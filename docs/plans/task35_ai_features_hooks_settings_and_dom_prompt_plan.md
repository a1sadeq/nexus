# Task 35: AI Features & Hooks Settings & DOM Prompt Plan

## 1. Problem Statement
- Users need an explicit, intuitive `AI Features & Hooks` section in Settings to inspect, configure, and customize DOM hooks per provider.
- Users need a ready-to-copy, comprehensive reverse-engineering prompt with full DOM extraction information to paste into any AI model to discover 100% accurate selectors for any webview.

## 2. Solution & Architectural Changes
1. **Rename & Restructure Settings Section**:
   - In `SettingsOverlay.tsx`, rename `"AI Features & Interceptors"` to **`AI Features & Hooks`** (`id: 'ai-features'`).
   - Add clear badges and quick-action toolbars.
2. **Upgrade `generateFeatureHooksPrompt` in `promptGenerator.ts`**:
   - Expand the prompt template to encompass:
     - `composerSelector`: Prompt textarea / contenteditable.
     - `sendButtonSelector`: Send / submit arrow button.
     - `stopGenerationSelector`: Stop / interrupt square button.
     - `streamingSelector`: Streaming indicator / cursor / pulsing dots.
     - `thinkingSelector`: Reasoning / thought toggle container (e.g. DeepSeek R1 / o1).
     - `assistantMessageSelector`: Assistant response container.
     - `promptNavSelector`: User message bubble for `Alt+J`/`Alt+K`.
     - `attachmentSelector`: File upload / paperclip trigger (`Ctrl+O`/`Ctrl+Shift+O`).
     - `newChatSelector`: New conversation button (`Ctrl+T`).
     - `chatTitleSelector`: Title heading/link for tab header synchronization.
3. **Comprehensive DOM Extraction & Instructions**:
   - Ensure the generated prompt includes the sanitized live DOM tree, exact selector rules, and returns a clean, parseable JSON block ready for 1-click import into Nexus.
