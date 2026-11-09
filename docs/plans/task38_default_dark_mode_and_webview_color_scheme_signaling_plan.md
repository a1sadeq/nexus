# Task 38: Default Dark Mode & Native AI WebView Color Scheme Signaling Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Configure Nexus to operate in dark mode by default and signal `(prefers-color-scheme: dark)` natively across Chromium and all AI webviews (ChatGPT, Claude, Gemini, Perplexity, DeepSeek, etc.) so that all AI websites automatically render in official dark mode without flashes of white.

**Architecture:** Electron main-process sets `nativeTheme.themeSource = 'dark'`. All `WebContentsView` instances receive Chromium media emulation (`prefers-color-scheme: dark`) and injected CSS with `color-scheme: dark !important`. An appearance IPC bridge (`get_theme_appearance`, `set_theme_appearance`) allows future toggling between dark, light, and system.

**Tech Stack:** Electron `nativeTheme`, Chromium WebContents DevTools/Emulation, TypeScript, React 19.

---

### Task 38.1: Main Process Native Theme & Chromium Media Emulation
**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/index_gemini.ts`
- Test: `src/main/nativeThemeAppearance.test.ts`

**Step 1: Write test for theme appearance and color-scheme media logic**
Verify `nativeTheme.themeSource` defaults to `'dark'` and webview theme CSS builder outputs `color-scheme: dark !important`.

**Step 2: Implement `nativeTheme.themeSource = 'dark'` in main process**
- Import `nativeTheme` from `electron`.
- Set `nativeTheme.themeSource = 'dark'` on startup.
- In `attachView` and webview navigation hooks, set media emulation for `prefers-color-scheme: dark`.
- Ensure `buildWebviewThemeCss` sets `color-scheme: dark !important;` on `:root, html`.

**Step 3: Register IPC handlers for appearance**
- `get_theme_appearance` -> returns current `nativeTheme.themeSource`.
- `set_theme_appearance` -> sets `nativeTheme.themeSource` and updates all attached webviews.

**Step 4: Update preload definitions**
- Expose `getThemeAppearance()` and `setThemeAppearance(mode)` in `src/preload/index.ts` and `src/preload/index.d.ts`.

---

### Task 38.2: App Shell HTML Meta & Webview Background Styling
**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/src/App.css`

**Step 1: Add dark color-scheme meta tag**
- Add `<meta name="color-scheme" content="dark">` to `src/renderer/index.html` to eliminate white flash during initial mount.

**Step 2: Ensure default root styling in App.css enforces dark fallback**
- Guarantee `:root` defaults to dark colors `#1a1a2e` before dynamic theme scripts execute.

---

### Task 38.3: Verification & Automated Tests
**Files:**
- Run test: `npm test -- src/main/nativeThemeAppearance.test.ts`
- Run typecheck: `npm run typecheck`
