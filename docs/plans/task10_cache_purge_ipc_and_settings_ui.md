# Task 10: Cache Purge IPC & Settings UI

## Objective
Provide a responsive, transparent mechanism for users to inspect current cache/memory usage and trigger an on-demand cache purge directly from Settings or the Command Palette.

## Context & User Need
Users requested an explicit "Purge Temp & Web Cache" button in Settings and/or Command Palette with live cache/RAM readouts, giving full visibility and control over memory footprint alongside the automated background routines.

## Implementation Steps
1. **IPC Endpoints**:
   - Add `nexus:cache:getStats` IPC handler:
     - Returns `{ diskCacheBytes: number, codeCacheBytes: number, totalCacheBytes: number, memoryUsageMB: number }`.
   - Add `nexus:cache:purge` IPC handler:
     - Invokes `purgeTransientCaches({ clearNetworkCache: true, clearShaderCache: true })`.
     - Returns `{ freedBytes: number, success: boolean }`.
2. **Preload API Expose**:
   - Expose `getCacheStats()` and `purgeCache()` in `src/preload/index.ts` via `contextBridge`.
3. **Settings UI / Command Palette**:
   - In Settings -> Interface / General or a dedicated "Performance & Storage" section:
     - Display live cache storage size (e.g. `142 MB`).
     - Display button: `[ Purge Temp & Cache ]` with loading spinner and feedback toast ("Freed 124 MB of cache").
   - Register Command Palette action: `"Purge Web Cache & Temp Files"`.

## Safety & Non-Regression Invariants
- IPC calls must handle errors gracefully without crashing the renderer or main process.
- Buttons must show appropriate busy/disabled state during purge to prevent concurrent race conditions.
