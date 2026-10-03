import { describe, it, expect } from 'vitest'
import {
  getProviderDefaultFeatures,
  getMergedProviderFeatures,
  DEFAULT_PROVIDER_FEATURES
} from '../../../shared/providerConfig'

describe('Provider Feature Configuration Engine', () => {
  it('returns appropriate built-in defaults for ChatGPT', () => {
    const feats = getProviderDefaultFeatures('chatgpt')
    expect(feats.promptNavSelector).toBe('[data-message-author-role="user"]')
    expect(feats.composerSelector).toContain('#prompt-textarea')
    expect(feats.sendButtonSelector).toContain('button[data-testid="send-button"]')
    expect(feats.defaultChatTitles).toContain('ChatGPT')
    expect(feats.enableSlashFocus).toBe(true)
  })

  it('returns appropriate built-in defaults for Claude', () => {
    const feats = getProviderDefaultFeatures('claude')
    expect(feats.promptNavSelector).toContain('[data-testid="user-message"]')
    expect(feats.composerSelector).toContain('.ProseMirror')
    expect(feats.defaultChatTitles).toContain('Claude')
  })

  it('returns appropriate built-in defaults for Gemini', () => {
    const feats = getProviderDefaultFeatures('gemini')
    expect(feats.promptNavSelector).toContain('user-query')
    expect(feats.composerSelector).toContain('rich-textarea')
    expect(feats.defaultChatTitles).toContain('Gemini')
  })

  it('falls back to generic configuration for custom providers like z.ai', () => {
    const feats = getProviderDefaultFeatures('z-ai-custom')
    expect(feats.promptNavSelector).toContain('[class*="user-query"]')
    expect(feats.composerSelector).toContain('textarea:not([disabled])')
    expect(feats.defaultChatTitles).toContain('New Chat')
  })

  it('merges user custom overrides on top of defaults correctly', () => {
    const merged = getMergedProviderFeatures('chatgpt', {
      features: {
        promptNavSelector: '.custom-chatgpt-user-bubble',
        chatTitleSelector: '.my-custom-header-title',
        defaultChatTitles: ['My Custom Generic Title'],
        enableSlashFocus: false
      }
    })

    expect(merged.promptNavSelector).toBe('.custom-chatgpt-user-bubble')
    expect(merged.chatTitleSelector).toBe('.my-custom-header-title')
    expect(merged.defaultChatTitles).toEqual(['My Custom Generic Title'])
    expect(merged.enableSlashFocus).toBe(false)
    // Inherited untouched default fields
    expect(merged.composerSelector).toBe(DEFAULT_PROVIDER_FEATURES.chatgpt.composerSelector)
    expect(merged.sendButtonSelector).toBe(DEFAULT_PROVIDER_FEATURES.chatgpt.sendButtonSelector)
  })

  it('merges global and provider customInitScript correctly', () => {
    const merged = getMergedProviderFeatures(
      'gemini',
      { features: { customInitScript: 'console.log("provider script");' } },
      { features: { customInitScript: 'console.log("global script");' } }
    )

    expect(merged.customInitScript).toBe(
      'console.log("global script");\n\nconsole.log("provider script");'
    )
  })
})

