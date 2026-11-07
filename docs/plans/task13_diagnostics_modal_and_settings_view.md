# Task 13: Diagnostics Modal & Settings View

## Objective
Build an intuitive, high-performance in-app Diagnostics preview modal and a dedicated "Diagnostics & Telemetry" tab in Settings.

## UI Components & Workflow
1. **Diagnostics Modal (`DiagnosticsModal.tsx`)**:
   - Header with status badges: Total System CPU %, Total Nexus Memory (MB), Resident WebViews, Disk Cache (MB).
   - Live Process Breakdown Table:
     - Process Name / Label (e.g. `Main Process`, `GPU Compositor`, `UI Shell`, `Tab: Claude`, `Tab: Gemini`)
     - PID
     - CPU % (highlighting high usage with yellow/red badges)
     - Memory Working Set (MB) & Peak Memory
     - Role / Status (Active / Background Throttled / Evicted)
   - Action Bar:
     - **[ 📥 Export JSON to Downloads ]**: Saves `nexus-diagnostics-[timestamp].json` and shows saved file path with open in folder option.
     - **[ 📋 Copy to Clipboard ]**: Copies sanitized formatted JSON for immediate pasting into conversations with the AI assistant.
     - **[ 🔄 Sample Again (2s) ]**: Triggers re-sampling with an animated 2-second progress indicator.
     - **[ ✕ Close ]**: Dismisses modal.
2. **Settings Section (`DiagnosticsSettingsSection.tsx`)**:
   - Integrated into `SettingsOverlay.tsx` under a new tab: `'diagnostics'` ("Diagnostics & Telemetry").
   - Shows system specs, OS load, process list, and export controls.
3. **Preload & IPC Bridge**:
   - Expose `window.electron.diagnostics`:
     - `capture: () => Promise<DiagnosticReport>`
     - `exportToFile: (report: DiagnosticReport) => Promise<{ success: boolean; filePath?: string; error?: string }>`
     - `showInFolder: (path: string) => Promise<void>`
