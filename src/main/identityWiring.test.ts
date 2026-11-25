import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The identity solution is only worth anything if it covers the whole app, and these are the joints
 * where that can silently come undone: the request hook, the lifecycle watcher, the two injection
 * helpers every caller funnels through, and the sign-in window itself. Electron cannot be started in
 * a test, so the wiring is read out of the source — the same way the shortcut tests do it.
 */
const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const signIn = readFileSync(join(__dirname, 'googleSignInWindow.ts'), 'utf8')

describe('one identity decision, applied app-wide', () => {
  it('decides identity in webIdentity.ts, not in the request hook', () => {
    expect(main).toContain("from './webIdentity'")
    expect(main).toContain('resolveIdentityForRequest({')
    expect(main).toContain('desiredIdentityFor(url)')
    // The old sign-in-window-only exemption must be gone, or a popup would still be judged by it.
    expect(main).not.toContain('isInAppSignInWebContents')
    expect(signIn).not.toContain('isInAppSignInWebContents')
  })

  it('knows which hosts are AI providers, so Google’s own pages can be honest', () => {
    // The rule is "Google's properties are native, the AI products are not" — that only works if the
    // product hosts are named explicitly.
    expect(main).toContain('configureProviderHosts(')
    expect(main).toContain('gemini.google.com')
    expect(main).toContain('aistudio.google.com')
  })

  it('hands both user agents to the registry before any page exists', () => {
    const configure = main.indexOf('configureUserAgents({ ai: AI_UA, native: NATIVE_ELECTRON_UA })')
    const fallback = main.indexOf('app.userAgentFallback = AI_UA')
    const firstWindow = main.indexOf('function createWindow(')
    expect(configure).toBeGreaterThan(fallback)
    expect(configure).toBeLessThan(firstWindow)
  })

  it('switches the page as well as the header when a sign-in surface is loaded', () => {
    const hook = main.slice(main.indexOf('ses.webRequest.onBeforeSendHeaders'), main.indexOf('ses.webRequest.onHeadersReceived'))
    expect(hook).toContain('adoptNativeIdentity(contents, NATIVE_ELECTRON_UA)')
    expect(hook).toContain('releaseNativeIdentity(contents)')
    expect(hook).toContain("decision.identity === 'native' ? NATIVE_ELECTRON_UA : AI_UA")
    // No lock, no switch: the answer comes from the registry every time.
    expect(hook).not.toContain('isInAppSignInWebContents')
  })

  it('watches every webContents in the app, not each creation site', () => {
    const start = main.indexOf("app.on('web-contents-created'")
    // A window, not a parser: wide enough to hold the whole handler including the guards added
    // around the repair (an in-flight navigation now postpones it).
    const watcher = main.slice(start, start + 4200)
    expect(watcher).toContain('syncIdentity(contents, url)')
    expect(watcher).toContain('forgetNativeIdentity(contents.id)')
    // The header/document repair for a page that was switched mid-flight.
    expect(watcher).toContain("executeJavaScript('navigator.userAgent'")
    expect(watcher).toContain('{ userAgent: NATIVE_ELECTRON_UA }')
    // Bounded, because an unbounded repair is a page that reloads itself forever — which is what the
    // user saw on www.google.com. Two repairs, then it says so and stops.
    expect(watcher).toContain('repairs >= 2')
    expect(watcher).toContain('repairs += 1')
  })

  it('guards the injection helpers every caller funnels through', () => {
    // The injection predicate, not the identity one: nothing of ours goes into any identity
    // provider's page, while the identity itself only changes on Google's sign-in surfaces.
    const focus = main.slice(
      main.indexOf('function focusPromptInView('),
      main.indexOf('function focusPromptInView(') + 800
    )
    expect(focus).toContain('if (isThirdPartyAuthPage(view.webContents.getURL())) return')

    const poller = main.slice(
      main.indexOf('function updateWebviewTitlePoller('),
      main.indexOf('function updateWebviewTitlePoller(') + 500
    )
    expect(poller).toContain('if (isThirdPartyAuthPage(view.webContents.getURL())) return')
  })

  it('gives the sign-in window the identity for its whole life, and the same session policy as a tab', () => {
    expect(signIn).toContain('adoptNativeIdentity(win.webContents, NATIVE_ELECTRON_UA, { permanent: true })')
    // The id is captured before the window can be destroyed: reading win.webContents inside the
    // 'closed' handler throws, so reaching for it there would never forget anything.
    expect(signIn).toContain('const contentsId = win.webContents.id')
    expect(signIn).toContain('forgetNativeIdentity(contentsId)')
    expect(signIn).not.toContain('forgetNativeIdentity(win.webContents.id)')
    // Setting the user agent directly would bypass the registry and let a navigation undo it.
    expect(signIn).not.toContain('setUserAgent(NATIVE_ELECTRON_UA)')

    const handler = main.slice(
      main.indexOf("ipcMain.handle('google_signin_start'"),
      main.indexOf("ipcMain.handle('google_signin_start'") + 1200
    )
    // The identity hook and the cookie flush, not the whole AI treatment: a partition used to sign in
    // must behave like a browser on Google's pages.
    expect(handler).toContain('installSignInSessionPolicy(partition)')
    expect(handler).not.toContain('installAiSessionPolicy(partition)')
  })

  it('can still upgrade a sign-in partition to a tab partition', () => {
    // installSignInSessionPolicy must not consume the full policy's one-shot slot, or a tab on the new
    // account's partition would run without telemetry blocking or download handling.
    const light = main.slice(
      main.indexOf('function installSignInSessionPolicy('),
      main.indexOf('function installAiSessionPolicy(')
    )
    expect(light).not.toContain('aiPolicyInstalled.add')
    expect(main).toContain('const identityHookInstalled')
  })

  it('never leaves a page whose header and navigator disagree', () => {
    // Adopting without also switching the document is the one state Google refuses.
    const adoptSites = main.split('adoptNativeIdentity(').length - 1
    expect(adoptSites).toBeGreaterThan(0)
    expect(main).toContain("executeJavaScript('navigator.userAgent'")
  })
})
