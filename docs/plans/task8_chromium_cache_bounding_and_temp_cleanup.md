# Task 8: Chromium Cache Bounding & Temp Cleanup

## Objective
Enforce strict Chromium cache boundaries to prevent memory-mapped file bloat (which previously inflated RSS memory from 500MB to 1GB+), and implement safe automated startup/shutdown cache and temp-file pruning without affecting user authentication, session data, or application functionality.

## Context & Root Cause Analysis
1. Chromium caches (`Cache`, `Code Cache`, `GPUCache`, `DawnCache`) in both `~/.config/nexus` and `~/.config/nexus/Partitions/ai-shared` grew past 650MB+.
2. Linux memory-maps (`mmap`) these files into resident memory (RSS).
3. Clearing temp/cache files unmaps these pages, immediately releasing 500MB+ of RAM.
4. Without cache caps, Chromium expands cache without bound on continuous AI streaming.

## Implementation Steps
1. **Chromium Command Line Switches**:
   - In `src/main/bootstrap.ts` (before `app.whenReady()`):
     - `app.commandLine.appendSwitch('disk-cache-size', '104857600')` (100MB limit)
     - `app.commandLine.appendSwitch('media-cache-size', '52428800')` (50MB limit)
     - `app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512')` (Cap V8 heap to 512MB to trigger timely GC)
     - `app.commandLine.appendSwitch('process-per-site')` (Consolidate duplicate renderer processes)
2. **Automated Cache Pruning Engine**:
   - Create `src/main/cachePruningManager.ts`:
     - Safe cache purge function `purgeTransientCaches(options: { clearNetworkCache?: boolean; clearShaderCache?: boolean })`:
       - `session.defaultSession.clearCache()`
       - `session.fromPartition('persist:ai-shared').clearCache()`
       - Clears `shadercache`, `cachestorage` safely while strictly **preserving** `cookies`, `localstorage`, `websql`, and `indexeddb` so all user logins (ChatGPT, Claude, Gemini, DeepSeek, etc.) remain intact.
     - Prunes stale temporary files (`.tmp-*`, obsolete Crashpad dumps older than 24h) from the app cache/temp paths.
     - Runs automatically on app launch (in background after 5s idle) and on graceful app exit.
3. **Telemetry & Size Calculation**:
   - Calculate total disk cache size (Cache + Code Cache + Partitions/ai-shared/Cache) to report freed megabytes to the user.

## Safety & Non-Regression Invariants
- User cookies, local storage, indexedDB tokens, and active sessions MUST NOT be cleared.
- WebViews and ongoing requests must not be interrupted or corrupted.
