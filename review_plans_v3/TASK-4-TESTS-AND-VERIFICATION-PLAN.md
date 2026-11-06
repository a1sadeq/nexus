# Task 4: Tests and Verification Plan

## 1. Automated Test Strategy

1. **Path & Lock Initialization Test** (`src/main/appDirectoryInitialization.test.ts`):
   - Verifies that `app.name === 'nexus'`.
   - Verifies that `app.getPath('userData')` is `~/.config/nexus` *before* `requestSingleInstanceLock()` is invoked.
   - Verifies that `~/.config/Nexus` is never created.
   - Verifies that safe migration checks detect and consolidate legacy files without data loss.

2. **Universal State Hydration Test** (`src/renderer/src/lib/universalStateHydration.test.ts`):
   - Simulates renderer startup under an origin change (e.g. `http://localhost:5173` with blank `localStorage`).
   - Verifies that IPC hydration takes precedence over empty `localStorage`.
   - Verifies that subsequent changes write to both `localStorage` and IPC.
   - Verifies that tabs hydration does not wipe populated disk state on startup race conditions.

3. **Full Regression Suite**:
   - `npm run typecheck` (Node + Web).
   - `npx vitest run` across all 72 test suites (505+ tests).
   - `npm run build` production bundling check.

## 2. Manual Verification Checklist
1. Inspect `~/.config/Nexus` after launching `npm run dev`:
   - It should NOT exist.
2. Launch `npm run dev`:
   - Verify all open tabs appear matching the user's setup.
   - Verify history drawer lists all 65 entries.
   - Verify theme and accent colors match live configuration.
   - Verify webview sessions remain authenticated (no re-login prompt on Gemini / ChatGPT).
