export type ModelKey = string

export interface Tab {
  id: string
  title: string
  model: ModelKey
  url: string
  patternId?: string
  projectDir?: string
  activeSkills?: string[]
  thumbnail?: string
  createdAt: number
  updatedAt: number
}

export interface HistoryItem {
  id?: string
  title: string
  url: string
  model: string
  thumbnail?: string
  timestamp?: number | string
  updatedAt?: string
}

let counter = 0

export function createTab(
  model: ModelKey,
  title: string,
  url: string,
  projectDir?: string
): Tab {
  counter += 1
  const now = Date.now()
  return {
    id: `tab-${now}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    model,
    url,
    projectDir,
    createdAt: now,
    updatedAt: now
  }
}

export function switchToModel(
  tabs: Tab[],
  model: ModelKey,
  defaultTitle: string,
  defaultUrl: string
): { tabs: Tab[]; activeId: string } {
  const created = createTab(model, defaultTitle, defaultUrl)
  return { tabs: [...tabs, created], activeId: created.id }
}

const MODEL_KEYS: Record<string, boolean> = { gemini: true, qwen: true, kimi: true }

export function openHistoryTab(tabs: Tab[], item: HistoryItem): { tabs: Tab[]; activeId: string } {
  const existing = tabs.find((t) => t.url === item.url)
  if (existing) {
    return { tabs, activeId: existing.id }
  }
  const model = MODEL_KEYS[item.model] ? (item.model as ModelKey) : 'gemini'
  const created = createTab(model, item.title || 'New Chat', item.url)
  return { tabs: [...tabs, created], activeId: created.id }
}

export function closeTab(
  tabs: Tab[],
  activeId: string | null,
  id: string
): { tabs: Tab[]; activeId: string | null } {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx === -1) return { tabs, activeId }

  if (tabs.length === 1) {
    const fresh = createTab(tabs[0].model, 'New Chat', originOf(tabs[0].url))
    return { tabs: [fresh], activeId: fresh.id }
  }

  const next = tabs.filter((t) => t.id !== id)
  let nextActive = activeId
  if (activeId === id) {
    const neighbor = next[idx] ?? next[idx - 1] ?? next[0]
    nextActive = neighbor.id
  }
  return { tabs: next, activeId: nextActive }
}

export function addNewChat(
  tabs: Tab[],
  model: ModelKey,
  url: string
): { tabs: Tab[]; activeId: string } {
  const created = createTab(model, 'New Chat', url)
  return { tabs: [...tabs, created], activeId: created.id }
}

export interface ClosedTabEntry {
  tab: Tab
  index: number
  isPinned?: boolean
}

export const MAX_CLOSED_TABS = 30

export function pushClosedTab(
  stack: ClosedTabEntry[],
  tab: Tab,
  index: number,
  isPinned = false
): ClosedTabEntry[] {
  const next = [{ tab, index, isPinned }, ...stack]
  if (next.length > MAX_CLOSED_TABS) {
    return next.slice(0, MAX_CLOSED_TABS)
  }
  return next
}

export function reopenClosedTab(
  tabs: Tab[],
  stack: ClosedTabEntry[]
): {
  tabs: Tab[]
  activeId: string | null
  restoredEntry: ClosedTabEntry | null
  nextStack: ClosedTabEntry[]
} {
  if (stack.length === 0) {
    return { tabs, activeId: null, restoredEntry: null, nextStack: stack }
  }
  const [restoredEntry, ...nextStack] = stack
  const insertIndex = Math.min(Math.max(0, restoredEntry.index), tabs.length)
  const nextTabs = [...tabs]
  nextTabs.splice(insertIndex, 0, restoredEntry.tab)
  return {
    tabs: nextTabs,
    activeId: restoredEntry.tab.id,
    restoredEntry,
    nextStack
  }
}

export function countModelUsage(tabs: Tab[], history: HistoryItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  const bump = (m: string | undefined | null) => {
    if (!m) return
    counts[m] = (counts[m] || 0) + 1
  }
  for (const t of tabs) bump(t.model)
  for (const h of history) bump(h.model)
  return counts
}

export function serializeState(tabs: Tab[], activeId: string | null): string {
  return JSON.stringify({ tabs, activeId })
}

export function deserializeState(
  raw: string | null
): { tabs: Tab[]; activeId: string | null } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const rawList = Array.isArray(parsed) ? parsed : parsed?.tabs
    if (!Array.isArray(rawList)) return null
    const tabs: Tab[] = rawList.filter(
      (t: unknown): t is Tab =>
        t != null &&
        typeof t === 'object' &&
        typeof (t as Tab).id === 'string' &&
        typeof (t as Tab).url === 'string' &&
        typeof (t as Tab).model === 'string'
    )
    if (tabs.length === 0) return null
    const activeId =
      typeof parsed?.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : tabs[0].id
    return { tabs, activeId }
  } catch {
    return null
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

// Provider home/new-chat paths. A tab.url regressing to one of these loses the
// conversation — empty-view recreation (startup rehydrate, Ctrl+W destroy) would
// then load the provider home = a NEW chat instead of restoring the chat.
const HOME_PATHS: Record<string, string[]> = {
  'www.kimi.com': ['/'],
  'kimi.com': ['/'],
  'www.qwen.ai': ['/', '/chat'],
  'qwen.ai': ['/', '/chat'],
  'gemini.google.com': ['/app'],
  'chatgpt.com': ['/'],
  'chat.deepseek.com': ['/', '/a/chat'],
  'deepseek.com': ['/', '/a/chat'],
  'www.perplexity.ai': ['/'],
  'perplexity.ai': ['/']
}

export function isProviderHomeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const paths = HOME_PATHS[u.hostname]
    if (!paths) return false
    return paths.includes(u.pathname.replace(/\/+$/, '') || '/')
  } catch {
    return false
  }
}

const IGNORED_HOST_SUBSTRINGS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'auth0.com',
  'recaptcha',
  'hcaptcha'
]

const IGNORED_PATH_PATTERNS = [
  /\/oauth\b/i,
  /\/signin\b/i,
  /\/signup\b/i,
  /\/login\b/i,
  /\/authorized\b/i,
  /\/sorry\/index/i,
  /\/webhp\b/i,
  /\/search\b/i
]

export function isIgnoredHistoryUrl(url: string): boolean {
  if (!url || typeof url !== 'string' || url.length <= 3) return true
  if (url.startsWith('about:') || url.startsWith('chrome:')) return true
  if (isProviderHomeUrl(url)) return true

  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.toLowerCase()

    if (IGNORED_HOST_SUBSTRINGS.some((sub) => host.includes(sub))) return true
    if (host.includes('google.com') && (path.includes('/search') || path.includes('/webhp') || path.includes('/sorry'))) {
      return true
    }
    if (IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true

    return false
  } catch {
    return true
  }
}

const GENERIC_TITLES = new Set([
  'new chat',
  'untitled chat',
  'google',
  'google gemini',
  'gemini',
  'chatgpt',
  'chat gpt',
  'claude',
  'kimi',
  'kimi ai',
  'kimi.ai',
  'qwen',
  'qwen chat',
  'qwen studio',
  'deepseek',
  'deepseek - into the unknown',
  'perplexity',
  'google ai studio',
  'sign in',
  'sign in - google accounts',
  'log in',
  'login',
  'couldn’t sign you in',
  "couldn't sign you in",
  'just a moment...',
  'cloudflare',
  'attention required!'
])

export function isDefaultOrGenericTitle(
  title?: string | null,
  modelKey?: string | null,
  knownLabels?: string[]
): boolean {
  if (!title || typeof title !== 'string') return true
  const trimmed = title.trim()
  if (!trimmed || trimmed.length === 0) return true
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true

  const lower = trimmed.toLowerCase()
  if (GENERIC_TITLES.has(lower)) return true

  if (modelKey) {
    const mk = modelKey.toLowerCase()
    if (lower === mk || lower === `${mk} chat` || lower === `${mk} ai` || lower === `${mk} studio`) {
      return true
    }
  }

  if (knownLabels && knownLabels.length > 0) {
    for (const label of knownLabels) {
      if (!label) continue
      const lbl = label.trim().toLowerCase()
      if (lower === lbl || lower === `${lbl} chat` || lower === `${lbl} ai`) {
        return true
      }
    }
  }

  return false
}

export function sanitizeHistory(
  rawList: HistoryItem[],
  knownLabels?: string[]
): HistoryItem[] {
  if (!Array.isArray(rawList) || rawList.length === 0) return []

  const seenUrls = new Set<string>()
  const result: HistoryItem[] = []

  for (const item of rawList) {
    if (!item || !item.url) continue
    if (isIgnoredHistoryUrl(item.url)) continue
    if (isDefaultOrGenericTitle(item.title, item.model, knownLabels)) continue

    // Normalize URL key (strip tracking query params / hashes where appropriate)
    let canonicalUrl = item.url
    try {
      const u = new URL(item.url)
      canonicalUrl = `${u.origin}${u.pathname}`
    } catch {}

    if (seenUrls.has(canonicalUrl)) continue
    seenUrls.add(canonicalUrl)

    result.push({
      ...item,
      id: item.id && !item.id.startsWith('tab-') ? item.id : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    })
  }

  return result
}
