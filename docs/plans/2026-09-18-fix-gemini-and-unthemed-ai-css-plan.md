# Fix Gemini & Unthemed AI Provider CSS Plan

## Objective
Ensure that custom CSS injected into AI webviews (especially Google Gemini and any unthemed/generic AI providers) properly constrains codeblocks and containers so code never expands off-screen or breaks horizontal scrolling, and prevents the right portion of the chat from blacking out.

## Problem Analysis
1. **Gemini Codeblock Layout**:
   - In `src/main/providerThemes.ts`, `code-block .formatted-code-block-internal-container` had `overflow: hidden !important;`, while `code-block pre` lacked `max-width: 100% !important; overflow-x: auto !important;`.
   - Long lines of code push the container's width beyond the viewport boundaries.
2. **Right-Side Blackout**:
   - `src/main/providerThemes.ts` set `.chat-history, .chat-history-scroll-container { overflow-x: visible !important; }`. This allowed internal content to overflow horizontally without a scroll container, displacing the layout and causing the right side of the webview canvas to appear black or clipped.
3. **Unthemed / Generic Providers**:
   - If a user navigates to an unsupported or custom AI URL, the base injected CSS must contain robust defaults ensuring `pre`, `code`, and containers always have `max-width: 100% !important; box-sizing: border-box !important; overflow-x: auto !important;` and `word-break: break-word;`.

## Tasks
1. **Gemini Rules Refactoring in `src/main/providerThemes.ts`**:
   - Enforce:
     ```css
     code-block,
     code-block .formatted-code-block-internal-container,
     code-block pre {
       max-width: 100% !important;
       width: 100% !important;
       box-sizing: border-box !important;
       overflow-x: auto !important;
     }
     code-block pre code {
       white-space: pre !important;
       word-break: normal !important;
       word-wrap: normal !important;
     }
     ```
   - Change `.chat-history, .chat-history-scroll-container` from `overflow-x: visible` to `overflow-x: hidden !important; max-width: 100% !important; width: 100% !important;`.
2. **Universal Code Block Safeguards in Base Theme**:
   - In the base styles generator (`base(v)`), add comprehensive code block wrapping and scroll safety rules:
     ```css
     pre, code, pre > code, .code-block, [class*="code-block"] {
       max-width: 100% !important;
       box-sizing: border-box !important;
     }
     pre {
       overflow-x: auto !important;
       white-space: pre !important;
     }
     ```
3. **Verification**:
   - Test rendering on Google Gemini and check long lines in code blocks to confirm horizontal scrollbars appear inside the block and the right side of the chat window remains fully visible.
