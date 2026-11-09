# Task 36: State Lifecycle Transitions & Context-Aware Badge Lingering Plan

## 1. Problem Statement
- Completed generations either disappear too fast in 0ms on click or linger confusingly without clear lifecycle semantics.
- Users need context-aware badge behavior: foreground tabs should show brief confirmation then reset cleanly, while background tabs must retain completion indicators until the user returns.

## 2. Solution & Architectural Changes
1. **Context-Aware Hybrid Linger**:
   - **Active Tab**: When active tab finishes, display `done` (emerald green) for **6 seconds**, then smoothly transition to `idle` (blue).
   - **Background Tab**: When a background tab finishes, keep `done` (emerald) or `waiting-input` (amber/red) active continuously so the user spots it in the sidebar.
   - **Tab Activation**: When switching to a finished background tab, retain the badge for **4 seconds** so the user has immediate visual confirmation of the completed answer, then automatically fade back to `idle`.
2. **Interactive Dismissal / Acknowledgment**:
   - `acknowledgeTabStatus(prev, tabId)` resets status to `idle`.
   - Update `scheduleStatusDismissal(tabId, delayMs)` in `App.tsx` with dedicated timers per tab.
3. **Unit Tests**:
   - Tests in `tabStatus.test.ts` and `App.test.tsx` for 6s active linger, persistent background retention, and 4s switch-to-tab acknowledgment.
