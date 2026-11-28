// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ProviderIcon from './ProviderIcon'
import TabProviderMark from './TabProviderMark'

/**
 * Build 43: the icon a tab row draws.
 *
 * The row has four possible marks, in order: the SVG configured in Settings → AI Providers, the
 * provider's brand path, the provider's initial, then the neutral ring. A provider added by hand has
 * neither of the first two, so before this build every custom provider fell straight to the neutral
 * ring — the "sparkle" — and a list of custom tabs showed the same mark for all of them.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: React.ReactElement): HTMLElement {
  act(() => root.render(node))
  return container
}

describe('ProviderIcon — which mark a tab row draws', () => {
  it('draws the configured SVG when the provider has one', () => {
    const el = render(
      <ProviderIcon
        modelKey="my-proxy"
        customSvg={'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>'}
        color="#f97316"
        fallbackLabel="My Proxy"
      />
    )
    expect(el.querySelector('[data-provider-icon="custom"]')).not.toBeNull()
    expect(el.querySelector('circle')).not.toBeNull()
    // The configured markup wins over both the initial and the neutral ring.
    expect(el.querySelector('[data-provider-icon="initial"]')).toBeNull()
    expect(el.querySelector('[data-tab-provider-mark]')).toBeNull()
  })

  it('draws the brand icon for a provider the app ships a path for', () => {
    const el = render(<ProviderIcon modelKey="gemini" color="#22d3ee" fallbackLabel="Gemini" />)
    expect(el.querySelector('[data-provider-icon="brand"]')).not.toBeNull()
    expect(el.querySelector('[data-provider-icon="initial"]')).toBeNull()
    expect(el.querySelector('[data-tab-provider-mark]')).toBeNull()
  })

  it('draws the provider\u2019s own initial for a hand-added provider, not the shared ring', () => {
    const el = render(<ProviderIcon modelKey="my-proxy" color="#f97316" fallbackLabel="My Proxy" />)
    const initial = el.querySelector('[data-provider-icon="initial"]')
    expect(initial).not.toBeNull()
    expect(initial?.textContent).toBe('M')
    // Colour comes from the provider, so two custom providers are not the same blue mark.
    expect((initial as HTMLElement).style.color).toBe('rgb(249, 115, 22)')
    expect(el.querySelector('[data-tab-provider-mark]')).toBeNull()
  })

  it('gives different custom providers different letters', () => {
    const a = render(<ProviderIcon modelKey="alpha" color="#f59e0b" fallbackLabel="Alpha" />)
    expect(a.querySelector('[data-provider-icon="initial"]')?.textContent).toBe('A')
    const b = render(<ProviderIcon modelKey="beta" color="#34d399" fallbackLabel="beta" />)
    expect(b.querySelector('[data-provider-icon="initial"]')?.textContent).toBe('B')
  })

  it('keeps the neutral mark as the last resort, when there is no label either', () => {
    const el = render(<ProviderIcon modelKey="my-proxy" color="#f97316" />)
    expect(el.querySelector('[data-tab-provider-mark]')).not.toBeNull()
    expect(el.querySelector('[data-provider-icon]')).toBeNull()
  })

  it('ignores markup that sanitises to nothing and falls through to the initial', () => {
    const el = render(
      <ProviderIcon
        modelKey="my-proxy"
        customSvg={'<script>alert(1)</script>'}
        color="#f97316"
        fallbackLabel="My Proxy"
      />
    )
    expect(el.querySelector('[data-provider-icon="custom"]')).toBeNull()
    expect(el.querySelector('[data-provider-icon="initial"]')?.textContent).toBe('M')
  })
})

describe('TabProviderMark — the neutral ring is still available', () => {
  it('renders a ring and core in the provider colour', () => {
    const el = render(<TabProviderMark color="#22d3ee" />)
    const mark = el.querySelector('[data-tab-provider-mark="dot"]')
    expect(mark).not.toBeNull()
    expect(el.querySelectorAll('circle').length).toBe(2)
  })
})
