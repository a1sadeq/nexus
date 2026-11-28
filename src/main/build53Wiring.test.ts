import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Build 53 — the wiring that makes the next report self-explaining.
 *
 * The user's report named two symptoms and one request: a blank view that survived closing and reopening
 * its tab, a thin cyan band at the top of the sidebar's right edge, and "if we update our logs functions
 * for detecting the main root cause do it". Two symptoms, and the honest position at the time was that
 * neither could be identified from outside the app. So this build spends most of its budget on making the
 * app able to say what happened, and repairs the two mechanisms that can actually produce the symptoms:
 *
 *   1. per-tab surface state that outlived the view it described (so a fresh document started life already
 *      condemned, and the same tab kept failing after it was reopened);
 *   2. a scrollbar on the tab rail, which is what the "cyan band" was.
 *
 * The behavioural halves are covered elsewhere — `build53DarkFrame.test.ts` and `viewForensics.test.ts` for
 * the grading and the colour maths, `surfacePixels.test.ts` for the budget. This file pins the wiring in
 * `index.ts` and the shell, because neither process can be started in a test runner.
 */

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const pixels = readFileSync(join(__dirname, 'surfacePixels.ts'), 'utf8')
const verticalTabs = readFileSync(join(__dirname, '../renderer/src/components/VerticalTabs.tsx'), 'utf8')
const appCss = readFileSync(join(__dirname, '../renderer/src/App.css'), 'utf8')

