import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Build 49 — the three things the build-48 report found.
 *
 *   "it remembers the location but it didn't remember the pinned [state] … & its location"
 *   "when closing & reopening with Ctrl+Shift+T the colours & aura aren't set correctly"
 *
 * Both come from the same two mistakes, and neither is visible from the outside:
 *
 *   1. Ctrl+Shift+T re-inserts the tab object it stored when the tab was closed — the *same id*. The
 *      "have I already adopted this tab?" set therefore said yes, and the reopened tab got neither its
 *      pin nor its re-adoption. A tab that leaves the list has to become a stranger again.
 *   2. Main keeps per-tab colours in memory beside the view and drops them with it, while the renderer
 *      believes it has already sent them for that id and sends nothing. So the rebuilt view opened in
 *      the app's default colours while its row kept its own.
 */
const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
const app = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8')
const memory = readFileSync(resolve(__dirname, '../renderer/src/lib/tabMemory.ts'), 'utf8')

describe('a closed tab is a stranger when it comes back', () => {
  it('drops the adoption set and the colour-send cache for tabs that are gone', () => {
    const prune = app.slice(
      app.indexOf('A tab that leaves the sidebar must be a stranger again'),
      app.indexOf('Keep the memory in step with the tabs that are open now')
    )
    expect(prune).toContain('memoryAdoptedRef.current.delete(id)')
    expect(prune).toContain('delete sentTabColorsRef.current[id]')
    expect(prune).toContain('const live = new Set(tabs.map((tab) => tab.id))')
  })

  it('restores the pin without a toggle that could unpin the tab it just brought back', () => {
    const reopen = app.slice(app.indexOf("case 'reopen_tab'"), app.indexOf("case 'close_tab'"))
    expect(reopen).not.toContain('togglePin(')
    expect(reopen).toContain('pinnedIdsRef.current')
    expect(reopen).toContain("invoke('save_pinned'")
  })
})

describe('a rebuilt view is told what it should look like', () => {
  it('main asks, every time it builds one', () => {
    const creation = main.slice(main.indexOf('function ensureAiView'), main.indexOf('view.webContents.setMaxListeners'))
    const born = main.slice(main.indexOf('view.webContents.setMaxListeners'), main.indexOf('// Own the navigation surface'))
    expect(creation).toContain('new WebContentsView(')
    expect(born).toContain("sendToMainWindow('request_tab_colors', tabId)")
  })

  it('the renderer answers with that tab’s own colours', () => {
    expect(app).toContain("ipcRenderer.on('request_tab_colors'")
    const handler = app.slice(
      app.indexOf('const handleRequestTabColors'),
      app.indexOf('const unsubColors')
    )
    expect(handler).toContain('sanitiseTabColors(tab ?? {})')
    expect(handler).toContain("send('set_tab_colors', tabId")
  })
})

describe('the pinned section has a place of its own', () => {
  it('is recorded and restored', () => {
    expect(memory).toContain('pinnedPosition')
    expect(memory).toContain('export function applyRememberedPinnedPosition')
    expect(app).toContain('applyRememberedPinnedPosition(')
  })
})
