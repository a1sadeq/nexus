import type { WebContents } from 'electron'
import { createArenaControlObserver, type RegisteredArenaView } from './arenaControlObserver'

type ChangeListener = (...args: unknown[]) => void
interface TrackedView {
  contents: WebContents
  id: number
  generation: number
  start: ChangeListener
  navigated: ChangeListener
  inPage: ChangeListener
  gone: ChangeListener
}

/**
 * Per-process lifecycle registry for a FUTURE trusted main-process integration.
 * It is not an IPC boundary, provider/account authentication, a sandbox,
 * consent, message correlation, completion, or authorization. Never register
 * objects supplied by a renderer or page. Not connected to Nexus by itself.
 */
export class ArenaViewRegistry {
  private readonly views = new Map<string, TrackedView>()
  private readonly owners = new Map<WebContents, string>()
  private readonly ids = new Map<number, string>()
  private generation = 0
  private exhausted = false

  private nextGeneration(): number {
    if (this.exhausted || this.generation >= Number.MAX_SAFE_INTEGER) {
      this.exhausted = true
      this.clear()
      throw new Error('Arena view generation exhausted')
    }
    this.generation++
    return this.generation
  }

  private remove(tabId: string, expected: WebContents): void {
    const entry = this.views.get(tabId)
    if (!entry || entry.contents !== expected) return
    this.views.delete(tabId)
    this.owners.delete(entry.contents)
    this.ids.delete(entry.id)
    // Cleanup should not leave a stale registration if the native wrapper is
    // already destroyed or one listener removal fails.
    try {
      entry.contents.removeListener('did-start-navigation', entry.start)
    } catch {
      // Native teardown is best effort after the registry has forgotten the view.
    }
    try {
      entry.contents.removeListener('did-navigate', entry.navigated)
    } catch {
      // Native teardown is best effort after the registry has forgotten the view.
    }
    try {
      entry.contents.removeListener('did-navigate-in-page', entry.inPage)
    } catch {
      // Native teardown is best effort after the registry has forgotten the view.
    }
    try {
      entry.contents.removeListener('render-process-gone', entry.gone)
    } catch {
      // Native teardown is best effort after the registry has forgotten the view.
    }
    try {
      entry.contents.removeListener('destroyed', entry.gone)
    } catch {
      // Native teardown is best effort after the registry has forgotten the view.
    }
  }

  private bump(tabId: string, expected: WebContents): void {
    const current = this.views.get(tabId)
    if (!current || current.contents !== expected) return
    try {
      current.generation = this.nextGeneration()
    } catch {
      /* all entries invalidated */
    }
  }

  /** Trusted main process only. Replace invalidates prior observers for the tab. */
  register(tabId: string, contents: WebContents): void {
    if (
      typeof tabId !== 'string' ||
      !tabId.trim() ||
      tabId.length > 1024 ||
      !contents ||
      !Number.isSafeInteger(contents.id) ||
      contents.id <= 0 ||
      contents.isDestroyed()
    ) {
      throw new Error('Invalid Arena view registration')
    }
    const otherOwner = this.owners.get(contents)
    const idOwner = this.ids.get(contents.id)
    if ((otherOwner && otherOwner !== tabId) || (idOwner && idOwner !== tabId)) {
      throw new Error('View already registered to another tab')
    }
    const old = this.views.get(tabId)
    if (old?.contents === contents) return
    if (old) this.remove(tabId, old.contents)
    const generation = this.nextGeneration()
    // New Electron uses details.isMainFrame; Electron 43 also supplies the
    // deprecated positional boolean. If neither is present, invalidate rather
    // than guessing that this was a harmless subframe navigation.
    const start: ChangeListener = (details, _url, _inPlace, legacyMain) => {
      const modernMain =
        details && typeof details === 'object'
          ? (details as { isMainFrame?: unknown }).isMainFrame
          : undefined
      if (
        typeof modernMain === 'boolean' &&
        typeof legacyMain === 'boolean' &&
        modernMain !== legacyMain
      ) {
        this.bump(tabId, contents)
        return
      }
      if (modernMain === false || (modernMain === undefined && legacyMain === false)) return
      this.bump(tabId, contents)
    }
    const navigated: ChangeListener = () => this.bump(tabId, contents)
    const inPage: ChangeListener = (_event, _url, mainFrame) => {
      if (mainFrame !== false) this.bump(tabId, contents)
    }
    const gone: ChangeListener = () => this.remove(tabId, contents)
    const entry: TrackedView = {
      contents,
      id: contents.id,
      generation,
      start,
      navigated,
      inPage,
      gone
    }
    this.views.set(tabId, entry)
    this.owners.set(contents, tabId)
    this.ids.set(contents.id, tabId)
    try {
      contents.on('did-start-navigation', start)
      contents.on('did-navigate', navigated)
      contents.on('did-navigate-in-page', inPage)
      contents.on('render-process-gone', gone)
      contents.on('destroyed', gone)
    } catch {
      this.remove(tabId, contents)
      throw new Error('Arena view lifecycle registration failed')
    }
  }

  /** Main-process account/session/grant resets must call this explicitly. */
  invalidate(tabId: string): void {
    const entry = this.views.get(tabId)
    if (entry) this.bump(tabId, entry.contents)
  }

  /** Remove current registration when main-process registration cannot be trusted. */
  forget(tabId: string): void {
    const entry = this.views.get(tabId)
    if (entry) this.remove(tabId, entry.contents)
  }

  /** Old teardown must not unregister a replacement with the same tab ID. */
  unregister(tabId: string, contents: WebContents): void {
    this.remove(tabId, contents)
  }

  resolve(tabId: string): RegisteredArenaView | undefined {
    const entry = this.views.get(tabId)
    if (!entry) return undefined
    try {
      if (entry.contents.isDestroyed()) {
        this.remove(tabId, entry.contents)
        return undefined
      }
      return { webContents: entry.contents, navigationGeneration: entry.generation }
    } catch {
      this.remove(tabId, entry.contents)
      return undefined
    }
  }

  /** Main-process internal API only; result still reports provider security unknown. */
  createObserver(tabId: string): ReturnType<typeof createArenaControlObserver> {
    return createArenaControlObserver(tabId, (id) => this.resolve(id))
  }

  clear(): void {
    for (const [tabId, entry] of this.views) this.remove(tabId, entry.contents)
  }
}
