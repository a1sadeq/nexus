// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import UrlBarModal, { coerceSearchSelectionToUrl, isUrlLikeInput, normalizeInputUrl } from './UrlBarModal'
import type { ModelDef } from '../App'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no layout, so scrollIntoView is missing; the list calls it to keep the highlighted row
// in view.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

const models: ModelDef[] = [
  { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app', color: '#4285f4' },
  { key: 'claude', label: 'Claude', url: 'https://claude.ai/new', color: '#d97757' },
  { key: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10a37f' }
]

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('UrlBarModal omnibox targeting', () => {
  let container: HTMLDivElement
  let root: any
  let onNavigate: Mock<(url: string, detectedModel?: string, inNewTab?: boolean) => void>
  let onClose: Mock<() => void>

  const mount = async (currentUrl = 'https://arena.ai/agent/') => {
    await act(async () => {
      root.render(
        <UrlBarModal
          isOpen
          currentUrl={currentUrl}
          currentModel="gemini"
          models={models}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      )
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onNavigate = vi.fn()
    onClose = vi.fn()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const rowFor = (text: string): HTMLElement | undefined =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-index]')).find((row) =>
      (row.textContent || '').includes(text)
    )

  const pressEnter = (input: HTMLInputElement) =>
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

  it('Enter on a typed URL navigates to the URL, not to a search engine', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'arena.ai/agent/')
    pressEnter(input)
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0][0]).toBe('https://arena.ai/agent/')
  })

  it('an unregistered provider URL keeps its URL (no model, still navigable)', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'https://arena.ai/agent/abc-123')
    pressEnter(input)
    expect(onNavigate.mock.calls[0][0]).toBe('https://arena.ai/agent/abc-123')
    expect(onNavigate.mock.calls[0][1]).toBeUndefined()
  })

  it('a resting pointer does not take the highlight: only a real move does', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'claude.ai')

    const claudeRow = rowFor('Claude')
    expect(claudeRow).toBeTruthy()
    // The row appearing under a motionless cursor fires `mouseenter` when the list re-renders —
    // that must not change what Enter picks.
    act(() => {
      claudeRow!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      claudeRow!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    pressEnter(input)
    expect(onNavigate.mock.calls[0][0]).toBe('https://claude.ai')

    // A real pointer movement still selects the row under the cursor (the provider entry).
    act(() => {
      claudeRow!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })
    pressEnter(input)
    expect(onNavigate.mock.calls[1][0]).toBe('https://claude.ai/new')
  })

  it('a URL update from the page does not wipe what the user typed', async () => {
    // The tab reports its own URL on every navigation, and the bar re-rendered with it. The field was
    // re-seeded from that URL mid-typing, so Enter submitted the tab's existing URL — which is why
    // Ctrl+L felt like it "just returned to the same AI view".
    await mount('https://arena.ai/agent/old-chat')
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'claude.ai/new')

    await act(async () => {
      root.render(
        <UrlBarModal
          isOpen
          currentUrl="https://arena.ai/agent/something-else"
          currentModel="gemini"
          models={models}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      )
    })

    expect(input.value).toBe('claude.ai/new')
    pressEnter(input)
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0][0]).toBe('https://claude.ai/new')
  })

  it('re-seeds the field from the tab URL when it is reopened', async () => {
    await mount('https://arena.ai/agent/old-chat')
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('https://arena.ai/agent/old-chat')
    typeInto(input, 'something else')

    // close
    await act(async () => {
      root.render(
        <UrlBarModal
          isOpen={false}
          currentUrl="https://arena.ai/agent/old-chat"
          currentModel="gemini"
          models={models}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      )
    })
    // reopen on a new URL
    await act(async () => {
      root.render(
        <UrlBarModal
          isOpen
          currentUrl="https://claude.ai/chat/42"
          currentModel="gemini"
          models={models}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      )
    })
    // The modal returns null while closed, so reopening mounts a fresh input element.
    const reopened = container.querySelector('input') as HTMLInputElement
    expect(reopened.value).toBe('https://claude.ai/chat/42')
  })

  it('offers a provider from a partial name, above the search rows', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'cl')
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-index]'))
    expect(rows[0].textContent).toContain('Claude')
    const claudeIndex = rows.findIndex((row) => (row.textContent || '').includes('Claude'))
    const googleIndex = rows.findIndex((row) => (row.textContent || '').includes('Search Google'))
    expect(claudeIndex).toBeGreaterThanOrEqual(0)
    expect(claudeIndex).toBeLessThan(googleIndex)
  })

  it('finds a provider through an alias without typing its name', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'gpt')
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-index]'))
    expect(rows[0].textContent).toContain('ChatGPT')
    pressEnter(input)
    expect(onNavigate.mock.calls[0][0]).toBe('https://chatgpt.com/')
  })

  it('still puts the search engines first for a question', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'how do i fix this')
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-index]'))
    expect(rows[0].textContent).toContain('Search')
  })

  it('choosing "Search Google" for a URL anyway still opens the URL', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'arena.ai/agent/')
    const googleRow = rowFor('Search Google')!
    act(() => {
      googleRow.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      googleRow.click()
    })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0][0]).toBe('https://arena.ai/agent/')
  })

  it('a real search query still searches Google when that row is chosen', async () => {
    await mount()
    const input = container.querySelector('input') as HTMLInputElement
    typeInto(input, 'nexus electron app')
    const googleRow = rowFor('Search Google')!
    act(() => {
      googleRow.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      googleRow.click()
    })
    expect(onNavigate.mock.calls[0][0]).toContain('google.com/search?q=nexus%20electron%20app')
  })
})

