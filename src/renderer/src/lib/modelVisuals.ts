// Shared model visual identity — single source of truth for tab pills + sidebar.
// Model colors follow provider brand accents; brand icons from BrandIcons.tsx.

export const DOT_COLOR: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97706',
  gemini: '#22d3ee',
  perplexity: '#2dd4bf',
  deepseek: '#6366f1',
  kimi: '#8b5cf6',
  qwen: '#0284c7',
  mistral: '#f97316',
  grok: '#ffffff'
}

export const BRAND_IDS: Record<string, boolean> = {
  gemini: true,
  chatgpt: true,
  claude: true,
  perplexity: true,
  deepseek: true,
  qwen: true,
  kimi: true,
  mistral: true,
  grok: true
}

export function modelLabel(model: string): string {
  const m = model.toLowerCase()
  if (m === 'gemini') return 'Gemini'
  if (m === 'chatgpt') return 'ChatGPT'
  if (m === 'claude') return 'Claude'
  if (m === 'perplexity') return 'Perplexity'
  if (m === 'deepseek') return 'DeepSeek'
  if (m === 'qwen') return 'Qwen'
  if (m === 'kimi') return 'Kimi'
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

