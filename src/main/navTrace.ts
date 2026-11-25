/**
 * The navigation trace: a small, always-on ring buffer that answers one question.
 *
 * "I pressed Ctrl+L, the title changed, the page didn't — what happened?"
 *
 * Every previous round of this bug was diagnosed by reading console lines and guessing which of them
 * caused the others. A load can be aborted by a repair re-attach, by a second `loadURL` from a stale
 * activation, by a discarded view, or by the tab being closed — and all four look identical in the log
 * ("ERR_ABORTED"). So every one of those places now writes a line here, in order, with the tab, the
 * reason and the URL, and the last few hundred lines are kept whether or not anything is printed.
 *
 * Design notes:
 *   • No Electron import. This module is pure so it can be unit-tested and so the main process can
 *     import it without dragging in anything that needs an app lifecycle.
 *   • Bounded. A ring buffer of `limit` events overall plus `perTabLimit` per tab; a long session cannot
 *     grow it without bound, which matters because this stays on in production (the Diagnostics panel
 *     reads it).
 *   • Verbose is a *printing* switch, not a *recording* switch. Recording is always on; verbose only
 *     decides whether each event is also mirrored to the console (dev) — so the trace that explains a
 *     failure the user just saw is still there when they open the panel.
 */

export type NavTraceKind =
  | 'request' // the user (or a caller) asked for a URL
  | 'load' // a loadURL was started
  | 'abort' // a load was aborted or failed
  | 'settle' // a load finished / stopped
  | 'event' // a webContents event
  | 'intent' // navigation-intent claim / forget
  | 'view' // attach, detach, visibility, bounds of the native surface
  | 'repair' // the surface repair ran, deferred or was refused
  | 'overlay' // a shell overlay opened or closed
  | 'note' // anything else worth a line
  | 'prog' // a programmatic navigation call: loadURL, reload, stop, history.goBack — with its caller

export interface NavTraceEvent {
  /** Monotonic id, so a reader can ask for "everything since #N". */
  seq: number
  /** Epoch milliseconds — lines from different sources stay comparable. */
  at: number
  /** Milliseconds since the trace started, which is what makes a race visible. */
  t: number
  tabId: string
  kind: NavTraceKind
  message: string
  data?: Record<string, unknown>
  /**
   * How many identical events this one stands for. React can call a state updater more than once, and a
   * burst of ten "URL report accepted" lines tells nobody anything — the tracer collapses repeats inside
   * `repeatWindowMs` into one line with a count.
   */
  count?: number
}

export interface NavTraceOptions {
  /** Overall ring size. Default 600 — a few minutes of a busy session. */
  limit?: number
  /** Per-tab ring size, used by the "explain this tab" view. Default 120. */
  perTabLimit?: number
  now?: () => number
  /** When it returns true, every recorded event is mirrored to `sink` (the console). */
  verbose?: () => boolean
  sink?: (line: string) => void
  /** Identical events inside this window are folded into one line with a count. Default 250 ms. */
  repeatWindowMs?: number
}

export interface NavTrace {
  record(
    tabId: string,
    kind: NavTraceKind,
    message: string,
    data?: Record<string, unknown>
  ): NavTraceEvent
  events(limit?: number): NavTraceEvent[]
  forTab(tabId: string, limit?: number): NavTraceEvent[]
  since(seq: number): NavTraceEvent[]
  lastSeq(): number
  tabs(): string[]
  setVerbose(on: boolean): void
  isVerbose(): boolean
  formatForTab(tabId: string, limit?: number, label?: string): string
  formatAll(limit?: number): string
  clear(): void
}

const DEFAULT_LIMIT = 600
const DEFAULT_PER_TAB_LIMIT = 120
const DEFAULT_REPEAT_WINDOW_MS = 250

/** Two payloads are "the same" for folding purposes when they print the same. */
function sameData(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  const left = a ?? {}
  const right = b ?? {}
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => String(left[key]) === String(right[key]))
}

/** One line, stable enough that two runs of the same bug can be diffed by eye. */
export function formatEvent(event: NavTraceEvent): string {
  const tab = event.tabId ? `[${event.tabId}]` : '[—]'
  const payload = formatData(event.data)
  const repeat = event.count && event.count > 1 ? ` ×${event.count}` : ''
  const head = `nav #${event.seq} +${String(event.t).padStart(6, ' ')}ms ${event.kind.padEnd(7, ' ')} ${tab} ${event.message}${repeat}`
  return payload ? `${head} ${payload}` : head
}

/** A URL short enough to read in a log line, still specific enough to tell two pages apart. */
export function shortUrl(url: string, max = 46): string {
  if (!url || url.length <= max) return url
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.length > 24 ? `${parsed.pathname.slice(0, 21)}…` : parsed.pathname
    const short = `${parsed.host}${path}${parsed.search ? '?…' : ''}`
    return short.length < url.length ? short : `${url.slice(0, max - 1)}…`
  } catch {
    return `${url.slice(0, max - 1)}…`
  }
}

/** Never throws: a trace line is worth less than the code path writing it. */
function formatData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return ''
  try {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      clean[key] = value
    }
    if (Object.keys(clean).length === 0) return ''
    return `{${Object.entries(clean)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(' ')}}`
  } catch {
    return '{<unprintable>}'
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value === '') return '""'
    if (/^https?:\/\//i.test(value)) return shortUrl(value)
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  try {
    const json = JSON.stringify(value)
    return json.length > 120 ? `${json.slice(0, 117)}…` : json
  } catch {
    return '<circular>'
  }
}

