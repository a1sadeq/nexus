# Task 39: Windows Theme Persistence & CSS Variable Unification Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix the theme regression on Windows and other platforms where switching themes in Nexus reverts to light theme colors or gets overridden by Style Studio defaults. Establish a unified, theme-first CSS variable pipeline where the active theme palette (`themes.ts`) is preserved as the single source of truth for colors while Style Studio (`interfaceSettings.ts`) safely manages structural styling, glassmorphism, motion, and aura effects.

**Architecture:** `applyInterfaceCssVariables` is updated to accept the active theme (`AppTheme`). It will not overwrite `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text2`, and `--accent` unless the user is explicitly in Custom mode. The default/fallback `surfaceDarkness` is updated from 25% to 50% across `interfaceSettings.ts`, `ZenGuideModal.tsx`, and `StyleStudioCanvas.tsx`, eliminating the accidental calculation of Porcelain Light Mode. On Windows, titleBarOverlay caption colors are dynamically updated over IPC to match the active theme.

**Tech Stack:** React 19, TypeScript, Electron IPC, Tailwind CSS / CSS Variables.

---

### Task 39.1: Unify `applyInterfaceCssVariables` with Active Theme Precedence
**Files:**
- Modify: `src/renderer/src/lib/interfaceSettings.ts`
- Modify: `src/renderer/src/lib/interfaceSettings_gemini.ts`
- Test: `src/renderer/src/lib/themeUnification.test.ts`

**Step 1: Write test for theme color preservation**
Verify that calling `applyInterfaceCssVariables` with Dracula or Tokyo Night active does NOT stomp over the theme's `--bg`, `--surface`, or `--accent`.

**Step 2: Update `applyInterfaceCssVariables` logic**
- Accept optional `activeTheme?: AppTheme`.
- If preset theme is active and `surfaceBgColor` is not customized, do not overwrite root background/surface/text CSS variables with computeSurfaceColors defaults.
- Change fallback darkness from 25% to 50%.
- Update `DEFAULT_INTERFACE_SETTINGS.surfaceDarkness = 50`.

---

### Task 39.2: Eliminate 25% Light Trap in UI Modals & Studio
**Files:**
- Modify: `src/renderer/src/components/ZenGuideModal.tsx`
- Modify: `src/renderer/src/components/StyleStudioCanvas.tsx`
- Modify: `src/renderer/src/components/StyleStudioCanvas_gemini.tsx`

**Step 1: Fix fallback darkness in ZenGuideModal**
- Change `interfaceSettings.surfaceDarkness ?? 25` to `50`.

**Step 2: Fix fallback darkness in StyleStudioCanvas**
- Change `effDarkness = ... ?? 25` to `50`.

---

### Task 39.3: Coordinated Application in App.tsx, SettingsOverlay, and Windows Caption Bar
**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App_gemini.tsx`
- Modify: `src/renderer/src/components/SettingsOverlay.tsx`
- Modify: `src/renderer/src/components/SettingsOverlay_gemini.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/main/index_gemini.ts`

**Step 1: Coordinate theme application hooks**
- In `App.tsx` and `SettingsOverlay.tsx`, pass `activeTheme` to `applyInterfaceCssVariables`.
- When switching themes in SettingsOverlay, trigger `applyTheme(newTheme)` and update `interfaceSettings` cleanly.

**Step 2: Windows dynamic title bar overlay colors**
- In main process `src/main/index.ts`, add IPC handler `set_titlebar_overlay_theme`:
  Calls `mainWindow.setTitleBarOverlay({ color: bg, symbolColor: text })` on Windows so the native caption buttons seamlessly integrate with the active theme.

---

### Task 39.4: Verification & Automated Tests
**Files:**
- Run test: `npm test -- src/renderer/src/lib/themeUnification.test.ts`
- Run test: `npm test`
- Run typecheck: `npm run typecheck`
- Run build: `npm run build`
