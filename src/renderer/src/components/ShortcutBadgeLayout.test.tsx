import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The badges have to stay legible at half width.
 *
 * Build 31 printed the keys on every footer button, and two of them came back unreadable: `Folder` and
 * `Base` showed "F" and "B", because a three-chip badge (Ctrl ⇧ O) and an 11px label cannot share the
 * ~100px inside a half-width button in the 2-up grid — the flex row shrank the label to its first letter.
 *
 * The fix is structural, so it is asserted structurally: every half-width button puts its keys on their
 * own row (`is-block`) with the label above them, the chips are told never to shrink, and the two buttons
 * that had no keys printed (History, Settings) now carry theirs. Reading the source is the only way to
 * cover this from jsdom, which has no layout engine and would happily render a chip 0px wide.
 */

const app = readFileSync(join(__dirname, '../App.tsx'), 'utf8')
const css = readFileSync(join(__dirname, '../App.css'), 'utf8')

/** The four quick actions that live two-per-row. */
const HALF_WIDTH: Array<[string, string]> = [
  ['Files', 'upload-file'],
  ['Folder', 'upload-folder'],
  ['Skills', 'skills-palette'],
  ['Base', 'skills-base-modal']
]

describe('key badges on half-width buttons', () => {
  it('gives every quick action its own row for the keys', () => {
    for (const [label, action] of HALF_WIDTH) {
      expect(app, label).toContain(`<ShortcutKeys action="${action}" className="is-block" />`)
    }
  })

  it('keeps the label and the icon on the first row, so the two do not compete with the keys', () => {
    // The label row is a nowrap flex line with the icon; the label may truncate, the badge may not.
    for (const [label] of HALF_WIDTH) {
      expect(app, label).toContain(`>${label}</span>`)
    }
    expect(app).toContain('items-stretch gap-1 cursor-pointer bg-(--surface2)')
  })

  it('never lets a chip shrink or wrap mid-word', () => {
    const chip = css.slice(css.indexOf('.shortcut-key {'))
    expect(chip).toContain('flex: 0 0 auto')
    expect(chip).toContain('min-width: max-content')
    expect(chip).toContain('white-space: nowrap')
    expect(css).toContain('.shortcut-keys.is-block')
    expect(css).toContain('margin-left: 0')
  })
})

describe('the buttons that had no shortcut printed on them', () => {
  it('badges Tabs, History and Settings', () => {
    expect(app).toContain('<ShortcutKeys action="tab-overview" className="is-block" />')
    expect(app).toContain('<ShortcutKeys action="history-open" className="is-block" />')
    expect(app).toContain('<ShortcutKeys action="settings-open" className="is-block" />')
  })

  it('names the keys in the tooltip too, from the same keymap as the badge', () => {
    expect(app).toContain("title={`History (${getShortcutKeys('history-open').join('+')})`}")
    expect(app).toContain("title={`Settings & Model Manager (${getShortcutKeys('settings-open').join('+')})`}")
    expect(app).toContain("title={`Tab Overview (${getShortcutKeys('tab-overview').join('+')})`}")
  })

  it('puts History and Settings in the same 1fr/1fr grid as everything else', () => {
    const nav = app.slice(app.indexOf('data-nav-tools="true"') - 200, app.indexOf('data-nav-tools="true"') + 200)
    expect(nav).toContain('grid grid-cols-2 gap-1.5')
  })
})

