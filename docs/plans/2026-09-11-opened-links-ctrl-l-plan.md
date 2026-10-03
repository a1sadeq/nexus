# Opened Links Ctrl+L Plan

## Objective
Make external links opened from the AI webviews support the `Ctrl+L` shortcut to view, edit, and copy the URL.

## Current Situation
Currently, when the AI webview opens a new link (e.g. `window.open` or `target="_blank"`), `setWindowOpenHandler` catches it and returns `action: 'allow'`, which spawns a raw native Electron `BrowserWindow`. Because this window does not load the React App, it completely lacks the `App.tsx` global shortcuts, including the `Ctrl+L` URL bar.

## Brainstorming & Open Questions
- **Option A (Native Popup Integration):** Keep opening them as separate popup windows, but inject a script/menu into them that intercepts `Ctrl+L` and communicates with the Main process to spawn a tiny native URL bar (or use Electron's dialogs).
- **Option B (In-App Tabs):** Instead of opening separate native windows, should we intercept these links and open them as a *new Tab* inside the Nexus main interface? This would instantly give them access to the existing `Ctrl+L` URL bar.
- **Option C (Main Window Proxy):** Keep them as popups, but if `Ctrl+L` is pressed while focused on the popup, the Main process tells the Main Window to show its URL bar on top of the popup?

## Proposed Implementation Steps (Pending Clarification)
*(Will be populated once the user clarifies their preferred workflow)*
