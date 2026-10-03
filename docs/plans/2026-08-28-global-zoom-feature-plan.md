# Global App Zoom Feature Plan

## Objective
Implement a global zoom feature that scales the entire application (both the Nexus UI and the underlying AI webviews) using `Ctrl +` and `Ctrl -` shortcuts, and provide UI controls within the Settings menu.

## Implementation Details
1. **Zoom State Management:**
   - Introduce a `zoomLevel` state (defaulting to 1.0) stored persistently so the app remembers the user's preference.
   - When `zoomLevel` changes, apply it to the main React UI (via `webFrame.setZoomFactor` in the renderer) AND broadcast the change to the main process so it can apply `webContents.setZoomFactor` to all active AI browser views.

2. **Global Shortcuts (`App.tsx`):**
   - Intercept `Ctrl + =` (or `+`) to increment zoom by `0.1` (max `2.0`).
   - Intercept `Ctrl + -` to decrement zoom by `0.1` (min `0.5`).
   - Intercept `Ctrl + 0` to reset zoom to `1.0`.

3. **Settings UI Integration:**
   - In `SettingsOverlay.tsx`, add a new section for "Appearance" or "Zoom".
   - Include intuitive `-` and `+` buttons alongside a percentage display (e.g., `110%`).
   - Allow the user to reset to 100% easily from the UI.
   
4. **Main Process IPC:**
   - Create an IPC handler (e.g., `set_zoom_factor`) in `src/main/index.ts` that receives the zoom level and applies it to all `aiViews`.
   - Update `preload/index.ts` to expose this IPC call safely.
