/**
 * Changing which browser a page claims to be, *without* cancelling the navigation it is in the middle of.
 *
 * `webContents.setUserAgent()` cannot do this job. Chromium treats a user-agent change on the page as a
 * reason to throw away whatever navigation is pending: the in-flight request is aborted with
 * `ERR_ABORTED (-3)`, the pending entry is discarded, and the tab replays the document it already had.
 * Every request our identity hook reacts to is, by definition, made *during* a navigation — so switching
 * the page from inside `onBeforeSendHeaders` means "cancel the navigation the user just started".
 *
 * That is exactly what "Continue with Google" on chat.z.ai was doing, and why it looked like a reload:
 *
 *   1. the button navigates to `chat.z.ai/oauth/google/login?t=2`  (a navigation the page started)
 *   2. z.ai answers `302 → accounts.google.com/o/oauth2/…`
 *   3. the redirect reaches the request hook as a **main-frame request for a Google-owned URL**, so the
 *      hook switched the page to the honest Electron identity — with `setUserAgent`
 *   4. Chromium discarded the redirect and re-committed `chat.z.ai/auth`
 *
 * The trace showed no navigation to Google at all — only `chat.z.ai/auth` again, 300–500 ms after the
 * click, with a `did-fail-load -3` on the way. Every Google sign-in that leaves a provider tab through a
 * server redirect died the same way; a popup did, too, on its first hop.
 *
 * The DevTools protocol's `Emulation.setUserAgentOverride` does the same job without touching navigation
 * state: the document's `navigator.userAgent` and its request headers change, and the redirect carries on.
 *
 * This module is the seam that makes that decision testable: it takes the two methods it needs, so a test
 * can hand it a stub instead of an Electron page.
 */

export interface SwitchableDebugger {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
}

/** The slice of a `WebContents` this needs. */
export interface SwitchableContents {
  isDestroyed(): boolean
  debugger: SwitchableDebugger
}

/**
 * Ask the page to present `userAgent` from now on, over the DevTools protocol.
 *
 * Returns `true` when the request was sent, `false` when there is no debugger to send it with — a page
 * with DevTools already open, or one that has gone. A `false` is not an error: the caller keeps the page
 * on the identity it already has, which never cancels anything, and the app-wide watcher switches it
 * after the navigation commits instead.
 *
 * The command itself is asynchronous and is deliberately not awaited: this runs inside a synchronous
 * request hook, and blocking it would stall the very navigation being repaired.
 */
export function applyUserAgentOverCdp(
  contents: SwitchableContents | null | undefined,
  userAgent: string,
  log: (message: string) => void = () => undefined
): boolean {
  if (!contents || !userAgent) return false
  try {
    if (contents.isDestroyed()) return false
    const dbg = contents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    void Promise.resolve(dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent })).catch(
      (error: unknown) => log(`could not override the page's user agent: ${String(error)}`)
    )
    return true
  } catch (error) {
    // No debugger for this page. Nothing is cancelled and nothing is claimed: the caller falls back to
    // the identity the page is already presenting.
    log(`no debugger for this page: ${String(error)}`)
    return false
  }
}
