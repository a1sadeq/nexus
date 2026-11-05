import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { ActiveTitleSync, buildActiveTitleReadScript, type ActiveTitleTask } from './activeTitleSync'
import { getMergedProviderFeatures } from '../shared/providerConfig'

const selector = 'button[aria-haspopup="menu"] > span[dir="auto"].truncate'
function makePage() {
  const dom = new JSDOM(`<!doctype html><html><head><title>Arena</title></head><body>
    <button aria-haspopup="menu"><span dir="auto" class="truncate" id="hidden">Old hidden title</span></button>
    <button aria-haspopup="menu"><span dir="auto" class="truncate" id="visible">Correct conversation</span></button>
  </body></html>`, { runScripts: 'outside-only', url: 'https://arena.ai/example' })
  const visible = dom.window.document.getElementById('visible')!
  Object.defineProperty(visible, 'getClientRects', { configurable: true, value: () => [{ width: 20, height: 10 }] })
  return dom
}

describe('active title selector script', () => {
  it('chooses a visible matching title instead of an earlier hidden match', () => {
    const dom = makePage()
    expect(dom.window.eval(buildActiveTitleReadScript(selector))).toBe('Correct conversation')
    expect(dom.window.document.title).toBe('Arena')
    dom.window.close()
  })
  it('does not publish hidden-only matches or invalid selectors', () => {
    const dom = makePage()
    Object.defineProperty(dom.window.document.getElementById('visible')!, 'getClientRects', { configurable: true, value: () => [] })
    expect(dom.window.eval(buildActiveTitleReadScript(selector))).toBe('')
    expect(dom.window.eval(buildActiveTitleReadScript('['))).toBe('')
    dom.window.close()
  })
  it('skips a hidden priority selector and uses the next visible one', () => {
    const dom = makePage()
    expect(dom.window.eval(buildActiveTitleReadScript('#hidden, #visible'))).toBe('Correct conversation')
    dom.window.close()
  })
})

describe('single-flight active title controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('publishes changes once, resumes after a native title update and stops cleanly', async () => {
    const controller = new ActiveTitleSync()
    let title = 'First'; let runnable = true
    const read = vi.fn(async () => title); const publish = vi.fn()
    const task: ActiveTitleTask = { contents: {}, intervalMs: 1500, canRun: () => runnable, read, publish }
    controller.start(task); await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(publish).toHaveBeenCalledTimes(1)
    title = 'Second'; await vi.advanceTimersByTimeAsync(1500)
    expect(publish).toHaveBeenLastCalledWith('Second')
    controller.invalidate(); await vi.advanceTimersByTimeAsync(1500)
    expect(publish).toHaveBeenCalledTimes(3)
    runnable = false; const calls = read.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000); expect(read).toHaveBeenCalledTimes(calls)
    controller.stop(); expect(vi.getTimerCount()).toBe(0)
  })
  it('never overlaps reads for one view and discards stale results after switching', async () => {
    const controller = new ActiveTitleSync(); const contents = {}; const publish = vi.fn()
    let resolve!: (value: string) => void
    const read = vi.fn(() => new Promise<string>(r => { resolve = r }))
    controller.start({ contents, intervalMs: 1000, canRun: () => true, read, publish })
    await vi.advanceTimersByTimeAsync(4000)
    expect(read).toHaveBeenCalledOnce()
    controller.stop(); resolve('Old tab title'); await vi.advanceTimersByTimeAsync(0)
    expect(publish).not.toHaveBeenCalled()
  })
  it('does not start for a disabled interval', async () => {
    const controller = new ActiveTitleSync(); const read = vi.fn(async () => 'Title')
    controller.start({ contents: {}, intervalMs: 0, canRun: () => true, read, publish: vi.fn() })
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('real main-process fallback integration with fake Electron and page', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('publishes the correct Arena title without depending on the page timer or document.title', async () => {
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const helperStart = main.indexOf('function shouldIgnoreProviderTitle(')
    const helperEnd = main.indexOf('\nfunction ensureAiView(', helperStart)
    const start = main.indexOf('const arenaTitleSync = new ActiveTitleSync()')
    const end = main.indexOf('// Switch tabs:', start)
    if (Math.min(helperStart, helperEnd, start, end) < 0) throw new Error('Unable to locate production title integration')
    const js = ts.transpileModule(main.slice(helperStart, helperEnd) + '\n' + main.slice(start, end) + '\nglobalThis.api = { restartActiveArenaTitleSync, arenaTitleSync }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const dom = makePage()
    const wc = { getURL: () => 'https://arena.ai/example', isDestroyed: () => false, executeJavaScript: (script: string) => Promise.resolve(dom.window.eval(script)) }
    const view = { webContents: wc }
    const ctx: Record<string, unknown> = {}
    const send = vi.fn()
    new Function('globalThis', 'ActiveTitleSync', 'buildActiveTitleReadScript', 'activeViewId', 'mainWindow', 'activeViewVisible', 'overlaysOpen', 'aiViews', 'viewModelKeys', 'providerConfig', 'getMergedProviderFeatures', 'viewTitles', 'sendToMainWindow', js)(
      ctx, ActiveTitleSync, buildActiveTitleReadScript, 'tab-1', { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false }, true, false,
      new Map([['tab-1', view]]), new Map([['tab-1', 'arena-ai']]), {}, getMergedProviderFeatures, new Map(), send
    )
    const api = ctx.api as { restartActiveArenaTitleSync: () => void; arenaTitleSync: ActiveTitleSync }
    api.restartActiveArenaTitleSync(); await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledWith('ai-title-updated', 'tab-1', 'Correct conversation')
    expect(dom.window.document.title).toBe('Arena')
    dom.window.document.getElementById('visible')!.textContent = 'Updated conversation'
    await vi.advanceTimersByTimeAsync(1500)
    expect(send).toHaveBeenLastCalledWith('ai-title-updated', 'tab-1', 'Updated conversation')
    api.arenaTitleSync.stop(); dom.window.close()
  })
})
