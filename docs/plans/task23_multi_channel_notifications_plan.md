# Task 23: Multi-Channel Notifications (Visual Badge + JARVIS Audio + Desktop Notification)

## 1. Context & Objective
Per user directive A3:
- Visual Tab Badge: Amber beacon pulse for `waiting-input`, orbital spin for `working`, calm emerald for `done`.
- Audio Feedback: Play a subtle JARVIS audio tone when a background tab finishes or needs input.
- OS Desktop Notification: Show a native desktop notification if Nexus Electron is minimized or blurred when an AI finishes.
- User emphasis: "make sure the nexus's inside notifications is perfect ."

## 2. Notification Dispatcher Implementation
1. **Visual Tab Item**:
   - `AiStatusBadge.tsx`:
     - Amber pulse beacon with `@keyframes ping` and soft outer glow.
     - Orbital spinner with model provider color during generation.
     - Emerald check/dot on done.
2. **Audio Chime via JARVIS Sound Synthesizer**:
   - Call `sfx.pop()` or a dedicated pleasant dual-frequency completion chime (`playAiFinishedChime()`) using the Web Audio API synthesizer already present in Nexus.
3. **OS Desktop Notification**:
   - When a background tab enters `'waiting-input'` or `'done'`:
     - Check `document.visibilityState === 'hidden'` or window blurred.
     - If true, display Electron / HTML5 `new Notification(title, { body: 'AI response ready' })`.
     - Clicking the notification activates the window and switches to that tab.

## 3. Verification Plan
- Unit tests for notification trigger conditions.
- Audio synthesis mock tests.
