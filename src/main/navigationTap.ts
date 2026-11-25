/**
 * Wraps a webContents' own navigation API so every *programmatic* navigation names itself.
 *
 * Why this exists: on a restored tab, Ctrl+L would start the load and 19–300 ms later the same
 * webContents would navigate back to the page's old URL, aborting it. `will-navigate` never fired, so
 * the page was not doing it — something in this process was. Nothing in the source called `goBack`
 * on that path, which left one possibility: a call from code we had not looked at, or a restoration
 * inside Chromium started on our behalf.
 *
 * Rather than keep reading the source, we now own the surface. `loadURL`, `reload`, `stop` and the
 * three `navigationHistory` moves are replaced by thin wrappers that record the call, the URL and the
 * first stack frame outside this file before delegating. The next trace answers "who moved this tab"
 * with a file and a line instead of a hypothesis.
 *
 * The wrappers must change nothing about behaviour: same return value, same rejection, no extra
 * navigation. A tracer that alters the thing it measures has no value.
 */

export type NavigationTapEvent = {
  /** `loadURL`, `reload`, `stop`, `history.goBack`, … — the method that was called. */
  action: string
  /** Where the call came from: `index.ts:4797`. Empty when the stack could not be read. */
  caller: string
  url?: string
}

type History = {
  goBack?: () => void
  goForward?: () => void
  goToIndex?: (index: number) => void
  clear?: () => void
  canGoBack?: () => boolean
  canGoForward?: () => boolean
}

/** The subset of a webContents (or Electron.WebContents) the tap needs. */
export interface NavigationSurface {
  loadURL: (url: string, ...rest: unknown[]) => Promise<unknown>
  reload?: () => void
  reloadIgnoringCache?: () => void
  stop?: () => void
  navigationHistory?: History
  [key: string]: unknown
}

