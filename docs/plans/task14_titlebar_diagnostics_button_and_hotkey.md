# Task 14: Titlebar Diagnostics Button & Trigger Access

## Objective
Provide instant 1-click access to the Diagnostics Modal directly from the Titlebar and Command Palette, so users experiencing sudden CPU or RAM spikes can capture performance data in seconds without digging through menus.

## Implementation Steps
1. **Titlebar Diagnostic Button**:
   - In `src/renderer/src/components/WindowTitleBar.tsx`:
     - Add a sleek, unobtrusive diagnostic icon button (`Activity` / `Pulse` / `Cpu` icon) in the titlebar controls area (near zoom/settings/window controls).
     - Tooltip: `"System Diagnostics & Resource Monitor"`.
     - Click triggers opening the Diagnostics modal.
2. **App.tsx State & Modal Mounting**:
   - Manage `showDiagnosticsModal` in `App.tsx`.
   - Mount `<DiagnosticsModal />` within overlay hierarchy.
   - Register Command Palette action: `"Export System & Memory Diagnostics"`.
   - Register global shortcut if requested or tie into quick actions.
