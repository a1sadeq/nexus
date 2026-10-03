# Fix Ctrl+T Focus & Keyboard Shortcuts Plan

## Objective
Ensure that opening `NewTabOverlay` via `Ctrl+T` immediately focuses and selects the search input, prevents focus drop into limbo, and ensures application keyboard shortcuts continue working reliably without requiring the user to click or restart the application.

## Problem Analysis
1. **Focus Drop on Hidden Webview**:
   - In `src/main/index.ts`, when `resize_view` receives `bounds.width === 0 && bounds.height === 0` (hidden), it previously checked `if (mainWindow && mainWindow.isFocused())`.
   - On Linux/Windows, when a child `BrowserView`/`WebContentsView` is active, `mainWindow.isFocused()` often returns `false`. Because of this guard, `mainWindow.focus()` and `mainWindow.webContents.focus()` were never called, leaving OS window focus in a detached state where neither the webview nor the renderer had focus.
2. **Delayed Modal Opening in Renderer**:
   - In `src/renderer/src/App.tsx`, `setShowNewTab(true)` and `resize_view` were wrapped inside `captureActiveSnapshot().then(...)`.
   - If snapshot generation took 200-500ms or stalled, modal opening and view hiding were delayed, swallowing subsequent keyboard inputs.
3. **Missing Immediate Input Focus**:
   - In `src/renderer/src/components/NewTabOverlay.tsx`, the search input lacked `autoFocus` and relied solely on delayed `useFocusLock` timeouts.

## Tasks
1. **Main Process Unconditional Window & Content Focus**:
   - In `src/main/index.ts` within `ipcMain.on('resize_view', ...)`:
     - When `hidden === true`, remove `mainWindow.isFocused()` check and immediately call:
       ```ts
       if (mainWindow && !mainWindow.isDestroyed()) {
         mainWindow.focus()
         if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
           mainWindow.webContents.focus()
         }
       }
       ```
     - Also add a dedicated IPC handler or ensure `mainWindow.webContents.focus()` is triggered when modals open.
2. **Instant Modal Dispatch in App.tsx**:
   - In `src/renderer/src/App.tsx` on `Ctrl+T`:
     - Immediately invoke `setShowNewTab(true)` and `resize_view(0, 0, 0, 0)`.
     - Run `captureActiveSnapshot()` asynchronously in the background without blocking the UI.
3. **Multi-Stage Focus Lock in NewTabOverlay.tsx**:
   - Add `autoFocus` to `<input ref={inputRef} />`.
   - Add immediate `requestAnimationFrame` and microtask focus calls on mount to guarantee the input captures focus as soon as the DOM renders.
4. **Verification**:
   - Press `Ctrl+T` repeatedly from within webviews and verify the input is always immediately focused, typing works instantly, and pressing `Escape` or `Ctrl+T` closes it smoothly.
