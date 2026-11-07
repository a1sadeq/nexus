// Shared model visual identity — single source of truth for tab pills + sidebar.
// Model colors follow provider brand accents; brand icons from BrandIcons.tsx.

export const DOT_COLOR: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#22d3ee',
  perplexity: '#22b8cd',
  deepseek: '#4d6bfe',
  kimi: '#8b5cf6',
  qwen: '#615ced',
  'arena-ai': '#f59e0b',
  arena: '#f59e0b',
  glm: '#1055ff',
  'z.ai': '#1055ff',
  zai: '#1055ff',
  aistudio: '#1a73e8',
  geminiv2aistudio: '#1a73e8',
  'gemini-v2-studio': '#1a73e8',
  albert: '#a855f7',
  mistral: '#f97316',
  grok: '#ffffff'
}

/** Authentic signature dual-tone gradients for major AI providers */
export const PROVIDER_GRADIENTS: Record<string, { start: string; end: string }> = {
  gemini: { start: '#22d3ee', end: '#4f46e5' },
  chatgpt: { start: '#10a37f', end: '#059669' },
  claude: { start: '#d97757', end: '#ea580c' },
  deepseek: { start: '#4d6bfe', end: '#06b6d4' },
  qwen: { start: '#615ced', end: '#8b5cf6' },
  kimi: { start: '#8b5cf6', end: '#c084fc' },
  perplexity: { start: '#22b8cd', end: '#0284c7' },
  'arena-ai': { start: '#f59e0b', end: '#f97316' },
  arena: { start: '#f59e0b', end: '#f97316' },
  glm: { start: '#1055ff', end: '#3b82f6' },
  'z.ai': { start: '#1055ff', end: '#3b82f6' },
  zai: { start: '#1055ff', end: '#3b82f6' },
  aistudio: { start: '#1a73e8', end: '#60a5fa' },
  geminiv2aistudio: { start: '#1a73e8', end: '#60a5fa' },
  'gemini-v2-studio': { start: '#1a73e8', end: '#60a5fa' },
  albert: { start: '#a855f7', end: '#d946ef' },
  mistral: { start: '#f97316', end: '#f59e0b' },
  grok: { start: '#f1f5f9', end: '#94a3b8' }
}

/**
 * Derives an analogous/complementary secondary gradient tone from any custom hex color.
 */
export function deriveSecondaryGradientColor(hex: string): string {
  const clean = hex.replace('#', '').trim()
  if (clean.length !== 6 && clean.length !== 3) return '#3b82f6'
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#3b82f6'

  // Shift color values to create an energetic, high-depth secondary gradient stop
  const newR = Math.min(255, Math.max(0, Math.round(r * 0.75 + 30)))
  const newG = Math.min(255, Math.max(0, Math.round(g * 0.75 + 20)))
  const newB = Math.min(255, Math.max(0, Math.round(b * 0.9 + 50)))

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

/**
 * Returns the effective primary color for a model, respecting user custom color if defined.
 */
export function getEffectiveProviderColor(modelKey: string, customColor?: string): string {
  if (customColor && customColor.trim()) return customColor.trim()
  return modelColor(modelKey)
}

/**
 * Returns the dual-tone signature gradient for a model.
 * If user customized the color, uses that color as primary and procedurally derives secondary.
 */
export function getProviderGradient(
  modelKey: string,
  customColor?: string
): { start: string; end: string } {
  const k = modelKey.toLowerCase().trim()
  const defaultBase = DOT_COLOR[k]

  // If user provided a custom color that differs from default brand color, derive secondary
  if (
    customColor &&
    customColor.trim() &&
    (!defaultBase || customColor.toLowerCase().trim() !== defaultBase.toLowerCase())
  ) {
    const start = customColor.trim()
    const end = deriveSecondaryGradientColor(start)
    return { start, end }
  }

  // Built-in hand-tuned dual-tone signature gradient
  if (PROVIDER_GRADIENTS[k]) {
    return PROVIDER_GRADIENTS[k]
  }

  const base = customColor?.trim() || defaultBase || '#6366f1'
  return { start: base, end: deriveSecondaryGradientColor(base) }
}

export const BRAND_IDS: Record<string, boolean> = {
  gemini: true,
  chatgpt: true,
  claude: true,
  perplexity: true,
  deepseek: true,
  qwen: true,
  kimi: true,
  'arena-ai': true,
  arena: true,
  glm: true,
  'z.ai': true,
  zai: true,
  aistudio: true,
  geminiv2aistudio: true,
  'gemini-v2-studio': true,
  albert: true,
  mistral: true,
  grok: true
}

export function modelLabel(model: string): string {
  const m = model.toLowerCase().trim()
  if (m === 'gemini') return 'Gemini'
  if (m === 'chatgpt') return 'ChatGPT'
  if (m === 'claude') return 'Claude'
  if (m === 'perplexity') return 'Perplexity'
  if (m === 'deepseek') return 'DeepSeek'
  if (m === 'qwen') return 'Qwen'
  if (m === 'kimi') return 'Kimi'
  if (m === 'arena-ai' || m === 'arena') return 'Arena'
  if (m === 'glm' || m === 'z.ai' || m === 'zai') return 'GLM'
  if (m === 'aistudio' || m === 'geminiv2aistudio' || m === 'gemini-v2-studio') return 'AI Studio'
  if (m === 'albert') return 'Albert'
  if (m === 'mistral') return 'Mistral'
  if (m === 'grok') return 'Grok'
  return model.charAt(0).toUpperCase() + model.slice(1)
}

export function modelColor(model: string): string {
  return DOT_COLOR[model.toLowerCase()] || '#818cf8'
}

export function generateProviderKey(label: string, existingKeys: string[] = []): string {
  let slug = label
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!slug) slug = 'custom-model'
  let unique = slug
  let counter = 2
  while (existingKeys.includes(unique)) {
    unique = `${slug}-${counter}`
    counter++
  }
  return unique
}

export interface ModelDef {
  key: string
  label: string
  url: string
  desc?: string
  icon?: string
  /** Custom provider color — overrides brand DOT_COLOR when set. */
  color?: string
}

export function deduplicateModels(models: ModelDef[]): ModelDef[] {
  const seenKeys = new Set<string>()
  const result: ModelDef[] = []

  for (const m of models) {
    if (!m || !m.url) continue
    let key = m.key?.trim()
    if (!key || seenKeys.has(key)) {
      key = generateProviderKey(m.label || key || 'custom-model', Array.from(seenKeys))
    }
    seenKeys.add(key)
    result.push({
      ...m,
      key,
      label: m.label || key,
      url: m.url.trim(),
      desc: m.desc?.trim(),
      icon: m.icon?.trim(),
      color: m.color?.trim()
    })
  }

  return result
}

