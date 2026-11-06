# Task 1: Bootstrap Order and Archive Consolidation

**Findings Addressed**: H3 (archive vs delete), M5 (merge policy), M8 (`mkdirSync` & `sessionData`), M9 (artifact hygiene), L1 (downgrade caveat), L2 (`bootstrap.ts` first import), L6 (`migration-v1.log`).

---

## 1. Context & Diagnosis
- **The Defect**:
  In `src/main/index.ts`, `app.requestSingleInstanceLock()` ran before `app.setPath('userData', ...)` was called.
  Because `electron-builder.yml` specifies `productName: Nexus`, Electron defaulted `app.name` to `"Nexus"`, creating single-instance lock files in `~/.config/Nexus/` on Linux before redirecting storage to `~/.config/nexus/`.
- **Nuance A (M8)**: `app.setPath('userData', ...)` throws an Error if the target directory does not exist on disk (e.g. fresh machine or fresh OS account).
- **Nuance B (M8)**: Electron 34+ introduces `sessionData` (which lazily derives from `userData`). Setting `sessionData` explicitly guarantees that persistent partitions (`Partitions/ai-shared`) never drift from `userData`.

---

## 2. Technical Implementation

### Step 1.1: Dedicated Top-Level Bootstrap Module (`src/main/bootstrap.ts`)
Create `src/main/bootstrap.ts` to be imported on line 1 of `src/main/index.ts`:

```typescript
// src/main/bootstrap.ts
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// 1. Force lowercase app name to prevent ~/.config/Nexus creation
app.name = 'nexus'

// 2. Ensure directory exists before setPath (prevents first-boot throw)
const userData = join(app.getPath('appData'), 'nexus')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

// 3. Pin sessionData explicitly for Electron >= 34
try {
  app.setPath('sessionData', userData)
} catch {
  // Graceful fallback on older Electron runtimes
}

export {}
```

### Step 1.2: Correct Lock Placement in `src/main/index.ts`
Import `./bootstrap` as the very first line of `src/main/index.ts`. Call `app.requestSingleInstanceLock()` strictly **after** `bootstrap.ts` has initialized `userData`:

```typescript
// src/main/index.ts
import './bootstrap' // Must be absolute first import!
import { app, BrowserWindow, ... } from 'electron'

// Single-instance lock now safely uses ~/.config/nexus/SingletonLock
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    toggleMainWindow()
  })
}
```

### Step 1.3: Archive-Based Safe Consolidation (`src/main/migrations/consolidateLegacyConfigDir.ts`)
Rather than calling `rm -rf` on `~/.config/Nexus`, implement atomic archive-rename:

```typescript
import { app } from 'electron'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SINGLETON = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])

export function consolidateLegacyConfigDir(): void {
  const appData = app.getPath('appData')
  const legacy = join(appData, 'Nexus')
  const live = join(appData, 'nexus')
  if (!existsSync(legacy) || legacy === live) return // Idempotent

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const archive = join(appData, `Nexus.archived-${stamp}`)
  mkdirSync(archive, { recursive: true })
  const log = (m: string) => appendFileSync(join(live, 'migration-v1.log'), `${new Date().toISOString()}  ${m}\n`)

  for (const entry of readdirSync(legacy)) {
    try {
      // Archive dead singleton locks and stale August partitions without overwriting live session
      if (SINGLETON.has(entry) || entry === 'Partitions') {
        renameSync(join(legacy, entry), join(archive, entry))
        log(`archived without merge: ${entry}`)
        continue
      }
      const from = join(legacy, entry)
      const to = join(live, entry)
      if (!existsSync(to)) {
        // Unique file (e.g. shortcuts.json) -> migrate safely
        renameSync(from, to)
        log(`migrated: ${entry}`)
      } else {
        // Conflict resolution: keep newer mtime, archive loser
        const fromNewer = statSync(from).mtimeMs > statSync(to).mtimeMs
        const loser = fromNewer ? to : from
        copyFileSync(loser, join(archive, entry))
        if (fromNewer) copyFileSync(from, to)
        renameSync(from, join(archive, `${entry}.legacy`))
        log(`conflict: ${entry} - kept ${fromNewer ? 'legacy' : 'live'}, loser quarantined`)
      }
    } catch (err) {
      log(`ERROR on ${entry}: ${String(err)} - left in place`)
    }
  }
  try {
    renameSync(legacy, `${archive}.remainder`)
    log('remainder archived')
  } catch {}
}
```

---

## 3. Verification Criteria
1. `npm run dev` and production builds create `SingletonLock` inside `~/.config/nexus/`.
2. `~/.config/Nexus` is renamed to `Nexus.archived-<stamp>` and never recreated.
3. `~/.config/nexus/migration-v1.log` contains an exact audit trail of migrated items.
