// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import VerticalTabs from './VerticalTabs'
import type { Tab } from '../lib/tabs'

/**
 * Build 47 — a tab can be right-clicked for everything, not just pin.
 *
 * Before this, `onContextMenu` toggled pin and offered nothing else: no reload without activating the
 * tab, no way to copy the address or the title, no way to hoist a tab to the top of its section, and no
 * "close others"/"close below". The menu is asserted here through the DOM the user actually clicks.
 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tabs: Tab[] = [
  { id: 'tab-1', title: 'First', model: 'gemini', url: 'https://a.example/1', createdAt: 1, updatedAt: 1 },
  { id: 'tab-2', title: 'Second', model: 'claude', url: 'https://a.example/2', createdAt: 2, updatedAt: 2 },
  { id: 'tab-3', title: 'Third', model: 'gemini', url: 'https://a.example/3', createdAt: 3, updatedAt: 3 }
]

describe('the tab menu — build 47', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let send: ReturnType<typeof vi.fn>
  let closeTab: ReturnType<typeof vi.fn<(id: string) => void>>
  let pinTab: ReturnType<typeof vi.fn<(id: string) => void>>
  let reorder: ReturnType<typeof vi.fn<(sourceId: string, targetId: string) => void>>

  const open = async (tabId: string): Promise<HTMLElement> => {
    const row = container.querySelector(`[data-vertical-tab-id="${tabId}"]`) as HTMLElement
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 140 })
      )
    })
    const menu = container.querySelector('[data-testid="tab-context-menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    return menu
  }

  const click = async (menu: HTMLElement, action: string): Promise<void> => {
    const item = menu.querySelector(`[data-menu-action="${action}"]`) as HTMLButtonElement
    expect(item, `menu item ${action}`).toBeTruthy()
    await act(async () => {
      item.click()
    })
  }

  beforeEach(() => {
    send = vi.fn()
    closeTab = vi.fn<(id: string) => void>()
    pinTab = vi.fn<(id: string) => void>()
    reorder = vi.fn<(sourceId: string, targetId: string) => void>()
    ;(window as unknown as { electron: unknown }).electron = { ipcRenderer: { send } }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <VerticalTabs
          tabs={tabs}
          activeId="tab-1"
          pinnedIds={['tab-3']}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={closeTab}
          onTogglePin={pinTab}
          onReorder={reorder}
        />
      )
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    delete (window as unknown as { electron?: unknown }).electron
  })

  it('offers the whole set of actions for a tab', async () => {
    const menu = await open('tab-2')
    for (const action of [
      'pin',
      'reload',
      'copy-url',
      'copy-title',
      'move-top',
      'close',
      'close-others',
      'close-below'
    ]) {
      expect(menu.querySelector(`[data-menu-action="${action}"]`), action).toBeTruthy()
    }
  })

  it('shows unpin for a pinned tab', async () => {
    const menu = await open('tab-3')
    expect(menu.querySelector('[data-menu-action="unpin"]')).toBeTruthy()
    expect(menu.querySelector('[data-menu-action="pin"]')).toBeFalsy()
  })

  it('reloads a background tab through main, without activating it', async () => {
    const menu = await open('tab-2')
    await click(menu, 'reload')
    expect(send).toHaveBeenCalledWith('reload_tab', 'tab-2')
  })

  it('pins, closes and reorders through the callbacks it was given', async () => {
    let menu = await open('tab-2')
    await click(menu, 'pin')
    expect(pinTab).toHaveBeenCalledWith('tab-2')

    menu = await open('tab-2')
    await click(menu, 'close')
    expect(closeTab).toHaveBeenCalledWith('tab-2')

    menu = await open('tab-2')
    await click(menu, 'move-top')
    // tab-2 is the second Active Session, so it is hoisted above tab-1.
    expect(reorder).toHaveBeenCalledWith('tab-2', 'tab-1')
  })

  it('closes the other tabs, or only the ones below, on request', async () => {
    let menu = await open('tab-2')
    await click(menu, 'close-others')
    // tab-3 is pinned, so it is not closed with the rest.
    expect(closeTab).toHaveBeenCalledTimes(1)
    expect(closeTab).toHaveBeenCalledWith('tab-1')

    closeTab.mockClear()
    // tab-3 is pinned and paints above the sessions, so "below" tab-1 is only tab-2.
    menu = await open('tab-1')
    await click(menu, 'close-below')
    expect(closeTab).toHaveBeenCalledTimes(1)
    expect(closeTab).toHaveBeenCalledWith('tab-2')
  })

  it('closes on Escape and on a click anywhere else', async () => {
    await open('tab-2')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="tab-context-menu"]')).toBeFalsy()

    await open('tab-2')
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="tab-context-menu"]')).toBeFalsy()
  })
})
