// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { TitlebarModelPillar } from './TitlebarModelPillar'
import { DEFAULT_MODELS } from '../lib/models'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('TitlebarModelPillar Component', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  it('renders all configured default AI providers with correct aria-checked', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={DEFAULT_MODELS}
          activeModelKey="gemini"
          onSelectModel={onSelect}
        />
      )
    })

    const geminiBtn = container.querySelector('button[title*="Gemini"]') as HTMLButtonElement
    expect(geminiBtn).toBeTruthy()
    expect(geminiBtn.getAttribute('aria-checked')).toBe('true')
    expect(geminiBtn.tabIndex).toBe(0)

    const chatgptBtn = container.querySelector('button[title*="ChatGPT"]') as HTMLButtonElement
    expect(chatgptBtn).toBeTruthy()
    expect(chatgptBtn.getAttribute('aria-checked')).toBe('false')
    expect(chatgptBtn.tabIndex).toBe(-1)
  })

  it('navigates via arrow keys with roving tabindex', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={DEFAULT_MODELS}
          activeModelKey="gemini"
          onSelectModel={onSelect}
        />
      )
    })

    const radiogroup = container.querySelector('[role="radiogroup"]') as HTMLDivElement
    expect(radiogroup).toBeTruthy()

    await act(async () => {
      radiogroup.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledWith('qwen')
  })

  it('triggers onSelectModel when a model button is clicked', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={DEFAULT_MODELS}
          activeModelKey="gemini"
          onSelectModel={onSelect}
        />
      )
    })

    const deepseekBtn = container.querySelector('button[title*="DeepSeek"]') as HTMLButtonElement
    expect(deepseekBtn).toBeTruthy()

    await act(async () => {
      deepseekBtn.click()
    })

    expect(onSelect).toHaveBeenCalledWith('deepseek')
  })

  // Finding H5: Parse actual CSS stylesheet to verify -webkit-app-region invariant!
  it('strictly defines -webkit-app-region: no-drag !important in TitlebarModelPillar.css', () => {
    const cssPath = resolve(__dirname, './TitlebarModelPillar.css')
    const cssContent = readFileSync(cssPath, 'utf-8')

    expect(cssContent).toMatch(/\.titlebar-model-pillar[\s\S]*?-webkit-app-region:\s*no-drag\s*!important;/)
    expect(cssContent).toMatch(/\.titlebar-model-pill[\s\S]*?-webkit-app-region:\s*no-drag\s*!important;/)
  })

  it('renders the glowing active-core-dot inside the active provider pill', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={DEFAULT_MODELS}
          activeModelKey="gemini"
          onSelectModel={onSelect}
        />
      )
    })

    const geminiBtn = container.querySelector('button[title*="Gemini"]') as HTMLButtonElement
    expect(geminiBtn).toBeTruthy()
    const coreDot = geminiBtn.querySelector('.active-core-dot')
    expect(coreDot).toBeTruthy()

    const qwenBtn = container.querySelector('button[title*="Qwen"]') as HTMLButtonElement
    expect(qwenBtn.querySelector('.active-core-dot')).toBeNull()
  })

  it('sets dynamic provider gradient and adaptive dock aura variables', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={DEFAULT_MODELS}
          activeModelKey="gemini"
          onSelectModel={onSelect}
        />
      )
    })

    const dock = container.querySelector('.titlebar-model-pillar') as HTMLDivElement
    expect(dock).toBeTruthy()
    // Container inherits active provider color
    expect(dock.style.getPropertyValue('--active-provider-color')).toBe('#22d3ee')

    const geminiBtn = container.querySelector('button[title*="Gemini"]') as HTMLButtonElement
    expect(geminiBtn.style.getPropertyValue('--provider-color')).toBe('#22d3ee')
    expect(geminiBtn.style.getPropertyValue('--provider-gradient-start')).toBe('#22d3ee')
    expect(geminiBtn.style.getPropertyValue('--provider-gradient-end')).toBe('#4f46e5')
  })

  // Build 37 — "the ai providers in the titlebar the active ai provider don't have their name visible".
  it('shows the active provider name, and only the active one, without being asked', () => {
    const css = readFileSync(resolve(__dirname, 'TitlebarModelPillar.css'), 'utf8')
    const labelRule = css.slice(css.indexOf('.titlebar-model-label {'), css.indexOf('}', css.indexOf('.titlebar-model-label {')))
    // The base rule still hides the name — five of six pills stay square.
    expect(labelRule).toContain('display: none')
    // …and the active pill brings its own name back, unconditionally.
    expect(css).toContain('.titlebar-model-pill.active .titlebar-model-label {')
    const activeRule = css.slice(
      css.indexOf('.titlebar-model-pill.active .titlebar-model-label {'),
      css.indexOf('}', css.indexOf('.titlebar-model-pill.active .titlebar-model-label {'))
    )
    expect(activeRule).toContain('display: inline-block')
    expect(activeRule).not.toContain('display: none')
    // The three ways a pill can have the user's attention bring the name back…
    expect(css).toContain('.titlebar-model-pill:hover .titlebar-model-label,')
    expect(css).toContain('.titlebar-model-pill:focus-visible .titlebar-model-label,')
    expect(css).toContain('.titlebar-model-pill:focus .titlebar-model-label {')
    // …and no width tier may override that with `display: none !important` any more.
    expect(css).not.toContain('.titlebar-model-label,\n  .active-core-dot {\n    display: none !important;')
  })

  it('draws the provider icon with the same component the tabs use', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <TitlebarModelPillar
          models={[
            {
              key: 'glm',
              label: 'GLM',
              url: 'https://chat.z.ai',
              icon: '<svg viewBox="0 0 24 24"><circle r="4" /></svg>'
            }
          ]}
          activeModelKey="glm"
          onSelectModel={onSelect}
        />
      )
    })
    // Configured markup reaches the pill through ProviderIcon, the same resolved + sanitised path the
    // tab strip takes — not a second raw `dangerouslySetInnerHTML`.
    expect(container.querySelector('[data-provider-icon="custom"]')).toBeTruthy()
    const source = readFileSync(resolve(__dirname, 'TitlebarModelPillar.tsx'), 'utf8')
    expect(source).toContain('<ProviderIcon')
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })
})
