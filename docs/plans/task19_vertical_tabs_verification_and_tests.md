# Task 19: Vertical Tabs Verification & Tests

## 1. Context & Objective
Verify that the new vertical tab strip, Herdr status indicator, sidebar collapse/expand logic, and topbar streamlining work without regressions across the test suite and build pipeline.

## 2. Test Coverage Plan
1. **Unit Tests for Tab Status & Formatting**:
   - `formatCollapsedTitle()`:
     - Short titles ("Chat") remain intact.
     - 3-5 word titles ("Write a python script") remain intact.
     - Long titles ("Write a python script to parse logs and send alerts to slack") get truncated to first 4 words + ellipsis ("Write a python script...").
     - Empty or undefined titles fall back gracefully to "New Chat".
   - `tabStatusManager`:
     - Transition from `working` to `waiting-input` when a background tab stops loading.
     - Clearing `waiting-input` to `idle` or `done` when active tab is selected.
2. **Component Tests**:
   - `VerticalTabs.test.tsx`:
     - Renders tabs in vertical order.
     - Displays Herdr status indicator with correct aria attributes.
     - Shows close button and responds to select/close/pin clicks.
     - Respects collapsed state rendering first 3-5 words.
3. **Build & Regression Suite**:
   - Run `npm run typecheck` to verify strict TypeScript adherence.
   - Run `npx vitest run` across all test suites.
   - Run `npm run build` to ensure production bundle packaging succeeds.
