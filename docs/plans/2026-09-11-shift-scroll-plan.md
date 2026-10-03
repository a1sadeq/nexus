# Code Block Shift+Scroll Plan

## Objective
Enable horizontal scrolling in code blocks using `Shift + Scroll` (mouse wheel) inside the AI webviews.

## Current Situation
`Shift + Scroll` normally translates to horizontal scrolling natively in browsers, but often fails in Electron `BrowserView`s on certain Linux desktop environments, or is explicitly swallowed by complex React frontends running on the AI provider's side (e.g. ChatGPT's markdown parser).

## Brainstorming & Open Questions
- Does this happen on all AI providers (ChatGPT, Claude, etc.), or just specific ones?
- We can fix this universally by injecting a small `preload` script into every AI webview that listens for `wheel` events on the `window` object in the capture phase. If `e.shiftKey` is true, the script can calculate the scroll delta and manually apply `element.scrollLeft += e.deltaY`, then `e.preventDefault()`.

## Proposed Implementation Steps (Pending Clarification)
1. Add a global mouse wheel interceptor via `executeJavaScript` or in `preload/ai.js`.
2. When a `wheel` event occurs with `shiftKey` pressed, identify the closest scrollable container.
3. Apply horizontal scroll natively and suppress the vertical default action.
