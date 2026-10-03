# Export Session Context: Auto-Copy & Auto-Close Plan

## Objective
Enhance the `ExportOverlay` component to automatically copy the extracted markdown to the user's clipboard upon successful extraction, and automatically close the overlay after 10 seconds.

## Implementation Details
1. **Auto-Copy to Clipboard:**
   - Inside `ExportOverlay.tsx`, right after the `window.electron.ipcRenderer.invoke('extract_context')` promise resolves and sets the `markdown` state.
   - Use `navigator.clipboard.writeText(result)` to immediately copy the text.
   - Update the local `copied` state to `true` so the UI visually reflects that it has been copied.

2. **Auto-Close Timer (10 Seconds):**
   - Introduce a `useEffect` that starts a `setTimeout` for 10,000ms once the extraction is complete.
   - The timeout will call `onClose()`.
   - **Consideration:** If the user hovers over the popup or interacts with it, we should clear the timeout to prevent it from closing while they are reading the text.

3. **Escape Key Support:**
   - Add a global `keydown` event listener in `ExportOverlay.tsx` (or utilize the existing overlay background click handler).
   - If `e.key === 'Escape'`, call `onClose()`.
