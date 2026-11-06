import { describe, it, expect } from 'vitest'
import { cleanConversationTitle, isDefaultConversationTitle } from './titleUtils'

describe('cleanConversationTitle', () => {
  it('strips provider prefixes cleanly', () => {
    expect(cleanConversationTitle('Kimi - Fix WASD Zoom in Electron')).toBe('Fix WASD Zoom in Electron')
    expect(cleanConversationTitle('ChatGPT - Quantum Logic Basics')).toBe('Quantum Logic Basics')
    expect(cleanConversationTitle('Claude | Refactoring Architecture')).toBe('Refactoring Architecture')
    expect(cleanConversationTitle('Gemini: Advanced Prompt Engineering')).toBe('Advanced Prompt Engineering')
    expect(cleanConversationTitle('DeepSeek — Memory Optimization Plan')).toBe('Memory Optimization Plan')
    expect(cleanConversationTitle('Perplexity - Latest AI Research')).toBe('Latest AI Research')
    expect(cleanConversationTitle('Qwen - Code Generation')).toBe('Code Generation')
    expect(cleanConversationTitle('Arena - Llama 3 vs Mistral')).toBe('Llama 3 vs Mistral')
    expect(cleanConversationTitle('Z.ai - Model Benchmark')).toBe('Model Benchmark')
  })

  it('strips provider suffixes cleanly', () => {
    expect(cleanConversationTitle('Electron Performance Tuning - ChatGPT')).toBe('Electron Performance Tuning')
    expect(cleanConversationTitle('Rust vs Go Analysis | Claude')).toBe('Rust vs Go Analysis')
    expect(cleanConversationTitle('Daily Notes - Gemini')).toBe('Daily Notes')
    expect(cleanConversationTitle('Code Review - Kimi')).toBe('Code Review')
  })

  it('handles custom model labels', () => {
    expect(cleanConversationTitle('My Assistant - Project Setup', 'My Assistant')).toBe('Project Setup')
    expect(cleanConversationTitle('custom-llm - Debugging Memory', 'custom-llm')).toBe('Debugging Memory')
  })

  it('strips surrounding quotes', () => {
    expect(cleanConversationTitle('"Clean Code Architecture"')).toBe('Clean Code Architecture')
    expect(cleanConversationTitle('“Modern Design Studio”')).toBe('Modern Design Studio')
  })

  it('preserves clean conversation titles without provider noise', () => {
    expect(cleanConversationTitle('Fix WASD Zoom in Electron')).toBe('Fix WASD Zoom in Electron')
    expect(cleanConversationTitle('How to write a compiler in Zig')).toBe('How to write a compiler in Zig')
  })

  it('handles empty or whitespace strings', () => {
    expect(cleanConversationTitle('')).toBe('')
    expect(cleanConversationTitle('   ')).toBe('')
  })
})

describe('isDefaultConversationTitle', () => {
  it('identifies generic default titles', () => {
    expect(isDefaultConversationTitle('')).toBe(true)
    expect(isDefaultConversationTitle('   ')).toBe(true)
    expect(isDefaultConversationTitle('New Chat')).toBe(true)
    expect(isDefaultConversationTitle('new chat')).toBe(true)
    expect(isDefaultConversationTitle('Untitled')).toBe(true)
    expect(isDefaultConversationTitle('Untitled conversation')).toBe(true)
    expect(isDefaultConversationTitle('Loading...')).toBe(true)
    expect(isDefaultConversationTitle('https://chatgpt.com/')).toBe(true)
  })

  it('identifies bare provider names as default', () => {
    expect(isDefaultConversationTitle('ChatGPT')).toBe(true)
    expect(isDefaultConversationTitle('Gemini')).toBe(true)
    expect(isDefaultConversationTitle('Claude')).toBe(true)
    expect(isDefaultConversationTitle('Kimi')).toBe(true)
    expect(isDefaultConversationTitle('DeepSeek')).toBe(true)
    expect(isDefaultConversationTitle('Perplexity')).toBe(true)
    expect(isDefaultConversationTitle('Qwen')).toBe(true)
    expect(isDefaultConversationTitle('Arena')).toBe(true)
    expect(isDefaultConversationTitle('custom-bot', 'custom-bot')).toBe(true)
  })

  it('does NOT mark real conversation titles as default even if prefixed with provider', () => {
    expect(isDefaultConversationTitle('Kimi - Fix WASD Zoom in Electron', 'kimi')).toBe(false)
    expect(isDefaultConversationTitle('ChatGPT - Quantum Logic', 'chatgpt')).toBe(false)
    expect(isDefaultConversationTitle('Claude | Refactoring Plan', 'claude')).toBe(false)
    expect(isDefaultConversationTitle('DeepSeek - High Performance Caching', 'deepseek')).toBe(false)
    expect(isDefaultConversationTitle('Quantum Logic Basics')).toBe(false)
  })

  it('respects custom provider defaultChatTitles', () => {
    expect(isDefaultConversationTitle('Custom Placeholder', 'bot', ['Custom Placeholder'])).toBe(true)
    expect(isDefaultConversationTitle('Real User Topic', 'bot', ['Custom Placeholder'])).toBe(false)
  })
})
