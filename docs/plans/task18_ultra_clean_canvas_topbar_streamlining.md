# Task 18: Ultra-Clean Canvas Topbar Streamlining

## 1. Context & Objective
The user specified: "Ultra-clean canvas — merge all top-bar buttons (Omni-search, HUD status, Agent export, New Tab) into the sidebar header/footer to maximize vertical webview viewport height."

When vertical tabs mode is active:
- The horizontal top navbar (`top-navbar` strip, ~44px height) is removed or collapsed to 0px.
- The webview viewport gains the full vertical height immediately below `WindowTitleBar`.
- Webview bounding box (`containerRef` / `resize_view` IPC) must calculate bounds without any layout shift or gaps.

## 2. Layout Integration in `App.tsx`
1. Re-evaluate `restoreViewBounds()` and container resize listeners:
   - When the top navbar is hidden, `containerRef` starts directly below `WindowTitleBar`.
   - The native webview container expands to fill `y = titlebarHeight` down to `height - bottomDockHeight`.
2. Responsive collapse:
   - Sidebar width smoothly transitions between collapsed (`w-44` ~176px for 3-5 word chips) and expanded (`w-64` ~256px).
   - Window resize and sidebar transition fire `restoreViewBounds()` so the webview aligns seamlessly.
3. Modals and Overlays:
   - Settings, History, Agent Handoff, Tab Overview modals continue to properly hide/show webviews via `resize_view` { x: 0, y: 0, width: 0, height: 0 }.

## 3. Verification
- Verify that `WindowTitleBar` maintains window draggable region (`-webkit-app-region: drag`) and AI model pill.
- Ensure no native webview clipping or overlapping occurs.
