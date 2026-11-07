# Task 9: WebView Background Throttling & Tab Discard Policy

## Objective
Eliminate runaway background CPU consumption (which previously spiked to 20%–30%) by enforcing instant background suspension on hidden webviews and tightening the default LRU tab discard policy to 3–4 active tabs with 10-minute idle evictions.

## Context & Root Cause Analysis
1. Inactive tabs continued running background JavaScript timers, WebSockets, DOM mutations, and canvas renders at full rate because `webContents.setBackgroundThrottling(true)` was never invoked.
2. The default discard policy had `maxActiveTabs: 0` (Unlimited), allowing 10+ heavyweight AI SPAs (ChatGPT, Claude, Gemini, Arena) to sit in memory concurrently, thrashing CPU and V8 GC threads.

## Implementation Steps
1. **Instant WebContents Background Throttling**:
   - In `src/main/index.ts` tab visibility & switching handlers:
     - When a tab is hidden / moved to background:
       - If `!view.webContents.isDestroyed()`:
         - `view.webContents.setBackgroundThrottling(true)`
         - `view.webContents.setAudioMuted(true)`
     - When a tab is activated / brought to foreground:
       - If `!view.webContents.isDestroyed()`:
         - `view.webContents.setBackgroundThrottling(false)`
         - `view.webContents.setAudioMuted(false)`
2. **Tab Discard Policy Update**:
   - In `src/shared/tabDiscardPolicy.ts`:
     - Change `DEFAULT_TAB_DISCARD_POLICY.maxActiveTabs` from `0` to `3`.
     - Keep `DEFAULT_TAB_DISCARD_POLICY.tabDiscardMinutes` at `10`.
   - In `src/main/tabDiscardManager.ts`:
     - If loaded policy from disk has `maxActiveTabs === 0` or `maxActiveTabs > 4` as legacy default, gracefully migrate or respect user override while defaulting new installations to 3.
3. **Tab Discard Teardown Hook**:
   - Ensure discarded tabs serialize their URL and scroll position to `tabs.json`.
   - When discarded, tear down the `WebContentsView` so its memory and CPU are immediately reclaimed by the OS.
   - On tab click, seamlessly restore the tab from its saved state.

## Safety & Non-Regression Invariants
- Pinned tabs must never be discarded automatically.
- The active tab must never be discarded or throttled.
- Background downloads or active streaming should complete or avoid mid-stream termination.
