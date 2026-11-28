// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import VerticalTabs from './VerticalTabs'
import NewTabOverlay from './NewTabOverlay'
import type { Tab } from '../lib/tabs'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const tabs: Tab[] = [
  {
    id: 'tab-1',
    title: 'Vibe Work',
    model: 'gemini',
    url: 'https://gemini.google.com/chat/1',
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'tab-2',
    title: 'New Chat',
    model: 'mine',
    url: 'https://example.invalid/chat',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
]

/** A provider with a colour of its own, which is the case that used to fall back to grey. */
const models = [
  { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#123456' },
  { key: 'mine', label: 'Mine', url: 'https://example.invalid', color: '#ff8800' }
]

let container: HTMLDivElement
let root: any

// jsdom has no layout, so the list's "scroll the selected row into view" has nothing to call.
beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rowOf = (id: string) => container.querySelector(`[data-vertical-tab-id="${id}"]`) as HTMLElement

async function renderTabs(activeId: string, modelColors?: Record<string, string>) {
  await act(async () => {
    root.render(
      <VerticalTabs
        tabs={tabs}
        activeId={activeId}
        sidebarCollapsed={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTogglePin={vi.fn()}
        modelColors={modelColors}
      />
    )
  })
}

async function renderNewTab() {
  await act(async () => {
    root.render(
      <NewTabOverlay
        models={models}
        usageCounts={{}}
        history={[]}
        onOpenNew={vi.fn()}
        onOpenHistory={vi.fn()}
        onDeleteHistory={vi.fn()}
        onClose={vi.fn()}
      />
    )
  })
}

describe('a tab row carries its provider’s colour, selected or not', () => {
  it('paints the unselected row and hands the colour to the row, not just the icon', async () => {
    await renderTabs('tab-1', { mine: '#ff8800' })
    const other = rowOf('tab-2')
    expect(other.classList.contains('vertical-tab-provider')).toBe(true)
    // The colour has to live on the row itself: the row's background, border and number badge are all
    // derived from it in VerticalTabs.css.
    expect(other.style.getPropertyValue('--provider-color')).toBe('#ff8800')
    expect(other.style.getPropertyValue('--provider-gradient-start')).toBe('#ff8800')
  })

  it('uses the colour configured for the provider, and different tabs get different colours', async () => {
    await renderTabs('tab-1', { mine: '#00ff88' })
    expect(rowOf('tab-2').style.getPropertyValue('--provider-color')).toBe('#00ff88')
    expect(rowOf('tab-2').style.getPropertyValue('--provider-color')).not.toBe(
      rowOf('tab-1').style.getPropertyValue('--provider-color')
    )
  })

  it('keeps the arc-reactor on the selected row and does not double-paint it', async () => {
    await renderTabs('tab-1')
    const active = rowOf('tab-1')
    expect(active.classList.contains('vertical-tab-arc-reactor')).toBe(true)
    expect(active.classList.contains('vertical-tab-provider')).toBe(false)
    expect(active.style.getPropertyValue('--provider-color')).toBeTruthy()
  })

  it('keeps a sleeping row tinted as well', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={tabs}
          activeId="tab-1"
          discardedTabIds={['tab-2']}
          modelColors={{ mine: '#ff8800' }}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    const sleeping = rowOf('tab-2')
    expect(sleeping.classList.contains('vertical-tab-sleeping')).toBe(true)
    expect(sleeping.classList.contains('vertical-tab-provider')).toBe(true)
    expect(sleeping.style.getPropertyValue('--provider-color')).toBe('#ff8800')
  })

  it('the stylesheet actually defines the tint it promises', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(__dirname, 'VerticalTabs.css'), 'utf8')
    expect(css).toContain('.vertical-tab-provider {')
    expect(css).toContain('color-mix(in srgb, var(--provider-gradient-start')
    expect(css).toContain('.vertical-tab-provider:hover')
    expect(css).toContain('.vertical-tab-provider.vertical-tab-sleeping')
  })
})

describe('the new-tab provider list is coloured by the configured accent', () => {
  it('uses the provider’s own colour instead of a hardcoded brand colour', async () => {
    await renderNewTab()
    const gemini = container.querySelector('[data-provider-row="gemini"]') as HTMLElement
    // The old list painted Gemini `#4285F4` no matter what Settings said.
    expect(gemini.style.getPropertyValue('--provider-color')).toBe('#123456')
    const mine = container.querySelector('[data-provider-row="mine"]') as HTMLElement
    expect(mine.style.getPropertyValue('--provider-color')).toBe('#ff8800')
  })

  it('marks the selected row so the accent can be the loudest thing on screen', async () => {
    await renderNewTab()
    const gemini = container.querySelector('[data-provider-row="gemini"]') as HTMLElement
    expect(gemini.getAttribute('data-selected')).toBe('true')
    expect(gemini.className).toContain('newtab-provider')
    const mine = container.querySelector('[data-provider-row="mine"]') as HTMLElement
    expect(mine.getAttribute('data-selected')).toBe('false')
  })

  it('its stylesheet derives every state from that one variable', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(__dirname, 'NewTabOverlay.css'), 'utf8')
    expect(css).toContain('.newtab-provider {')
    expect(css).toContain(".newtab-provider[data-selected='true']")
    expect(css).toContain('border-left-color: var(--provider-color')
  })
})
