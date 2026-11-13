import { describe, it, expect } from 'vitest'
import {
  getProviderDefaultFeatures,
  getMergedProviderFeatures,
  DEFAULT_PROVIDER_FEATURES,
  migrateLegacyArenaFeatures
} from './providerConfig'

describe('z.ai provider resolution', () => {
  it('resolves z.ai spellings to the ZAI entry, not generic', () => {
    for (const key of ['z.ai', 'zai', 'z-ai', 'chat.z.ai-ish']) {
      expect(getProviderDefaultFeatures(key)).toBe(DEFAULT_PROVIDER_FEATURES['z.ai'])
    }
    expect(getProviderDefaultFeatures('Z.AI')).toBe(DEFAULT_PROVIDER_FEATURES['z.ai'])
  })
})

describe('arena provider resolution', () => {
  it('resolves arena spellings to the arena entry with verified promptNavSelector and Status Beacon hooks', () => {
    for (const key of ['arena', 'arena-ai', 'chatbot-arena', 'ARENA']) {
      const feats = getProviderDefaultFeatures(key)
      expect(feats).toBe(DEFAULT_PROVIDER_FEATURES.arena)
      expect(feats.promptNavSelector).toBe(
        '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])'
      )
      expect(feats.chatTitleSelector).toBe('button[aria-haspopup="menu"] > span[dir="auto"].truncate')
      expect(feats.sendButtonSelector).toBe('button[data-perf-target="send"][aria-label="Send message"]')
      expect(feats.stopGenerationSelector).toBe('button[data-perf-target="send"][aria-label="Stop generating"]')
      expect(feats.assistantMessageSelector).toContain('[data-agent-transcript-message="true"]')
      expect(feats.streamingSelector).toContain('[data-perf-target="transcript"] .animate-spin')
      expect(feats.completionActionSelector).toBe(
        '[data-agent-transcript-message="true"]:last-child > div > div > div.mt-3 button[aria-label="Copy"]'
      )
      expect(feats.statusWatchdogTimeoutMs).toBe(15000)
    }
  })

  it('migrates auto-seeded v1.0.7 generic Arena selectors without overwriting custom user selectors', () => {
    const legacy = {
      chatTitleSelector: 'button[aria-haspopup="menu"] > span[dir="auto"].truncate',
      stopGenerationSelector:
        'button[aria-label*="stop" i], button[data-testid*="stop" i], button[aria-label*="interrupt" i], button[data-testid*="interrupt" i], button:has(svg.lucide-square), button[class*="stop" i]',
      sendButtonSelector: '#user-intentional-custom-send'
    }
    const { features, migrated } = migrateLegacyArenaFeatures(legacy)
    expect(migrated).toBe(true)
    expect(features.stopGenerationSelector).toBe(
      'button[data-perf-target="send"][aria-label="Stop generating"]'
    )
    expect(features.sendButtonSelector).toBe('#user-intentional-custom-send')
    expect(features.streamingSelector).toBe(DEFAULT_PROVIDER_FEATURES.arena.streamingSelector)
    expect(features.statusWatchdogTimeoutMs).toBe(15000)
  })
})

describe('getMergedProviderFeatures precedence', () => {
  it('user features override defaults; unknown keys pass through; nesting is features:{}', () => {
    const merged = getMergedProviderFeatures('z.ai', { features: { composerSelector: '#mine' } })
    expect(merged.composerSelector).toBe('#mine')
    expect(merged.sendButtonSelector).toBe(DEFAULT_PROVIDER_FEATURES['z.ai'].sendButtonSelector)
  })
  it('concatenates customInitScript from global and provider overrides', () => {
    const merged = getMergedProviderFeatures('z.ai',
      { features: { customInitScript: '/*b*/' } },
      { features: { customInitScript: '/*a*/' } })
    expect(merged.customInitScript).toBe('/*a*/\n\n/*b*/')
  })
  it('allows custom user chatTitleSelector to override defaults', () => {
    const merged = getMergedProviderFeatures('gemini', {
      features: { chatTitleSelector: '#custom-selector' }
    })
    expect(merged.chatTitleSelector).toBe('#custom-selector')
  })
  it('preserves gemini authentic 1.0.3 selectors without radix regression', () => {
    const geminiFeats = getProviderDefaultFeatures('gemini')
    expect(geminiFeats.chatTitleSelector).not.toContain('#radix')
    expect(geminiFeats.chatTitleSelector).toContain('.conversation-title')
    expect(geminiFeats.chatTitleSelector).toContain('[data-test-id="conversation-title"]')
  })
})

describe('provider motion opt-in', () => {
  it('defaults to off and persists per-provider choices through merge', () => {
    expect(getMergedProviderFeatures('arena-ai').pauseCssAnimations).not.toBe(true)
    expect(getMergedProviderFeatures('arena-ai', { features: { pauseCssAnimations: true } }).pauseCssAnimations).toBe(true)
    expect(getMergedProviderFeatures('gemini', { features: { pauseCssAnimations: false } }).pauseCssAnimations).toBe(false)
  })
})
