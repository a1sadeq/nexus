/**
 * Duplicate-navigation suppression for `navigate_tab`.
 *
 * A tab's URL is re-applied from several places (the URL bar, history restore, tab activation,
 * the sidebar). When two of those fire within a few hundred milliseconds for the same URL, the
 * second `loadURL` aborts the first one and Chromium reports `ERR_ABORTED (-3)` for it — the view
 * then looks broken while it is really just loading once. This tracker makes the second identical
 * request a no-op so a tab can only have one navigation in flight per URL.
 *
 * It is deliberately narrow: only an *identical* URL for the *same* tab within
 * `DUPLICATE_NAVIGATION_WINDOW_MS` is dropped. A different URL always wins (that is a real
 * navigation, and aborting the older one is correct). The entry is forgotten as soon as the load
 * finishes or fails, so a reload the user asks for is never swallowed.
 */

export const DUPLICATE_NAVIGATION_WINDOW_MS = 1500

export interface PendingNavigation {
  url: string
  at: number
}

/** True when `url` repeats the request this tab already started inside the dedupe window. */
export function isDuplicateNavigation(
  previous: PendingNavigation | undefined,
  url: string,
  now: number,
  windowMs: number = DUPLICATE_NAVIGATION_WINDOW_MS
): boolean {
  if (!previous) return false
  if (!url || previous.url !== url) return false
  const elapsed = now - previous.at
  if (Number.isNaN(elapsed)) return false
  return elapsed >= 0 && elapsed < windowMs
}

export class NavigationIntentTracker {
  private pending = new Map<string, PendingNavigation>()

  constructor(private readonly windowMs: number = DUPLICATE_NAVIGATION_WINDOW_MS) {}

  /**
   * Records the intent to load `url` in `tabId`.
   * Returns `false` when this is a repeat of the load already started and the caller should skip it.
   */
  claim(tabId: string, url: string, now: number = Date.now()): boolean {
    if (isDuplicateNavigation(this.pending.get(tabId), url, now, this.windowMs)) return false
    this.pending.set(tabId, { url, at: now })
    return true
  }

  /** The load finished or failed — the next navigation for this tab is always allowed. */
  forget(tabId: string): void {
    this.pending.delete(tabId)
  }

  pendingUrl(tabId: string): string | undefined {
    return this.pending.get(tabId)?.url
  }

  clear(): void {
    this.pending.clear()
  }
}

/**
 * Do these two URLs point at the same site?
 *
 * The check `navigate_tab` uses to decide whether the tab actually went where it was told. It compares
 * hosts, not full URLs, on purpose: providers redirect within their own site all the time
 * (`/search?q=x` → `/search/new?q=x`, `/` → `/app`), and treating that as "the navigation failed" would
 * reload a page that had arrived. Landing on a *different site* is the failure worth re-asking about.
 */
export function sameSiteUrl(a: string | undefined | null, b: string | undefined | null): boolean {
  const hostOf = (value: string | undefined | null): string => {
    if (!value) return ''
    try {
      return new URL(value).host.toLowerCase().replace(/^www\./, '')
    } catch {
      return ''
    }
  }
  const left = hostOf(a)
  const right = hostOf(b)
  if (!left || !right) return false
  return left === right
}
