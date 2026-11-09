# Task 37: Native OS Desktop Notifications & AI Features Precision Suite Plan

## 1. Problem Statement
- **System Desktop Notifications Missing**: Background tabs completing or needing input did not pop an OS desktop notification when Nexus was out of focus, minimized, or in another workspace. Renderer HTML5 `new Notification` was blocked/silent in Chromium/Electron on Linux desktop environments.
- **AI Features & Hooks Precision**:
  - `assistantMessageSelector` & `streamingSelector` were missing UI controls and un-wired in the observer script.
  - Lack of deterministic completion indicators (Copy/Regenerate buttons) and error banner detection meant potential edge-case false positives or missed rate-limit failures.
  - Heavy reasoning models (o1/o3/DeepSeek R1) lacked a configurable watchdog timeout.

## 2. Solutions Implemented
1. **Native Electron Main Process Desktop Notifications**:
   - Replaced browser renderer HTML5 `Notification` with Electron's first-class `Notification` module in `src/main/index.ts`.
   - Connected directly to Linux D-Bus `org.freedesktop.Notifications` (GNOME, KDE Plasma, Mako, Dunst, SwayNC) and Windows Action Center / macOS Notification Center.
   - When focused: shows inside-Nexus Iron-Man HUD toast overlay.
   - When in background or minimized: triggers native OS notification with sound and icon.
   - Clicking native OS notification un-minimizes, focuses, and activates the finished tab.
2. **AI Features & Hooks Precision Suite**:
   - Added `errorSelector`, `completionActionSelector`, and `statusWatchdogTimeoutMs` to `ProviderFeatureConfig` and `FEATURE_HOOK_KEYS`.
   - Injected all 6 precision selectors (`assistantMessageSelector`, `streamingSelector`, `errorSelector`, `completionActionSelector`, `statusWatchdogTimeoutMs`, `stopGenerationSelector`) into `getAiStatusObserverScript`.
   - Wired dual-confirmation completion: if Copy/Regenerate or send button is active and text growth has settled, generation transitions cleanly to done.
   - Added dedicated "State & Completion Intelligence" card in `ProviderFeaturesSection.tsx` with live input controls.
   - Upgraded AI reverse-engineering prompt in `promptGenerator.ts` to output all 12 hook selectors.
