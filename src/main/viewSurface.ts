import type { Rectangle } from 'electron'

/**
 * Surface repair for native `WebContentsView`s.
 *
 * A tab's page can end up showing the window background — "the AI view went blank and I had to close
 * the tab and open it again". The page is alive; what is lost is the compositor surface behind it.
 * `viewRepaint.ts` answers that with `invalidate()` plus a 1 px bounds nudge, which is enough on some
 * drivers and silently does nothing on others. The thing that *always* works is the user's own
 * workaround: a fresh surface. Closing and reopening the tab gets one by building a whole new
 * `WebContentsView` — which also throws away the page. This module gets the same fresh surface while
 * keeping the page:
 *
 *   1. re-apply the authoritative bounds (a view left at a stale or zero rect never paints);
 *   2. flip visibility off and on across a tick — Chromium re-attaches a surface when a view becomes
 *      visible, which is why "switch to another tab and back" sometimes rescues it;
 *   3. `invalidate()` so the renderer schedules a full repaint;
 *   4. detach and re-attach the child view — a new surface attach on the same `WebContents`, so the
 *      conversation, scroll position, focus and session are untouched.
 *
 * Every step is guarded: destroyed contents are never touched, a host without `contentView` skips the
 * re-attach, and the caller's bounds are restored exactly. The policy object decides *when* an
 * escalation is worth it — repeated repaint requests for a view that is supposed to be visible are the
 * signal that the cheap path is not working.
 */

export interface SurfaceViewLike {
  webContents?: {
    isDestroyed?: () => boolean
    invalidate?: () => void
    executeJavaScript?: (code: string) => Promise<unknown>
  }
  setBounds?: (bounds: Rectangle) => void
  getBounds?: () => Rectangle
  setVisible?: (visible: boolean) => void
  getVisible?: () => boolean
}

export interface SurfaceHostLike {
  contentView?: {
    addChildView?: (view: unknown) => void
    removeChildView?: (view: unknown) => void
  }
}

export interface RepairOptions {
  /** Authoritative bounds to restore. Omitted → whatever the view already has. */
  bounds?: Rectangle | null
  /** Whether the view is supposed to be on screen. Default true. */
  visible?: boolean
  reason?: string
  log?: (message: string) => void
  /** Injectable scheduler, so tests can run the visibility flip synchronously. */
  schedule?: (fn: () => void, ms: number) => void
  /** Nudge the page into producing a frame as well as the surface. Default true. */
  pageResizeHint?: boolean
  /**
   * A navigation is in flight for this view. Detaching a view mid-load aborts the load and leaves the
   * tab on its previous page, so the repair must not run then — the caller defers it instead.
   */
  navigationInFlight?: boolean
}

export type RepairOutcome = 'repaired' | 'partial' | 'skipped'

const isUsableRect = (rect: Rectangle | null | undefined): rect is Rectangle =>
  Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
  )

function isDestroyed(view: SurfaceViewLike): boolean {
  try {
    return view.webContents?.isDestroyed?.() === true
  } catch {
    return true
  }
}

const PAGE_RESIZE_HINT =
  "(() => { try { window.dispatchEvent(new Event('resize')); } catch {} return true })()"

/**
 * Rebuild the surface behind a live view, in place.
 *
 * Returns `repaired` when the child view was detached and re-attached, `partial` when at least one
 * cheaper step ran (bounds/visibility/invalidate) but re-attaching was not available, `skipped` when
 * there was nothing usable to repair.
 */