/** The body of a top-level function, by name, from its declaration to the next blank-line-separated one. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) return ''
  const next = source.indexOf('\nfunction ', start + 10)
  return source.slice(start, next > start ? next : source.length)
}

describe('1. nothing learned about a view outlives the view', () => {
  it('clears the surface state in one place, and only that place', () => {
    const body = functionBody(main, 'resetSurfaceForensics')
    expect(body).toContain('viewForensics.delete(tabId)')
    expect(body).toContain('surfaceRestartBudget.delete(tabId)')
    expect(body).toContain('surfaceSuspects.delete(tabId)')
    expect(body).toContain('lastSurfaceProbe.delete(tabId)')
    expect(body).toContain('textColourRepairs.delete(tabId)')
  })

  it('runs it when a view is created', () => {
    const create = main.slice(main.indexOf('const viewGen = bumpTabViewGeneration(tabId)'))
    expect(create.indexOf("resetSurfaceForensics(tabId, 'new view')")).toBeGreaterThan(-1)
    expect(create.indexOf("resetSurfaceForensics(tabId, 'new view')")).toBeLessThan(400)
  })

  it('runs it when a view is torn down', () => {
    const teardown = main.slice(main.indexOf('onTeardown: async (tabId, view, contents) =>'))
    expect(teardown.slice(0, 600)).toContain("resetSurfaceForensics(tabId, 'teardown')")
  })

  it('says why a tab was forgiven, in the trace', () => {
    // The complaint was that the app never explained itself; a reset that happens silently is the same bug.
    const body = functionBody(main, 'resetSurfaceForensics')
    expect(body).toContain('surface state reset — the view this was about is gone')
    expect(body).toContain('budget:')
  })

  it('still keeps the hard cap that stops a rebuild loop', () => {
    // Forgiveness is per view, not per page: within one document the budget is unchanged.
    expect(pixels).toContain('MAX_AUTOMATIC_RESTARTS_PER_TAB')
    expect(pixels).toContain('already rebuilt ${budget.count} times this run')
  })
})

describe('2. the frame is graded for readability, not only for emptiness', () => {
  it('measures the frame it already captured', () => {
    expect(main).toContain('measureBitmap(bitmap, size.width, size.height)')
    expect(main).toContain('meanLuminance: sample.meanLuminance ?? null')
  })

  it('asks the page instead of guessing, when the frame is dark', () => {
    const dark = main.slice(main.indexOf("if (verdict === 'dark-surface')"))
    expect(dark.slice(0, 400)).toContain('captureViewAppearance(tabId, view)')
    expect(dark.slice(0, 1400)).toContain('judgeReadability(appearance)')
  })

  it('repairs the text, and never the view, on an unreadable page', () => {
    const repair = functionBody(main, 'repairUnreadableColours')
    expect(repair).toContain('textColourRepairs.set(tabId')
    expect(repair).toContain('applyWebviewTheme(view)')
    // No eviction, no reload, no new document: this is a stylesheet swap.
    expect(repair).not.toContain('restartTab')
    expect(repair).not.toContain('reload(')
    expect(repair).not.toContain('loadURL(')
    expect(repair).not.toContain('destroy()')
  })

  it('refuses to repair a page that did not report a background', () => {
    const repair = functionBody(main, 'repairUnreadableColours')
    expect(repair).toContain('bg === null')
    expect(repair).toContain('the page reported no background to contrast against')
  })

  it('gives the tab a minute before repairing it again', () => {
    expect(main).toContain('TEXT_REPAIR_COOLDOWN_MS')
    expect(functionBody(main, 'repairUnreadableColours')).toContain('TEXT_REPAIR_COOLDOWN_MS')
  })

  it('puts the repair into the stylesheet for that view only', () => {
    const css = functionBody(main, 'computeThemeCss')
    expect(css).toContain('textColourRepairs.get(tabId)')
    expect(css).toContain('text: repair.text')
    expect(css).toContain('text2: repair.text2')
  })

  it('does not restart a view because its page is dark', () => {
    // The dark path returns before the rebuild branch; a readable-looking black page is not a lost surface.
    const probe = functionBody(main, 'probePaintedSurface')
    const darkReturn = probe.indexOf("if (verdict === 'dark-surface')")
    const rebuild = probe.indexOf('mayRestartSurface')
    expect(darkReturn).toBeGreaterThan(-1)
    expect(darkReturn).toBeLessThan(rebuild)
    expect(probe.slice(darkReturn, rebuild)).toContain('return')
  })

  it('still restarts only through the existing budgeted path', () => {
    const probe = functionBody(main, 'probePaintedSurface')
    expect(probe).toContain('tabDiscardManager.restartTab(tabId)')
    expect(probe).toContain('if (verdict !== \'blank-surface\') return')
  })
})

describe('3. the report names the root cause', () => {
  it('carries a per-view forensics block', () => {
    expect(main).toContain('viewForensics: {')
    for (const key of [
      'verdict:',
      'verdictReason:',
      'verdictAgoMs:',
      'meanLuminance:',
      'darkFraction:',
      'badFrames:',
      'rebuilds:',
      'rebuildBudget:',
      'stylesheet:',
      'textRepair:',
	      'appearance:'
    ]) {
      expect(main).toContain(key)
    }
  })

  it('explains what each verdict means, in the report itself', () => {
    expect(main).toContain('dark-surface = a frame with content that is nearly black')
    expect(main).toContain('blank-surface = content in the page and nothing in the frame')
  })

  it('stops `presentedVisible` being read as six blank tabs', () => {
    expect(main).toContain('presentedVisibleNote:')
    expect(main).toContain('not "blank"')
  })

  it('quotes the page it asked, not the app’s belief about the page', () => {
    const capture = functionBody(main, 'captureViewAppearance')
    expect(capture).toContain('buildAppearanceScript()')
    expect(capture).toContain('parseAppearance(raw)')
    // A page that will not answer must not wedge the probe.
    expect(capture).toContain('APPEARANCE_SCRIPT_TIMEOUT_MS')
  })

  it('hit-tests the sidebar edge so the next cyan band has a name', () => {
    expect(main).toContain('sidebarEdge')
    expect(main).toContain('elementFromPoint')
    expect(main).toContain("document.querySelector('[data-guide=\"tabs\"]')")
    expect(main).toContain('scrollbarPx: Math.max(0, el.offsetWidth - el.clientWidth)')
  })

  it('records which stylesheet went onto which view', () => {
    expect(main).toContain("traceViewOp(id, 'theme — stylesheet applied'")
    expect(main).toContain('themeAccentFingerprint(id)')
  })
})

describe('4. the cyan band at the top of the rail', () => {
  it('is the rail’s own scrollbar, and the rail no longer draws one', () => {
    expect(verticalTabs).toContain('tab-rail-scroller')
    expect(appCss).toContain('.tab-rail-scroller::-webkit-scrollbar')
    expect(appCss).toContain('scrollbar-width: none')
  })

  it('keeps the rail scrollable — only the furniture goes', () => {
    const className = verticalTabs.slice(
      verticalTabs.indexOf('tab-rail-scroller'),
      verticalTabs.indexOf('tab-rail-scroller') + 200
    )
    expect(className).toContain('overflow-y-auto')
  })

  it('does not strip scrollbars app-wide', () => {
    // The global 5 px scrollbar is a setting the user asked for elsewhere; this is the rail, not everything.
    expect(appCss).toContain('*::-webkit-scrollbar,')
  })
})
