# Task 4: Nexus Shortcut Toggle & Singleton Socket Unification

## Objective
Ensure that pressing the user's OS shortcut `Ctrl+Alt+Space` (configured in Hyprland to launch `/opt/Nexus/nexus`) seamlessly toggles/focuses the active `npm run dev` window, exactly as it did before. Consolidate the dual directories (`~/.config/Nexus` and `~/.config/nexus`) into a unified single path.

## Root Cause
1. **Conflicting Background Process**:
   - A stale `/opt/Nexus/nexus` process (`PID 175777`) was running in the background, locking `~/.config/Nexus/SingletonSocket` and intercepting calls from Hyprland.
2. **Socket Path Mismatch**:
   - `/opt/Nexus/nexus` has `productName: Nexus` and requests its single-instance lock before setting `userData`, creating its UNIX domain socket in `~/.config/Nexus/SingletonSocket`.
   - `bootstrap.ts` in dev mode set `app.name = 'nexus'`, directing `npm run dev`'s single-instance lock to `~/.config/nexus/SingletonSocket`.
   - Consequently, when Hyprland executes `/opt/Nexus/nexus`, it inspects `~/.config/Nexus/` and completely misses the running `npm run dev` process.

## Implementation Steps
1. **Terminate Orphan Process**:
   - Kill stale PID 175777 (`/opt/Nexus/nexus`) and any orphaned child processes so locks are freed cleanly.
2. **Directory & Socket Consolidation**:
   - Remove stale sockets in `~/.config/Nexus/`.
   - Symlink `~/.config/Nexus` -> `~/.config/nexus` (or ensure `~/.config/Nexus/SingletonSocket` points to the active dev socket).
   - This ensures that when `/opt/Nexus/nexus` checks `~/.config/Nexus/SingletonSocket`, the Linux kernel resolves directly to `~/.config/nexus/SingletonSocket`, sending the `second-instance` IPC message to `npm run dev`.
3. **Align Dev Bootstrap**:
   - Verify `src/main/bootstrap.ts` and `src/main/index.ts` to ensure `second-instance` handler calls `toggleMainWindow()` and restores/focuses `mainWindow` properly on Wayland/Hyprland.
4. **Verification**:
   - Run `npm run dev`.
   - Trigger `Ctrl+Alt+Space` and verify the dev window toggles visibility/focus instantly.
