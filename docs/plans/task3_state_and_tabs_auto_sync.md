# Task 3: Automatic Nexus State, Tabs & Config Sync for Dev Mode

## Objective
Enable `npm run dev` to automatically read the complete live Nexus state (the exact 8 active tabs, active tab ID, pinned tabs, themes, models, zoom, and interface settings) that was opened in the packaged `nexus` application, eliminating discrepancies between dev mode and packaged mode.

## Root Cause
1. **Origin-Isolated LocalStorage**:
   - The packaged `/opt/Nexus/nexus` loads `file:///opt/Nexus/resources/app.asar/out/renderer/index.html` (origin `file://`).
   - `npm run dev` loads `http://localhost:5173` (origin `http://localhost:5173`).
   - In Chromium/Electron, `window.localStorage` is partitioned strictly by origin. The tabs stored in `localStorage['vicinae.tabs']` under `file://` are invisible to `http://localhost:5173`.
2. **Stale Disk Fallback**:
   - `tabs.json` on disk contained an outdated snapshot from an older session (9 stale tabs) rather than the user's latest 8 live tabs (`hunterHQ`, `Custom Cloudstream`, `Weird response page bug hunt`, `Review CustomBustomPin Project`, `Nexus`, `Arena | Benchmark`, `Nexus Build Plans Reviewer`, `BOLBOL & Progress scripts`).
3. **Renderer Race Condition**:
   - On initial mount in `App.tsx`, `initialTabs` renders a dummy tab (`createTab('gemini', 'New Chat')`) before the asynchronous `nexusState.get('tabs')` promise finishes resolving.

## Implementation Steps
1. **Bridge State from `file://` LevelDB to Disk**:
   - Extract the 8 live tabs from `_file://` LocalStorage in `~/.config/nexus/Local Storage/leveldb` and atomically write them to `~/.config/nexus/tabs.json`.
   - Ensure `pinned.json` accurately reflects the user's pinned tab list.
2. **Auto-Import Utility on Main Startup**:
   - In `src/main/index.ts` / `src/main/stateIpc.ts`, on startup in dev mode, inspect if `Local Storage/leveldb` contains newer `file://` tabs or state. If so, automatically sync them to disk so `npm run dev` always inherits live user sessions without manual intervention.
3. **Ensure Instant Hydration in `App.tsx`**:
   - In `src/renderer/src/App.tsx`, guarantee that `tabs` and `activeId` hydrate seamlessly and switch to the active tab (`BOLBOL & Progress scripts`) without flashing dummy tabs.
4. **Verification**:
   - Launch `npm run dev` and confirm all 8 tabs and active session appear immediately.
