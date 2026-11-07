# Task 7: Verification & Regression Testing

## Objective
Verify the new visual styling, dynamic colors, custom user color override support, and animations through comprehensive automated tests, TypeScript type checking, and production packaging.

## Verification Checklist
1. **Model Visuals Unit Tests**:
   - Verify `getProviderGradient()` and `getProviderColor()` return authentic palettes for built-in providers.
   - Verify that custom user colors in `models.json` correctly override defaults and procedurally derive secondary gradient and glow values.
2. **Titlebar Model Pillar Component Tests**:
   - Verify rendering of inactive pills with brand icons and tinted borders.
   - Verify active pill receives `--provider-gradient-start`, `--provider-gradient-end`, and active styling.
   - Verify presence of the micro-reactor core dot on active pill.
   - Verify dock container inherits `--active-provider-color`.
   - Verify roving tabindex keyboard navigation (Left/Right/Home/End) and click selection.
3. **Build & Typecheck**:
   - `npm run typecheck`: 0 errors.
   - `npm run build`: 0 errors.
   - `npx vitest run`: All test suites pass.
