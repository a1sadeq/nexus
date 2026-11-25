import { describe, it, expect } from 'vitest'
import {
  hostOf,
  scoreText,
  scoreProvider,
  rankProviders,
  providersOutrankSearch,
  SCORE_EXACT,
  SCORE_PREFIX,
  SCORE_WORD_START,
  SCORE_SUBSTRING,
  SCORE_SUBSEQUENCE,
  SCORE_NONE
} from './omnibox'

const providers = [
  { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { key: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { key: 'claude', label: 'Claude', url: 'https://claude.ai/new' },
  { key: 'arena', label: 'Arena', url: 'https://arena.ai/' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { key: 'glm', label: 'GLM', url: 'https://chat.z.ai/' }
]

describe('hostOf', () => {
  it('strips scheme, www and path', () => {
    expect(hostOf('https://www.perplexity.ai/search?q=x')).toBe('perplexity.ai')
    expect(hostOf('chat.deepseek.com')).toBe('chat.deepseek.com')
    expect(hostOf('')).toBe('')
    expect(hostOf(undefined)).toBe('')
  })
})

describe('scoreText', () => {
  it('grades matches', () => {
    expect(scoreText('claude', 'Claude')).toBe(SCORE_EXACT)
    expect(scoreText('cla', 'Claude')).toBe(SCORE_PREFIX)
    expect(scoreText('deep', 'chat.deepseek.com')).toBe(SCORE_WORD_START)
    expect(scoreText('seek', 'chat.deepseek.com')).toBe(SCORE_SUBSTRING)
    expect(scoreText('gpt', 'chatgpt')).toBe(SCORE_SUBSTRING)
    expect(scoreText('cpt', 'chatgpt')).toBe(SCORE_SUBSEQUENCE)
    expect(scoreText('zzz', 'Claude')).toBe(SCORE_NONE)
  })

  it('is case-insensitive both ways', () => {
    expect(scoreText('CLAUDE', 'claude')).toBe(SCORE_EXACT)
    expect(scoreText('cla', 'CLAUDE')).toBe(SCORE_PREFIX)
  })

  it('treats an empty query as no match (the caller lists everything instead)', () => {
    expect(scoreText('', 'Claude')).toBe(SCORE_NONE)
    expect(scoreText('   ', 'Claude')).toBe(SCORE_NONE)
  })
})

describe('scoreProvider', () => {
  it('finds a provider from a partial name', () => {
    expect(scoreProvider('cl', { key: 'claude', label: 'Claude' })).toBeGreaterThan(0)
    expect(scoreProvider('clau', { key: 'claude', label: 'Claude' })).toBe(SCORE_PREFIX)
    expect(scoreProvider('aren', { key: 'arena', label: 'Arena' })).toBe(SCORE_PREFIX)
  })

  it('finds a provider through an alias, without the real name', () => {
    const chatgpt = { key: 'chatgpt', label: 'ChatGPT' }
    expect(scoreProvider('gpt', chatgpt)).toBe(SCORE_EXACT)
    expect(scoreProvider('openai', chatgpt)).toBe(SCORE_EXACT)
    expect(scoreProvider('anthropic', { key: 'claude', label: 'Claude' })).toBe(SCORE_EXACT)
    expect(scoreProvider('moonshot', { key: 'kimi', label: 'Kimi' })).toBe(SCORE_EXACT)
    expect(scoreProvider('pplx', { key: 'perplexity', label: 'Perplexity' })).toBe(SCORE_EXACT)
  })

  it('finds a provider from its domain', () => {
    expect(scoreProvider('deepseek', { key: 'ds', label: 'Deep Seek', url: 'https://chat.deepseek.com' })).toBeGreaterThan(0)
    expect(scoreProvider('z.ai', { key: 'glm', label: 'GLM', url: 'https://chat.z.ai/' })).toBeGreaterThan(0)
  })

  it('does not match an unrelated query', () => {
    expect(scoreProvider('how do i fix this', { key: 'claude', label: 'Claude' })).toBe(SCORE_NONE)
  })
})

describe('rankProviders', () => {
  it('puts the best match first, keeping the caller order for ties', () => {
    const ranked = rankProviders('cl', providers)
    expect(ranked[0].provider.key).toBe('claude')
  })

  it('returns several candidates for a short prefix so a provider is always reachable', () => {
    const ranked = rankProviders('g', providers)
    const keys = ranked.map((entry) => entry.provider.key)
    expect(keys).toContain('gemini')
    expect(keys).toContain('chatgpt')
    expect(keys).toContain('glm')
  })

  it('drops non-matches', () => {
    const ranked = rankProviders('claude', providers)
    expect(ranked.map((entry) => entry.provider.key)).toEqual(['claude'])
  })

  it('is empty for an empty query', () => {
    expect(rankProviders('', providers)).toEqual([])
  })
})

describe('providersOutrankSearch', () => {
  it('is true for a confident provider match', () => {
    expect(providersOutrankSearch('clau', providers)).toBe(true)
    expect(providersOutrankSearch('gpt', providers)).toBe(true)
    expect(providersOutrankSearch('arena', providers)).toBe(true)
  })

  it('is false for a question and for an empty query', () => {
    expect(providersOutrankSearch('how do i fix this', providers)).toBe(false)
    expect(providersOutrankSearch('', providers)).toBe(false)
  })
})
