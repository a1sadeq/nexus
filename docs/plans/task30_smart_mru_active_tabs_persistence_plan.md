# Task 30 Plan: Smart MRU Active Tabs Persistence & Restoration Across Restarts

## Context & Objectives
- When closing Nexus with multiple active working tabs (e.g., 5 tabs) and opening it the next day, only 1 single tab was classified in the "Active Sessions" section in `VerticalTabs`, while the remaining 4 tabs were prematurely labeled as "Sleeping / Discarded".
- This occurred because `residentTabIds` initialized as `[initialTabs.activeId]` on launch and `tabDiscardManager.getStatus()` only returned live views.
- Objective:
  1. Persist the user's MRU tab sequence (`mruTabIds`) alongside tabs in storage.
  2. On startup, initialize `residentTabIds` with the top N most recently used tabs (up to the user's active limit, e.g. 5) so the user's working tabs remain in "Active Sessions".
  3. When `tab_discard_status_updated` is received from the main process, preserve active MRU tabs unless they are explicitly present in `discardedTabIds` (evicted by the discard policy).
  4. Ensure on-demand view creation and waking when switching to any of these active sessions.

## Execution Steps
1. In `src/renderer/src/lib/tabs.ts` and `tabs_gemini.ts`:
   - Extend `serializeState(tabs, activeId, mruTabIds)` to save `mruTabIds`.
   - Extend `deserializeState` to restore `mruTabIds?: string[]`.
   - Update tests in `tabs.test.ts` and `tabs_gemini.test.ts`.
2. In `src/renderer/src/App.tsx` and `App_gemini.tsx`:
   - On hydration/mount, initialize `residentTabIds` with the top MRU tabs (up to 5 or `maxActiveTabs`).
   - In `tab_discard_status_updated` listener, preserve non-evicted resident tabs.
   - Save `mruTabIds` when persisting tabs to `localStorage` and `nexusState`.
3. Verify with unit tests (`tabs.test.ts`, `VerticalTabs.test.tsx`), full test suite, typecheck, and build.
