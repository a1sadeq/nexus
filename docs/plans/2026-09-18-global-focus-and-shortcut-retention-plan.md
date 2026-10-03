# Architecture Plan: Global Focus & Shortcut Retention Overhaul

## 1. Executive Summary & Root Cause Investigation
The user reported that after pressing `Ctrl+,` to open Settings (or opening any modal/popup), shortcuts (such as `Ctrl+,` to toggle close, `Escape`, `Ctrl+T`, `Ctrl+W`) stop working until the user clicks the panel with the mouse. Furthermore, shortcuts sometimes stop working entirely even without opening settings.

Our deep inspection into the Electron native window architecture, Chromium Views hierarchy, and renderer event routing uncovered **7 distinct failure modes** that compound to produce this issue:

### Root Cause 1: Chromium Views FocusManager Limbo on Child View Hide
- Nexus uses Electron 43 with `WebContentsView`. The main window's root view is `mainWindow.contentView`, and AI tabs are attached as child views via `mainWindow.contentView.addChildView(view)`.
- When an AI tab is active, Chromium's native `FocusManager` has the child `WebContentsView` as its `focused_view_`.
- When `Ctrl+,` or any modal opens, `resize_view` sets `view.setVisible(false)` and `bounds: { width: 0, height: 0 }`.
- In Chromium Views framework, making the focused child view invisible clears `focused_view_` to `nullptr`.
- `src/main/index.ts` called `mainWindow.webContents.focus()`. However, `WebContentsImpl::Focus()` only operates on the content layer — it does NOT update the native `views::Widget`'s `FocusManager::focused_view_`.
- With `focused_view_ == nullptr`, native OS keyboard events (`WM_KEYDOWN` on Windows, `KeyPress` on Linux X11/Wayland) hitting the window are discarded by Chromium's Widget before reaching `mainWindow.webContents`!
- **Why clicking fixes it:** Clicking sends a mouse press (`ui::ET_MOUSE_PRESSED`). Chromium's Widget hit-tests the click coordinate, finds `mainWindow.contentView`, and executes `FocusManager::SetFocusedView(contentView)`. From that instant, keys flow normally.
- **The Native Fix:** Electron provides `mainWindow.focusOnWebView()`, which internally calls `content_view_->RequestFocus()`, directly telling Chromium Views `FocusManager` to set `focused_view_ = contentView`.

### Root Cause 2: Overlays Lack Focusable DOM Roots & Autofocus
- In `SettingsOverlay.tsx`, `ExportOverlay.tsx`, and others, the modal wrapper is a plain `<div>` without `tabIndex={-1}` and without any `.focus()` invocation on mount.
- Even if the window had focus, `document.activeElement` was `document.body` or in a blurred state.
- In Chromium, if no element is focused in the DOM, key events may not bubble cleanly, especially when a child webview was just detached/hidden.
- **The Renderer Fix:** All modal overlays must assign `ref={rootRef}`, `tabIndex={-1}`, and execute `rootRef.current?.focus({ preventScroll: true })` on mount, along with IPC `claim_window_focus`.

### Root Cause 3: `mainWindow.isFocused()` Race Condition Dropping Focus
- Across `src/main/index.ts` (lines 1582, 1588, 2533, 2762), tab activation and loading completion guarded webview focus with:
  `if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && !view.webContents.isDestroyed())`
- On Linux and Windows, when a child `WebContentsView` has focus, `mainWindow.isFocused()` frequently returns `false` because the parent window itself is not the leaf focused view.
- Consequently, during tab switching (`activate_tab`) or navigation completion (`did-stop-loading`), `view.webContents.focus()` was skipped completely! The webview was visible on screen, but completely unfocused, leaving keyboard shortcuts completely dead without opening any settings!

### Root Cause 4: Focus Stealing on `did-start-loading`
- In `src/main/index.ts` lines 1580-1585:
  ```ts
  view.webContents.on('did-start-loading', () => {
    sendToMainWindow('ai-loading', tabId, true)
    if (activeViewId === tabId && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && mainWindow.webContents) {
      mainWindow.webContents.focus()
    }
  })
  ```
- Whenever a webview started loading (even background token refreshes, redirects, or new chats), line 1583 yanked focus away from the AI webview and focused `mainWindow.webContents`!
- This left the user typing into the void while the chat was loading.

### Root Cause 5: Asymmetric Shortcut Interception in `mainWindow.webContents`
- `view.webContents.on('before-input-event')` intercepted shortcuts like `Ctrl+T`, `Ctrl+W`, `Ctrl+,`, `Ctrl+H`, `Alt+P`, `Alt+J`, `Alt+K`.
- But `mainWindow.webContents.on('before-input-event')` ONLY intercepted `Ctrl+Tab`!
- When focus was on the titlebar, tab strip, sidebar, or any overlay, all other shortcuts bypassed the main process and had to rely on React's `window.addEventListener('keydown')`, which is vulnerable to DOM focus drops, synthetic event discrepancies, and modal event swallowing.

