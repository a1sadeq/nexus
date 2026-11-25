import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Two things build 28 got wrong, both visible in the trace the user sent back.
 *
 * 1. **The keyboard.** `did-stop-loading` called `view.webContents.focus()` on the active tab, so a page
 *    that reloads itself (chat.deepseek.com did it every couple of seconds) pulled the keyboard out of
 *    the shell twice a second. Shortcuts still *arrived* — the view forwards accelerators — but the
 *    address bar they opened could not be typed into, which is exactly "I have to click Nexus first".
 *    With an overlay open the handler bailed out early, which is why the keyboard behaved while the
 *    Diagnostics panel was up.
 *
 * 2. **The tug-of-war.** When the old page started navigating itself back while a URL-bar load was in
 *    flight, build 28 re-issued `loadURL` on the same tick. The trace shows the result: `did-fail-load
 *    -2 ERR_FAILED` for the URL we had just asked for, `ERR_ABORTED` for the intruder, and the old page
 *    committing anyway — five times, then "attempts exhausted". Cancelling first and asking again on
 *    the next turn is the whole difference.
 *
 * Asserted on the handler source, like `navigationRetry.test.ts`, because these live next to the
 * Electron imports and cannot be executed in isolation.
 */

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('the keyboard is remembered, not grabbed', () => {
  it('has one owner and one place that decides it', () => {
    expect(main).toContain("type KeyboardOwner = 'shell' | 'view'")
    expect(main).toContain('let keyboardOwner: KeyboardOwner')
    expect(main).toContain('function giveKeyboardToView(')
    expect(main).toContain('function giveKeyboardToShell(')
  })

  it('no longer moves the keyboard when a load finishes', () => {
    const start = main.indexOf("view.webContents.on('did-stop-loading'")
    expect(start).toBeGreaterThan(0)
    const handler = main.slice(start, start + 2200)
    // The steal is gone: the page may only *keep* the keyboard it already has.
    expect(handler).toContain('keyboardStaysWithView(view, tabId)')
    expect(handler).not.toContain('view.webContents.focus()')
  })

  it('remembers who had the keyboard before an overlay opened, and gives it back', () => {
    expect(main).toContain('keyboardBeforeOverlay = keyboardOwner')
    const restore = main.indexOf('function restoreWorkspaceAfterOverlay')
    const body = main.slice(restore, restore + 1400)
    expect(body).toContain("keyboardBeforeOverlay === 'shell'")
    expect(body).toContain('giveKeyboardToShell(')
  })

  it('learns the owner from what the user does', () => {
    // Clicking into the page…
    expect(main).toContain("setKeyboardOwner('view', 'view focused', tabId)")
    // …and clicking back into the shell.
    expect(main).toContain("setKeyboardOwner('shell', 'shell focused')")
  })

  it('does not drag the keyboard into the page when the window regains focus', () => {
    const start = main.indexOf("mainWindow.on('focus'")
    const body = main.slice(start, start + 900)
    expect(body).toContain("keyboardOwner === 'shell'")
    expect(body).toContain("keyboardOwner === 'view'")
  })
})

describe('the defence stops the intruder before asking again', () => {
  const start = main.indexOf("view.webContents.on('did-start-navigation'")
  const end = main.indexOf("view.webContents.on('will-navigate'", start)
  const handler = main.slice(start, end)

  it('is where expected', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(handler).toContain('taking the frame back from the old page')
  })

  it('schedules the defence instead of touching navigation state inside the event', () => {
    // Build 28 reloaded from inside the handler and aborted its own load. Build 29 called `stop()` from
    // inside the handler and closed the window — the log ends on that line. The handler now only
    // schedules; every native call happens on a later turn of the loop.
    expect(handler).toContain('scheduleDefence(view, tabId, pendingUrl)')
    expect(handler).not.toContain('view.webContents.stop()')
    expect(handler).not.toContain('view.webContents.loadURL(')

    const helperStart = main.indexOf('function scheduleDefence(')
    expect(helperStart).toBeGreaterThan(0)
    const helper = main.slice(helperStart, helperStart + 2400)
    expect(helper).toContain('setTimeout(')
    expect(helper).toContain("traceNav(tabId, 'load', 're-issue — this load cancels the intruder'")
    // …and the re-issue is guarded against a newer request having taken over.
    expect(helper).toContain('navWanted.get(tabId)?.url !== wantedUrl')
  })

  it('has a crash reporter, so a window that closes leaves a reason behind', () => {
    expect(main).toContain("process.on('uncaughtException'")
    expect(main).toContain("process.on('unhandledRejection'")
    expect(main).toContain("app.on('child-process-gone'")
    expect(main).toContain("app.on('render-process-gone'")
    expect(main).toContain('function reportFatal(')
  })

  it('clears the history of a repeat bouncer before the load, not during one', () => {
    // Touching navigation state mid-navigation is what closed the app, so the clear moved to the quiet
    // moment before a load starts — and only for tabs already caught bouncing.
    expect(main).toContain('const navBouncedTabs = new Set<string>()')
    expect(handler).toContain('navBouncedTabs.add(tabId)')

    const navStart = main.indexOf("ipcMain.on('navigate_tab'")
    const navEnd = main.indexOf("ipcMain.handle('history_go_back'", navStart)
    const navTab = main.slice(navStart, navEnd)
    expect(navTab).toContain('if (navBouncedTabs.has(tabId))')
    expect(navTab).toContain('history.clear()')
    expect(navTab).toContain('history cleared before the load')
    // An ordinary tab is left alone: history is only cleared when the tab has bounced and the site changes.
    expect(navTab).toContain('!sameSiteUrl(leaving, url)')
  })

  it('does not fire for a redirect of our own load', () => {
    // The intruder must be the page we are leaving, and must not be the URL we asked for.
    expect(handler).toContain('sameSiteUrl(url, leaving)')
    expect(handler).toContain('shouldDefend({')
  })
})

