import { describe, it, expect } from 'vitest'
import { getProviderDefaultFeatures, getMergedProviderFeatures, DEFAULT_PROVIDER_FEATURES } from './providerConfig'

describe('z.ai provider resolution', () => {
  it('resolves z.ai spellings to the ZAI entry, not generic', () => {
    for (const key of ['z.ai', 'zai', 'z-ai', 'chat.z.ai-ish']) {
      expect(getProviderDefaultFeatures(key)).toBe(DEFAULT_PROVIDER_FEATURES['z.ai'])
    }
    expect(getProviderDefaultFeatures('Z.AI')).toBe(DEFAULT_PROVIDER_FEATURES['z.ai'])
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
})
