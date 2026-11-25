// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { ShortcutKeys } from './ShortcutKeys'
import { getShortcutKeys, setShortcutKeys } from '../lib/shortcuts'

/**
 * The keys printed on a button have to be the keys that work.
 *
 * Every tool in the sidebar footer used to keep its shortcut in a tooltip; the badge puts it on the
 * button. A badge that disagreed with the keymap would be worse than no badge at all, so these tests
 * pin the two together — including after a customization.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('ShortcutKeys', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  const render = (action: string): void => {
    act(() => {
      root.render(<ShortcutKeys action={action} />)
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('prints one chip per key of the action it names', () => {
    render('upload-folder')
    const chips = Array.from(container.querySelectorAll('kbd')).map((el) => el.textContent)
    expect(chips).toEqual(getShortcutKeys('upload-folder').map((key) => (key === 'Shift' ? '⇧' : key)))
    expect(container.querySelector('[data-shortcut-for="upload-folder"]')).toBeTruthy()
  })

  it('shows the keys the buttons in the footer actually use', () => {
    for (const [action, expected] of [
      ['upload-file', ['Ctrl', 'O']],
      ['upload-folder', ['Ctrl', '⇧', 'O']],
      ['skills-palette', ['Ctrl', 'S']],
      ['skills-base-modal', ['Ctrl', '⇧', 'S']],
      ['containers-picker', ['Ctrl', '.']],
      ['tab-colours', ['Ctrl', '⇧', 'C']],
      // Build 32: the two buttons that had no keys printed on them at all.
      ['tab-overview', ['Ctrl', '⇧', 'A']],
      ['history-open', ['Ctrl', 'H']],
      ['settings-open', ['Ctrl', ',']]
    ] as Array<[string, string[]]>) {
      render(action)
      const chips = Array.from(container.querySelectorAll('kbd')).map((el) => el.textContent)
      expect(chips, action).toEqual(expected)
    }
  })

  it('follows a customised shortcut instead of the default', () => {
    const original = getShortcutKeys('tab-colours')
    try {
      setShortcutKeys('tab-colours', ['Ctrl', 'Alt', 'K'])
      render('tab-colours')
      const chips = Array.from(container.querySelectorAll('kbd')).map((el) => el.textContent)
      expect(chips).toEqual(['Ctrl', 'Alt', 'K'])
    } finally {
      setShortcutKeys('tab-colours', original)
    }
  })

  it('takes the two-row layout class, so half-width buttons keep their label', () => {
    // The Folder and Base buttons showed "F" and "B": three chips plus a label cannot share ~100px.
    // `is-block` puts the keys under the label; the chips never shrink (App.css pins that).
    act(() => {
      root.render(<ShortcutKeys action="upload-folder" className="is-block" />)
    })
    const badge = container.querySelector('.shortcut-keys')
    expect(badge?.className).toContain('is-block')
    expect(container.querySelectorAll('kbd')).toHaveLength(getShortcutKeys('upload-folder').length)
  })

  it('renders nothing for an action with no keys', () => {
    render('not-a-real-action')
    expect(container.querySelector('kbd')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
