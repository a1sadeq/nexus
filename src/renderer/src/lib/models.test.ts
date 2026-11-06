import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadAndMigrateModels,
  DEFAULT_MODELS,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  SCHEMA_KEY
} from './models'

const storageMap = new Map<string, string>()

const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, val),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  get length() {
    return storageMap.size
  },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null
}

// @ts-ignore
globalThis.localStorage = mockLocalStorage

describe('Models LocalStorage Migration Matrix (Finding H6)', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('Case 1: Fresh install initializes default models and sets schema version = 2', () => {
    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(DEFAULT_MODELS.length)
    expect(mockLocalStorage.getItem(SCHEMA_KEY)).toBe('2')
    expect(mockLocalStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('Case 2: Preserves user configured models on app upgrade without force-appending unrequested models', () => {
    const legacyData = [
      { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#22d3ee' },
      { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com', color: '#4d6bfe' }
    ]
    mockLocalStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyData))

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(2)
    expect(result[0].key).toBe('gemini')
    expect(result[1].key).toBe('deepseek')
    expect(result.some((m) => m.key === 'claude')).toBe(false)
    expect(mockLocalStorage.getItem(SCHEMA_KEY)).toBe('2')
  })

  it('Case 3: Preserves user custom models and never clobbers custom chatgpt key', () => {
    const customModels = [
      { key: 'chatgpt', label: 'My Custom ChatGPT Team', url: 'https://custom.chatgpt.com', color: '#10a37f' },
      { key: 'local-llm', label: 'Ollama Local', url: 'http://localhost:11434', color: '#888888' }
    ]
    mockLocalStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(customModels))

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    const customChatgpt = result.find((m) => m.key === 'chatgpt')
    expect(customChatgpt?.label).toBe('My Custom ChatGPT Team')
    expect(result.some((m) => m.key === 'local-llm')).toBe(true)
  })

  it('Case 4: Respects deliberate deletions of models when schema is already v2', () => {
    const userTrimmed = [
      { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#22d3ee' }
    ]
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(userTrimmed))
    mockLocalStorage.setItem(SCHEMA_KEY, '2')

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(1)
    expect(result[0].key).toBe('gemini')
    expect(result.some((m) => m.key === 'chatgpt')).toBe(false)
  })

  it('Case 5: Corrupted storage is quarantined without crashing and defaults restored', () => {
    const corrupted = 'INVALID_JSON_CORRUPTED{{{}}'
    mockLocalStorage.setItem(STORAGE_KEY, corrupted)

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(DEFAULT_MODELS.length)
    expect(mockLocalStorage.getItem(SCHEMA_KEY)).toBe('2')

    const keys = Array.from(storageMap.keys())
    expect(keys.some((k) => k.startsWith('nexus.models.corrupted.'))).toBe(true)
  })

  it('Case 6: Purges dirty legacy inline SVG plus icons and cleans labels', () => {
    const dirtyData = [
      {
        key: 'qwen',
        label: 'QWEN',
        url: 'https://chat.qwen.ai',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>'
      },
      {
        key: 'geminiv2aistudio',
        label: 'GEMINIV2AISTUDIO',
        url: 'https://aistudio.google.com'
      },
      {
        key: 'glm',
        label: 'GLM',
        url: 'https://chat.z.ai'
      }
    ]
    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(dirtyData))
    mockLocalStorage.setItem(SCHEMA_KEY, '2')

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    const qwen = result.find((m) => m.key === 'qwen')
    expect(qwen?.icon).toBeUndefined() // Purged so BrandIcon renders authentic vector
    expect(qwen?.label).toBe('Qwen')

    const aiStudio = result.find((m) => m.key === 'geminiv2aistudio')
    expect(aiStudio?.label).toBe('AI Studio')

    const glm = result.find((m) => m.key === 'glm')
    expect(glm?.label).toBe('GLM')
    expect(glm?.color).toBe('#1055ff')
  })
})