describe('isUrlLikeInput', () => {
  it('accepts real URLs and bare hosts', () => {
    expect(isUrlLikeInput('https://arena.ai/agent/')).toBe(true)
    expect(isUrlLikeInput('arena.ai/agent/')).toBe(true)
    expect(isUrlLikeInput('arena.ai')).toBe(true)
    expect(isUrlLikeInput('example.com:8080/x')).toBe(true)
    expect(isUrlLikeInput('localhost:3000')).toBe(true)
  })

  it('rejects questions', () => {
    expect(isUrlLikeInput('what is arena ai')).toBe(false)
    expect(isUrlLikeInput('arena')).toBe(false)
    expect(isUrlLikeInput('')).toBe(false)
    expect(isUrlLikeInput('   ')).toBe(false)
  })
})

describe('coerceSearchSelectionToUrl', () => {
  const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

  it('returns the URL when the search was for that exact URL', () => {
    expect(coerceSearchSelectionToUrl('arena.ai/agent/', google('arena.ai/agent/'))).toBe(
      'https://arena.ai/agent/'
    )
    expect(
      coerceSearchSelectionToUrl(
        'https://arena.ai/agent/',
        `https://www.perplexity.ai/search?q=${encodeURIComponent('https://arena.ai/agent/')}`
      )
    ).toBe('https://arena.ai/agent/')
  })

  it('leaves a different query alone', () => {
    expect(coerceSearchSelectionToUrl('arena.ai/agent/', google('something else'))).toBeNull()
  })

  it('leaves non-URL input alone', () => {
    expect(coerceSearchSelectionToUrl('nexus electron', google('nexus electron'))).toBeNull()
  })

  it('ignores provider and command rows', () => {
    expect(coerceSearchSelectionToUrl('arena.ai/agent/', 'https://claude.ai/new')).toBeNull()
    expect(coerceSearchSelectionToUrl('arena.ai/agent/', '')).toBeNull()
  })

  it('keeps normalizeInputUrl behaviour unchanged for plain queries', () => {
    expect(normalizeInputUrl('hello world').url).toContain('perplexity.ai/search?q=hello%20world')
    expect(normalizeInputUrl('arena.ai/agent/').url).toBe('https://arena.ai/agent/')
  })
})
