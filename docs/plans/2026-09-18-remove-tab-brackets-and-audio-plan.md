# Remove Tab Brackets and Audio Plan

## Objective
Remove corner reticles from chat tabs and completely remove all audio synthesis code and sound triggers across the entire application.

## Tasks
1. **Chat Tabs Styling**:
   - In `src/renderer/src/components/ChatTabs.tsx`, remove the `hud-bracket` class from `.chat-tab-pill`.
   - Ensure the sleek Iron Man HUD active gradient, cyan border, and text shadow remain intact.
2. **Audio System Removal**:
   - Delete `src/renderer/src/lib/hudAudio.ts`.
   - In `src/renderer/src/components/HudStatusHeader.tsx`, remove the Audio Mute/Unmute button, keeping only the mini Arc Reactor diagnostics trigger and the Mark protocol badge.
   - In all components (`ChatTabs.tsx`, `PinnedSidebar.tsx`, `ModelNotch.tsx`, `NewTabOverlay.tsx`, `DownloadNotificationToast.tsx`, `JarvisBootOverlay.tsx`, `App.tsx`), remove all `hudAudio` imports and event triggers (`click()`, `hover()`, `modalOpen()`, `modalClose()`, `boot()`, `success()`).
