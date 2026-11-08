# Task 31 Plan: Visual Tabs Sorting & Keyboard Navigation Synchronization

## Context & Objectives
- When using `Ctrl+J` (next tab / down) and `Ctrl+K` (prev tab / up), the navigation logic in `App.tsx` filtered the raw `tabs` array solely by `isPinned` (`tabs.filter(t => pinnedIds.includes(t.id) === isPinned)`).
- This caused two major issues:
  1. **UI Sorting Mismatch**: The raw `tabs` array creation order differed from the visual `VerticalTabs` sidebar order (`pinned active tabs`, then `unpinned active tabs`, followed by sleeping tabs).
  2. **Accidental Waking & Insertion of Discarded Tabs**: `tabs.filter(...)` included unpinned sleeping/discarded tabs. When `Ctrl+J/K` stepped onto a sleeping tab, `switchToTab` immediately woke it and inserted it into `residentTabIds` (the Active Sessions section), disrupting the user's active session grouping.
- Objective:
  - Create a shared visual active tabs ordering utility `getVisibleActiveTabs(tabs, residentTabIds, pinnedIds, tabStatuses, activeId)`.
  - Update `navigate_tab` (`Ctrl+J` / `Ctrl+K`) to cycle strictly within the visual Active Sessions list in top-to-bottom visual order.
  - Update `move_tab` (`Ctrl+Shift+J` / `Ctrl+Shift+K`) to swap positions with the adjacent active tab in the visual list.
  - Update arrow-key navigation in `VerticalTabs.tsx` to cycle within active tabs.
  - Ensure discarded tabs are never unintentionally woken by keyboard navigation.

## Execution Steps
1. In `src/renderer/src/lib/tabs.ts` and `tabs_gemini.ts`:
   - Export `getVisibleActiveTabs(tabs, residentTabIds, pinnedIds, tabStatuses?, activeId?)`.
   - Export `moveActiveTabInList(tabs, activeId, direction, visualActiveTabs)`.
   - Add unit tests in `src/renderer/src/lib/tabs.test.ts` and `tabs_gemini.test.ts`.
2. In `src/renderer/src/App.tsx` and `App_gemini.tsx`:
   - Update `case 'navigate_tab'` to use `getVisibleActiveTabs(...)`.
   - Update `case 'move_tab'` to reorder relative to adjacent visual active tabs.
3. In `src/renderer/src/components/VerticalTabs.tsx` and `VerticalTabs_gemini.tsx`:
   - Align arrow key navigation with `activeTabs`.
4. Verification:
   - Run unit tests: `tabs.test.ts`, `VerticalTabs.test.tsx`, full test suite (`npm test`).
   - Run typecheck (`npm run typecheck`) and build (`npm run build`).
   - Verify byte-for-byte synchronization with all `_gemini` companion files.
