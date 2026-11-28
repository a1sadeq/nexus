/**
 * Build 51 — notifications that look right, arrive once, and never cost the page its frame.
 *
 * Three separate promises are pinned here, because all three were reported by the user against the
 * same feature:
 *
 *   1. One event, one surface. The window being in front means the in-app card is the notification and
 *      the OS popup is not raised; the window being behind means the popup is, and the card is not.
 *   2. Copy that matches. The popup is titled with the tab's title and says what the card says, because
 *      the wording is built once in `shared/notificationContent`.
 *   3. The page comes back. Hiding the native card is a surface-order change of its own, so the active
 *      view is re-presented afterwards — verified path only, never a flip or a detach.
 *
 * These are source-slice assertions on `main/index.ts`: the module cannot be imported in a test process
 * (it opens windows and reads the OS), so the wiring itself is what gets checked, with the exact call
 * syntax that has to be there rather than a phrase that merely resembles it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

/** The settle helpers, which sit between `dismissInAppToast` and the user-agent block below them. */
function settleBody(): string {
  const start = source.indexOf('let notificationSettleTimers')
  const end = source.indexOf('// Match the actual OS and bundled Chromium version', start)
  expect(start, 'the settle helpers must exist').toBeGreaterThan(-1)
  expect(end, 'the settle helpers must be followed by the user-agent block').toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The body of one function, from its declaration to the next top-level `function`/`const` anchor. */
function functionBody(name: string, endMarker: string): string {
  const start = source.indexOf(name)
  expect(start, `${name} must exist`).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start)
  expect(end, `${endMarker} must follow ${name}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('one event, one surface', () => {
  const show = functionBody('function showInAppToast', 'function dismissInAppToast')

  it('does not raise a desktop notification while the window is in front', () => {
    expect(show).toContain('const nativeShown = isAppActiveAndVisible ? false : triggerDesktopNotification(data)')
    expect(show).not.toContain('const nativeShown = triggerDesktopNotification(data)')
  })

  it('still draws the card when the OS refused the popup', () => {
    // The fallback is the reason this is not "return early when the window is behind": a platform with
    // no notification daemon would otherwise be silent.
    expect(show).toContain('if (!isAppActiveAndVisible && nativeShown) return')
  })

  it('records which surface was chosen, so "why no popup?" has an answer', () => {
    expect(show).toContain("outcome: 'in-app'")
  })

  it('does not announce the same event twice for one tab', () => {
    const trigger = functionBody('function triggerCompletionNotification', 'export function getTabAiStatus')
    expect(trigger).toContain('shouldDeduplicateCompletion(prev, status, currentRev, now)')
    expect(trigger).toContain("status === 'waiting-input' ? 20000 : 4000")
    expect(trigger).toContain("outcome: 'duplicate'")
  })
})

describe('the card leaving the surface gives the page its frame back', () => {
  it('re-presents the active view when the notification view is hidden', () => {
    expect(source).toMatch(
      /setVisible: \(visible: boolean\) => \{[\s\S]{0,500}?setVisible\(visible\)[\s\S]{0,500}?if \(!visible\) settleSurfaceAfterNotification\(/
    )
  })

  it('uses the verified path twice, and never a flip or a detach', () => {
    const settle = settleBody()
    expect(settle).toContain("ensureActiveViewPresented(reason, 'suspect')")
    expect(settle).toContain("ensureActiveViewPresented(`${reason} / second look`, 'cheap')")
    expect(settle).not.toContain('flipVisibility')
    expect(settle).not.toContain('removeChildView')
    expect(settle).not.toContain('addChildView')
  })

  it('stays out of the way while an overlay is open or the tab is meant to be hidden', () => {
    const settle = settleBody()
    expect(settle).toContain('if (overlaysOpen || !activeViewVisible) return')
  })

  it('cancels a pending settle when a newer one is scheduled', () => {
    const settle = settleBody()
    expect(settle).toContain('cancelNotificationSettle()')
  })
})

describe('the overlay that hides every view has to name itself', () => {
  const handler = source.slice(
    source.indexOf("ipcMain.on('set_overlays_open'"),
    source.indexOf("ipcMain.on('set_overlays_open'") + 9000
  )

  it('reads the panels the renderer reports', () => {
    expect(handler).toContain('reportedKeys')
    expect(handler).toContain("reportedKeys.filter((key): key is string => typeof key === 'string')")
  })

  it('refuses to hide the workspace for an overlay with no name', () => {
    expect(handler).toContain('overlay open refused — the renderer named no open panel')
    expect(handler).toContain('if (next && Array.isArray(reportedKeys) && openKeys.length === 0)')
  })

  it('prints the panels in the trace instead of "overlay open" alone', () => {
    expect(handler).toContain("'overlay open — AI view hidden', {\n      overlays:")
    expect(handler).toContain('overlays: lastOverlayKeys.length > 0 ? lastOverlayKeys : \'not reported\'')
  })

  it('asks the renderer again when a panel has been open long enough to be suspicious', () => {
    expect(source).toContain('const OVERLAY_STATE_RECHECK_MS = 8000')
    expect(source).toContain('function startOverlayStateRecheck()')
    expect(source).toContain("sendToMainWindow('overlays_state_requested')")
    // The re-check stops the moment the panel closes.
    expect(handler).toContain('else stopOverlayStateRecheck()')
  })

  it('records the overlay state in the diagnostics export itself', () => {
    // The window covers the whole `capture_diagnostics` handler. It grew in build 53 — the handler now
    // also hit-tests the shell's sidebar edge and reports per-view forensics before it builds this object,
    // and a slice sized to build 51's handler would fail for a reason that has nothing to do with overlays.
    const start = source.indexOf("ipcMain.handle('capture_diagnostics'")
    const end = source.indexOf("ipcMain.handle('nav_trace_get'", start)
    const capture = source.slice(start, end > start ? end : start + 24000)
    expect(capture).toContain('overlayState: {')
    expect(capture).toContain('panels: lastOverlayKeys.length > 0 ? lastOverlayKeys : \'not reported\'')
    expect(capture).toContain('presentedVisible: Object.fromEntries(presentedVisible)')
    expect(capture).toContain('notificationCard: {')
  })

  it('is answered by the renderer with the flag and the names it believes now', () => {
    const app = readFileSync(join(__dirname, '../renderer/src/App.tsx'), 'utf8')
    expect(app).toContain("on('overlays_state_requested'")
    expect(app).toContain('openOverlayKeys(overlayFlagsRef.current)')
    expect(app).toContain("'set_overlays_open',\n      Boolean(anyOverlayOpen),\n      openOverlayKeys(overlayFlagsRef.current)")
  })
})

describe('the card and the popup cannot disagree about the same event', () => {
  it('builds the badge and the description from the shared helpers', () => {
    const html = functionBody('function buildNotificationHtml', 'interface DesktopNotificationInput')
    expect(html).toContain('statusLabel(data.status)')
    expect(html).toContain('statusDescription(data.status, data.snippet)')
    expect(html).not.toContain("'Waiting for your choice or confirmation'")
    expect(html).not.toContain("'Generation completed.'")
  })

  it('titles the popup with the tab, not the app', () => {
    const content = readFileSync(join(__dirname, '../shared/notificationContent.ts'), 'utf8')
    expect(content).toContain('const title = tabTitle.length > 0 ? tabTitle : cleanLine(')
    expect(content).not.toContain('${waiting ? \'needs your input\'')
  })
})
