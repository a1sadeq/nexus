# Implementation Plan: Task 2 — Dedicated "Accounts & Sessions" Settings Tab (Universal AI Chat Importer & Safe UI)

**Target:** Nexus Settings Studio (Renderer)  
**Status:** Approved for Implementation (Universal AI Chat Importer & Safe Merge Architecture)  
**Related Components:**  
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/SettingsOverlay.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/SettingsOverlay.tsx)  
- [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/SyncReminderBanner.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/SyncReminderBanner.tsx)  
- [`/home/elsadek/vicinae/nexus electron/src/main/index.ts`](file:///home/elsadek/vicinae/nexus%20electron/src/main/index.ts)

---

## 1. Architectural Decisions & Scope

Following the deep brainstorming alignment:
1. **Dedicated Unclipped Sidebar Tab:**
   - Account and AI provider session management is permanently promoted to a dedicated tab (`'sessions'`) under `AI Engine`.
   - Completely resolves viewport-clipping below Zoom cards on 1080p and high-DPI displays (125%/150% scaling).
2. **Universal AI Chat Scope (Beyond Google-Only):**
   - The session manager is upgraded from Google-only authentication to a **Universal AI Session Manager**.
   - Supports all configured AI chat providers: OpenAI / ChatGPT, Claude / Anthropic, Perplexity, DeepSeek, Grok / xAI, Mistral / Le Chat, Google / Gemini, and custom configured endpoints.
3. **Safe Merge Strategy:**
   - Importing browser sessions merges newly imported cookies without purging or wiping existing active sessions in other AI providers.
   - No indiscriminate `clearStorageData()` wiping the whole partition.
4. **Resilient Profile Discovery & Manual Custom Folder Picker:**
   - Displays all detected browser profiles (Zen, Firefox, Floorp, Chrome, Edge, Brave, Opera, Vivaldi).
   - Visual badges show which AI provider sessions were detected within each profile (e.g. `[ChatGPT]`, `[Claude]`, `[DeepSeek]`).
   - Native OS Folder Picker button allows users to manually select any profile folder if custom or uninstalled-portable browser paths are used.

---

## 2. Component Design & User Flow

### A. Dedicated Navigation & Layout
- In [`/home/elsadek/vicinae/nexus electron/src/renderer/src/components/SettingsOverlay.tsx`](file:///home/elsadek/vicinae/nexus%20electron/src/renderer/src/components/SettingsOverlay.tsx):
  - **Sidebar Item:**
    - ID: `'sessions'`
    - Label: `Accounts & Sessions`
    - Subtitle: `AI Chat Logins & Universal Browser Sync`
    - Icon: `IconShield`
  - **Layout Structure:**
    - Full viewport height (`flex-1 min-h-0 overflow-y-auto custom-scrollbar`).
    - Breadcrumb navigation: `AI Engine > Accounts & Sessions`.

### B. Top Hero Section: Universal Browser Session Importer
- **Browser Profile Grid:**
  - Queries `window.electron.ipcRenderer.invoke('sessions_get_profiles')` on mount.
  - Renders cards for each detected browser profile:
    - Browser icon (Zen, Firefox, Chrome, Edge, Brave, Floorp, Opera, Vivaldi).
    - Profile name & path hint.
    - AI Badges: Visual tags for each detected AI provider session (`ChatGPT`, `Claude`, `Gemini`, `DeepSeek`, etc.).
    - "Import All AI Sessions" button per profile.
- **Custom Profile Folder Button:**
  - Invokes `window.electron.ipcRenderer.invoke('sessions_pick_custom_folder')`.
  - Automatically identifies whether the folder contains Firefox/Zen `cookies.sqlite` or Chromium `Network/Cookies` and imports detected AI chat sessions.
- **Sync Status & Feedback:**
  - Clear, user-friendly toast / progress indicators (e.g., `Successfully imported 24 session cookies across 4 AI providers from Zen Browser`).
  - Graceful lock handling: If the browser's SQLite database is locked by Windows OS, presents a helpful modal/banner explaining that the browser process is actively running and offering a retry button or custom folder import.

### C. Bottom Section: Configured Provider Matrix
- Displays each configured provider from `models`:
  - Provider Brand Icon, Title, and Hostname.
  - **Actions:**
    - `Open Provider View`: Selects the provider tab and closes Settings so the user can sign in directly through official web forms if preferred.
    - `Clear Local Session`: Invokes `provider_clear_session` with origin-scoped clearing in `persist:ai-shared` without affecting other providers.

---

## 3. Implementation Checklist

- [x] Create dedicated `'sessions'` tab in SettingsOverlay navigation.
- [x] Fix viewport clipping and add breadcrumbs.
- [x] Add origin-scoped `provider_clear_session` IPC handler in `src/main/index.ts`.
- [ ] Connect `sessions_get_profiles` to fetch detected browser profiles with AI provider session tags.
- [ ] Add Universal Browser Profile Cards with AI session tags and Import action.
- [ ] Add Custom Profile Folder Picker with native dialog.
- [ ] Test layout across 100%, 125%, and 150% DPI display scaling.
- [ ] Verify `npm run typecheck` and `npm test`.
