# Task 27 Plan: Native AI Notifications Overlay View, Provider Webview Permission Blocking, and App Focus Filtering

## 1. Context and Problem Statement
From the user's feedback and screenshot evidence:
1. **In-App Toast Hidden by AI Webview:**
   - `<AiNotificationToast />` was rendered in the React DOM with `fixed bottom-6 right-6`.
   - Because `WebContentsView` is a native Chromium view rendered on top of the BrowserWindow DOM, the entire toast was covered by the active AI web view and remained invisible to the user.
2. **AI Webview Triggers Its Own Duplicate Notification:**
   - The provider website (e.g. Gemini) called HTML5 `new Notification(...)`, triggering an OS desktop notification directly from the webview. The user explicitly does not want webviews triggering notifications.
3. **Nexus Emitted Desktop Notification While App Was Focused:**
   - Inside `App.tsx`, `isWindowFocusedRef.current` was hooked to DOM `window.blur`. When the user clicked into the AI webview (e.g. to type a prompt), the React DOM window received a blur event, falsely marking the window as unfocused and triggering a desktop notification even though the user was actively focused on Nexus.

## 2. Requirements & Desired Behavior
1. **Native Toast Overlay (`aiNotificationView`):**
   - Create a dedicated, transparent `WebContentsView` in Electron (`aiNotificationView`) attached to `mainWindow.contentView`.
   - It must sit at the top of the z-order (in front of all `aiViews`), guaranteeing 100% visibility over the AI web view without being occluded.
   - Positioned in the upper-right corner of the web view (`{ x: winWidth - 390, y: 48, width: 370, height: 130 }`).
   - Click-through outside its bounds: mouse interactions outside the toast pass directly to the underlying web view.
   - Provides clean Iron-Man HUD styling, title, snippet preview, "Switch to tab" action, and auto-dismiss timer.
2. **Block Provider Webview Notifications:**
   - In `session.fromPartition('persist:ai-shared')` and `session.defaultSession`, register `setPermissionRequestHandler` and `setPermissionCheckHandler` to unconditionally deny `'notifications'`.
   - In webview runtime / DOM-ready, override `window.Notification` so `Notification.permission` returns `'denied'`, preventing provider sites from ever dispatching HTML5 notifications.
3. **Reliable App Focus Filtering:**
   - Remove DOM `window.addEventListener('blur')` from `App.tsx` that falsely triggered on webview clicks.
   - Implement `is_app_focused` IPC handler querying `mainWindow.isFocused()`.
   - Strictly suppress desktop system notifications when Nexus is focused; only trigger system notifications when Nexus is genuinely blurred/minimized/in background.

## 3. Implementation Steps
1. **Update `src/main/index.ts` and `src/main/index_gemini.ts`:**
   - Add notification permission denier to `aiSharedSession` and `defaultSession`.
   - Inject `window.Notification` neutering script in `buildWebviewRuntimeJs`.
   - Create `aiNotificationView` on startup and add to `mainWindow.contentView`.
   - Implement `show_in_app_toast` and `dismiss_in_app_toast` IPC handlers.
   - Implement `is_app_focused` IPC handler.
2. **Update `src/renderer/src/App.tsx` and `src/renderer/src/App_gemini.tsx`:**
   - Update focus detection to remove DOM `blur` listeners and query `is_app_focused`.
   - Dispatch `show_in_app_toast` IPC to main when an AI session finishes or needs input.
   - Dismiss toast when user switches to that tab.
3. **Synchronize All `_gemini` Files:**
   - Keep all companion files 100% identical.
4. **Verification & Tests:**
   - Run typecheck, build, and test suite.
