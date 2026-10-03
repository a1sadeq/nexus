# Bottom Pinned Chats Menu Plan

## Objective
Add a user setting and UI layout option allowing the pinned chats bar to be placed at the bottom of the workspace as a sleek horizontal dock, as an alternative to the vertical side rail.

## Problem Analysis
- Currently, `PinnedSidebar.tsx` renders pinned chats vertically on the left/right side of the main workspace.
- The user requested an option to make the pinned chats menu appear at the bottom instead of on the side.
- When positioned at the bottom, the active webview bounds must be adjusted so that the bottom dock is not occluded by the webview.
- The bottom dock should present items horizontally with provider icon, title truncation, click-to-switch, close/unpin button, and full Iron Man HUD styling.

## Tasks
1. **Interface Settings & State**:
   - In `src/renderer/src/lib/interfaceSettings.ts`, add `pinnedPosition: 'sidebar' | 'bottom'` to `InterfaceSettings` with `'sidebar'` or user preference as default.
   - Add setting toggle in `SettingsOverlay.tsx` under Interface settings so the user can easily switch between `'sidebar'` and `'bottom'`.
2. **Bottom Dock Component / Layout**:
   - Create or update layout in `App.tsx` (or `PinnedSidebar.tsx` supporting bottom orientation):
     - When `pinnedPosition === 'bottom'` and there are pinned tabs, render a horizontal dock above the bottom window edge.
     - Height: e.g., 42px.
     - Adjust `getWebviewBounds()` / container bounds in `App.tsx` so the webview height accounts for the bottom dock.
3. **Styling**:
   - Apply HUD styling: subtle translucent glass background, HUD cyan border-top, horizontal scroll if many pinned tabs, compact pill/tile badges with model icons.
4. **Verification**:
   - Toggle between 'sidebar' and 'bottom' in Settings.
   - Verify webview resizing recalculates properly.
   - Verify unpinning and switching tabs work seamlessly.
