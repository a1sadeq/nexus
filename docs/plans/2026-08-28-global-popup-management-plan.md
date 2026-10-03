# Global Popup Management & Shortcut Priority Plan

## Objective
Ensure that various popups (History, Export, etc.) play nicely together. Only one popup should be open at a time. Pressing `Escape` should close the active popup. Pressing a shortcut like `Ctrl+H` should close any currently open popup (like Export) and open History.

## Implementation Details
1. **Unified Overlay State (or Mutual Exclusion):**
   - In `App.tsx`, we currently have states like `showHistory` and `showExport`.
   - When toggling `showHistory` via `Ctrl+H`, we must explicitly call `setShowExport(false)`.
   - Similarly, when clicking Export, we should ensure History and any other overlays are closed.
   
2. **Keyboard Shortcut Refactoring (`App.tsx`):**
   - Intercept the `keydown` event globally.
   - If `Escape` is pressed:
     - Check if `showExport` is true -> `setShowExport(false)`.
     - Check if `showHistory` is true -> `setShowHistory(false)`.
   - If `Ctrl+H` is pressed:
     - Prevent default.
     - `setShowExport(false)`
     - Toggle `showHistory`.
