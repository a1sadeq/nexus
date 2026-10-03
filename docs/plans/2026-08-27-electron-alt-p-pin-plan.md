# Plan: Fix Alt+P Pinning Shortcut

## Issue
Pressing `Alt+P` to pin the active chat tab fails. The webview correctly intercepts the shortcut and sends an IPC event `toggle_pin_tab` to the renderer, but the React frontend (`App.tsx`) is completely missing an IPC listener for this event. Additionally, if the focus is natively in the React UI (e.g., search bar), `Alt+P` is not handled in the global keyboard shortcuts.

## Solution
1. In `src/renderer/src/App.tsx`, inside the `useEffect` that sets up IPC listeners, add a listener for `toggle_pin_tab` that invokes the existing `togglePin(activeId)` function.
2. In the `handleGlobalShortcuts` function, explicitly add a check for `e.altKey && e.key.toLowerCase() === 'p'` to invoke `togglePin(activeId)` when focus is outside the webview.