describe('a page that refuses to unload is let go', () => {
  const start = main.indexOf("view.webContents.on('will-prevent-unload'")
  const end = main.indexOf("view.webContents.on('will-navigate'", start)
  const handler = main.slice(start, end)

  it('is where expected', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
  })

  it('ignores the page beforeunload handler only when the user asked for another page', () => {
    // Electron: "if the existing page has a beforeUnload handler, did-fail-load will be called unless
    // will-prevent-unload is handled". Every chat app has one; this is the whole Ctrl+L bug.
    expect(handler).toContain('navWanted.get(tabId)?.url')
    expect(handler).toContain('if (!wanted) return')
    expect(handler).toContain('event.preventDefault()')
  })

  it('leaves a page guard alone when nothing of ours is in flight', () => {
    // The early return happens before preventDefault, so a page protecting an unsaved draft keeps it.
    const guard = handler.indexOf('if (!wanted) return')
    const allow = handler.indexOf('event.preventDefault()')
    expect(guard).toBeGreaterThan(0)
    expect(allow).toBeGreaterThan(guard)
  })

  it('records it, so the next trace names the cause instead of guessing', () => {
    expect(handler).toContain('will-prevent-unload — the page tried to keep itself')
    expect(handler).toContain('leaving anyway — the user asked for another page')
  })
})

describe('build 32 — the page that fights back gets a new renderer, not another request', () => {
  const navStart = main.indexOf("ipcMain.on('navigate_tab'")
  const navEnd = main.indexOf("ipcMain.handle('history_go_back'", navStart)
  const navTab = main.slice(navStart, navEnd)
  const rebuildStart = main.indexOf('async function rebuildTabView(')
  const rebuild = main.slice(rebuildStart, rebuildStart + 4200)

  it('has a rebuild helper, and it closes the contents that was refusing', () => {
    expect(rebuildStart).toBeGreaterThan(0)
    // A real unload: the same teardown the discard manager uses, so a beforeunload cannot hold it.
    expect(rebuild).toContain('closeWebContents(')
    expect(rebuild).toContain('mainWindow.contentView.removeChildView(old)')
    // …and the tab is rebuilt through the one function that wires every listener.
    expect(rebuild).toContain('ensureAiView(tabId, container ?? undefined)')
    // The container's partition is preserved, so the rebuilt page is still signed in.
    expect(rebuild).toContain('tabContainers.get(tabId)')
    expect(rebuild).toContain('fresh.setBounds(bounds)')
  })

  it('does not spend three more attempts once the defence has seen the page take the frame', () => {
    // The trace: four loads, four aborts, then a fifth request to the same contents that was aborted
    // too. Six builds retried a renderer that had already answered the question.
    expect(navTab).toContain('if (navBouncedTabs.has(tabId))')
    expect(navTab).toContain('foughtBack = true')
    expect(navTab).toContain('break')
    expect(navTab).toContain('NAV_REBUILD_DELAY_MS')
  })

  it('loads the requested URL in the rebuilt view and reports where it landed', () => {
    expect(navTab).toContain('await rebuildTabView(tabId,')
    expect(navTab).toContain('view = rebuilt')
    expect(navTab).toContain('last resort — the request, in the rebuilt tab')
    expect(navTab).toContain('landed in the rebuilt tab')
    // Only the URL the user asked for counts as a landing.
    expect(navTab).toContain('sameSiteUrl(committedUrl(), url)')
  })

  it('survives a close that did not complete, instead of breaking the request', () => {
    // `registerView` refuses to replace a live view; if the close timed out the rebuild must return
    // null so the request still reaches its give-up line with a trace.
    expect(rebuild).toContain('the rebuild could not register a new view')
    expect(rebuild).toContain("traceNav(tabId, 'abort', 'the rebuild produced no usable view'")
  })

  it('still gives up honestly when even a fresh renderer will not load it', () => {
    expect(navTab).toContain("traceNav(tabId, 'abort', 'the rebuilt tab refused too'")
    expect(navTab).toContain("traceNav(tabId, 'abort', 'giving up on this load'")
  })
})

describe('build 32 — the page may not navigate itself back while a URL is pending', () => {
  const start = main.indexOf("view.webContents.on('will-navigate'")
  const handler = main.slice(start, start + 3200)

  it('cancels a page-initiated navigation to the site we are leaving', () => {
    expect(start).toBeGreaterThan(0)
    expect(handler).toContain('event.preventDefault()')
    expect(handler).toContain('sameSiteUrl(url, leaving) && !sameSiteUrl(url, wanted)')
    expect(handler).toContain('refused — the page may not navigate itself back while a URL is pending')
  })

  it('leaves a redirect that belongs to the load, and an idle page, alone', () => {
    // Two guards before the cancel: nothing of ours pending, or the navigation is the URL we asked for.
    expect(handler).toContain('if (!wanted || asked || !goingBackToItself) return')
    expect(handler).toContain("asked: asked ? 'yes' : 'no'")
  })

  it('records both facts the trace needs: whose navigation it was, and whether it was refused', () => {
    expect(handler).toContain('will-navigate — the page is navigating itself')
    expect(handler).toContain("self: goingBackToItself ? 'yes' : 'no'")
  })
})
