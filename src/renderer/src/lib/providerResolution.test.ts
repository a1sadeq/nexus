import { describe, it, expect } from 'vitest'
import { resolveActiveProviderKey } from './providerResolution'
import type { ModelDef } from './models'

describe('providerResolution Engine', () => {
  const testModels: ModelDef[] = [
    { key: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com', color: '#10a37f' },
    { key: 'claude', label: 'Claude', url: 'https://claude.ai', color: '#d97757' },
    { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#22d3ee' },
    { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com', color: '#4d6bfe' },
    { key: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai', color: '#22b8cd' },
    { key: 'qwen', label: 'Qwen', url: 'https://chat.qwen.ai', color: '#615ced' },
    { key: 'kimi', label: 'Kimi', url: 'https://kimi.ai', color: '#00d1b2' },
    { key: 'arena-ai', label: 'Arena', url: 'https://arena.ai/', color: '#f59e0b' },
    { key: 'glm', label: 'GLM', url: 'https://chat.z.ai', color: '#1055ff' },
    { key: 'geminiv2aistudio', label: 'AI Studio', url: 'https://aistudio.google.com', color: '#1a73e8' }
  ]

  it('Resolves GLM (z.ai) from active URL chat.z.ai', () => {
    const activeTab = {
      id: 'tab-1',
      title: 'Nexus Build Plans Reviewer',
      url: 'https://chat.z.ai/c/67890',
      model: 'generic' // Stale/mismatched tab.model
    }
    const resolved = resolveActiveProviderKey(activeTab, testModels)
    expect(resolved).toBe('glm')
  })

  it('Resolves AI Studio from active URL aistudio.google.com even if model key is geminiv2aistudio', () => {
    const activeTab = {
      id: 'tab-2',
      title: 'Google AI Studio Prompt',
      url: 'https://aistudio.google.com/prompts/new_chat',
      model: 'gemini'
    }
    const resolved = resolveActiveProviderKey(activeTab, testModels)
    expect(resolved).toBe('geminiv2aistudio')
  })

  it('Resolves Arena from arena.ai URL', () => {
    const activeTab = {
      id: 'tab-3',
      title: 'Arena | Benchmark',
      url: 'https://arena.ai/?mode=direct',
      model: 'arena'
    }
    const resolved = resolveActiveProviderKey(activeTab, testModels)
    expect(resolved).toBe('arena-ai')
  })

  it('Resolves DeepSeek from chat.deepseek.com', () => {
    const activeTab = {
      id: 'tab-4',
      title: 'DeepSeek Chat',
      url: 'https://chat.deepseek.com/a/chat/s/1234',
      model: 'deepseek'
    }
    const resolved = resolveActiveProviderKey(activeTab, testModels)
    expect(resolved).toBe('deepseek')
  })

  it('Resolves via tab.model alias when URL is empty or about:blank', () => {
    const activeTab = {
      id: 'tab-5',
      title: 'New Tab',
      url: 'about:blank',
      model: 'z.ai' // alias of glm
    }
    const resolved = resolveActiveProviderKey(activeTab, testModels)
    expect(resolved).toBe('glm')
  })

  it('Resolves custom model via host matching', () => {
    const customModels = [
      ...testModels,
      { key: 'my-custom-llm', label: 'Custom LLM', url: 'https://internal-ai.corp.com:8080/app' }
    ]
    const activeTab = {
      id: 'tab-6',
      title: 'Internal AI',
      url: 'https://internal-ai.corp.com:8080/chat/123',
      model: 'custom'
    }
    const resolved = resolveActiveProviderKey(activeTab, customModels)
    expect(resolved).toBe('my-custom-llm')
  })

  it('Returns safe fallback when activeTab is undefined or models is empty', () => {
    expect(resolveActiveProviderKey(undefined, testModels)).toBe('chatgpt')
    expect(resolveActiveProviderKey(undefined, [])).toBe('gemini')
  })
})
