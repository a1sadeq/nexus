/**
 * Omnibox matching and ranking.
 *
 * The address bar used to filter providers with a plain substring test and then put three
 * "Search <engine>" rows above them, so typing a provider's name put the provider fourth and typing a
 * *partial* name often matched nothing at all. Two things are fixed here:
 *
 *   • a graded match — exact, prefix, word-start, substring, subsequence — so "cl", "clau", "anthropic"
 *     and "cla" all find Claude, and "gpt" finds ChatGPT through an alias rather than by luck;
 *   • a ranking, so the provider the query is actually about is offered *above* the search rows
 *     instead of below them.
 *
 * Everything here is pure: no React, no window, so the ordering rules are testable on their own.
 */

export interface ProviderLike {
  key: string
  label?: string
  url?: string
}

/** Match strength. 0 means "not a match"; anything above 0 is ranked, higher first. */
export const SCORE_NONE = 0
export const SCORE_SUBSEQUENCE = 1
export const SCORE_SUBSTRING = 2
export const SCORE_WORD_START = 3
export const SCORE_PREFIX = 4
export const SCORE_EXACT = 5

/**
 * Extra names people actually type. Keys are model keys; the values are matched with the same rules,
 * so "openai", "gpt" and "chat gpt" all reach ChatGPT.
 */
export const PROVIDER_ALIASES: Record<string, string[]> = {
  chatgpt: ['gpt', 'openai', 'chat gpt', 'oai'],
  gemini: ['google', 'bard', 'aistudio'],
  claude: ['anthropic'],
  grok: ['xai', 'x ai'],
  perplexity: ['pplx'],
  deepseek: ['deep seek'],
  kimi: ['moonshot'],
  qwen: ['tongyi', 'alibaba'],
  mistral: ['mixtral'],
  glm: ['chatglm', 'zhipu'],
  arena: ['lmarena', 'lmsys', 'arena ai']
}

const isSubsequence = (needle: string, haystack: string): boolean => {
  if (!needle) return true
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return false
}

/** Hostname of a URL-ish string, without scheme, `www.` or path. Empty when it is not a URL. */
export function hostOf(url: string | undefined): string {
  if (!url) return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Score one query against one candidate string. Case-insensitive; empty query matches weakly. */
export function scoreText(query: string, text: string | undefined): number {
  const q = query.trim().toLowerCase()
  if (!q) return SCORE_NONE
  const t = (text || '').trim().toLowerCase()
  if (!t) return SCORE_NONE
  if (t === q) return SCORE_EXACT
  if (t.startsWith(q)) return SCORE_PREFIX
  // A word inside the candidate starts with the query: "deep" → "chat.deepseek.com", "gpt" → "chat gpt".
  const words = t.split(/[\s._\-/]+/).filter(Boolean)
  if (words.some((word) => word.startsWith(q))) return SCORE_WORD_START
  if (t.includes(q)) return SCORE_SUBSTRING
  if (isSubsequence(q, t)) return SCORE_SUBSEQUENCE
  return SCORE_NONE
}

/** Best score for a provider across its label, key, aliases and host. */
export function scoreProvider(query: string, provider: ProviderLike): number {
  const candidates = [
    provider.label,
    provider.key,
    ...(PROVIDER_ALIASES[provider.key?.toLowerCase?.() ?? ''] ?? []),
    hostOf(provider.url)
  ]
  let best = SCORE_NONE
  for (const candidate of candidates) {
    const score = scoreText(query, candidate)
    if (score > best) best = score
  }
  return best
}

/**
 * Providers that match `query`, best first. Ties keep the caller's order, so a user's own ordering of
 * their providers is never scrambled for no reason.
 */
export function rankProviders<T extends ProviderLike>(query: string, providers: T[]): Array<{ provider: T; score: number }> {
  const scored = providers
    .map((provider) => ({ provider, score: scoreProvider(query, provider) }))
    .filter((entry) => entry.score > SCORE_NONE)
  return scored
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .map(({ entry }) => entry)
}

/**
 * Should the matching providers be listed above the search-engine rows?
 *
 * Only when one of them is a confident match (prefix or better). A casual query like "how do i fix
 * this" should still offer the search engines first; "clau" should not have to be scrolled to.
 */
export function providersOutrankSearch(query: string, providers: ProviderLike[]): boolean {
  if (!query.trim()) return false
  const ranked = rankProviders(query, providers)
  return ranked.length > 0 && ranked[0].score >= SCORE_WORD_START
}
