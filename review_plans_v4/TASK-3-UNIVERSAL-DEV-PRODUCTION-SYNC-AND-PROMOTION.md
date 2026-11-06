# Task 3: Universal Dev-Production Sync and Promotion

**Findings Addressed**: B1 (complete IPC read/write surface), B2 (`interface-settings.json` on-disk artifact & one-time promotion), H2 (`providers.json` included in sync), M3 (1.5s timeout & read-only fallback), M4 (pre-paint synchronous theme read), M11 (Electron version marker).

---

## 1. Context & Architecture

Once the main-process Write Barrier and Atomic Storage Engine (Task 2) are verified in place, the renderer can safely be connected to file-backed state.

### Key Objectives:
1. **Full State Surface Unified**:
   - `tabs.json`, `pinned.json`, `theme.json`, `models.json`, `providers.json`, `interface-settings.json`.
2. **Pre-Paint Theme Flash Elimination (Fix 4, M4)**:
   - Provide a synchronous IPC call `get_theme_sync` through `contextBridge` invoked once before first paint to prevent Flash-of-Unstyled-Content (FOUC).
3. **One-Time Promotion Migration for Interface Settings (Fix 5, B2)**:
   - On the first production launch, if `interface-settings.json` is missing on disk but present in renderer `localStorage`, promote it to disk via `save_interface_settings`.
4. **Resilient Hydration with Read-Only Fallback (Fix 5, M3, L4)**:
   - Promise race against a 1500ms timeout.
   - If timeout or error occurs, render local storage in read-only mode without dispatching writes.

---

## 2. Technical Implementation

### Step 3.1: Preload API Bridge Extension (`src/preload/index.ts`)
Expose typed state methods:

```typescript
contextBridge.exposeInMainWorld('nexusState', {
  get: (key: string): Promise<unknown> => ipcRenderer.invoke(`get_${key}`),
  save: (key: string, data: unknown): Promise<unknown> => ipcRenderer.invoke(`save_${key}`, data),
  getThemeSync: (): unknown => ipcRenderer.sendSync('get_theme_sync')
})
```

Register synchronous theme responder in `src/main/stateIpc.ts`:
```typescript
ipcMain.on('get_theme_sync', (event) => {
  event.returnValue = readJson(join(app.getPath('userData'), 'theme.json'))
})
```

### Step 3.2: Universal Hydration and Persistence in `src/renderer/src/App.tsx`
Replace origin-isolated `localStorage` calls with universal hydration:

```tsx
// 1. Tabs State Hydration
const [tabsHydrated, setTabsHydrated] = useState(false)
const [tabs, setTabs] = useState<Tab[] | null>(null) // null renders skeleton, avoiding default clobber
const [activeId, setActiveId] = useState<string | null>(null)

useEffect(() => {
  let active = true
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500))

  Promise.race([window.nexusState?.get('tabs'), timeout])
    .then((result) => {
      if (!active) return
      if (result !== 'timeout' && result && typeof result === 'object' && Array.isArray((result as any).tabs)) {
        // Disk wins: hydrate live tabs
        setTabs((result as any).tabs)
        setActiveId((result as any).activeId || (result as any).tabs[0]?.id)
        localStorage.setItem(TABS_STORAGE_KEY, serializeState((result as any).tabs, (result as any).activeId))
        setTabsHydrated(true)
      } else if (result === 'timeout') {
        // Read-only fallback: render local storage, NEVER write back until disk resolves
        const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
        if (restored) {
          setTabs(restored.tabs)
          setActiveId(restored.activeId)
        }
      } else {
        // Fresh install: initialize default tab
        const initial = createTab('gemini', 'New Chat', 'https://gemini.google.com')
        setTabs([initial])
        setActiveId(initial.id)
        setTabsHydrated(true)
      }
    })
    .catch((err) => {
      console.warn('[state] Tabs hydration fallback:', err)
    })

  return () => { active = false }
}, [])

// Safe Persistence: Gated on successful hydration
useEffect(() => {
  if (!tabsHydrated || !tabs || tabs.length === 0) return
  const serialized = serializeState(tabs, activeId)
  localStorage.setItem(TABS_STORAGE_KEY, serialized)
  window.nexusState?.save('tabs', { tabs, activeId }).catch((err: Error) => {
    console.error('Failed to save tabs:', err)
  })
}, [tabs, activeId, tabsHydrated])

// 2. One-Time Promotion: Migrate Interface Settings to Disk
useEffect(() => {
  if (!tabsHydrated) return
  window.nexusState?.get('interface_settings').then((diskData) => {
    if (diskData == null) {
      const local = localStorage.getItem('nexus.interfaceSettings') || localStorage.getItem('vicinae.interfaceSettings')
      if (local) {
        try {
          const parsed = JSON.parse(local)
          window.nexusState?.save('interface_settings', parsed)
        } catch {}
      }
    }
  })
}, [tabsHydrated])
```

### Step 3.3: Electron Version Skew Marker (`src/main/stateIpc.ts`)
Guard the shared `persist:ai-shared` profile against accidental runtime version downgrade:

```typescript
const markerPath = join(app.getPath('userData'), '.electron-version')
try {
  const recorded = readFileSync(markerPath, 'utf-8').trim()
  const running = `electron ${process.versions.electron}`
  if (recorded && recorded !== running) {
    console.warn(`[nexus] Profile was last opened by ${recorded}, now running ${running}`)
  }
} catch {}
try {
  writeFileSync(markerPath, `electron ${process.versions.electron}\n`, 'utf-8')
} catch {}
```

---

## 3. Verification Criteria
1. Running `npm run dev` restores all 9 tabs from `~/.config/nexus/tabs.json` on initial mount.
2. Interface settings are promoted to `~/.config/nexus/interface-settings.json`.
3. AI webview sessions remain authenticated across both dev and production.
