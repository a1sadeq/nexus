import { describe, it, expect } from 'vitest'
import {
  generateProviderKey,
  deduplicateModels,
  modelLabel,
  modelColor,
  type ModelDef
} from './modelVisuals'

describe('modelVisuals', () => {
  it('generates clean slug keys from PascalCase, camelCase, spaces and special chars', () => {
    expect(generateProviderKey('Geminiv2AIStudio')).toBe('geminiv-2-ai-studio')
    expect(generateProviderKey('GeminiV2AIStudio')).toBe('gemini-v-2-ai-studio')
    expect(generateProviderKey('Gemini v2 AI Studio')).toBe('gemini-v-2-ai-studio')
    expect(generateProviderKey('ChatGPT Plus 4.5')).toBe('chat-gpt-plus-4-5')
    expect(generateProviderKey('DeepSeek Coder')).toBe('deep-seek-coder')
    expect(generateProviderKey('My_Custom_Model')).toBe('my-custom-model')
    expect(generateProviderKey('   ')).toBe('custom-model')
  })

  it('handles slug key collisions gracefully', () => {
    const existing = ['geminiv-2-ai-studio', 'geminiv-2-ai-studio-2']
    expect(generateProviderKey('Geminiv2AIStudio', existing)).toBe('geminiv-2-ai-studio-3')
  })

  it('deduplicates models and resolves key collisions in list', () => {
    const input: ModelDef[] = [
      { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
      { key: 'gemini', label: 'Gemini 2', url: 'https://gemini.google.com/app' },
      { key: 'new_model', label: 'Geminiv2AIStudio', url: 'https://aistudio.google.com' },
      { key: 'new_model', label: 'Geminiv2AIStudio', url: 'https://aistudio.google.com' }
    ]

    const deduped = deduplicateModels(input)
    expect(deduped).toHaveLength(4)
    expect(deduped[0].key).toBe('gemini')
    expect(deduped[1].key).not.toBe('gemini') // auto-resolved
    expect(deduped[2].key).toBe('new_model')
    expect(deduped[3].key).not.toBe('new_model') // auto-resolved unique key

    const uniqueKeys = new Set(deduped.map((m) => m.key))
    expect(uniqueKeys.size).toBe(4)
  })

  it('returns appropriate model labels and colors', () => {
    expect(modelLabel('gemini')).toBe('Gemini')
    expect(modelLabel('chatgpt')).toBe('ChatGPT')
    expect(modelColor('gemini')).toBe('#22d3ee')
    expect(modelColor('unknown-custom')).toBe('#818cf8')
  })
})
