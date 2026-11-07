# Task 12: Diagnostics Sampling Engine

## Objective
Implement a robust, non-blocking telemetry engine in the Electron main process that captures full process metrics (Main, Renderer, GPU, WebViews), disk cache footprint, tab lifecycle states, and OS resources with a 2-second CPU differential sampling window and strict privacy sanitization.

## Core Capabilities
1. **2-Second CPU Differential Sampling**:
   - Electron's `app.getAppMetrics()` reports instantaneous or cumulative CPU usage.
   - Sample initial metrics at $t_0$, sleep 2000ms asynchronously (non-blocking via `setTimeout`), sample at $t_1$, and calculate real per-process CPU percentage and idle wakeups.
2. **Full Process Breakdown**:
   - Classify each process: Main Browser, GPU Process, UI Renderer, AI Webview, Network/Utility.
   - Correlate renderer PIDs with `aiViews` and `mainWindow` to label which AI provider (ChatGPT, Claude, Gemini, Arena) corresponds to which process.
   - Capture Working Set (RSS MB), Peak Working Set (MB), Private Bytes (MB), Shared Bytes (MB).
3. **Tab & Lifecycle Observability**:
   - Report each tab's: ID, provider modelKey, sanitized domain (e.g. `https://chatgpt.com` without query strings/tokens), active/background state, backgroundThrottling status, audioMuted status, pinned state, eviction state.
4. **Cache & Storage Footprint**:
   - Root cache bytes, partition cache bytes, code cache, GPU cache, thumbnails.
5. **Privacy & Security Sanitization**:
   - Zero cookies, zero auth headers, zero conversation text, zero query string parameters. Only high-level metrics, origins, and system specs.
6. **File Export IPC**:
   - `saveDiagnosticsToFile(data)` writes `nexus-diagnostics-[timestamp].json` into the user's Downloads directory and returns the absolute path.

## Implementation Files
- `src/main/diagnosticsManager.ts`
- `src/main/diagnosticsManager.test.ts`