export function createNavTrace(options: NavTraceOptions = {}): NavTrace {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  const perTabLimit = Math.max(1, options.perTabLimit ?? DEFAULT_PER_TAB_LIMIT)
  const repeatWindowMs = Math.max(0, options.repeatWindowMs ?? DEFAULT_REPEAT_WINDOW_MS)
  const now = options.now ?? (() => Date.now())
  const sink = options.sink

  const startedAt = now()
  let seq = 0
  let verbose = options.verbose ? options.verbose() : Boolean(sink)
  let verboseOverride: boolean | null = verbose
  const all: NavTraceEvent[] = []
  const byTab = new Map<string, NavTraceEvent[]>()

  const mirror = (event: NavTraceEvent): void => {
    const isVerbose = verboseOverride === null ? (options.verbose ? options.verbose() : true) : verboseOverride
    if (!isVerbose || !sink) return
    try {
      sink(formatEvent(event))
    } catch {
      // A console that throws must not take the navigation down with it.
    }
  }

  return {
    record(tabId, kind, message, data) {
      const at = now()

      // Fold a repeat instead of recording it. Four identical lines for one URL update (a React state
      // updater running more than once, a page reporting itself on every tick) buried the lines that
      // matter, which is the opposite of what a trace is for.
      const previous = all[all.length - 1]
      if (
        previous &&
        repeatWindowMs > 0 &&
        previous.tabId === (tabId || '') &&
        previous.kind === kind &&
        previous.message === message &&
        sameData(previous.data, data) &&
        at - previous.at <= repeatWindowMs
      ) {
        previous.count = (previous.count ?? 1) + 1
        previous.at = at
        previous.t = Number.isFinite(startedAt) ? at - startedAt : previous.t
        // The per-tab ring holds the same object, so it stays in step without a second write.
        return previous
      }

      seq += 1
      const event: NavTraceEvent = {
        seq,
        at,
        t: Number.isFinite(startedAt) ? at - startedAt : 0,
        tabId: tabId || '',
        kind,
        message,
        ...(data && Object.keys(data).length > 0 ? { data } : {})
      }

      all.push(event)
      while (all.length > limit) all.shift()

      if (event.tabId) {
        const perTab = byTab.get(event.tabId) ?? []
        perTab.push(event)
        while (perTab.length > perTabLimit) perTab.shift()
        byTab.set(event.tabId, perTab)
      }

      mirror(event)
      return event
    },

    events(listLimit) {
      if (!listLimit || listLimit >= all.length) return all.slice()
      return all.slice(all.length - listLimit)
    },

    forTab(tabId, listLimit) {
      const perTab = byTab.get(tabId) ?? []
      if (!listLimit || listLimit >= perTab.length) return perTab.slice()
      return perTab.slice(perTab.length - listLimit)
    },

    since(lastSeq) {
      if (!Number.isFinite(lastSeq)) return all.slice()
      return all.filter((event) => event.seq > lastSeq)
    },

    lastSeq() {
      return seq
    },

    tabs() {
      return Array.from(byTab.keys())
    },

    setVerbose(on) {
      verbose = Boolean(on)
      verboseOverride = Boolean(on)
    },

    isVerbose() {
      return verboseOverride === null ? verbose : verboseOverride
    },

    formatForTab(tabId, listLimit, label) {
      const rows = this.forTab(tabId, listLimit)
      const head = `Navigation trace for ${label || tabId} (${rows.length} event${rows.length === 1 ? '' : 's'})`
      if (rows.length === 0) return `${head}\n  (nothing recorded for this tab yet)`
      return [head, ...rows.map((event) => `  ${formatEvent(event)}`)].join('\n')
    },

    formatAll(listLimit) {
      const rows = this.events(listLimit)
      const head = `Navigation trace (${rows.length} of ${all.length} events, verbose ${this.isVerbose() ? 'on' : 'off'})`
      return [head, ...rows.map((event) => `  ${formatEvent(event)}`)].join('\n')
    },

    clear() {
      all.length = 0
      byTab.clear()
    }
  }
}

/**
 * A one-line verdict for a failed load, so the trace says what kind of failure it was instead of
 * making the reader remember what `-3` means.
 */
export function describeLoadFailure(errorCode: number, errorDescription?: string): string {
  const label = errorDescription ? `${errorCode} ${errorDescription}` : String(errorCode)
  if (errorCode === -3) return `${label} (aborted — something started another navigation)`
  if (errorCode === -105 || errorCode === -106) return `${label} (name not resolved — offline or DNS blocked)`
  if (errorCode === -7 || errorCode === -118) return `${label} (timed out)`
  if (errorCode === -2) return `${label} (load cancelled)`
  if (errorCode === -6) return `${label} (file not found)`
  return label
}

/** The trace line for an `ERR_ABORTED` thrown by `loadURL`, so both paths read the same. */
export function describeLoadError(err: unknown): string {
  const code = (err as { code?: string })?.code
  const errno = (err as { errno?: number })?.errno
  if (code === 'ERR_ABORTED' || errno === -3) return 'ERR_ABORTED (-3)'
  const message = (err as { message?: string })?.message
  return message || code || String(err)
}
