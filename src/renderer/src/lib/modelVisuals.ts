// Shared model visual identity — single source of truth for tab pills + sidebar.
// Model colors follow provider brand accents; brand icons from BrandIcons.tsx.

export const DOT_COLOR: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#22d3ee',
  perplexity: '#22b8cd',
  deepseek: '#4d6bfe',
  kimi: '#00d1b2',
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

