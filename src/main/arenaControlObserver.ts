import { classifyArenaObservedState, type ArenaObservedState } from './arenaObservedState'

// This narrow interface makes the dependency on Electron's actual webContents
// explicit without exposing a renderer IPC or arbitrary script execution.
export interface ArenaReadOnlyWebContents {
  readonly id: number
  isDestroyed(): boolean
  getURL(): string
  executeJavaScriptInIsolatedWorld(
    worldId: number,
    scripts: Array<{ code: string }>,
    userGesture?: boolean
  ): Promise<unknown>
}
export interface RegisteredArenaView {
  webContents: ArenaReadOnlyWebContents
  navigationGeneration: number
}
export type ResolveArenaView = (tabId: string) => RegisteredArenaView | undefined
export type ArenaControlResult =
  | {
      status: 'observed'
      state: Exclude<ArenaObservedState, 'unknown'>
      providerCondition: 'unknown'
    }
  | {
      status: 'unknown'
      reason:
        | 'invalid-target'
        | 'view-changed'
        | 'busy'
        | 'timeout'
        | 'read-failed'
        | 'unrecognized-controls'
      providerCondition: 'unknown'
    }

// Fixed literal only: no request text, page data, URLs or selectors are ever
// interpolated. Reads counts, not message text, input content, IDs or cookies.
const CONTROL_SCRIPT = `(() => {
  const selectors = {
    composer: '[data-perf-target="composer"] div.ProseMirror[contenteditable="true"]:not([aria-disabled="true"])',
    send: 'button[data-perf-target="send"][aria-label="Send message"]',
    stop: 'button[data-perf-target="send"][aria-label="Stop generating"]'
  }
  const visible = el => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const result = {}
  for (const [name, selector] of Object.entries(selectors)) {
    const nodes = Array.from(document.querySelectorAll(selector))
    result[name] = {
      count: nodes.length,
      visible: nodes.filter(visible).length,
      enabled: nodes.filter(el => !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true').length
    }
  }
  return result
})()`
// A dedicated candidate world ID; reserve and verify it against the real app before wiring.
const ISOLATED_WORLD = 235017
const READ_TIMEOUT_MS = 5000

// Shared across observer instances in this process. A timeout cannot cancel
// Electron's underlying read: retain the slot until that promise settles.
// Saturation intentionally fails closed rather than queuing unbounded work.
const MAX_OUTSTANDING_READS = 8
const outstandingReads = new Set<ArenaReadOnlyWebContents>()

function startBoundedRead(view: ArenaReadOnlyWebContents): Promise<unknown> | null {
  if (outstandingReads.has(view) || outstandingReads.size >= MAX_OUTSTANDING_READS) return null
  outstandingReads.add(view)
  let read: Promise<unknown>
  try {
    read = Promise.resolve(
      view.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: CONTROL_SCRIPT }], false)
    )
  } catch (error) {
    outstandingReads.delete(view)
    throw error
  }
  // Both handlers release the slot, including when the caller has timed out.
  // Attaching both handlers also consumes late rejections without logging data.
  return read.then(
    (value) => {
      outstandingReads.delete(view)
      return value
    },
    (error: unknown) => {
      outstandingReads.delete(view)
      throw error
    }
  )
}

function safeUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'arena.ai' || url.hostname.endsWith('.arena.ai'))
    )
  } catch {
    return false
  }
}
function validRegisteredView(view: RegisteredArenaView | undefined): view is RegisteredArenaView {
  if (
    !view ||
    !view.webContents ||
    !Number.isSafeInteger(view.navigationGeneration) ||
    view.navigationGeneration < 1
  )
    return false
  const wc = view.webContents
  return (
    Number.isSafeInteger(wc.id) &&
    wc.id > 0 &&
    typeof wc.isDestroyed === 'function' &&
    typeof wc.getURL === 'function' &&
    typeof wc.executeJavaScriptInIsolatedWorld === 'function'
  )
}
const unknown = (
  reason: Extract<ArenaControlResult, { status: 'unknown' }>['reason']
): ArenaControlResult => ({ status: 'unknown', reason, providerCondition: 'unknown' })

/**
 * Read-only candidate. The resolver must be owned by trusted main-process code
 * and map the selected tab to its actual view. It must increment the generation
 * on every full and same-document navigation, replacement, crash, discard and
 * relevant session reset. Neither a URL nor a DOM observation authenticates a
 * provider, account, conversation, response or user grant. No send or approval
 * is allowed by this helper; security state deliberately remains unknown.
 */
export function createArenaControlObserver(
  tabId: string,
  resolveView: ResolveArenaView
): {
  observe: () => Promise<ArenaControlResult>
} | null {
  if (
    typeof tabId !== 'string' ||
    !tabId.trim() ||
    tabId.length > 1024 ||
    typeof resolveView !== 'function'
  )
    return null
  let registration: RegisteredArenaView | undefined
  let initialUrl: string
  try {
    registration = resolveView(tabId)
    if (!validRegisteredView(registration) || registration.webContents.isDestroyed()) return null
    initialUrl = registration.webContents.getURL()
    if (!safeUrl(initialUrl)) return null
  } catch {
    return null
  }
  const capturedView = registration.webContents
  const capturedId = capturedView.id
  const capturedGeneration = registration.navigationGeneration
  let inFlight = false
  let invalidated = false

  const stillCurrent = (): boolean => {
    try {
      const next = resolveView(tabId)
      return (
        validRegisteredView(next) &&
        next.webContents === capturedView &&
        next.webContents.id === capturedId &&
        next.navigationGeneration === capturedGeneration &&
        !capturedView.isDestroyed() &&
        capturedView.getURL() === initialUrl &&
        safeUrl(initialUrl)
      )
    } catch {
      return false
    }
  }

  return {
    async observe(): Promise<ArenaControlResult> {
      if (invalidated) return unknown('view-changed')
      if (inFlight) return unknown('busy')
      if (!stillCurrent()) {
        invalidated = true
        return unknown('view-changed')
      }
      inFlight = true
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('read-timeout')), READ_TIMEOUT_MS)
        })
        const read = startBoundedRead(capturedView)
        if (!read) return unknown('busy')
        const data = await Promise.race([read, timeout])
        if (!stillCurrent()) {
          invalidated = true
          return unknown('view-changed')
        }
        const state = classifyArenaObservedState(data)
        return state === 'unknown'
          ? unknown('unrecognized-controls')
          : { status: 'observed', state, providerCondition: 'unknown' }
      } catch (error) {
        if (!stillCurrent()) {
          invalidated = true
          return unknown('view-changed')
        }
        return unknown(
          error instanceof Error && error.message === 'read-timeout' ? 'timeout' : 'read-failed'
        )
      } finally {
        if (timer) clearTimeout(timer)
        inFlight = false
      }
    }
  }
}