describe('build 34 — the footer rows the user asked for', () => {
  it('puts Tabs beside Agent Handoff instead of on its own full-width row', () => {
    // Both are one-press "open a panel" tools, and the horizontal title bar already pairs them.
    const row = app.slice(app.indexOf('data-agent-tabs="true"') - 300, app.indexOf('data-agent-tabs="true"') + 120)
    expect(row).toContain("sidebarCollapsed ? 'grid-cols-2' : 'grid-cols-[1.55fr_1fr]'")
    const tabsAt = app.indexOf('data-nav-tab-overview="sidebar-top"')
    expect(tabsAt).toBeGreaterThan(0)
    // The Export button is the block immediately above it, and it is the only one in that row.
    const beforeTabs = app.slice(app.indexOf('data-agent-tabs="true"'), tabsAt)
    expect(beforeTabs).toContain('Agent Handoff')
    expect(beforeTabs).toContain('showExport')
    // It is one button with one owner: the toggle lives in one callback now.
    expect(app).toContain('const toggleTabOverviewPanel = useCallback(')
    expect(app).not.toContain('col-span-2 bg-(--surface2) hover:bg-(--border) text-(--text) p-1.5')
  })

  it('gives Containers and Tab Colours the full row, inside the grid that was already there', () => {
    // Build 35: both take two button widths instead of one. They stay in the quick-action grid — no
    // row of their own, nothing else moves — they simply span its two columns.
    const quick = app.indexOf('data-quick-actions="true"')
    const nav = app.indexOf('data-nav-tools="true"')
    const grid = app.slice(quick, nav)
    expect(grid).toContain('containers-btn col-span-2 min-w-0')
    expect(grid).toContain('variant="half"')
    expect(grid).toContain('className="col-span-2"')
    expect(app).not.toContain('data-container-tools')
    // …and the four quick actions are still one cell each.
    expect(app).not.toContain("sidebarCollapsed ? 'col-span-2' : ''")
    const tile = readFileSync(join(__dirname, 'TabColorButton.tsx'), 'utf8')
    // The half-width variant stacks like its neighbours: label row, then the keys.
    expect(tile).toContain("variant?: 'tile' | 'half' | 'compact'")
    expect(tile).toContain('data-tab-color-button="half"')
    expect(tile).toContain('<ShortcutKeys action="tab-colours" className="is-block" />')
  })

  it('has one owner for the panel, and both footers use it — audit fix', () => {
    // The toggle existed twice (once per footer). A third entry point made that untenable, so it lives
    // in one callback and both buttons call it.
    expect(app.match(/const toggleTabOverviewPanel = useCallback\(/g) ?? []).toHaveLength(1)
    expect(app.match(/onClick=\{\(\) => void toggleTabOverviewPanel\(\)\}/g) ?? []).toHaveLength(2)
    expect(app).toContain('data-nav-tab-overview="sidebar-top"')
    expect(app).toContain('data-nav-tab-overview="titlebar"')
    // The mirror is written in the same tick as the decision, so two clicks cannot both "open".
    expect(app).toContain('showTabOverviewRef.current = nextState')
  })

  it('collapsed keeps the expanded arrangement, one size smaller', () => {
    // Collapsed is w-44 = 160px of content. The top row goes equal (a 1.55fr/1fr split leaves the Tabs
    // tile ~60px), but every tile keeps the shape it has when expanded: a label row that is now just
    // its icon, then the keys. No tile is a single full-width bar any more.
    expect(app).toContain("sidebarCollapsed ? 'grid-cols-2' : 'grid-cols-[1.55fr_1fr]'")
    expect(app).toContain('const tileLabelRow = `flex items-center gap-1.5 min-w-0${sidebarCollapsed ? \' justify-center\' : \'\'}`')
    // The keys live on every tile in both modes now, not only when expanded.
    // (tab-colours lives in TabColorButton, asserted in its own test below.)
    for (const action of ['upload-file', 'upload-folder', 'skills-palette', 'skills-base-modal', 'containers-picker', 'tab-overview', 'history-open', 'settings-open']) {
      expect(app).toContain(`<ShortcutKeys action="${action}" className="is-block" />`)
    }
    expect(app).not.toContain('{!sidebarCollapsed && <ShortcutKeys')
  })

  it('starts expanded — the v1 key is retired', () => {
    expect(app).toContain("localStorage.getItem('vicinae.sidebarCollapsed.v2') === 'true'")
    expect(app).toContain("localStorage.removeItem('vicinae.sidebarCollapsed')")
    expect(app).not.toContain("localStorage.getItem('vicinae.sidebarCollapsed') === 'true'")
  })

  it('keeps every half-width tile showing its keys on their own row', () => {
    // Containers and Tab Colours joined the half-width family, so they follow its rule.
    expect(app).toContain('<ShortcutKeys action="containers-picker" className="is-block" />')
    expect(app).toContain('<ShortcutKeys action="tab-overview" className="is-block" />')
  })
})
