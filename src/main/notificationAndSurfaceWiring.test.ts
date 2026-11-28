import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The two things build 33 fixes about the page and the toast, asserted where they are wired.
 *
 * From the build-32 diagnostics the user sent:
 *
 *   nav #1938 +1431399ms overlay  overlay open — AI view hidden
 *   nav #1939 +1439989ms overlay  overlay closed — restoring the workspace
 *   nav #1940 +1439989ms view     setVisible (reconcile-presentation) {visible=true}
 *   nav #1941 +1439989ms view     repaint (reconcile-presentation) {geometryChanged=false comingBackFromHidden=false}
 *   nav #1945 +1439991ms repair   repair running — reconciled twice without a frame
 *   nav #1946 +1439991ms view     detach (repair) — aborts any load in flight
 *   nav #1947 +1439991ms view     attach (repair)
 *
 * Two facts, both visible above. `comingBackFromHidden=false` one millisecond after the view was hidden,
 * because "was it hidden?" was being inferred from the view's *bounds* — an overlay hides a view with
 * `setVisible(false)` and never touches its geometry. And the *second* reconcile in the same tick counted
 * as "a repaint that did not work", which escalated into a detach/re-attach: the dark page the user then
 * had to clear by switching tabs.
 */

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('a view that was hidden is repainted, not re-attached — build 33', () => {
  it('records visibility where it is set instead of guessing it from geometry', () => {
    expect(main).toContain('const presentedVisible = new Map<string, boolean>()')
    expect(main).toContain('function markViewVisibility(')
    expect(main).toContain('function viewWasHidden(')
    // The overlay handler is the transition that loses the surface, so it has to record it.
    expect(main).toContain('markViewVisibility(id, false)')
    // And tab activation records both directions.
    expect(main).toContain('markViewVisibility(tabId, shouldBeVisible)')
  })

  it('asks for the strong repaint when the view is coming back', () => {
    expect(main).toContain('const recordedHidden = viewWasHidden(activeViewId, view)')
    expect(main).toContain('wasHidden || !previousBounds')
    // Build 45 kept the decision and moved the repaint behind `ensureActiveViewPresented`, which verifies
    // the view is really on screen and then flips it with a gate — the strong path is still what runs.
    expect(main).toContain("'coming back from hidden (overlay / tab switch)'")
    expect(main).toContain('force: true')
  })

  it('does not escalate to a detach/re-attach for a known transition', () => {
    // A hidden view is not a failing repaint: the counter is reset rather than advanced.
    expect(main).toContain('surfaceRepair.forget(activeViewId)')
    // …and the escalation itself waits until the overlay has been closed for a moment.
    expect(main).toContain('Date.now() - lastOverlayCloseAt > 600')
    expect(main).toContain("'repair held back — an overlay just closed, the strong repaint runs first'")
    expect(main).toContain('lastOverlayCloseAt = Date.now()')
  })

  it('gives the re-attach path a frame of its own, and puts the overlays back on top', () => {
    expect(main).toContain("reason: 'after re-attach'")
    expect(main).toContain('function raiseNativeOverlays(')
    const repairStart = main.indexOf('function repairTabSurface(')
    const repair = main.slice(repairStart, repairStart + 6000)
    expect(repair).toContain('raiseNativeOverlays()')
    expect(repair).toContain("reason: 'after re-attach'")
  })
})

describe('a notification survives a tab switch and a panel — build 33', () => {
  const overlayStart = main.indexOf("ipcMain.on('set_overlays_open'")
  const overlayHandler = main.slice(overlayStart, overlayStart + 4200)

  it('suspends the toast when a panel opens, and resumes it when the panel closes', () => {
    expect(overlayHandler).toContain('aiToastManager.suspend()')
    expect(overlayHandler).toContain('notification toast suspended — an overlay is open')
    expect(overlayHandler).toContain('aiToastManager.isSuspended()')
    expect(overlayHandler).toContain('aiToastManager.resume()')
    expect(overlayHandler).toContain('notification toast resumed — the overlay closed')
    // The dismissal that lost the notification is gone from this handler.
    expect(overlayHandler).not.toContain('dismissInAppToast()')
  })

  it('arms a toast that arrives while a panel is open, instead of dropping it', () => {
    const showStart = main.indexOf('function showInAppToast(')
    const show = main.slice(showStart, showStart + 2600)
    expect(show).not.toContain('if (overlaysOpen || !aiNotificationView)')
    expect(show).toContain('if (overlaysOpen) aiToastManager.suspend()')
  })

  it('does not dismiss the toast when a tab is activated', () => {
    // `if (currentNotificationData?.tabId === tabId) dismissInAppToast()` used to sit in activate_tab.
    const activateStart = main.indexOf("ipcMain.on('activate_tab'")
    const activate = main.slice(activateStart, activateStart + 12000)
    expect(activate).not.toContain('dismissInAppToast()')
  })

  it('asks the page for a frame when a toast is stacked over it', () => {
    // Stacking a native child rebuilds the window's surface order, and the page underneath can come
    // back with no frame — "the AI view went blank when a notification came".
    const showStart = main.indexOf('function showInAppToast(')
    const show = main.slice(showStart, showStart + 3200)
    expect(show).toContain("reason: 'a notification was stacked over the page'")
    expect(show).toContain('forceViewRepaint(activeView')
  })

  it('re-stacks the toast only when there is one on screen to protect — audit fix', () => {
    // removeChildView + addChildView is a detach/attach pair of its own; doing it for a hidden toast buys
    // nothing and is the one operation that can leave a native view frameless.
    expect(main).toContain('const toastOnScreen = Boolean(aiToastManager?.getIsVisible?.())')
    expect(main).toContain('if (toastOnScreen && aiNotificationView && !aiNotificationView.webContents.isDestroyed())')
  })

  it('keeps the toast above a freshly attached page', () => {
    // A WebContentsView is a window child: addChildView stacks it over the toast.
    const ensureStart = main.indexOf('function ensureAiView(')
    const ensureEnd = main.indexOf("ipcMain.on('navigate_to_url'", ensureStart)
    const ensure = main.slice(ensureStart, ensureEnd)
    expect(ensure).toContain('raiseNativeOverlays()')
  })
})
