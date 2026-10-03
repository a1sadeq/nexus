# Plan: MRU (Most Recently Used) Tab Closing

## Issue
When a user closes the currently active tab using `Ctrl+W` or by clicking the 'X' button, the app incorrectly selects the *last tab in the array* as the next active tab, completely ignoring the user's previously active tab. 

## Solution
1. In `src/renderer/src/App.tsx`, we already have `mruTabIds` tracking the history of active tabs.
2. We will extract a unified `closeTab(id: string)` function inside `App.tsx` to handle tab closure.
3. The `closeTab` function will calculate the next active tab by looking at the second item in `mruTabIds` (the most recently used tab before the closed one) that still exists in the tabs array.
4. If no such MRU tab exists, it will safely fallback to the nearest neighbor.
5. Both the `Ctrl+W` shortcut handler and the `onClose` prop passed to `<ChatTabs>` will use this unified `closeTab` function.
