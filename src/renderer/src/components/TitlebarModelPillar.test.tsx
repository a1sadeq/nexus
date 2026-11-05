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
          activeModelKey="claude"
          onSelectModel={onSelect}
        />
      )
    })

    const claudeBtn = container.querySelector('button[title*="Claude"]') as HTMLButtonElement
    expect(claudeBtn).toBeTruthy()
    expect(claudeBtn.getAttribute('aria-checked')).toBe('true')
    expect(claudeBtn.tabIndex).toBe(0)

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
          activeModelKey="chatgpt"
          onSelectModel={onSelect}
        />
      )
    })

    const radiogroup = container.querySelector('[role="radiogroup"]') as HTMLDivElement
    expect(radiogroup).toBeTruthy()

    await act(async () => {
      radiogroup.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledWith('claude')
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
})
