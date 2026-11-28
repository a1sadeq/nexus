/**
 * Build 52 — the app's own CPU bill.
 *
 * The report that prompted this build measured 164.8 % of a core across nine processes for four idle
 * chat tabs: the page that was on screen at 70.7 %, the compositor at 33.3 %, the React shell at 26.9 %
 * and the z.ai tab at 25.9 %. Two of those four are the app's own work — the injected status observer
 * (which ran a full-document mutation observer and a layout-heavy button sweep several times a second in
 * every page) and the shell's endless decorative animations — and this file pins the changes that make
 * them cheap, in the source, because neither can be run in a test process.
 *
 * The behavioural half of the observer change is covered by `aiStatusObserver.test.ts` and
 * `arenaTabLiveSimulation.test.ts`, which drive the real injected script against a jsdom page: keeping
 * those green is the guarantee that "cheaper" did not become "wrong".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const observer = readFileSync(join(__dirname, 'aiStatusObserver.ts'), 'utf8')
const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const app = readFileSync(join(__dirname, '../renderer/src/App.tsx'), 'utf8')
const css = readFileSync(join(__dirname, '../renderer/src/App.css'), 'utf8')

describe('the injected status observer costs what the status needs, and no more', () => {
  it('decides whether a button could be a stop button before reading any geometry', () => {
    expect(observer).toContain('function looksLikeStopButton(btn)')
    expect(observer).toContain('if (!looksLikeStopButton(btn)) return false;')
    // The layout read must come after both cheap tests, not before them.
    const body = observer.slice(observer.indexOf('function isStopButton(btn)'), observer.indexOf('function hasActiveStopButton'))
    expect(body.indexOf('isInComposer(btn)')).toBeLessThan(body.indexOf('isElementVisible(btn)'))
    expect(body.indexOf('looksLikeStopButton(btn)')).toBeLessThan(body.indexOf('isInComposer(btn)'))
  })

  it('searches the composer for a stop button instead of every button on the page', () => {
    expect(observer).toContain('const scopes = document.querySelectorAll(')
    expect(observer).toContain("'form, [data-perf-target=\"composer\"], [class*=\"composer\" i]")
    expect(observer).toContain('checked < STOP_SCAN_LIMIT')
    expect(observer).toContain('const limit = Math.min(all.length, STOP_SCAN_LIMIT)')
  })

  it('caps every "is anything visible?" scan', () => {
    expect(observer).toContain('const VISIBLE_SCAN_LIMIT = 8;')
    for (const limit of ['streamingLimit', 'spinnerLimit', 'errorLimit', 'completionLimit', 'sendLimit', 'stopLimit']) {
      expect(observer, limit).toContain(`i < ${limit}`)
    }
  })

  it('spaces evaluations instead of running one per mutation', () => {
    expect(observer).toContain('const EVALUATE_FLOOR_MS = 250;')
    expect(observer).toContain('const since = Date.now() - lastEvaluateAt;')
    expect(observer).not.toContain('setTimeout(evaluateStatus, 100);')
  })

  it('resolves the assistant element once, not on every evaluation', () => {
    expect(observer).toContain('let cachedAssistantEl = null;')
    expect(observer).toContain('if (cachedAssistantEl && cachedAssistantEl.isConnected')
    expect(observer).toContain('function resolveAssistantElement()')
  })

  it('never forces a layout to measure how much text there is', () => {
    // `innerText` is the layout-forcing one; the observer only ever needed a length and a tail.
    const script = observer.slice(observer.indexOf('return `(() => {'), observer.indexOf('export function isSnippetAwaitingInput'))
    const innerTextUses = script.split('innerText').filter((_, i) => i > 0).length
    // One permitted fallback remains, for an error banner whose textContent may be empty.
    expect(innerTextUses).toBe(1)
    expect(script).toContain("(assistantEl.textContent || '').trim()")
  })

  it('does nothing at all for a tab nobody is looking at', () => {
    expect(observer).toContain('function syncObservation()')
    expect(observer).toContain("if (document.visibilityState === 'hidden') {\n            observer.disconnect();")
    expect(observer).toContain("document.addEventListener('visibilitychange', syncObservation);")
    expect(observer).toContain("if (document.visibilityState === 'hidden') return;")
  })
})

describe('the title readers do not flush layout every few seconds', () => {
  it('reads textContent first in both injected readers and in the active-view reader', () => {
    expect(main).toContain("const candidate = (el.textContent || '').trim() || (el.innerText || '').trim();")
    expect(readFileSync(join(__dirname, 'activeTitleSync.ts'), 'utf8')).toContain(
      "const txt = (el.textContent || '').trim() || (el.innerText || '').trim();"
    )
  })

  it('polls titles at a rate a title can actually change at', () => {
    // Two injected pollers and one active-view timer, all defaulting to 3 s / 2.5 s rather than 1.5 s / 1 s.
    expect(main).not.toContain('        : 1500')
    expect(main).toContain('        : 3000')
    expect(main).toContain('  intervalMs: 2500,')
  })
})

describe('the shell stops animating when nobody is interacting', () => {
  it('sets an activity attribute after fifteen seconds without input', () => {
    expect(app).toContain('const IDLE_AFTER_MS = 15000')
    expect(app).toContain("document.documentElement.dataset.activity = idle ? 'idle' : 'active'")
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'focus']) {
      expect(app, event).toContain(`'${event}'`)
    }
  })

  it('pauses every animation under that attribute, alongside the build-50 blur gate', () => {
    expect(css).toContain("html[data-activity='idle'] *,")
    expect(css).toContain('animation-play-state: paused !important;')
    expect(css).toContain("html[data-window-focus='blurred'] *,")
  })
})

describe('the next report can prove it', () => {
  it('records how many shell animations are running when the report is taken', () => {
    const capture = main.slice(main.indexOf("ipcMain.handle('capture_diagnostics'"), main.indexOf("ipcMain.handle('capture_diagnostics'") + 5000)
    expect(capture).toContain('shellActivity')
    expect(capture).toContain('document.getAnimations()')
    expect(capture).toContain("a.playState === \"playing\"")
    expect(capture).toContain('      shellActivity,')
  })
})
