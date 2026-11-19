import type { WebContents } from 'electron'
import type { EventEmitter } from 'node:events'
import type { ArenaViewRegistry } from './arenaViewRegistry'

/**
 * Main-process-only lifecycle signal. It is NOT an origin/account/chat identity,
 * permission grant, IPC authorization or a way to cancel native operations.
 * It deliberately invalidates for every frame navigation, including subframes.
 */
export interface ArenaViewLease {
  readonly tabId: string
  readonly navigationGeneration: number
  readonly webContentsId: number
  readonly signal: AbortSignal
  assertCurrent(): void
  dispose(): void
}

export function acquireArenaViewLease(registry: ArenaViewRegistry, tabId: string): ArenaViewLease {
  const initial = registry.resolve(tabId)
  if (!initial) throw new Error('View unavailable')
  const contents = initial.webContents as WebContents
  const generation = initial.navigationGeneration
  const id = contents.id
  // Node EventEmitter's generic listener API avoids Electron's per-event overload union.
  const eventsSource = contents as unknown as EventEmitter
  const controller = new AbortController()
  let valid = true
  let disposing = false

  const events = [
    'did-start-navigation',
    'did-navigate',
    'did-navigate-in-page',
    'render-process-gone',
    'destroyed'
  ] as const
  const invalidate = (): void => {
    if (!valid) return
    valid = false
    // Forget state before notification; abort handlers can synchronously reenter.
    for (const event of events) {
      try {
        eventsSource.removeListener(event, invalidate)
      } catch {
        // A destroyed native wrapper may reject listener removal.
      }
    }
    controller.abort()
  }
  const current = (): boolean => {
    if (!valid) return false
    try {
      const view = registry.resolve(tabId)
      return (
        !!view &&
        view.webContents === contents &&
        view.webContents.id === id &&
        view.navigationGeneration === generation &&
        !contents.isDestroyed()
      )
    } catch {
      return false
    }
  }
  try {
    for (const event of events) {
      eventsSource.on(event, invalidate)
      if (!valid) throw new Error('View invalidated during acquisition')
    }
    if (!current()) throw new Error('View changed during acquisition')
  } catch {
    invalidate()
    throw new Error('View unavailable or changed')
  }
  return Object.freeze({
    tabId,
    navigationGeneration: generation,
    webContentsId: id,
    signal: controller.signal,
    assertCurrent(): void {
      if (!current()) {
        invalidate()
        throw new Error('View lease invalid')
      }
    },
    dispose(): void {
      // Reentrant disposal through an abort listener must remain harmless.
      if (disposing) return
      disposing = true
      try {
        invalidate()
      } finally {
        disposing = false
      }
    }
  })
}
