import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Build 48 — the four things this build is, wired end to end.
 *
 * The build-47 round shipped a menu whose every item was dead and a surface fix that did not fix the
 * surface. Both were failures of *wiring*, not of reasoning: the pieces existed and nothing joined them
 * up in the order a real press or a real frame takes. These assertions are about the joins — that the
 * main process has a handler for every channel the menu sends, that the pixel probe runs on both present
 * paths, and that the renderer does something with `tab_restarted` instead of dropping it.
 */
const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
const app = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8')
const tabs = readFileSync(resolve(__dirname, '../renderer/src/components/VerticalTabs.tsx'), 'utf8')
const menu = readFileSync(resolve(__dirname, '../renderer/src/components/TabContextMenu.tsx'), 'utf8')

describe('every channel the menu sends has a handler', () => {
  it('reload, restart and discard', () => {
    expect(main).toContain("ipcMain.on('reload_tab'")
    expect(main).toContain("ipcMain.on('restart_tab'")
    expect(main).toContain("ipcMain.on('discard_tab'")
    expect(tabs).toContain("send('reload_tab', t.id)")
    expect(tabs).toContain("send('restart_tab', t.id)")
    expect(tabs).toContain("send('discard_tab', t.id)")
  })

  it('the restart runs through the eviction path, not a second view lifecycle', () => {
    expect(main).toContain('tabDiscardManager.restartTab(tabId)')
    const handler = main.slice(main.indexOf("ipcMain.on('restart_tab'"), main.indexOf("ipcMain.on('discard_tab'"))
    expect(handler).toContain("sendToMainWindow('tab_restarted'")
  })

  it('the renderer re-activates a tab whose view was rebuilt', () => {
    expect(app).toContain("ipcRenderer.on('tab_restarted'")
    const listener = app.slice(app.indexOf('const handleTabRestarted'), app.indexOf('const unsubCycle'))
    expect(listener).toContain('switchToTabRef.current?.(tab.id, tab.url)')
  })

  it('the menu is dismissed by presses outside it, and only those', () => {
    // The build-47 bug in one line: the dismissal ran in the capture phase and closed the menu before
    // the button under the pointer could receive the press.
    const dismissal = menu.slice(menu.indexOf('const onPointerDown'), menu.indexOf('window.addEventListener'))
    expect(dismissal).toContain('ref.current.contains(target)')
    expect(dismissal).toContain('return')
    expect(menu).toContain("window.addEventListener('mousedown', onPointerDown, true)")
  })
})

describe('the pixels are actually looked at', () => {
  it('both present paths arm the probe', () => {
    const presented = main.slice(
      main.indexOf('function ensureActiveViewPresented'),
      main.indexOf('const repairDeferrals')
    )
    const repaintPath = presented.slice(0, presented.indexOf('// A flip:'))
    const flipPath = presented.slice(presented.indexOf('// A flip:'))
    expect(repaintPath).toContain('scheduleSurfaceProbe(')
    expect(flipPath).toContain('scheduleSurfaceProbe(')
  })

  it('a flat frame on a page with content rebuilds the view', () => {
    const probe = main.slice(
      main.indexOf('function probePaintedSurface'),
      main.indexOf('function scheduleSurfaceProbe')
    )
    expect(probe).toContain('judgeSurface(sample)')
    expect(probe).toContain("verdict !== 'blank-surface'")
    expect(probe).toContain('mayRestartSurface(')
    expect(probe).toContain('tabDiscardManager.restartTab(tabId)')
    // and it never runs while the app is showing a panel over the view
    expect(probe).toContain('overlaysOpen')
  })
})

describe('the tab is remembered, not the row', () => {
  it('pin, both colours and position are adopted by address', () => {
    expect(app).toContain('adoptTabMemory(tab, tabMemoryRef.current ?? {})')
    expect(app).toContain('applyRememberedPosition(nextTabs, tab.id, inherited.position)')
    const adoption = app.slice(app.indexOf('const inherited = adoptTabMemory'), app.indexOf('if (nextTabs !== tabs)'))
    expect(adoption).toContain('if (inherited.pinned) toPin.push(tab.id)')
  })

  it('what is open now is written back, and survives a restart', () => {
    expect(app).toContain('rememberTabs(current, tabs, pinnedIds)')
    expect(app).toContain('localStorage.setItem(TAB_MEMORY_STORAGE_KEY')
    expect(app).toContain('readTabMemory(localStorage.getItem(TAB_MEMORY_STORAGE_KEY))')
  })
})
