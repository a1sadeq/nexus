import type { ModelDef } from './models'

export interface ProviderDomainRule {
  key: string
  aliases: string[]
  hosts: string[]
}

export const KNOWN_PROVIDER_RULES: ProviderDomainRule[] = [
  {
    key: 'chatgpt',
    aliases: ['openai', 'chatgpt-4', 'chatgpt-3.5'],
    hosts: ['chatgpt.com', 'oaistatic.com', 'openai.com']
  },
  {
    key: 'claude',
    aliases: ['anthropic'],
    hosts: ['claude.ai']
  },
  {
    key: 'gemini',
    aliases: ['google-gemini'],
    hosts: ['gemini.google.com']
  },
  {
    key: 'aistudio',
    aliases: ['geminiv2aistudio', 'gemini-v2-studio', 'google-ai-studio', 'ai-studio'],
    hosts: ['aistudio.google.com']
  },
  {
    key: 'deepseek',
    aliases: ['deepseek-chat'],
    hosts: ['chat.deepseek.com', 'deepseek.com']
  },
  {
    key: 'perplexity',
    aliases: ['pplx'],
    hosts: ['perplexity.ai', 'www.perplexity.ai']
  },
  {
    key: 'qwen',
    aliases: ['tongyi', 'qwen-studio', 'tongyi-qianwen'],
    hosts: ['chat.qwen.ai', 'qwen.ai', 'tongyi.aliyun.com']
  },
  {
    key: 'kimi',
    aliases: ['moonshot'],
    hosts: ['kimi.ai', 'kimi.moonshot.cn']
  },
  {
    key: 'arena-ai',
    aliases: ['arena', 'lmsys'],
    hosts: ['arena.ai', 'lmarena.ai']
  },
  {
    key: 'glm',
    aliases: ['z.ai', 'zai', 'z-ai', 'zhipu', 'glm-4', 'glm-5'],
    hosts: ['chat.z.ai', 'z.ai', 'open.bigmodel.cn']
  },
  {
    key: 'albert',
    aliases: ['albert-ai'],
    hosts: ['albert.ai']
  }
]

function extractHost(urlStr: string | undefined): string | null {
  if (!urlStr || typeof urlStr !== 'string') return null
  try {
    const parsed = new URL(urlStr)
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Resolves the active provider key from an active tab and list of configured models.
 *
 * Precedence:
 * 1. Active Tab URL Hostname matched against known provider domain rules.
 * 2. Active Tab URL Hostname matched against custom model registered URLs.
 * 3. Active Tab Model key matched directly against configured model keys.
 * 4. Active Tab Model key matched via alias to a configured model key.
 * 5. Safe deterministic fallback to models[0]?.key || 'gemini'.
 */
export function resolveActiveProviderKey(
  activeTab: { url?: string; model?: string } | undefined,
  models: ModelDef[] = []
): string {
  const fallback = models[0]?.key || 'gemini'
  if (!activeTab) return fallback

  const activeHost = extractHost(activeTab.url)

  // 1. Host matching against known rules
  if (activeHost) {
    for (const rule of KNOWN_PROVIDER_RULES) {
      const hostMatches = rule.hosts.some(
        (h) => activeHost === h || activeHost.endsWith('.' + h)
      )
      if (hostMatches) {
        // Find if user has a configured model for this rule (canonical key or any alias)
        const targetModel = models.find(
          (m) => m.key === rule.key || rule.aliases.includes(m.key)
        )
        if (targetModel) return targetModel.key
        // If not in models, return canonical rule key
        return rule.key
      }
    }

    // 2. Host matching against custom model URLs
    for (const m of models) {
      const mHost = extractHost(m.url)
      if (mHost && (activeHost === mHost || activeHost.endsWith('.' + mHost))) {
        return m.key
      }
    }
  }

  // 3. Direct model key match
  const rawModelKey = (activeTab.model || '').toLowerCase().trim()
  if (rawModelKey) {
    const directMatch = models.find((m) => m.key.toLowerCase() === rawModelKey)
    if (directMatch) return directMatch.key

    // 4. Alias matching
    for (const rule of KNOWN_PROVIDER_RULES) {
      if (rule.key === rawModelKey || rule.aliases.includes(rawModelKey)) {
        const aliasMatch = models.find(
          (m) => m.key === rule.key || rule.aliases.includes(m.key)
        )
        if (aliasMatch) return aliasMatch.key
        return rule.key
      }
    }
  }

  return fallback
}
