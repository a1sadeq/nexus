# Implementation Plan: Task 1 — Custom Window Titlebar & Safe Chrome Lifecycle

**Target:** Windows & Linux Desktop  
**Status:** **COMPLETED & VERIFIED** (Passes all 7 security & architectural mandates)  
**Verification Results:** `478 / 478` tests pass, `npm run typecheck` clean, `npm run build` clean.  

---

## 1. Architectural & Security Mandates Implemented

1. **Explicit Platform Chrome Strategy (Zero Duplicate Controls):**
   - **Windows:** Integrates with native `titleBarOverlay`. On Windows, the in-app titlebar renders with `paddingRight: 140px` and **omits duplicate HTML caption buttons**, allowing native Windows 11 Snap layouts and caption controls to function unobstructed.
   - **Linux / Other:** Standard Linux runs native window decorations (`frame: true`). If custom controls are required (CSD / frameless), custom Minimize, Maximize/Restore, and Close buttons are rendered with accessible `aria-label`s and visible `:focus-visible` outlines.
2. **Safe Fallback when Titlebar is Hidden:**
   - When `showTitlebar: false`, the in-app titlebar collapses cleanly.
   - Window dragging remains accessible via the existing top navigation bar (`.top-navbar` has `.drag-region`).
   - On Windows with hidden titlebar, `.top-navbar` dynamically adds `paddingRight: 150px` so its action buttons never collide with native caption buttons.
3. **Narrow, Typed, Sender-Validated Preload IPC:**
   - Preload exposes only typed methods under `window.electron.windowControls`:
     - `minimize()`
     - `maximizeToggle()`
     - `close()`
     - `isMaximized()`
     - `onMaximizedChange(callback: (isMaximized: boolean) => void): (() => void)`
   - Main process validates `event.sender === mainWindow.webContents` via `isValidMainWindowSender`.
4. **Push Events Instead of Polling for Maximize State:**
   - Main process listens to `mainWindow.on('maximize')` and `mainWindow.on('unmaximize')`.
   - Pushes `window_maximized_changed` via IPC.
   - Renderer queries state once on mount via `isMaximized()`, then listens to pushed events. Zero interval polling.
   - Cleanup function removes listener on unmount.
5. **Cross-Process Layout Bounds Contract:**
   - Single source of truth: `containerRef.current.getBoundingClientRect()`.
   - Clamped to non-negative integers (`Math.max(0, Math.round(...))`).
   - Whenever `showTitlebar` toggles, `useEffect` triggers `restoreViewBounds()` immediately.
6. **Strict Draggable vs. Non-Draggable Boundaries:**
   - Empty titlebar surface has `.drag-region`.
   - Title pills, buttons, and badges have `.no-drag`. Double-clicking empty drag area triggers `maximizeToggle()`.
7. **Privacy & Accessibility Safeguards:**
   - Screen-share privacy: `maskTitlebarTitle` setting masks conversation titles to generic `"Nexus"`.
   - All interactive elements have `aria-label`, visible focus indicators, and keyboard actuation.

---

## 2. Modified & Created Files

- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/WindowTitleBar.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/WindowTitleBar.tsx) (NEW)
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/WindowTitleBar.test.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/WindowTitleBar.test.tsx) (NEW - 6 tests)
- [`/home/elsadek/vicinae/nexus electron/src/main/windowControlsIpc.test.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/windowControlsIpc.test.ts) (NEW - 7 tests)
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/lib/interfaceSettings.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/lib/interfaceSettings.ts) (Added `showTitlebar` and `maskTitlebarTitle` with migration)
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/lib/interfaceSettings.test.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/lib/interfaceSettings.test.ts) (Added test coverage)
- [`/home/elsadek/vicinae/nexus electron/src/preload/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/preload/index.ts) & [`/home/elsadek/vicinae/nexus electron/src/preload/index.d.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/preload/index.d.ts) (Added `onMaximizedChange`)
- [`/home/elsadek/vicinae/nexus electron/src/main/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/index.ts) (Added sender validation and event push)
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/App.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/App.tsx) (Integrated layout, bounds clamping, and dynamic padding)
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/SettingsOverlay.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/SettingsOverlay.tsx) (Added UI toggles and search indexing)
