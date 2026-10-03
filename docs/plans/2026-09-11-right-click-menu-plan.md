# Right-Click Context Menu Plan

## Objective
Enable a functional right-click context menu inside the AI webviews. Currently, right-clicking in the Chromium `BrowserView` does nothing because the `context-menu` event is unhandled in the Main process.

## Current Situation
Electron's `BrowserView` requires explicit handling of the `context-menu` event (or using a library like `electron-context-menu`) to render the native OS right-click menu (Copy, Paste, Cut, etc.).

## Brainstorming & Open Questions
- Should the menu just contain the standard editing tools (Copy, Paste, Cut, Select All)?
- Do we need "Inspect Element" for debugging?
- Do we want custom AI-specific actions (e.g., "Reload this frame")?

## Proposed Implementation Steps (Pending Clarification)
1. In `src/main/index.ts`, attach a `context-menu` event listener to `view.webContents`.
2. Construct a native `Menu` template dynamically based on what the user right-clicked on (text selection vs. image vs. empty space).
3. Popup the menu using `Menu.buildFromTemplate(template).popup()`.
