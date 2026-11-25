import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The URL-bar navigation has to survive being aborted by the app around it.
 *
 * The build-26 trace showed the pattern that broke it three times in a row: the load starts while the
 * address-bar overlay is still up (the view is hidden), the overlay closes and the view is re-shown, and
 * Chromium then restores the page the tab was already on — aborting the new load. The old code retried
 * 150 ms later, straight into that restore, and lost again.
 *
 * These are the invariants of the fix. They are asserted on the handler's source because the handler
 * lives in `index.ts` next to the Electron imports and cannot be executed in isolation — that is the same
 * trade the other wiring tests make, and it is enough to stop the behaviour being refactored away.
 */
describe('navigate_tab waits for the tab before asking again', () => {
  const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const start = main.indexOf("ipcMain.on('navigate_tab'")
  const end = main.indexOf("ipcMain.handle('history_go_back'", start)
  const handler = main.slice(start, end)

  it('is where expected', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(handler).toContain("traceNav(tabId, 'request', 'navigate_tab'")
  })

  it('does not start the load while the address-bar overlay is open', () => {
    // Ctrl+L *is* an overlay: the AI view is hidden until it closes. Starting the load on a hidden view
    // and re-showing it mid-navigation is what the trace caught aborting every attempt.
    expect(handler).toContain('waitForOverlayClosed(')
    expect(handler).toContain('OVERLAY_CLOSE_TIMEOUT_MS')
    expect(handler).toContain("'waiting for the address bar overlay to close'")
  })

  it('waits for the tab to stop loading before retrying, instead of a bare timer', () => {
    expect(handler).toContain('const settle = (timeoutMs: number): Promise<void>')
    expect(handler).toContain("view.webContents.once('did-stop-loading', finish)")
    expect(handler).toContain('await settle(NAV_SETTLE_TIMEOUT_MS)')
  })

  it('checks the page it actually landed on, not just that the promise resolved', () => {
    expect(handler).toContain('sameSiteUrl(committedUrl(), url)')
    expect(handler).toContain("'landed on the requested page'")
    expect(handler).toContain("'load finished, but the tab is on another page'")
    // A later navigation from the user always wins over this one.
    expect(handler).toContain('isStillWanted()')
  })

  it('keeps trying more than once, and says when it stops', () => {
    expect(main).toContain('const NAV_LOAD_ATTEMPTS = 4')
    expect(handler).toContain('giving up on this load')
    expect(handler).toContain("reason: 'attempts exhausted'")
  })
})

describe('the trace can name a page that navigates itself', () => {
  const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('logs will-navigate, which only fires for navigations the page started', () => {
    expect(main).toContain("view.webContents.on('will-navigate'")
    expect(main).toContain('the page is navigating itself')
  })

  it('stamps the webContents id on navigation events, so two views for one tab is visible', () => {
    const startNavigation = main.slice(
      main.indexOf("view.webContents.on('did-start-navigation'"),
      main.indexOf("view.webContents.on('will-navigate'")
    )
    expect(startNavigation).toContain('wc: view.webContents.id')
  })
})