/** First stack frame outside this module — that is the caller worth printing. */
export function callerFrame(stack: string | undefined): string {
  if (!stack) return ''
  const lines = stack.split('\n').slice(1)
  for (const line of lines) {
    const file = /((?:[A-Za-z]:)?[^\s()]*?\.(?:ts|tsx|js|mjs|cjs|jsx))(?::(\d+))(?::(\d+))?/.exec(line)
    if (!file) continue
    const path = file[1]
    if (/navigationTap\.(ts|js|mjs|cjs)$/.test(path)) continue
    if (/node:(internal|electron)/.test(line)) continue
    const name = /^\s*at\s+(?:([\w.$<>[\]-]+)\s+)?\(?/.exec(line)
    const where = `${path.split(/[\\/]/).pop()}:${file[2]}`
    return name && name[1] && !/^\d+$/.test(name[1]) ? `${name[1]}@${where}` : where
  }
  return ''
}

/**
 * Read the caller without relying on file names.
 *
 * Build 28's first cut took `new Error().stack` and skipped frames belonging to *this file*. That works
 * in the source tree and fails in the bundle, where every module lands in one `index.js`: the first
 * frame was the wrapper itself, and every line printed `caller=describeError@index.js:2379` — a fact
 * about the build, not about the navigation. `Error.captureStackTrace(err, skipUntil)` is resolved by
 * function identity instead, so it stops at the real caller whichever file the bundler put it in.
 */
function captureCaller(skipUntil: (...args: never[]) => unknown): string {
  try {
    const error: { stack?: string } = {}
    const capture = (Error as unknown as { captureStackTrace?: (target: object, skip?: unknown) => void })
      .captureStackTrace
    if (typeof capture === 'function') {
      capture(error, skipUntil)
      const stack = String(error.stack || '')
      // The first frame after the message is the caller when captureStackTrace is available.
      const frames = stack.split('\n').slice(1)
      for (const line of frames) {
        const where = parseFrame(line)
        if (where) return where
      }
    }
    return callerFrame(new Error().stack)
  } catch {
    return ''
  }
}

/** `at run (/app/out/main/index.js:7312:24)` → `run@index.js:7312`. */
function parseFrame(line: string): string {
  const file = /((?:[A-Za-z]:)?[^\s()]*?\.(?:ts|tsx|js|mjs|cjs|jsx))(?::(\d+))(?::(\d+))?/.exec(line)
  if (!file) return ''
  if (/navigationTap\.(ts|js|mjs|cjs)$/.test(file[1])) return ''
  if (/node:(internal|electron)/.test(line)) return ''
  const name = /^\s*at\s+(?:([\w.$<>[\]-]+)\s+)?\(?/.exec(line)
  const where = `${file[1].split(/[\\/]/).pop()}:${file[2]}`
  return name && name[1] && !/^\d+$/.test(name[1]) && name[1] !== 'Object.<anonymous>'
    ? `${name[1]}@${where}`
    : where
}

function describeError(): string {
  try {
    return callerFrame(new Error().stack)
  } catch {
    return ''
  }
}

function shortUrlForTrace(url: unknown): string | undefined {
  if (typeof url !== 'string' || url === '') return undefined
  if (url.length <= 80) return url
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname.slice(0, 40)}…`
  } catch {
    return `${url.slice(0, 79)}…`
  }
}

const WRAPPED = Symbol.for('nexus.navigationTap')

/**
 * Install the tap. Returns an uninstall function. Calling it twice on the same surface is a no-op that
 * returns the existing uninstaller, so a view that is re-created cannot end up with two layers of
 * wrappers recording every call twice.
 */
export function tapNavigationSurface(
  surface: NavigationSurface,
  report: (event: NavigationTapEvent) => void
): () => void {
  const existing = (surface as unknown as Record<symbol, unknown>)[WRAPPED]
  if (typeof existing === 'function') return existing as () => void

  const undo: Array<() => void> = []

  const emit = (action: string, url: string | undefined, caller: string): void => {
    try {
      report({ action, caller: caller || describeError(), ...(url ? { url: shortUrlForTrace(url) } : {}) })
    } catch {
      // A trace must never be the reason a navigation fails.
    }
  }

  const wrap = <K extends string>(
    key: K,
    action: string,
    label: (args: unknown[]) => string | undefined
  ): void => {
    const original = surface[key] as unknown
    if (typeof original !== 'function') return
    const fn = original as (...args: unknown[]) => unknown
    const patched = function patchedNavigation(this: unknown, ...args: unknown[]): unknown {
      // Captured first: by the time anything else runs, the caller has left the stack.
      const caller = captureCaller(patchedNavigation as unknown as (...args: never[]) => unknown)
      emit(action, label(args), caller)
      const result = fn.apply(this, args)
      // `loadURL` rejects when the load is superseded; the caller's catch block is unchanged, we only
      // make the rejection visible in the trace next to the call that started it.
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        return (result as Promise<unknown>).catch((err: unknown) => {
          // Same failure, one line, next to the call that caused it.
          const message = err instanceof Error ? err.message : String(err)
          emit(`${action} rejected — ${message.slice(0, 90)}`, undefined, caller)
          throw err
        })
      }
      return result
    }
    try {
      ;(surface as Record<string, unknown>)[key] = patched
      undo.push(() => {
        ;(surface as Record<string, unknown>)[key] = original
      })
    } catch {
      // A frozen surface is not worth a crash; the tap simply does not install.
    }
  }

  wrap('loadURL', 'loadURL', (args) => (typeof args[0] === 'string' ? args[0] : undefined))
  wrap('reload', 'reload', () => undefined)
  wrap('reloadIgnoringCache', 'reloadIgnoringCache', () => undefined)
  wrap('stop', 'stop', () => undefined)

  const history = surface.navigationHistory
  if (history && typeof history === 'object') {
    const wrapHistory = (key: 'goBack' | 'goForward' | 'goToIndex' | 'clear', action: string): void => {
      const original = history[key]
      if (typeof original !== 'function') return
      const fn = original.bind(history)
      try {
        const patched = (...args: unknown[]): unknown => {
          const caller = captureCaller(patched as unknown as (...args: never[]) => unknown)
          emit(action, typeof args[0] === 'number' ? `index=${args[0]}` : undefined, caller)
          return (fn as (...a: unknown[]) => unknown)(...args)
        }
        ;(history as Record<string, unknown>)[key] = patched
        undo.push(() => {
          ;(history as Record<string, unknown>)[key] = original
        })
      } catch {
        /* ignore */
      }
    }
    wrapHistory('goBack', 'history.goBack')
    wrapHistory('goForward', 'history.goForward')
    wrapHistory('goToIndex', 'history.goToIndex')
    wrapHistory('clear', 'history.clear')
  }

  const uninstall = (): void => {
    while (undo.length) {
      const step = undo.pop()
      try {
        step?.()
      } catch {
        /* ignore */
      }
    }
    try {
      delete (surface as unknown as Record<symbol, unknown>)[WRAPPED]
    } catch {
      /* ignore */
    }
  }

  try {
    ;(surface as unknown as Record<symbol, unknown>)[WRAPPED] = uninstall
  } catch {
    /* ignore */
  }

  return uninstall
}

/**
 * Should we fight for the user's URL?
 *
 * A load of ours started, and a *different* URL then started navigating the main frame. The load the
 * user asked for is still wanted, so rather than wait for the intruder to finish (which is how the
 * last six builds lost), we start ours again immediately — that cancels the other navigation in
 * Chromium. Bounded by `budget` so a page that insists cannot spin forever.
 */
export function shouldDefend(params: {
  isMainFrame: boolean
  incomingUrl: string
  pendingUrl: string | null
  sameUrl: (a: string, b: string) => boolean
  defencesUsed: number
  budget: number
  lastDefenceAt: number
  now: number
  minGapMs?: number
}): boolean {
  if (!params.isMainFrame) return false
  if (!params.pendingUrl) return false
  if (!params.incomingUrl) return false
  if (params.sameUrl(params.incomingUrl, params.pendingUrl)) return false
  if (params.defencesUsed >= params.budget) return false
  const gap = params.minGapMs ?? 120
  return params.now - params.lastDefenceAt >= gap
}
