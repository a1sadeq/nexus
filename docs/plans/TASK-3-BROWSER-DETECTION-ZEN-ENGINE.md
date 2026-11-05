# Implementation Plan: Task 3 — Universal Browser Cookie Engine & Zen Support (Windows/Linux)

**Target:** Nexus Main Process (`src/main/cookieImport.ts`, `src/main/googleAuth.ts`, `src/main/index.ts`)  
**Status:** Approved for Implementation (Universal AI Chat Scope, Zen Support & Resilient Windows Handling)  
**Related Components:**  
- [`/home/elsadek/vicinae/nexus electron/src/main/cookieImport.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/cookieImport.ts)  
- [`/home/elsadek/vicinae/nexus electron/src/main/googleAuth.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/googleAuth.ts)  
- [`/home/elsadek/vicinae/nexus electron/src/main/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/index.ts)  
- [`/home/elsadek/vicinae/nexus electron/src/preload/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/preload/index.ts)

---

## 1. Root Causes of Windows Failure & Scope Expansion

Our deep analysis identified the following concrete root causes for Windows browser detection failing:

1. **Premature Profile Discarding via Google-Only Filter:**
   - In `src/main/googleAuth.ts`, `listProfiles()` discarded any profile where `hasGoogleAuth === false` (`all.filter(p => p.hasGoogleAuth)`).
   - If a user on Windows had active sessions for ChatGPT, Claude, Perplexity, or DeepSeek, but was NOT signed into Google in that browser profile, `listProfiles()` returned an empty array `[]` ("No browser profiles detected").
2. **Missing Zen Browser Support:**
   - Zen Browser (the popular Firefox-based browser) was entirely missing from `getSystemBrowserTargets()`.
   - On Windows, Zen installs into `%APPDATA%\zen` or `%LOCALAPPDATA%\zen`.
   - On Linux, Zen uses `~/.zen` or Flatpak paths (`~/.var/app/app.zen_browser.zen/.zen` / `~/.var/app/io.github.zen_browser.zen/.zen`).
   - In `readBrowserCookies()`, `isFirefoxFamily` only checked `firefox` and `floorp`, causing any future Zen profile to be misrouted to Chrome decryption and crash.
3. **Windows SQLite File Locking (EBUSY / EPERM):**
   - When Chromium-based browsers (Chrome, Edge, Brave, Opera) or Firefox/Zen are running on Windows, their SQLite databases (`Cookies` or `cookies.sqlite`) can be locked with exclusive file locks.
   - Calling `copyFileSync` threw an exception, which was caught and swallowed, causing `chromeProfileInfo` to return `{ hasGoogleAuth: false }`, which then caused `listProfiles()` to drop the profile completely.
4. **Indiscriminate Partition Wiping:**
   - `clearAiSessionStorage()` wiped the entire `persist:ai-shared` storage before importing, destroying existing logins for untouched AI providers.

---

## 2. Technical Architecture & Implementation Steps

