import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Build 50 — where the CPU goes, and the three places it was being spent for nothing.
 *
 * The report was "nexus uses huge cpu usage", with a screenshot showing one electron process at 6.6%
 * and the machine at 106%. There is no honest way to *fix* that by guessing, so this build does two
 * things: it makes the next diagnostics able to name the offending process (the build-49 report had
 * `cpuPercent: 0` on all ten, because Electron does not measure CPU on Linux), and it removes the work
 * that was certain to be running for no reason:
 *
 *   1. four off-screen AI pages painting at full frame rate, because a hidden `WebContentsView` is not
 *      a hidden page and every page still believed it was on screen;
 *   2. the sidebar's endless decorative loops, kept at 60 fps for a window behind an editor;
 *   3. a GPU frame read-back on every tab switch, to confirm that healthy pages were healthy.
 */
const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
const app = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../renderer/src/App.css'), 'utf8')
const diagnostics = readFileSync(resolve(__dirname, 'diagnosticsManager.ts'), 'utf8')

describe('off-screen pages stop painting', () => {
  it('budgets frames from the one place visibility is recorded', () => {
    const mark = main.slice(main.indexOf('function markViewVisibility'), main.indexOf('function viewWasHidden'))
    expect(mark).toContain('scheduleFrameBudgets()')
  })

  it('gives the visible tab 60 and everything else 1', () => {
    const budgets = main.slice(main.indexOf('function applyFrameBudgets'), main.indexOf('function scheduleFrameBudgets'))
    expect(budgets).toContain('VIEW_FRAME_RATE_ACTIVE')
    expect(budgets).toContain('VIEW_FRAME_RATE_BACKGROUND')
    expect(budgets).toContain('setFrameRate?.(target)')
    // and only the tab that is on screen and not covered gets the active rate
    expect(budgets).toContain('tabId === activeViewId && activeViewVisible && !overlaysOpen')
  })

  it('coalesces the five calls that arrive in one tick into one pass', () => {
    const schedule = main.slice(
      main.indexOf('function scheduleFrameBudgets'),
      main.indexOf('function scheduleFrameBudgets') + 400
    )
    expect(schedule).toContain('if (frameBudgetTimer) return')
  })

  it('re-budgets when the window is hidden, minimised, restored or shown', () => {
    // The window-level handlers call suspendAllViews / resumeActiveView; each of those pairs is what
    // also has to re-budget, because a hidden or minimised window has no frames worth producing.
    for (const call of ['suspendAllViews()', 'resumeActiveView()']) {
      const at = main.indexOf(`    ${call}\n    scheduleFrameBudgets()`)
      expect(at, call).toBeGreaterThan(-1)
    }
    expect(main).toContain("mainWindow.on('hide', () => {")
    expect(main).toContain("mainWindow.on('minimize', () => {")
    expect(main).toContain("mainWindow.on('restore', () => {")
    expect(main).toContain("mainWindow.on('show', () => {")
  })
})

describe('decorative loops stop when the window is in the background', () => {
  it('the stylesheet pauses animations, not just hides them', () => {
    expect(css).toContain("html[data-window-focus='blurred'] *")
    const rule = css.slice(css.indexOf("html[data-window-focus='blurred'] *"))
    expect(rule).toContain('animation-play-state: paused !important')
  })

  it('the renderer sets the attribute from both focus signals', () => {
    const effect = app.slice(
      app.indexOf('Tell the stylesheet whether this window is in the foreground'),
      app.indexOf('const tabMemoryRef')
    )
    expect(effect).toContain("document.documentElement.dataset.windowFocus")
    expect(effect).toContain("window.addEventListener('blur'")
    expect(effect).toContain("'window-focus-changed'")
    expect(effect).toContain('ipcRenderer?.on(')
  })
})

describe('the pixel probe stops costing a read-back per switch', () => {
  it('on the cheap path, only a tab that has been blank before is probed', () => {
    const presented = main.slice(main.indexOf('function ensureActiveViewPresented'), main.indexOf('const repairDeferrals'))
    const repaintPath = presented.slice(0, presented.indexOf('// A flip:'))
    expect(repaintPath).toContain('if (surfaceSuspects.has(tabId))')
    expect(repaintPath).toContain('scheduleSurfaceProbe(')
  })

  it('never reads a frame back for a window nobody can see', () => {
    const probe = main.slice(main.indexOf('function probePaintedSurface'), main.indexOf('function scheduleSurfaceProbe'))
    expect(probe).toContain('mainWindow.isVisible()')
    expect(probe).toContain('mainWindow.isMinimized()')
  })

  it('and a blank verdict is what makes a tab worth watching', () => {
    const probe = main.slice(main.indexOf('function probePaintedSurface'), main.indexOf('function scheduleSurfaceProbe'))
    expect(probe).toContain('surfaceSuspects.add(tabId)')
  })
})

describe('the diagnostics can name the process', () => {
  it('measures CPU itself on Linux instead of trusting a zero', () => {
    expect(diagnostics).toContain("process.platform === 'linux'")
    expect(diagnostics).toContain('takeProcSamples(')
    expect(diagnostics).toContain('completeProcSamples(')
    expect(diagnostics).toContain('measured?.get(m.pid)')
  })
})