export function repairViewSurface(
  host: SurfaceHostLike | null | undefined,
  view: SurfaceViewLike | null | undefined,
  options: RepairOptions = {}
): RepairOutcome {
  const log = options.log ?? (() => undefined)
  const reason = options.reason ?? 'unspecified'
  if (!view || isDestroyed(view)) return 'skipped'
  if (options.navigationInFlight === true) {
    log(`repair deferred (${reason}): a navigation is in flight`)
    return 'skipped'
  }

  let did = false

  // 1. Authoritative bounds. A view parked at a zero or stale rectangle cannot paint.
  const bounds = options.bounds ?? (typeof view.getBounds === 'function' ? view.getBounds() : null)
  if (isUsableRect(bounds) && typeof view.setBounds === 'function') {
    try {
      view.setBounds(bounds)
      did = true
    } catch (error) {
      log(`bounds re-apply failed (${reason}): ${(error as Error)?.message ?? error}`)
    }
  }

  // 2. Visibility flip across a tick, then 3. invalidate.
  const shouldBeVisible = options.visible !== false
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))
  if (shouldBeVisible && typeof view.setVisible === 'function') {
    try {
      view.setVisible(false)
      schedule(() => {
        if (isDestroyed(view)) return
        try {
          view.setVisible?.(true)
          view.webContents?.invalidate?.()
        } catch (error) {
          log(`visibility restore failed (${reason}): ${(error as Error)?.message ?? error}`)
        }
      }, 16)
      did = true
    } catch (error) {
      log(`visibility flip failed (${reason}): ${(error as Error)?.message ?? error}`)
    }
  } else if (shouldBeVisible) {
    try {
      view.webContents?.invalidate?.()
      did = true
    } catch {
      /* invalidate is best-effort */
    }
  }

  // 4. Detach + re-attach: a new surface attach for the same WebContents.
  const contentView = host?.contentView
  let reattached = false
  if (contentView?.addChildView && contentView?.removeChildView) {
    try {
      contentView.removeChildView(view)
      contentView.addChildView(view)
      reattached = true
      did = true
      // Re-applying bounds after the re-attach: the attach itself can reset geometry on some builds.
      if (isUsableRect(bounds) && typeof view.setBounds === 'function') {
        try {
          view.setBounds(bounds)
        } catch {
          /* the attach is the part that matters */
        }
      }
    } catch (error) {
      log(`re-attach failed (${reason}): ${(error as Error)?.message ?? error}`)
    }
  }

  // 5. Ask the page for a frame. Harmless on a page that is already drawing.
  if (options.pageResizeHint !== false && typeof view.webContents?.executeJavaScript === 'function') {
    try {
      void view.webContents.executeJavaScript(PAGE_RESIZE_HINT).catch(() => undefined)
    } catch {
      /* the surface steps above are what matter */
    }
  }

  if (!did) {
    log(`repair skipped (${reason}): nothing to act on`)
    return 'skipped'
  }
  log(
    `repair (${reason}): ${reattached ? 're-attached' : 'no re-attach'}, ` +
      `bounds ${isUsableRect(bounds) ? `${bounds.width}x${bounds.height}` : 'unchanged'}, ` +
      `visible ${shouldBeVisible}`
  )
  return reattached ? 'repaired' : 'partial'
}

/**
 * Decides when the cheap repaint path has been tried often enough that re-attaching is warranted.
 *
 * One repaint request per transition is normal traffic — a tab switch or an overlay close asks for a
 * repaint and is then quiet. *Repeated* requests for the same tab, while the app believes the view is
 * on screen, mean the surface is not coming back, and that is exactly the state the user used to be
 * stuck in until they closed the tab. Escalating on that signal repairs the view instead.
 */
export class SurfaceRepairPolicy {
  private nudges = new Map<string, number[]>()
  private lastRepair = new Map<string, number>()

  constructor(
    /** How many repaint requests inside the window mean "the cheap path is failing". */
    private readonly escalateAfterNudges: number = 2,
    /** Window for counting repaint requests. */
    private readonly nudgeWindowMs: number = 3000,
    /** Never repair the same tab more often than this. */
    private readonly cooldownMs: number = 3000
  ) {}

  /**
   * Record that a cheap repaint was requested for this tab.
   *
   * Requests that arrive within `coalesceMs` (25 ms) of each other are one event, not two. Restoring the
   * workspace after an overlay closes deliberately reconciles twice (the overlay's own close and the
   * renderer's bounds message), and counting that pair as "two failed repaints" is what escalated straight
   * into a detach/re-attach — the blank view the user then had to switch tabs to clear.
   */
  noteRepaint(tabId: string, now: number = Date.now(), coalesceMs: number = 25): void {
    const stamps = this.nudges.get(tabId) ?? []
    const cutoff = now - this.nudgeWindowMs
    const kept = stamps.filter((at) => at >= cutoff)
    const last = kept[kept.length - 1]
    if (last !== undefined && now - last < coalesceMs) {
      this.nudges.set(tabId, kept)
      return
    }
    kept.push(now)
    this.nudges.set(tabId, kept)
  }

  /** True when this tab has asked for enough repaints that re-attaching is the next step. */
  shouldRepair(tabId: string, now: number = Date.now()): boolean {
    const last = this.lastRepair.get(tabId)
    if (last !== undefined && now - last >= 0 && now - last < this.cooldownMs) return false
    const stamps = (this.nudges.get(tabId) ?? []).filter((at) => at >= now - this.nudgeWindowMs)
    return stamps.length >= this.escalateAfterNudges
  }

  /** Record that a repair actually ran, starting the cooldown and clearing the count. */
  noteRepair(tabId: string, now: number = Date.now()): void {
    this.lastRepair.set(tabId, now)
    this.nudges.delete(tabId)
  }

  /** A view was closed, or a new one was created for this tab: forget it. */
  forget(tabId: string): void {
    this.nudges.delete(tabId)
    this.lastRepair.delete(tabId)
  }

  pendingCount(tabId: string, now: number = Date.now()): number {
    return (this.nudges.get(tabId) ?? []).filter((at) => at >= now - this.nudgeWindowMs).length
  }

  clear(): void {
    this.nudges.clear()
    this.lastRepair.clear()
  }
}
