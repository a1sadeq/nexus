# Task 28 Plan: Remove Old Bottom-Right React DOM AI Toast

## Context & Objectives
- Nexus now features a dedicated native `aiNotificationView` (Electron `WebContentsView`) rendered at the top-right (`x: width - 395, y: 44`) with Iron-Man HUD styling, real-time response snippets, status glows, and a "View Tab" button.
- The legacy `<AiNotificationToast />` component was rendered in the React DOM at `fixed bottom-6 right-6`.
- Having both toasts caused duplicate UI notifications when AI generation completed.
- Objective: Completely remove the old bottom-right React DOM AI toast from `App.tsx` (and `App_gemini.tsx`), keeping download toasts (`DownloadNotificationToast`) intact, and ensure all AI notifications route exclusively through the native top-right Iron-Man HUD.

## Execution Steps
1. In `src/renderer/src/App.tsx`:
   - Remove `<AiNotificationToast ... />` from the JSX tree.
   - Keep `DownloadNotificationToast` intact.
   - Clean up the unnecessary `aiNotifications` state while preserving `show_in_app_toast` IPC triggers in `onLiveStatus`.
   - Update `switchToTab` and tab dismissals to dispatch `dismiss_in_app_toast` to the native overlay.
2. Mirror all changes to `src/renderer/src/App_gemini.tsx`.
3. Verify `AiNotificationToast.test.tsx` and all unit test suites.
