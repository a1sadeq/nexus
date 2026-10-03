# IPC Listener Leak Fix Plan

## Objective
Eliminate the `MaxListenersExceededWarning` on `toggle_pin_tab` and `trigger_tab_cycle` caused by Electron contextBridge function proxying.

## Current Situation
In `src/renderer/src/App.tsx`, IPC listeners (`toggle_pin_tab` and `trigger_tab_cycle`) are registered inside a heavy `useEffect` that re-runs whenever tabs, activeId, or modals change.
Because `src/preload/index.ts` exposes `on` and `removeListener` through `contextBridge.exposeInMainWorld`, function references passed across the bridge are wrapped in new proxy functions. Consequently, `ipcRenderer.removeListener(channel, listener)` fails to match the original wrapper, leaving obsolete listeners attached and triggering Node's EventEmitter warning after 10 tab switches.

## Proposed Implementation
1. **Preload Registry & Unsubscribe Pattern**:
   - In `src/preload/index.ts`, maintain a map of listeners or return an explicit cleanup function `() => void` from `ipcRenderer.on`.
   - Ensure `removeListener` properly resolves wrapped functions if used directly.
2. **Renderer Listener Management**:
   - In `src/renderer/src/App.tsx`, decouple persistent global IPC listeners (`toggle_pin_tab`, `trigger_tab_cycle`) from frequently-invalidated component state by using mutable refs (`activeIdRef`, `tabsRef`, `togglePinRef`) or moving them into a dedicated, one-time initialization effect (`useEffect(..., [])`).
