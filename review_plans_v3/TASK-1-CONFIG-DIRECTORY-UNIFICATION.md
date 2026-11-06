# Task 1: Config Directory Unification (`.config/Nexus` -> `.config/nexus`)

## 1. Context & Diagnosis
- **Investigation Finding**:
  - `/home/elsadek/.config/Nexus`: Contains `SingletonLock -> A1sadeq-3329279`, `SingletonCookie`, `SingletonSocket`, `shortcuts.json`, and stale empty partition folders from August.
  - `/home/elsadek/.config/nexus`: Contains live production databases:
    - `history.json` (478 KB, 65 items, latest Nov 6)
    - `models.json` (2.4 KB)
    - `providers.json` (25 KB, all 7 configured providers)
    - `pinned.json` (465 B)
    - `tabs.json` (2.2 KB)
    - `theme.json` (522 B)
    - `Partitions/ai-shared` (160 KB cookies, active logins)
- **Root Cause**:
  In [src/main/index.ts](file:///home/elsadek/vicinae/nexus%20electron/src/main/index.ts):
  ```typescript
  // Line 78:
  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  // ...
  // Line 89:
  app.setPath('userData', join(app.getPath('appData'), 'nexus'))
  ```
  Because `electron-builder.yml` sets `productName: Nexus`, Electron defaulted `app.getName()` to `"Nexus"`. At line 78, calling `app.requestSingleInstanceLock()` immediately instantiated Chromium's process singleton handler in `~/.config/Nexus`.
  Only *after* the lock was created did line 89 redirect `userData` to `~/.config/nexus`.

## 2. Technical Implementation Plan
1. **Bootstrap Re-Ordering in `src/main/index.ts`**:
   - Immediately after Electron imports, explicitly set:
     ```typescript
     app.name = 'nexus'
     app.setPath('userData', join(app.getPath('appData'), 'nexus'))
     ```
   - Place `app.requestSingleInstanceLock()` strictly *after* `userData` is set.
   - Result: `SingletonLock`, `SingletonCookie`, and `SingletonSocket` will be created inside `~/.config/nexus/`. The uppercase `~/.config/Nexus` directory will never be touched by Electron again.
2. **One-Time Safe Consolidation & Cleanup**:
   - Add a startup check in main process:
     ```typescript
     const uppercaseDir = join(app.getPath('appData'), 'Nexus')
     const lowercaseDir = join(app.getPath('appData'), 'nexus')
     if (existsSync(uppercaseDir)) {
       // Migrate any unique files (e.g. shortcuts or custom skills) if newer/missing
       // Prune obsolete singleton symlinks and remove uppercaseDir
     }
     ```
   - Preserve all data, ensuring zero risk of loss.

## 3. Verification Criteria
- `npm run dev` and `npm run build` boot without creating `/home/elsadek/.config/Nexus`.
- `ls /home/elsadek/.config/Nexus` returns "No such file or directory" once cleaned.
- Single-instance locking functions properly across repeated launches.
