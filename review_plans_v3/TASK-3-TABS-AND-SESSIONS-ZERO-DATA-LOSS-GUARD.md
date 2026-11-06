# Task 3: Tabs and Sessions Zero-Data-Loss Guard

## 1. Context & Risk Analysis
- **The Accidental Wipe Threat**:
  If the renderer initializes with empty tabs (or a fallback single tab) and immediately pushes this state to the main process via `save_tabs`, it could overwrite a populated `~/.config/nexus/tabs.json` containing the user's real open workspace tabs.
- **Race Condition Guard Requirement**:
  - The renderer must NOT write `save_tabs` until it has successfully completed hydration from disk.
  - The main process `save_tabs` handler must refuse to overwrite a multi-tab file with a single blank fallback tab on startup.

## 2. Technical Implementation Plan
1. **Renderer Hydration Flag**:
   - In [src/renderer/src/App.tsx](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/App.tsx):
     ```typescript
     const [tabsHydrated, setTabsHydrated] = useState(false)
     ```
   - Do not trigger disk persistence for `tabs` until `tabsHydrated === true`.
2. **Main Process Overwrite Protection**:
   - In `save_tabs` handler in `src/main/index.ts`:
     - If incoming data contains only 1 default tab, but disk contains 2+ tabs, check whether the save is a user-initiated tab closure or a startup race condition.
     - Maintain an atomic backup: `tabs.json.bak` whenever writing changes.
3. **Serialization Integrity**:
   - Ensure `serializeState(tabs, activeId)` and `deserializeState(...)` handle:
     - Model key preservation.
     - Pinned tab states.
     - Split pane arrangements if present.
     - MRU (Most Recently Used) navigation stack ordering.

## 3. Verification Criteria
- Starting `npm run dev` with existing `tabs.json` retains all tabs without blanking.
- Closing tabs intentionally updates `tabs.json` accurately.
- `tabs.json.bak` exists as a safety fallback.
