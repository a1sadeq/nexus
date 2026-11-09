# Task 34: AI Status Observer Precision & Watchdog Plan

## 1. Problem Statement
- The AI generation status was inaccurate and frequently locked in the purple `working` state.
- **Root Cause 1**: `aiStatusObserver.ts` contained a document-wide `MutationObserver` updating `lastTokenTime` on any DOM change outside textarea/input. Background animations, SVGs, avatars, and WebSocket events kept `Date.now() - lastTokenTime < 1500` constantly true, locking `isGenerating` in an infinite loop.
- **Root Cause 2**: Global `isStopButton()` regex matched unrelated buttons across the entire page (e.g., read-aloud stop, media buttons, sidebar links) instead of strictly scoping to the chat composer.
- **Root Cause 3**: Missing completion watchdog meant missed DOM transitions left the tab in `working` state indefinitely.

## 2. Solution & Architectural Changes
1. **Remove Document-Wide Mutation Timer**:
   - Completely eliminate the document-wide `lastTokenTime` heuristic in `aiStatusObserver.ts`.
2. **Scope Controls to Chat Composer/Form**:
   - Restrict Stop and Send button inspection strictly to the active composer / prompt form (`form, [class*="composer" i], [class*="prompt" i], [class*="chat-input" i], footer`).
3. **Provider-Specific Adapters**:
   - **ChatGPT**: Check `button[data-testid="stop-button"]`, `button[data-testid="send-button"]`, and `.result-streaming`.
   - **Claude**: Check `button[aria-label="Stop Response"]`, `button[aria-label="Send Message"]`, and streaming cursor.
   - **Gemini**: Check `button[aria-label*="Stop" i]`, send button return, and `model-response.is-streaming`.
   - **DeepSeek**: Check composer stop button, `.ds-thinking`, and `div[class*="ds-message"].streaming`.
   - **Arena / Gradio**: Check `#component-stop` / `button:has-text("Stop")`.
4. **Dual-Confirmation & Assistant Growth Heartbeat**:
   - Track text length growth in the last assistant response container (`getAssistantSnippet()`).
   - Generation is marked finished when Stop button disappears or Send button returns, confirmed by 1.2s without text growth.
5. **Fail-Safe Watchdog**:
   - If `working` state persists for >4 seconds with zero text growth and no composer Stop button, auto-recover to `done`.
6. **Tests**:
   - Unit tests covering start, streaming, dual-confirmation, and watchdog recovery.
