# Task 11: Verification & Stress Testing

## Objective
Verify the end-to-end functionality, memory retention bounds, CPU idle drops, and ensure zero regressions across all existing tests and features.

## Validation Steps
1. **Static Analysis & Compilation**:
   - Run `npm run typecheck` to verify TypeScript types across main, renderer, and preload.
   - Run `npx vitest run` to ensure all existing test suites pass.
   - Run `npm run build` to verify production packaging.
2. **Runtime Verification**:
   - Verify that cache directory sizes remain capped and don't expand past 100MB.
   - Verify that background tabs receive `setBackgroundThrottling(true)` and idle CPU drops to near 0%–2% when Nexus is in background or inactive.
   - Verify that clicking "Purge Temp & Web Cache" in Settings safely frees disk cache and memory without logging the user out from active AI sessions (ChatGPT, Claude, Gemini, etc.).
3. **Rollout & Commit**:
   - Clean up temporary files, stage changes, commit with clear semantic message, and push.
