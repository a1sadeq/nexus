# Plan: Fix Uncaught SyntaxError (Invalid or unexpected token)

## Issue
When a user focuses the webview and types a quote character (e.g., `'` or `\`), the webview forwards the `keydown` event to the main window using `executeJavaScript` with a template literal. Since the string is constructed like `key: '${input.key}'`, a single quote breaks the JavaScript syntax, throwing an `Uncaught SyntaxError` that is caught by our global `window.onerror` fallback UI (the red screen).

## Solution
1. Open `src/main/index.ts`.
2. Locate the `before-input-event` listener on the webview where `executeJavaScript` builds the `KeyboardEvent` string.
3. Replace the unsafe template literal interpolation (`'${input.key}'`) with a safe JSON stringification (`${JSON.stringify(input.key)}` and `${JSON.stringify(input.code)}`).
4. This ensures quotes and slashes are properly escaped before being executed in the React renderer context.
