# Fix Startup Animation Native Webview Occlusion Plan

## Objective
Fix the issue where the J.A.R.V.I.S. Iron Man startup diagnostic sequence was frequently not running or appearing on screen, and restrict bypass keys to `Escape` and direct mouse click.

## Problem Analysis
1. **Native Webview Physical Occlusion**:
   - In Electron, a `BrowserView` / `WebContentsView` is a native window surface composited above the Chromium DOM renderer.
   - When the app launched, `containerRef`'s `ResizeObserver` or initial tab activation sent `resize_view` with full window bounds.
   - The native webview was immediately displayed over the entire window, physically occluding `JarvisBootOverlay` (which lives in the React DOM).
   - Because `showBootSequence` did not hide the webview or block `sendBounds()`, the animation ran unseen underneath the native webview canvas.
2. **Accidental Bypass Triggers**:
   - In `JarvisBootOverlay.tsx`, keyboard bypass included `Space` and `Enter`. Any stray keystroke during startup immediately cancelled the boot animation.

## Tasks
1. **Hide Native View During Boot Sequence**:
   - In `src/renderer/src/App.tsx`:
     - While `showBootSequence` is `true`, prevent `ResizeObserver` from setting non-zero webview bounds.
     - Send `resize_view({ x: 0, y: 0, width: 0, height: 0 })` on mount when `showBootSequence` is active.
     - When `showBootSequence` finishes, call `restoreViewBounds()` to smoothly reveal the webview.
2. **Restrict Bypass Keys in JarvisBootOverlay.tsx**:
   - Update keydown listener in `JarvisBootOverlay.tsx` to strictly check `e.key === 'Escape'` (and direct click), removing `Space` and `Enter`.
3. **Verification**:
   - Launch the application and confirm the full 5-second diagnostic sequence is visible on screen with Arc Reactor animations, telemetry progress, and smooth transition into the active tab upon completion.