### A. First-Class Zen Browser & Windows Path Expansion
- In [`/home/elsadek/vicinae/nexus electron/src/main/cookieImport.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/cookieImport.ts):
  - Expand `BrowserKind`:
    ```ts
    export type BrowserKind =
      | 'zen'
      | 'firefox'
      | 'floorp'
      | 'chrome'
      | 'chromium'
      | 'brave'
      | 'edge'
      | 'opera'
      | 'vivaldi'
    ```
  - Update `isFirefoxFamily`:
    ```ts
    const isFirefoxFamily = profile.browser === 'firefox' || profile.browser === 'floorp' || profile.browser === 'zen'
    ```
  - Add Zen search paths in `getSystemBrowserTargets()`:
    - **Windows:**
      - `%APPDATA%\zen`
      - `%LOCALAPPDATA%\zen`
      - `%APPDATA%\Zen Browser`
    - **Linux:**
      - `join(home, '.zen')`
      - `join(home, '.var', 'app', 'app.zen_browser.zen', '.zen')`
      - `join(home, '.var', 'app', 'io.github.zen_browser.zen', '.zen')`
    - **macOS:**
      - `join(appSupport, 'zen')`
      - `join(appSupport, 'Zen')`
  - Expand Windows Chromium detection paths for Edge, Brave, Opera GX, Vivaldi, Chrome:
    - Check both `LOCALAPPDATA` and `APPDATA`.
    - Support Opera GX default and subfolder profiles.

### B. Universal AI Chat Session Detection & Extraction
- Instead of checking only Google authentication cookies, create a unified AI host pattern and session detector:
  ```ts
  export const AI_PROVIDERS = [
    { key: 'chatgpt', label: 'ChatGPT', patterns: ['chatgpt.com', 'openai.com'] },
    { key: 'claude', label: 'Claude', patterns: ['claude.ai', 'anthropic.com'] },
    { key: 'google', label: 'Google / Gemini', patterns: ['google.com', 'gemini.google.com'] },
    { key: 'perplexity', label: 'Perplexity', patterns: ['perplexity.ai'] },
    { key: 'deepseek', label: 'DeepSeek', patterns: ['deepseek.com'] },
    { key: 'grok', label: 'Grok', patterns: ['grok.com', 'x.ai'] },
    { key: 'mistral', label: 'Mistral', patterns: ['mistral.ai'] }
  ]
  ```
- Detect which AI providers have sessions in each profile:
  - Return `detectedAiSessions: string[]` (e.g. `['chatgpt', 'claude', 'deepseek']`).
  - Never drop a profile simply because Google auth is absent.
  - Return all discovered profiles so the user can see their installed browsers.

### C. Resilient Windows SQLite Reading (Safe Merge & Lock Handling)
- Update `withTempSqliteDb`:
  - When copying the SQLite database on Windows:
    - Attempt `copyFileSync`.
    - If `EBUSY` or `EPERM` is caught, attempt retry after 250ms with read-sharing stream or descriptive error flag `{ isLocked: true }`.
    - When `isLocked: true`, do not drop the profile; return the profile with `{ isLocked: true }` so the UI can inform the user: `"Zen is running. Close Zen or click to retry."`
- Safe Cookie Injection (Safe Merge):
  - In `src/main/googleAuth.ts`, update `syncSessionFromProfile` and `syncAllSessionsFromBrowsers`:
    - Remove `await clearAiSessionStorage()`.
    - Instead, use `injectCookies(cookies)` to merge session cookies safely into `persist:ai-shared`.
    - Existing sessions for other providers remain completely untouched.

### D. Custom Profile Folder Picker
- In `src/main/index.ts`:
  - Add IPC handler `sessions_pick_custom_folder`:
    - Uses `dialog.showOpenDialog({ properties: ['openDirectory'] })`.
    - Checks for `cookies.sqlite` (Firefox/Zen format) or `Cookies` / `Network/Cookies` (Chromium format).
    - If found, reads all AI chat cookies and safely merges them into `persist:ai-shared`.
    - Returns `{ success: true, count, detectedProviders, browserType }`.

### E. WebAuthn & Windows Hello Prompt Cancellation in Webviews
- **Problem:** On Windows, when logging into Google, Microsoft, OpenAI, or Anthropic inside embedded webviews, Chromium can trigger WebAuthn/Passkey/Windows Hello prompts ("Making sure it's you"). Because embedded webviews cannot complete Windows Hello ceremonies, this causes the login window to hang indefinitely or trigger security warnings.
- **API Clarification:** OpenCode suggested `session.defaultSession.setWebAuthnInterceptor`, which is an unofficial/hallucinated API in Electron.
- **Native Electron Implementation:** In [`src/main/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/index.ts), we implemented the authentic Electron API using `session.on('select-webauthn-account', (event, details, callback) => callback())` and `select-webauthn-authenticator` across both `persist:ai-shared` and `session.defaultSession`. Invoking `callback()` with no arguments cleanly rejects the ceremony with `NotAllowedError`, causing authentication forms to immediately and smoothly fall back to standard username/password/2FA without hanging!

---

## 3. Verification & Safety Contract

1. **Unit Tests:**
   - Update `src/main/cookieImport.test.ts` to verify Zen browser detection and profile discovery.
   - Test normalization and AI session pattern detection across all providers.
2. **Typecheck & Full Test Suite:**
   - `npm run typecheck` passes with 0 errors.
   - `npm test` passes all tests.
3. **Cross-Platform Safety:**
   - Windows, Linux, and macOS path resolution tests.
   - Zero credential leaks or unhandled exceptions when databases are busy.
