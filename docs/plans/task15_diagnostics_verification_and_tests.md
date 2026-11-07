# Task 15: Diagnostics Verification & Tests

## Objective
Verify the end-to-end functionality of the Diagnostics Sampling Engine, ensuring accurate metric calculations, zero leaking of sensitive user data, clean file writing, and zero regressions in existing test suites.

## Validation Steps
1. **Unit Tests**:
   - Write `src/main/diagnosticsManager.test.ts`:
     - Test CPU delta calculation over sample window.
     - Test process correlation with WebContents and aiViews.
     - Test URL sanitization (stripping tokens, query params, hash fragments).
     - Test file export and path formatting.
2. **Typecheck & Production Build**:
   - Run `npm run typecheck` across Node and Web configs.
   - Run `npx vitest run`.
   - Run `npm run build`.
3. **Commit & Push**:
   - Stage changes, commit with clean message, and push to origin.
