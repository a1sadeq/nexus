// src/main/atomicWrite.ts
import { app } from 'electron'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
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

/**
 * Atomically writes data to a JSON file:
 * 1. Writes to temporary file with current process PID.
 * 2. Calls fsync to ensure buffers are physically written to storage.
 * 3. Rotates existing backup: .bak -> .bak2 (two generations).
 * 4. Copies live file to .bak before replacing.
 * 5. Atomically renames tmp file over target.
 */
export function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  // 2-generation backup rotation
  if (existsSync(`${file}.bak`)) {
    try {
      renameSync(`${file}.bak`, `${file}.bak2`)
    } catch {}
  }
  if (existsSync(file)) {
    try {
      copyFileSync(file, `${file}.bak`)
    } catch {}
  }

  renameSync(tmp, file)
}

/**
 * Reads JSON with fallback ladder: file -> .bak -> .bak2.
 * If all fail, quarantines the corrupted file to .corrupt-<timestamp>
 * so it is never silently overwritten without a trace.
 */
export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    for (const candidate of [`${file}.bak`, `${file}.bak2`]) {
      try {
        if (existsSync(candidate)) {
          return JSON.parse(readFileSync(candidate, 'utf-8')) as T
        }
      } catch {}
    }
    // Quarantine corrupted file
    try {
      if (existsSync(file)) {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      }
    } catch {}
    return null
  }
}

// Main-owned coalescing debounce with quit-time flush
const pending = new Map<StateKey, unknown>()
let debounceTimer: NodeJS.Timeout | null = null
const TRAILING_MS = 400

export function scheduleWrite(key: StateKey, data: unknown): void {
  pending.set(key, data)
  if (!debounceTimer) {
    // Leading edge write: first change lands immediately
    const dir = app.getPath('userData')
    const filename = STATE_FILES[key]
    if (filename) {
      atomicWriteJson(join(dir, filename), data)
    }
    // Arm trailing timer to coalesce subsequent rapid writes
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
    const filename = STATE_FILES[key]
    if (filename) {
      atomicWriteJson(join(dir, filename), data)
    }
  }
  pending.clear()
}

// Synchronously flush all trailing debounce windows on app exit
app.on('before-quit', flushState)
