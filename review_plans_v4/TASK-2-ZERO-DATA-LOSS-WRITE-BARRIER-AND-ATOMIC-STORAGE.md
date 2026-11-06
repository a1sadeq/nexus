# Task 2: Zero-Data-Loss Write Barrier & Atomic Storage Engine

**Findings Addressed**: B3 (flush on quit), B4 (sequencing guard first), H1 (session write barrier vs flawed tab-count heuristic), M1 (main-owned debounce), M2 (tmp+fsync+rename & 2-gen `.bak`/`.bak2`), M6 (sender trust), M10 (payload & schema validation).

---

## 1. Context & Architecture

To eliminate the possibility of any renderer instance wiping disk files during startup, this task builds the **Storage Engine & Write Barrier in the Main Process** BEFORE the renderer is allowed to trigger disk persistence.

### Key Innovations:
1. **The Session Write Barrier (Fix 3, H1)**:
   - A `webContents` is tracked by its `id`.
   - Any `save_<key>` invocation is **strictly rejected** unless that exact `webContents` session previously completed a successful `get_<key>` read.
   - Eliminates startup race conditions where an unhydrated component emits an empty save.
2. **Main-Owned Debounce & Flush on Quit (Fix 4, B3, M1)**:
   - Debounce timers live in the Node.js main process, surviving renderer navigation and crashes.
   - Immediate leading-edge write on first modification; subsequent modifications coalesced over a 400ms window.
   - `app.on('before-quit', flushState)` synchronously flushes pending memory state to disk.
3. **Atomic Writes & 2-Generation Backup (Fix 4, M2)**:
   - File writes target `${file}.tmp-${process.pid}` followed by `fsyncSync` and atomic `renameSync`.
   - Rotates `${file}.bak` to `${file}.bak2` before overwriting, guaranteeing resilience against two consecutive bad writes.
   - `readJson` features a recovery ladder: `file` -> `.bak` -> `.bak2` -> quarantine corrupted file to `.corrupt-<timestamp>`.

---

## 2. Technical Implementation

### Step 2.1: Atomic Storage Engine (`src/main/atomicWrite.ts`)
```typescript
import { app } from 'electron'
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_FILES = {
  tabs: 'tabs.json',
  pinned: 'pinned.json',
  theme: 'theme.json',
  models: 'models.json',
  providers: 'providers.json',
  interface_settings: 'interface-settings.json'
} as const

export type StateKey = keyof typeof STATE_FILES

export function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8')
    fsyncSync(fd) // Flush OS buffers to physical disk
  } finally {
    closeSync(fd)
  }
  // Two-generation backup rotation
  if (existsSync(`${file}.bak`)) {
    try { renameSync(`${file}.bak`, `${file}.bak2`) } catch {}
  }
  if (existsSync(file)) {
    try { copyFileSync(file, `${file}.bak`) } catch {}
  }
  renameSync(tmp, file)
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    // Recovery ladder: .bak -> .bak2
    for (const candidate of [`${file}.bak`, `${file}.bak2`]) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8')) as T
      } catch {}
    }
    // Quarantine corrupted file; do not overwrite silently
    try {
      if (existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {}
    return null
  }
}

// Main-owned coalescing debounce with quit-time flush
const pending = new Map<StateKey, unknown>()
let debounceTimer: NodeJS.Timeout | null = null
const TRAILING_MS = 400

export function scheduleWrite(key: StateKey, data: unknown): void {
  const isFirst = pending.size === 0 && !debounceTimer
  pending.set(key, data)
  if (isFirst) {
    flushState() // Leading edge write
  } else if (!debounceTimer) {
    debounceTimer = setTimeout(flushState, TRAILING_MS)
  }
}

export function flushState(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const dir = app.getPath('userData')
  for (const [key, data] of pending) {
    atomicWriteJson(join(dir, STATE_FILES[key]), data)
  }
  pending.clear()
}

// Synchronously flush all trailing debounce windows on app exit
app.on('before-quit', flushState)
```

### Step 2.2: State IPC Registration & Write Barrier (`src/main/stateIpc.ts`)
```typescript
import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { readJson, scheduleWrite, STATE_FILES, type StateKey } from './atomicWrite'

const trustedSenders = new Set<number>()
export function trustWindow(win: BrowserWindow): void {
  trustedSenders.add(win.webContents.id)
  win.on('closed', () => trustedSenders.delete(win.webContents.id))
}

const hydratedSessions = new Set<string>() // composite key: `${senderId}:${stateKey}`

const SAFE_URL_REGEX = /^https?:\/\//i

function validatePayload(key: StateKey, payload: unknown): void {
  if (!payload || typeof payload !== 'object') throw new Error(`Invalid payload for ${key}`)
  if (key === 'tabs') {
    const tabs = (payload as any).tabs
    if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('tabs[] required and must not be empty')
    if (tabs.length > 64) throw new Error('Exceeded maximum tab cap (64)')
    for (const t of tabs) {
      if (typeof t?.id !== 'string' || typeof t?.url !== 'string') throw new Error('Invalid tab shape')
      if (!SAFE_URL_REGEX.test(t.url)) throw new Error(`Blocked unsafe tab URL scheme: ${t.url}`)
    }
  }
}

export function registerStateIpc(): void {
  for (const key of Object.keys(STATE_FILES) as StateKey[]) {
    // Read Handler
    ipcMain.handle(`get_${key}`, (event) => {
      if (!trustedSenders.has(event.sender.id)) throw new Error('Untrusted IPC sender')
      const filePath = join(app.getPath('userData'), STATE_FILES[key])
      const data = readJson(filePath)
      // Open the barrier for this session
      hydratedSessions.add(`${event.sender.id}:${key}`)
      return data
    })

    // Write Handler
    ipcMain.handle(`save_${key}`, (event, payload) => {
      if (!trustedSenders.has(event.sender.id)) throw new Error('Untrusted IPC sender')
      // Enforce the Write Barrier
      if (!hydratedSessions.has(`${event.sender.id}:${key}`)) {
        throw new Error(`Write Barrier: save_${key} rejected because session never completed get_${key}`)
      }
      validatePayload(key, payload)
      scheduleWrite(key, payload)
      return true
    })
  }
}
```

---

## 3. Verification Criteria
1. Any `save_*` called before `get_*` throws a Write Barrier rejection.
2. Terminating the app immediately after modifying state flushes trailing state to disk via `before-quit`.
3. Disk files are written atomically with `.tmp` and backed up to `.bak` and `.bak2`.
