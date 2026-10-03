import { describe, it, expect } from 'vitest'
import { generateAiThemingPrompt, generateFeatureHooksPrompt } from './promptGenerator'

describe('generateAiThemingPrompt', () => {
  it('generates a complete AI theming prompt with default fallback values', () => {
    const prompt = generateAiThemingPrompt({})
    expect(prompt).toContain('# MASTER AI THEMING SYSTEM PROMPT: NEXUS WORKSTATION DEEP STYLING')
    expect(prompt).toContain('--nexus-bg')
    expect(prompt).toContain('--nexus-accent')
    expect(prompt).toContain('DOM INSPECTION INSTRUCTIONS')
    expect(prompt).toContain('FORMAT 1: Pure CSS')
    expect(prompt).toContain('FORMAT 2: TypeScript ProviderTheme Definition')
  })

  it('populates custom provider name, URL, and theme color tokens', () => {
    const prompt = generateAiThemingPrompt({
      providerName: 'Z.AI Intelligence',
      providerUrl: 'https://z.ai',
      colors: {
        bg: '#000000',
        surface: '#0a0a0f',
        surface2: '#14141e',
        accent: '#00ffcc',
        text: '#ffffff',
        text2: '#aaaaaa',
        border: 'rgba(255,255,255,0.1)'
      },
      interfaceSettings: {
        cornerRadius: 18,
        accentColor: '#00ffcc',
        accentGlowColor: '#ff0055',
        webviewBubbleStyle: 'gradient-pill',
        webviewCodeBlockStyle: 'matrix-terminal'
      } as any
    })

    expect(prompt).toContain('Z.AI Intelligence')
    expect(prompt).toContain('https://z.ai')
    expect(prompt).toContain('#000000')
    expect(prompt).toContain('#00ffcc')
    expect(prompt).toContain('#ff0055')
    expect(prompt).toContain('18px')
    expect(prompt).toContain('matrix-terminal')
  })

  it('embeds live DOM HTML and computed CSS directly when provided', () => {
    const prompt = generateAiThemingPrompt({
      providerName: 'Z.AI',
      providerUrl: 'https://z.ai',
      computedCss: ':root { --nexus-bg: #000; } .user-bubble { color: #fff; }',
      liveDomHtml: '<div class="z-layout"><main class="z-chat"><div class="user-turn">Hello</div></main></div>'
    })

    expect(prompt).toContain('2. COMPUTED NEXUS BASELINE CSS')
    expect(prompt).toContain('--nexus-bg: #000')
    expect(prompt).toContain('3. LIVE EXTRACTED CHAT DOM / HTML STRUCTURE')
    expect(prompt).toContain('<div class="z-layout">')
    expect(prompt).toContain('<div class="user-turn">Hello</div>')
  })
})

describe('generateFeatureHooksPrompt', () => {
  it('generates a complete AI feature hooks prompt with default fallback values', () => {
    const prompt = generateFeatureHooksPrompt({})
    expect(prompt).toContain('# 🎯 NEXUS AI WEBVIEW AUTOMATION & HOOKS SELECTOR EXTRACTION')
    expect(prompt).toContain('Target AI Provider')
    expect(prompt).toContain('attachmentSelector')
    expect(prompt).toContain('promptNavSelector')
    expect(prompt).toContain('composerSelector')
    expect(prompt).toContain('sendButtonSelector')
    expect(prompt).toContain('chatTitleSelector')
    expect(prompt).toContain('newChatSelector')
    expect(prompt).toContain('stopGenerationSelector')
    expect(prompt).toContain('virtualizationSelector')
    expect(prompt).toContain('REQUIRED OUTPUT FORMAT')
    expect(prompt).toContain('DOM INSPECTION INSTRUCTIONS')
  })

  it('embeds provider details, existing config, and extracted live HTML DOM', () => {
    const prompt = generateFeatureHooksPrompt({
      providerName: 'Claude',
      providerUrl: 'https://claude.ai',
      currentFeatures: {
        attachmentSelector: 'input[type="file"]',
        composerSelector: '.ProseMirror'
      },
      liveDomHtml: '<div class="claude-input"><button aria-label="Upload file"></button></div>'
    })

    expect(prompt).toContain('Claude')
    expect(prompt).toContain('https://claude.ai')
    expect(prompt).toContain('CURRENT CONFIGURATION (UPDATE OR FILL IN GAPS)')
    expect(prompt).toContain('"attachmentSelector": "input[type=\\"file\\"]"')
    expect(prompt).toContain('EXTRACTED LIVE HTML DOM')
    expect(prompt).toContain('<button aria-label="Upload file"></button>')
  })
})

