/**
 * Title sanitization, prefix-stripping, and default title detection utilities.
 * Ensures webview tab titles accurately reflect the active conversation topic.
 */

const KNOWN_PROVIDER_PATTERNS = [
  'chatgpt',
  'openai',
  'kimi\\s*ai',
  'kimi\\.ai',
  'kimi',
  'moonshot\\s*ai',
  'claude',
  'anthropic',
  'google\\s*gemini',
  'gemini',
  'deepseek\\s*coder',
  'deepseek',
  'perplexity',
  'qwen\\s*studio',
  'tongyi\\s*qianwen',
  'qwen',
  'chatbot\\s*arena',
  'arena\\s*ai',
  'arena',
  'z\\.ai',
  'z\\s*chat',
  'glm',
  '智谱清言'
]

const PROVIDER_PREFIX_REGEX = new RegExp(
  `^(?:${KNOWN_PROVIDER_PATTERNS.join('|')})\\s*[-|–—:•·]\\s*`,
  'i'
)

const PROVIDER_SUFFIX_REGEX = new RegExp(
  `\\s*[-|–—:•·]\\s*(?:${KNOWN_PROVIDER_PATTERNS.join('|')})$`,
  'i'
)

const GENERIC_DEFAULT_TITLES = new Set([
  'new chat',
  'untitled',
  'untitled conversation',
  'chat',
  'ai chat',
  'new thread',
  'direct chat',
  'side-by-side',
  'loading',
  'loading...',
  'where knowledge begins',
  '未命名对话',
  '新对话',
  '新建对话'
])

const KNOWN_PROVIDER_EXACT = new Set([
  'chatgpt',
  'openai',
  'kimi',
  'kimi ai',
  'kimi.ai',
  'moonshot ai',
  'claude',
  'anthropic',
  'gemini',
  'google gemini',
  'deepseek',
  'deepseek coder',
  'perplexity',
  'qwen',
  'tongyi qianwen',
  'qwen studio',
  'arena',
  'arena ai',
  'chatbot arena',
  'z.ai',
  'z chat',
  'glm',
  '智谱清言'
])

/**
 * Strips provider name prefixes/suffixes (e.g. "Kimi - Fix WASD Zoom" -> "Fix WASD Zoom",
 * "ChatGPT - Quantum Logic" -> "Quantum Logic", "Machine Learning | Claude" -> "Machine Learning").
 */
export function cleanConversationTitle(rawTitle: string, providerKeyOrLabel?: string): string {
  if (!rawTitle) return ''
  let cleaned = rawTitle.trim()

  // Repeatedly strip known provider prefixes in case of nested titles like "Gemini - Chat - Topic"
  let prev = ''
  while (cleaned !== prev) {
    prev = cleaned
    cleaned = cleaned.replace(PROVIDER_PREFIX_REGEX, '').trim()
    cleaned = cleaned.replace(PROVIDER_SUFFIX_REGEX, '').trim()
  }

  // If a specific provider key or label was passed, also strip it specifically
  if (providerKeyOrLabel && providerKeyOrLabel.trim()) {
    const escaped = providerKeyOrLabel.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[-|–—:•·]\\s*`, 'i'), '').trim()
    cleaned = cleaned.replace(new RegExp(`\\s*[-|–—:•·]\\s*${escaped}$`, 'i'), '').trim()
  }

  // Clean surrounding quotes if accidentally included
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”') && cleaned.length > 2) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length > 2)
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }

  return cleaned
}

/**
 * Checks whether an incoming title is a generic default/placeholder title.
 * Used to avoid overwriting a real chat title with loading or placeholder noise.
 */
export function isDefaultConversationTitle(
  title: string,
  providerKeyOrLabel?: string,
  defaultChatTitles?: string[]
): boolean {
  if (!title) return true
  const rawLower = title.toLowerCase().trim()
  if (!rawLower || rawLower === 'loading' || rawLower === 'loading...') return true

  // Raw URLs are always considered default/noise
  if (rawLower.startsWith('http://') || rawLower.startsWith('https://')) return true

  // Check cleaned title
  const cleaned = cleanConversationTitle(title, providerKeyOrLabel)
  if (!cleaned) return true
  const cleanLower = cleaned.toLowerCase().trim()

  if (GENERIC_DEFAULT_TITLES.has(cleanLower)) return true
  if (KNOWN_PROVIDER_EXACT.has(cleanLower)) return true

  if (providerKeyOrLabel) {
    const pLower = providerKeyOrLabel.toLowerCase().trim()
    if (cleanLower === pLower || cleanLower === `${pLower} chat`) return true
  }

  if (cleanLower.startsWith('new chat') || cleanLower.startsWith('untitled')) return true

  if (defaultChatTitles && defaultChatTitles.length > 0) {
    const isCustomDefault = defaultChatTitles.some((d) => {
      const dLower = d.toLowerCase().trim()
      return cleanLower === dLower || rawLower === dLower
    })
    if (isCustomDefault) return true
  }

  return false
}
