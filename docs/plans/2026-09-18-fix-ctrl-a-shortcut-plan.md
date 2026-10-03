# Fix Ctrl+A Shortcut Plan

## Objective
Restore `Ctrl+A` (Select All) functionality across webviews and UI inputs, preventing the main process from intercepting and blocking Chromium's native text selection.

## Problem Analysis
- In `src/main/index.ts`, `globalKeys` array currently includes `'a'`.
- When `Ctrl+A` is pressed, `event.preventDefault()` is executed on webview input events, suppressing native select-all.
- Additionally, `App.css` had a global `user-select: none;` on `html, body, #root`, which restricts text selection in the application wrapper.

## Tasks
1. **Main Process Shortcut Interception**:
   - In `src/main/index.ts`, remove `'a'` from `globalKeys` in `view.webContents.on('before-input-event', ...)`.
   - Ensure `Ctrl+A` passes directly through to Chromium's native edit commands.
2. **Renderer CSS Selection Scope**:
   - In `src/renderer/src/App.css`, refine `user-select: none;` so that text in editable inputs, search bars, textareas, and webviews are not restricted from being selected.
3. **Verification**:
   - Verify typing in webviews, input boxes, and pressing `Ctrl+A` selects text as expected.
