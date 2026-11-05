// Core AI models configuration, definitions, and versioned persistence.
import { DOT_COLOR } from './modelVisuals'

export interface ModelDef {
  key: string
  label: string
  url: string
  color?: string
  icon?: string
  desc?: string
}

export const CURRENT_MODELS_SCHEMA_VERSION = 2
export const STORAGE_KEY = 'nexus.models'
export const LEGACY_STORAGE_KEY = 'vicinae.models'
export const SCHEMA_KEY = 'nexus.models.version'

export const DEFAULT_MODELS: ModelDef[] = [
  { key: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com', color: '#10a37f' },
  { key: 'claude', label: 'Claude', url: 'https://claude.ai', color: '#d97757' },
  { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', color: '#22d3ee' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com', color: '#4d6bfe' },
  { key: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai', color: '#22b8cd' },
  { key: 'qwen', label: 'Qwen', url: 'https://chat.qwen.ai', color: '#615ced' },
  { key: 'kimi', label: 'Kimi', url: 'https://kimi.ai', color: '#00d1b2' },
  { key: 'arena-ai', label: 'Arena', url: 'https://arena.ai/', color: '#f59e0b' }
]

/**
 * Sanitizes model definitions:
 * - Purges legacy dirty inline SVGs (like the plus sign <circle><path d="M12 8v8"/><path d="M8 12h8"/></circle>) so BrandIcon renders authentic official vectors.
 * - Formats dirty uppercase/camelcase legacy labels (e.g. GEMINIV2AISTUDIO -> AI Studio, glm -> GLM, arena-ai -> Arena).
 * - Fills in brand accent colors if missing.
 */
export function sanitizeModelDef(m: ModelDef): ModelDef {
  if (!m || typeof m !== 'object') return m
  const key = (m.key || '').toLowerCase().trim()

  // 1. Label formatting
  let label = m.label || key
  const upper = label.toUpperCase().trim()
  if (key === 'geminiv2aistudio' || key === 'aistudio' || upper === 'GEMINIV2AISTUDIO') {
    label = 'AI Studio'
  } else if (key === 'glm' || key === 'zai' || key === 'z.ai' || upper === 'GLM') {
    label = 'GLM'
  } else if (key === 'arena-ai' || key === 'arena' || upper === 'ARENA') {
    label = 'Arena'
  } else if (key === 'qwen' && (upper === 'QWEN' || upper === 'TONGYI QIANWEN')) {
    label = 'Qwen'
  } else if (key === 'kimi' && upper === 'KIMI') {
    label = 'Kimi'
  } else if (key === 'chatgpt' && upper === 'CHATGPT') {
    label = 'ChatGPT'
  } else if (key === 'claude' && upper === 'CLAUDE') {
    label = 'Claude'
  } else if (key === 'deepseek' && upper === 'DEEPSEEK') {
    label = 'DeepSeek'
  } else if (key === 'perplexity' && upper === 'PERPLEXITY') {
    label = 'Perplexity'
  } else if (key === 'albert' && upper === 'ALBERT') {
    label = 'Albert'
  }

  // 2. Dirty legacy inline SVG purge
  let icon = m.icon
  if (
    icon &&
    (icon.includes('M12 8v8') ||
      icon.includes('M8 12h8') ||
      icon.includes('circle cx="12" cy="12"') ||
      icon.includes('m12 14 4-4') ||
      icon.includes('m12 3-1.912') ||
      icon.includes('M12 3a6 6 0 0 0 9 9'))
  ) {
    icon = undefined
  }

  // 3. Brand color default
  const color = m.color || DOT_COLOR[key] || '#22d3ee'

  return {
    ...m,
    label,
    icon,
    color
  }
}

/**
 * Loads models from localStorage and applies a single-shot versioned migration.
 * - Respects deliberate user deletions if schema >= 2.
 * - Safely appends missing default models (e.g. ChatGPT, Claude) only when upgrading from v1 or unversioned.
 * - Never clobbers user-customized keys or custom models.
 * - Quarantines corrupted storage without crashing.
 */
export function loadAndMigrateModels(defaultModels: ModelDef[] = DEFAULT_MODELS): ModelDef[] {
  try {
    const rawSchema = typeof localStorage !== 'undefined' ? localStorage.getItem(SCHEMA_KEY) : null
    const currentVersion = rawSchema ? parseInt(rawSchema, 10) : 0

    // Read stored models (check new key first, fallback to legacy)
    const rawData =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
        : null

    if (!rawData) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultModels))
        localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      }
      return defaultModels.map(sanitizeModelDef)
    }

    let parsed: ModelDef[]
    try {
      parsed = JSON.parse(rawData)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid array structure')
    } catch {
      // Corruption recovery: Quarantine old invalid data and return defaults
      console.warn('[models-migration] Corrupted models storage detected. Quarantining.')
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('nexus.models.corrupted.' + Date.now(), rawData)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultModels))
        localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      }
      return defaultModels.map(sanitizeModelDef)
    }

    // Only run v1 -> v2 migration ONCE if schema < 2
    if (currentVersion < 2) {
      const existingKeys = new Set(parsed.map((m) => m.key))
      const toAppend: ModelDef[] = []

      // If user never had chatgpt or claude, append them to the end
      for (const reqKey of ['chatgpt', 'claude']) {
        if (!existingKeys.has(reqKey)) {
          const def = defaultModels.find((m) => m.key === reqKey)
          if (def) toAppend.push(def)
        }
      }

      const migrated = [...parsed, ...toAppend].map(sanitizeModelDef)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        localStorage.setItem(SCHEMA_KEY, CURRENT_MODELS_SCHEMA_VERSION.toString())
      }
      return migrated
    }

    // Schema >= 2: Return stored models sanitized. Respect deliberate user deletions!
    const sanitized = parsed.map(sanitizeModelDef)
    return sanitized
  } catch (err) {
    console.error('[models-migration] Failed to load/migrate models:', err)
    return defaultModels.map(sanitizeModelDef)
  }
}
