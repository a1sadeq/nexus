import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Build 47 — an overlay that hid the view gets the flip back; a tab switch does not; and the terminal
 * stops drowning in Chromium's own log.
 *
 * The build-46 diagnostics (`nexus-diagnostics-2026-11-27T23-43-33.json`) show the blank returning right
 * after a notification:
 *
 *   nav #811  overlay  notification toast suspended — an overlay is open
 *   nav #817  overlay  overlay open — AI view hidden          (every view setVisible(false))
 *   nav #820  overlay  notification toast resumed — the overlay closed
 *   nav #823  view     repaint (reconcile-presentation) {comingBackFromHidden=true wasHidden=true}
 *   nav #825  view     presented — verified, repainted (no flip needed)   ← cheap path, and it stayed blank
 *
 * Build 45 flipped on that transition and the view came back; build 46 removed the flip from every
 * present to stop the tab-switch pause. The two cases are not the same transition, and this build is the
 * split: an overlay that was actually open pays for the flip, a tab switch does not.
 */
const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

function body(marker: string, span = 1600): string {
  const at = main.indexOf(marker)
  expect(at, `${marker} must exist`).toBeGreaterThan(-1)
  return main.slice(at, at + span)
}

describe('build 47 — the overlay transition', () => {
  it('remembers when the overlay opened, so it can tell a pause from a panel', () => {
    expect(main).toContain('overlaysOpenedAt = Date.now()')
    expect(main).toContain('let overlaysOpenedAt = 0')
    expect(main).toContain('lastOverlayCloseAt = Date.now()')
  })

  it('flips after an overlay that really hid the view, and stays cheap for a tab switch', () => {
    const strong = body('const overlayHidTheView =', 900)
    expect(strong).toContain('lastOverlayCloseAt - overlaysOpenedAt >= 250')
    expect(strong).toContain("overlayWasLongEnough ? 'always' : 'suspect'")
  })

  it('keeps the tab-switch path on the cheap branch', () => {
    // The default mode of the one present helper is 'suspect' — no flip unless the check repaired.
    expect(main).toContain("function ensureActiveViewPresented(reason: string, mode: PresentMode = 'suspect')")
  })
})

describe('build 47 — a window that was away', () => {
  it('records when the window was hidden', () => {
    const suspend = body('const suspendAllViews = () => {', 500)
    expect(suspend).toContain('lastWindowHiddenAt = Date.now()')
  })

  it('only pays for the flip when it was hidden long enough to matter', () => {
    const resume = body('const awayFor =', 400)
    expect(resume).toContain('awayFor >= 1500 ? \'always\' : \'suspect\'')
  })
})

describe('build 47 — the terminal', () => {
  it('keeps Chromium’s own log quiet unless it is asked for', () => {
    expect(main).toContain("process.env.NEXUS_VERBOSE_CHROMIUM !== '1'")
    expect(main).toContain("app.commandLine.appendSwitch('log-level', '3')")
  })
})

describe('build 47 — the tab menu reaches main', () => {
  it('reloads the tab it was asked about', () => {
    const handler = body("ipcMain.on('reload_tab'", 400)
    expect(handler).toContain('aiViews.get(tabId)')
    expect(handler).toContain('.reload()')
  })
})
