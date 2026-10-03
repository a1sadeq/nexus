# Fix Immediate Theme Application Plan

## Objective
Ensure that interface theming (including `data-preset="iron-man-hud"`, dark surfaces, contrast adjustments, cyan glow variables, and provider webview CSS) is applied immediately on application launch without requiring the user to open and close the Settings modal (`Ctrl+,`).

## Problem Analysis
- In `src/renderer/src/components/SettingsOverlay.tsx`, opening and closing settings invokes `applyInterfaceCssVariables(interfaceSettings)` and transmits the full transformed `themeColors` payload to `ipcRenderer.send('set_webview_theme', ...)`.
- On initial mount in `src/renderer/src/App.tsx`, only the basic `applyTheme(findTheme(themeState))` was invoked, and a simplified `{ on, colors, radius }` object was sent to the main process.
- As a result, `document.body` did not receive `data-preset` or HUD custom properties until `SettingsOverlay` mounted or saved.

## Tasks
1. **Initialize Interface Variables in App Mount**:
   - In `src/renderer/src/App.tsx`, import `loadInterfaceSettings`, `applyInterfaceCssVariables`, `computeSurfaceColors`, and `adjustAccentContrast` from `./lib/interfaceSettings`.
   - On initial mount (or theme state hydration), call `applyInterfaceCssVariables(interfaceSettings)` directly.
2. **Send Full Webview Theme Payload on Startup**:
   - Compute the full surface and contrast values and dispatch `set_webview_theme` to the main process so webview injection scripts have complete tokens from the moment tabs start loading.
3. **Verification**:
   - Verify that on a fresh launch or reload, the HUD borders, background textures, and webview styles appear immediately without pressing `Ctrl+,`.
