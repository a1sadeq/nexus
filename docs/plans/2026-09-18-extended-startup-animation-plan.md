# Extended Startup Animation Plan

## Objective
Extend the J.A.R.V.I.S. Iron Man startup diagnostic sequence so that it lasts at least 5 seconds and holds until the active tab / webview and initial app state are completely loaded.

## Problem Analysis
- In `src/renderer/src/components/JarvisBootOverlay.tsx`, the sequence had a fixed timer (or short ~2-3s delay) before automatically dismissing.
- The user requested:
  > "make the startup animation longer till everything is loaded ... instead of minimum 2.5 seconds make it 5 seconds"
- If the network or webview takes longer than 5 seconds, the boot overlay should continue showing diagnostics until `isLoaded` is `true`.
- The user should still have the option to press ESC or click to bypass if desired.

## Tasks
1. **Boot Overlay Timing Logic**:
   - In `src/renderer/src/components/JarvisBootOverlay.tsx`:
     - Introduce a 5000ms minimum duration timer (`MIN_BOOT_TIME = 5000`).
     - Prop: `isReady?: boolean` (or `isLoaded?: boolean`).
     - Distribute diagnostic steps (ARC REACTOR INITIALIZATION, PROTOCOL CHECK, TELEMETRY ENGAGED, NEURAL LINK ESTABLISHED, MARK-HUD ONLINE) smoothly across the 5000ms window.
     - Dismiss only when `elapsed >= 5000` AND `isReady === true`.
2. **App.tsx Integration**:
   - Track readiness: `const isReady = historyLoaded && !activeTabLoading;`.
   - Pass `isReady` to `JarvisBootOverlay`.
3. **Verification**:
   - Verify smooth 5-second HUD animation with progress bar and radar sweep on startup.
   - Verify clean fade-out when loading completes.
