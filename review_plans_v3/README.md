# Nexus Dual-Directory Elimination & Universal Dev-Production Sync
**Version:** 1.0.0  
**Target:** Elimination of duplicate `~/.config/Nexus`, unification onto `~/.config/nexus`, and seamless shared state in `npm run dev`.

---

## 🎯 Strategic Overview

1. **Duplicate Config Elimination (`~/.config/Nexus` vs `~/.config/nexus`)**:
   - **Root Cause**: `electron-builder.yml` defines `productName: Nexus` (capital N). In `src/main/index.ts`, `app.requestSingleInstanceLock()` was executed before `app.setPath('userData', ...)` was called. Electron's Chromium bootstrap immediately created single-instance lock files (`SingletonLock`, `SingletonCookie`, `SingletonSocket`) in the default capitalized directory `~/.config/Nexus/`. Later at line 89, `app.setPath('userData', ...)` redirected data files to `~/.config/nexus/` (lowercase).
   - **Solution**: Set `app.name = 'nexus'` and establish `app.setPath('userData', join(app.getPath('appData'), 'nexus'))` as step zero before requesting the single-instance lock. Add automatic safe consolidation to merge any lingering files from `~/.config/Nexus` into `~/.config/nexus` and prune the redundant directory.

2. **Universal Sync for `npm run dev`**:
   - **Root Cause**: In `npm run dev`, Vite serves the renderer on `http://localhost:5173`. Chromium enforces strict per-origin isolation for browser `localStorage`. In `src/renderer/src/App.tsx`, active tabs, theme state, interface settings, and pinned tabs were initialized solely from `localStorage`. In dev, `http://localhost:5173` had empty `localStorage`, causing the app to open with fresh test defaults (a single blank Gemini tab) even though the main process had 478KB of history and live configs on disk.
   - **Solution**: Establish a Universal File-Backed App State IPC layer. On startup, the renderer hydrates tabs, theme, settings, pinned state, models, and history directly from `~/.config/nexus/` via IPC (with non-blocking `localStorage` fallback). On every change, state dual-persists to disk and `localStorage`. `npm run dev` and production share the exact same tabs, active session, models, and webview login partition (`persist:ai-shared`).

---

## 📂 Plan Breakdown

| Plan File | Scope & Focus |
| :--- | :--- |
| [TASK-1-CONFIG-DIRECTORY-UNIFICATION.md](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v3/TASK-1-CONFIG-DIRECTORY-UNIFICATION.md) | Eliminating `.config/Nexus`, fixing lock bootstrap order, and one-time clean consolidation. |
| [TASK-2-UNIVERSAL-DEV-PRODUCTION-SYNC.md](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v3/TASK-2-UNIVERSAL-DEV-PRODUCTION-SYNC.md) | Bridging origin-isolated `localStorage` to file-backed IPC so `npm run dev` mirrors live state. |
| [TASK-3-TABS-AND-SESSIONS-ZERO-DATA-LOSS-GUARD.md](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v3/TASK-3-TABS-AND-SESSIONS-ZERO-DATA-LOSS-GUARD.md) | Safe tabs hydration, anti-wipe protection for `tabs.json`, and session continuity. |
| [TASK-4-TESTS-AND-VERIFICATION-PLAN.md](file:///home/elsadek/vicinae/nexus%20electron/review_plans_v3/TASK-4-TESTS-AND-VERIFICATION-PLAN.md) | Unit test suite, integration matrix, and smoke testing for dev and production builds. |

---

## 📁 Review Folder Absolute Path
```
/home/elsadek/vicinae/nexus electron/review_plans_v3
```
