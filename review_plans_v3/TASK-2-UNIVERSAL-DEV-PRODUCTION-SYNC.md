# Task 2: Universal Dev-Production Sync

## 1. Context & Diagnosis
- **User Issue**:
  When running `npm run dev`, Nexus opens with "test data" / fresh state instead of the user's real tabs, themes, interface settings, and active session.
- **Root Cause Analysis**:
  1. In production, Electron loads via packaged assets (`file://` or custom scheme).
  2. In `npm run dev`, Vite serves the renderer on `http://localhost:5173`.
  3. Chromium strictly silos `window.localStorage` per origin. `http://localhost:5173` has its own isolated `localStorage` completely separate from production.
  4. In [src/renderer/src/App.tsx](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/App.tsx#L99-L105):
     ```typescript
     const [initialTabs] = useState(() => {
       const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
       if (restored && restored.tabs.length > 0) return restored
       const initial = createTab('gemini', 'New Chat', 'https://gemini.google.com')
       return { tabs: [initial], activeId: initial.id }
     })
     ```
     Because `http://localhost:5173` had no `localStorage`, it fell back to creating a dummy Gemini "New Chat" tab!
  5. The main process already has IPC handlers `get_tabs`, `save_tabs`, `get_pinned`, `save_pinned`, and `list_history`, but `App.tsx` was relying on `localStorage` for tab hydration.

## 2. Technical Implementation Plan
1. **Universal Dual-Persistence Hydration in `App.tsx`**:
   - On startup, request `get_tabs`, `get_pinned`, `get_theme`, `get_interface_settings`, and `get_models` via IPC from `~/.config/nexus/`.
   - Hydrate React state from disk. Populate `localStorage` as a fast local mirror.
   - If disk has tabs saved (e.g. user had 5 active tabs open), render them immediately in `npm run dev`!
2. **Synchronized Persistence Handlers**:
   - In `App.tsx`, whenever tabs, active tab, pinned tabs, theme, or interface settings are modified:
     - Save to `localStorage` (for instant synchronous next-frame recovery).
     - Dispatch atomic debounced write to main process (`save_tabs`, `save_pinned`, `save_theme`, etc.) targeting `~/.config/nexus/`.
3. **Shared Partition for Webview Logins**:
   - Webviews in both `npm run dev` and production specify `partition: 'persist:ai-shared'`.
   - With `userData` pinned to `~/.config/nexus`, the partition files live at `~/.config/nexus/Partitions/ai-shared/`.
   - Result: Google Gemini, ChatGPT, Claude, DeepSeek, and Kimi logins persist seamlessly between `npm run dev` and production.

## 3. Verification Criteria
- Launching `npm run dev` immediately restores the user's open tabs, custom model order, themes, and interface width settings.
- History drawer in `npm run dev` displays all 65 live history entries.
- Creating a tab or altering theme in dev updates `~/.config/nexus/tabs.json` and `~/.config/nexus/theme.json`.