### Root Cause 6: Fragile Synthetic DOM Dispatches via `executeJavaScript`
- In `view.webContents.on('before-input-event')`, shortcuts were forwarded to `mainWindow` using:
  `mainWindow.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent(...))")`
- This is asynchronous, subject to V8 task scheduling latency, prone to being blocked if the renderer is busy, and creates synthetic events that don't trigger native browser default behaviors or can be swallowed by child component capture listeners.

### Root Cause 7: Missing `restoreViewBounds()` on Modal Dismissal
- In `src/renderer/src/App.tsx` line 1730, `TabOverviewOverlay`'s `onClose` failed to call `restoreViewBounds()`.
- When closed, the AI webview remained hidden with `{ width: 0, height: 0 }`, leaving the screen blank or dead.

---

## 2. Comprehensive Solution Architecture

### Plan Steps:
1. **Main Process: Robust Native Focus Handshake & View Focusing (`src/main/index.ts`)**:
   - Add `claim_window_focus` IPC handler:
     Calls `mainWindow.focus()`, `mainWindow.focusOnWebView()`, and `mainWindow.webContents.focus()`.
   - In `resize_view`: when `hidden === true`, call `mainWindow.focus()`, `mainWindow.focusOnWebView()`, and `mainWindow.webContents.focus()`.
   - In `activate_tab`, `did-stop-loading`, and `resize_view (shown)`: remove the fragile `mainWindow.isFocused()` check so `view.webContents.focus()` and `focusPromptInView(view)` always run.
   - In `did-start-loading`: eliminate the focus-stealing call to `mainWindow.webContents.focus()`.
   - In `view.webContents.on('did-create-window')`: return focus to active AI view when popup windows close.

2. **Unified Global Shortcut Router in Main Process (`src/main/index.ts`)**:
   - Create a shared `handleGlobalShortcutInput(event, input, source: 'window' | 'view')` function.
   - For application-level shortcuts (`Ctrl+,`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+H`, `Ctrl+B`, `Ctrl+L`, `Ctrl+Tab`, `Alt+P`, `Ctrl+O`, `Ctrl+Shift+O`, `Ctrl+R`, `Ctrl+Shift+D`):
     - Main intercepts them via `before-input-event` on BOTH `mainWindow.webContents` AND all `view.webContents`.
     - Dispatches clean, typed IPC messages directly to `mainWindow.webContents.send('execute-global-action', action)`.
     - This completely bypasses fragile `window.dispatchEvent(KeyboardEvent)` and DOM focus state!

3. **Renderer Global Action Dispatcher (`src/renderer/src/App.tsx`)**:
   - Add an IPC listener for `execute-global-action` in `App.tsx` that triggers:
     - `toggle_settings`: toggles `showSettings`.
     - `new_tab`: opens `showNewTab`.
     - `close_tab`: closes active tab.
     - `reopen_tab`: reopens recently closed tab.
     - `toggle_history`: toggles `showHistory`.
     - `toggle_tab_overview`: toggles `showTabOverview`.
     - `toggle_sidebar`: toggles sidebar collapse.
     - `toggle_url_bar`: toggles URL bar.
     - `toggle_pin`: pins/unpins active tab.
     - `close_active_overlay`: closes whatever modal is currently open.
   - Fix `onClose` in `TabOverviewOverlay` (call `restoreViewBounds()`).

4. **Renderer Overlay Focus Retention**:
   - In `SettingsOverlay.tsx`, `HistoryOverlay.tsx`, `ExportOverlay.tsx`, `TabOverviewOverlay.tsx`, `UrlBarModal.tsx`:
     - Add `tabIndex={-1}` and autofocus / `ref.current?.focus()` on mount.
     - Send `claim_window_focus` IPC on mount.
     - Ensure `Escape` closes the overlay and immediately restores view bounds and focuses the active webview.

5. **Verification**:
   - Test `Ctrl+,` from inside an active chat tab -> Settings opens -> immediately press `Ctrl+,` or `Escape` WITHOUT clicking anything -> Settings closes instantly and webview is focused.
   - Test `Ctrl+T` -> New tab modal opens with search input focused immediately.
   - Test tab switching (`Ctrl+Tab`, `Ctrl+J`, `Ctrl+K`, clicking tab strip) -> verify typing and shortcuts work immediately without clicking.
   - Test page loading and navigation -> verify webview never loses focus.
   - Run `npm run typecheck` to verify complete type safety.
