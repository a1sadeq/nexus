import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createArenaControlObserver,
  type ArenaReadOnlyWebContents,
  type RegisteredArenaView
} from './arenaControlObserver'

afterEach(() => vi.useRealTimers())
const controls = {
  composer: { count: 1, visible: 1, enabled: 1 },
  send: { count: 1, visible: 1, enabled: 0 },
  stop: { count: 0, visible: 0, enabled: 0 }
}
function fixture(): {
  wc: ArenaReadOnlyWebContents
  reg: RegisteredArenaView
  resolve: (tab: string) => RegisteredArenaView | undefined
  url: { value: string }
} {
  const url = { value: 'https://arena.ai/chat/test' }
  const wc: ArenaReadOnlyWebContents = {
    id: 12,
    isDestroyed: () => false,
    getURL: () => url.value,
    executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(controls)
  }
  const reg = { webContents: wc, navigationGeneration: 1 }
  return { wc, reg, url, resolve: (tab) => (tab === 'tab-a' ? reg : undefined) }
}

describe('Arena per-tab read-only control observer', () => {
  it('reads only the requested view in an isolated world and never marks security clear', async () => {
    const { wc, resolve } = fixture()
    const observer = createArenaControlObserver('tab-a', resolve)!
    expect(await observer.observe()).toEqual({
      status: 'observed',
      state: 'send-disabled',
      providerCondition: 'unknown'
    })
    expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    const args = vi.mocked(wc.executeJavaScriptInIsolatedWorld).mock.calls[0]
    expect(args[0]).toBe(235017)
    expect(args[2]).toBe(false)
    expect(args[1][0].code).not.toMatch(
      /\.click\(|document\.cookie|localStorage|\.innerText|\.textContent/
    )
  })
  it('returns null for unknown tab, destroyed view or non-Arena URL', () => {
    const f = fixture()
    expect(createArenaControlObserver('tab-b', f.resolve)).toBeNull()
    f.url.value = 'https://arena.ai.attacker.test/'
    expect(createArenaControlObserver('tab-a', f.resolve)).toBeNull()
    f.url.value = 'http://arena.ai/'
    expect(createArenaControlObserver('tab-a', f.resolve)).toBeNull()
    f.url.value = 'https://arena.ai/'
    f.wc.isDestroyed = () => true
    expect(createArenaControlObserver('tab-a', f.resolve)).toBeNull()
  })
  it('rejects changed view and never follows the active tab', async () => {
    const f = fixture(),
      observer = createArenaControlObserver('tab-a', f.resolve)!
    const replacement = fixture()
    f.reg.webContents = replacement.wc
    expect(await observer.observe()).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
    expect(replacement.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
  it('invalidates across changed navigation generation even if URL returns to the original', async () => {
    const f = fixture(),
      observer = createArenaControlObserver('tab-a', f.resolve)!
    f.reg.navigationGeneration++
    expect((await observer.observe()).status).toBe('unknown')
    f.reg.navigationGeneration--
    expect(await observer.observe()).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
  })
  it('discards an asynchronous result if navigation or tab identity changes during reading', async () => {
    const f = fixture()
    let finish!: (result: unknown) => void
    f.wc.executeJavaScriptInIsolatedWorld = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const observer = createArenaControlObserver('tab-a', f.resolve)!
    const pending = observer.observe()
    f.reg.navigationGeneration++
    finish(controls)
    expect(await pending).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
  })
  it('rejects changed URL, malformed provider data and query errors', async () => {
    const a = fixture(),
      oa = createArenaControlObserver('tab-a', a.resolve)!
    a.url.value = 'https://arena.ai/other'
    expect(await oa.observe()).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
    const b = fixture()
    vi.mocked(b.wc.executeJavaScriptInIsolatedWorld).mockResolvedValue({ bogus: true })
    expect(await createArenaControlObserver('tab-a', b.resolve)!.observe()).toEqual({
      status: 'unknown',
      reason: 'unrecognized-controls',
      providerCondition: 'unknown'
    })
    const c = fixture()
    vi.mocked(c.wc.executeJavaScriptInIsolatedWorld).mockRejectedValue(new Error('no'))
    expect(await createArenaControlObserver('tab-a', c.resolve)!.observe()).toEqual({
      status: 'unknown',
      reason: 'read-failed',
      providerCondition: 'unknown'
    })
  })
  it('bounds a slow read and rejects concurrent reads for the same observer', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let finish!: (value: unknown) => void
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const observer = createArenaControlObserver('tab-a', f.resolve)!
    const pending = observer.observe()
    expect(await observer.observe()).toEqual({
      status: 'unknown',
      reason: 'busy',
      providerCondition: 'unknown'
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({
      status: 'unknown',
      reason: 'timeout',
      providerCondition: 'unknown'
    })
    finish(controls)
    await Promise.resolve()
  })
  it('runs its actual fixed script on a synthetic DOM and detects Send disabled', async () => {
    const dom = new JSDOM(
      '<div data-perf-target="composer"><div class="ProseMirror" contenteditable="true"></div></div><button data-perf-target="send" aria-label="Send message" disabled></button>',
      { runScripts: 'outside-only' }
    )
    dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({ width: 10, height: 10 }) as DOMRect
    const f = fixture()
    f.wc.executeJavaScriptInIsolatedWorld = vi
      .fn()
      .mockImplementation(async (_world, scripts) => dom.window.eval(scripts[0].code))
    expect(await createArenaControlObserver('tab-a', f.resolve)!.observe()).toEqual({
      status: 'observed',
      state: 'send-disabled',
      providerCondition: 'unknown'
    })
  })
  it('fails closed if the resolver or webContents becomes unusable', async () => {
    expect(
      createArenaControlObserver('tab-a', () => {
        throw new Error('sensitive details')
      })
    ).toBeNull()
    const f = fixture(),
      observer = createArenaControlObserver('tab-a', f.resolve)!
    f.wc.isDestroyed = () => true
    expect(await observer.observe()).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
  })
  it('does not return raw page content, exception details or a claimed clear security state', async () => {
    const f = fixture()
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockResolvedValue({
      ...controls,
      secret: 'private message',
      url: 'https://arena.ai/private'
    })
    const result = await createArenaControlObserver('tab-a', f.resolve)!.observe()
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.providerCondition).toBe('unknown')
  })
  it('shares a per-view read slot across independent observers', async () => {
    const f = fixture()
    let finish!: (value: unknown) => void
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const a = createArenaControlObserver('tab-a', f.resolve)!
    const b = createArenaControlObserver('tab-a', f.resolve)!
    const pending = a.observe()
    expect(await b.observe()).toEqual({
      status: 'unknown',
      reason: 'busy',
      providerCondition: 'unknown'
    })
    expect(f.wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
    finish(controls)
    expect((await pending).status).toBe('observed')
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockResolvedValue(controls)
    expect((await b.observe()).status).toBe('observed')
  })
  it('keeps a timed-out native read reserved until it actually settles', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let finish!: (value: unknown) => void
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const a = createArenaControlObserver('tab-a', f.resolve)!
    const b = createArenaControlObserver('tab-a', f.resolve)!
    const pending = a.observe()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({ status: 'unknown', reason: 'timeout' })
    expect(await b.observe()).toMatchObject({ status: 'unknown', reason: 'busy' })
    finish(controls)
    await Promise.resolve()
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockResolvedValue(controls)
    expect((await b.observe()).status).toBe('observed')
  })
  it('releases the slot after synchronous failure and late rejection', async () => {
    vi.useFakeTimers()
    const f = fixture()
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementationOnce(() => {
      throw new Error('private')
    })
    const a = createArenaControlObserver('tab-a', f.resolve)!
    expect(await a.observe()).toMatchObject({ status: 'unknown', reason: 'read-failed' })
    let fail!: (reason: unknown) => void
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    const pending = a.observe()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({ reason: 'timeout' })
    fail(new Error('late private failure'))
    await Promise.resolve()
    vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockResolvedValue(controls)
    expect((await a.observe()).status).toBe('observed')
  })
  it('caps concurrent native reads across different views without queuing', async () => {
    const fs = Array.from({ length: 9 }, () => fixture())
    const finish: Array<(value: unknown) => void> = []
    for (const f of fs) {
      vi.mocked(f.wc.executeJavaScriptInIsolatedWorld).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish.push(resolve)
          })
      )
    }
    const observers = fs.map((f) => createArenaControlObserver('tab-a', f.resolve)!)
    const pending = observers.slice(0, 8).map((o) => o.observe())
    expect(await observers[8].observe()).toMatchObject({ status: 'unknown', reason: 'busy' })
    expect(fs[8].wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    finish.forEach((done) => done(controls))
    expect((await Promise.all(pending)).every((result) => result.status === 'observed')).toBe(true)
    vi.mocked(fs[8].wc.executeJavaScriptInIsolatedWorld).mockResolvedValue(controls)
    expect((await observers[8].observe()).status).toBe('observed')
  })
})
