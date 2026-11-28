import { EventEmitter } from 'node:events'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import {
  TabDiscardManager,
  type DiscardableView,
  type DiscardableWebContents
} from './tabDiscardManager'

/**
 * Build 48 — "restart this tab", on request.
 *
 * The user's own fix for a blank AI view is to close the tab and open it again; the one they found for a
 * *wedged* tab is the same thing, because it is the only way to get a brand new `WebContentsView`. This
 * is that move as a single request, and it has to behave like an ordinary eviction afterwards: the tab
 * stays in the sidebar, the URL is remembered, and the wake path brings the page back.
 *
 * Unlike the timer-driven eviction this must *work* on a pinned or active tab — the user asked for it —
 * so the guards are only the ones that would make it fail outright.
 */

function createMockView(id: string, url = `https://arena.ai/agent/${id}`, scrollY = 240): {
  view: DiscardableView
  destroyed: () => boolean
} {
  let destroyed = false
  const events = new EventEmitter()
  const webContents: DiscardableWebContents = {
    once: (name, fn) => events.once(name, fn),
    removeListener: (name, fn) => events.removeListener(name, fn),
    getURL: () => url,
    isLoading: () => false,
    executeJavaScript: () => Promise.resolve(scrollY),
    close: () => {
      destroyed = true
      events.emit('destroyed')
    },
    isDestroyed: () => destroyed
  }
  return { view: { webContents }, destroyed: () => destroyed }
}

describe('restartTab', () => {
  let tempDir: string
  let now = 1000000

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nexus-restart-test-'))
    now = 1000000
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* windows */
    }
  })

  const manager = (): TabDiscardManager =>
    new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => now,
      onTeardown: (_id, view) => view.webContents.close()
    })

  it('tears the view down and remembers the address and the scroll position', async () => {
    const m = manager()
    const mock = createMockView('tabA', 'https://gemini.google.com/app/xyz', 512)
    m.registerView('tabA', mock.view)

    const outcome = await m.restartTab('tabA')

    expect(outcome).toBe('ok')
    expect(mock.destroyed()).toBe(true)
    expect(m.hasView('tabA')).toBe(false)
    expect(m.isTabEvicted('tabA')).toBe(true)
    const saved = m.getEvictedTabState('tabA')
    expect(saved?.url).toBe('https://gemini.google.com/app/xyz')
    expect(saved?.scrollY).toBe(512)
  })

  it('restarts a pinned tab — the user asked for it, so the timer rules do not apply', async () => {
    const m = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => now,
      isPinned: () => true,
      onTeardown: (_id, view) => view.webContents.close()
    })
    const mock = createMockView('tabPinned')
    m.registerView('tabPinned', mock.view)
    expect(await m.restartTab('tabPinned')).toBe('ok')
    expect(m.isTabEvicted('tabPinned')).toBe(true)
  })

  it('restarts the tab that is on screen', async () => {
    const m = manager()
    const mock = createMockView('tabActive')
    m.registerView('tabActive', mock.view)
    m.activateTab('tabActive')
    expect(await m.restartTab('tabActive')).toBe('ok')
    expect(m.hasView('tabActive')).toBe(false)
  })

  it('restarts a tab whose assistant is mid-answer, when the user says so', async () => {
    const m = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => now,
      isBusy: () => true,
      onTeardown: (_id, view) => view.webContents.close()
    })
    const mock = createMockView('tabBusy')
    m.registerView('tabBusy', mock.view)
    expect(await m.restartTab('tabBusy')).toBe('ok')
  })

  it('refuses a tab it has no view for, and never throws', async () => {
    const m = manager()
    expect(await m.restartTab('nothing-here')).toBe('no-view')
    expect(await m.restartTab('')).toBe('no-view')
  })

  it('refuses a tab whose address could not be restored afterwards', async () => {
    const m = manager()
    const mock = createMockView('tabBlank', 'about:blank')
    m.registerView('tabBlank', mock.view)
    expect(await m.restartTab('tabBlank')).toBe('no-url')
    expect(mock.destroyed()).toBe(false)
    expect(m.hasView('tabBlank')).toBe(true)
  })
})
