export type ShortcutCategory = 'tabs' | 'models' | 'skills' | 'prompting' | 'system'

export interface ShortcutDef {
  id: string
  action: string
  desc: string
  category: ShortcutCategory
  defaultKeys: string[]
  badge?: string
  isGlobal?: boolean
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Tabs & Navigation
  {
    id: 'tab-new',
    action: 'New AI Tab / Model Launcher',
    desc: 'Open a new AI model tab with Model Selector & URL bar',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'T'],
    badge: 'Ultra Fast'
  },
  {
    id: 'tab-close',
    action: 'Close Active Tab',
    desc: 'Instantly dismiss the current active chat tab',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'W']
  },
  {
    id: 'tab-reopen',
    action: 'Reopen Closed Tab',
    desc: 'Restore the most recently closed chat tab',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'Shift', 'T'],
    badge: 'Undo'
  },
  {
    id: 'tab-pin',
    action: 'Pin / Unpin Active Tab',
    desc: 'Lock essential chat tabs into the persistent sidebar',
    category: 'tabs',
    defaultKeys: ['Alt', 'P'],
    badge: 'Productivity'
  },
  {
    id: 'tab-overview',
    action: 'Open Tab Overview',
    desc: 'Search, filter, and preview all open tabs in a visual overlay',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'Shift', 'A'],
    badge: 'New'
  },
  {
    id: 'history-open',
    action: 'Unified Multi-Model History',
    desc: 'Search past chats across Gemini, ChatGPT, Claude, DeepSeek',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'H'],
    badge: 'Unified'
  },
  {
    id: 'url-bar',
    action: 'Omni URL & Search Bar',
    desc: 'Focus URL search or navigate custom provider endpoints',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'L']
  },
  {
    id: 'fuzzy-cmd',
    action: 'Fuzzy Command Palette',
    desc: 'Search tabs, open history, run commands & presets',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'Shift', 'P'],
    badge: 'Power Tool'
  },
  {
    id: 'tab-prev',
    action: 'Previous Tab',
    desc: 'Switch to the left adjacent tab',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'J']
  },
  {
    id: 'tab-next',
    action: 'Next Tab',
    desc: 'Switch to the right adjacent tab',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'K']
  },
  {
    id: 'tab-cycle',
    action: 'Cycle Next Tab',
    desc: 'Cycle forward through open chat tabs',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'Tab']
  },
  {
    id: 'sidebar-toggle',
    action: 'Toggle Sidebar',
    desc: 'Expand or collapse the pinned chats sidebar',
    category: 'tabs',
    defaultKeys: ['Ctrl', 'B']
  },

  // AI Models & Webview
  {
    id: 'upload-file',
    action: 'Upload File to AI',
    desc: 'Triggers the file attachment dialog for the active AI webview',
    category: 'models',
    defaultKeys: ['Ctrl', 'O']
  },
  {
    id: 'upload-folder',
    action: 'Upload Entire Folder as Codebase',
    desc: 'Bundles an entire directory into a single text file and uploads it',
    category: 'models',
    defaultKeys: ['Ctrl', 'Shift', 'O'],
    badge: 'Codebase'
  },
  {
    id: 'model-next',
    action: 'Next AI Provider',
    desc: 'Rotate forward between Gemini, ChatGPT, Claude, DeepSeek',
    category: 'models',
    defaultKeys: ['Ctrl', ']']
  },
  {
    id: 'model-prev',
    action: 'Previous AI Provider',
    desc: 'Rotate backward through configured AI providers',
    category: 'models',
    defaultKeys: ['Ctrl', '[']
  },
  {
    id: 'model-reload',
    action: 'Reload AI Webview',
    desc: 'Hard refresh active provider without losing chat',
    category: 'models',
    defaultKeys: ['Ctrl', 'R']
  },
  {
    id: 'model-dev-tools',
    action: 'Webview Inspector',
    desc: 'Open Chromium DevTools for active webview',
    category: 'models',
    defaultKeys: ['Ctrl', 'Shift', 'D']
  },

  // SuperAntigravity Skills & Tools
  {
    id: 'skills-palette',
    action: 'Skills & Tools Palette',
    desc: 'Instant command palette to search, parameterize, and run AI skills',
    category: 'skills',
    defaultKeys: ['Ctrl', 'S'],
    badge: 'Skills'
  },
  {
    id: 'skills-base-modal',
    action: 'Base Skills Framework Rules',
    desc: 'Configure and inject active SuperAntigravity specialist framework rules',
    category: 'skills',
    defaultKeys: ['Ctrl', 'Shift', 'S'],
    badge: 'Framework'
  },

  // System & Studio
  {
    id: 'settings-open',
    action: 'Settings & Style Studio',
    desc: 'Full aesthetic customizer, cookie sync, and provider overrides',
    category: 'system',
    defaultKeys: ['Ctrl', ',']
  },
  {
    id: 'guide-open',
    action: 'Nexus Helper Guide',
    desc: 'Open the interactive Nexus feature and setup guide anytime',
    category: 'system',
    defaultKeys: ['F1'],
    badge: 'Help'
  },
  {
    id: 'export-context',
    action: 'Export Agent Handoff Context',
    desc: 'Export compressed session state and prompt to hand off to another AI agent',
    category: 'system',
    defaultKeys: ['Ctrl', 'Shift', 'E'],
    badge: 'Handoff'
  },
  {
    id: 'summon-nexus',
    action: 'Summon Nexus',
    desc: 'Global hotkey — show or hide Nexus from anywhere in the OS',
    category: 'system',
    defaultKeys: ['Alt', 'Space'],
    badge: 'Global',
    isGlobal: true
  }
]

const STORAGE_KEY = 'nexus.custom_shortcuts'
const LEGACY_STORAGE_KEY = 'vicinae.custom_shortcuts'
const SHORTCUTS_CHANGED_EVENT = 'nexus-shortcuts-changed'

export function loadCustomShortcuts(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    }
  } catch {}
  return {}
}

export function saveCustomShortcuts(custom: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT))
  }
}

/**
 * Effective keymap for every shortcut (custom override when set, default otherwise).
 * Pushed to the main process so its keyboard router can honor user customizations.
 */
export function getShortcutMap(): Record<string, string[]> {
  const custom = loadCustomShortcuts()
  const map: Record<string, string[]> = {}
  for (const s of DEFAULT_SHORTCUTS) {
    const c = custom[s.id]
    map[s.id] = c && Array.isArray(c) && c.length > 0 ? c : [...s.defaultKeys]
  }
  return map
}

export function getShortcutKeys(id: string): string[] {
  const custom = loadCustomShortcuts()
  if (custom[id] && Array.isArray(custom[id]) && custom[id].length > 0) {
    return custom[id]
  }
  const found = DEFAULT_SHORTCUTS.find((s) => s.id === id)
  return found ? found.defaultKeys : []
}

export function setShortcutKeys(id: string, keys: string[]): void {
  const custom = loadCustomShortcuts()
  const found = DEFAULT_SHORTCUTS.find((s) => s.id === id)
  if (found && keys.join('+') === found.defaultKeys.join('+')) {
    delete custom[id]
  } else {
    custom[id] = keys
  }
  saveCustomShortcuts(custom)
}

export function resetShortcutKeys(id: string): void {
  const custom = loadCustomShortcuts()
  delete custom[id]
  saveCustomShortcuts(custom)
}

export function resetAllShortcuts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT))
  }
}

export function getEffectiveShortcuts(): Array<ShortcutDef & { keys: string[]; isCustom: boolean }> {
  const custom = loadCustomShortcuts()
  return DEFAULT_SHORTCUTS.map((s) => {
    const isCustom = Boolean(custom[s.id] && Array.isArray(custom[s.id]) && custom[s.id].length > 0)
    const keys = isCustom ? custom[s.id] : s.defaultKeys
    return {
      ...s,
      keys,
      isCustom
    }
  })
}

export function findShortcutCollision(id: string, newKeys: string[]): ShortcutDef | null {
  const keyStr = newKeys.join('+').toLowerCase()
  const effective = getEffectiveShortcuts()
  for (const s of effective) {
    if (s.id !== id && s.keys.join('+').toLowerCase() === keyStr) {
      return s
    }
  }
  return null
}

export function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  if (key === 'ArrowUp') return 'Up'
  if (key === 'ArrowDown') return 'Down'
  if (key === 'ArrowLeft') return 'Left'
  if (key === 'ArrowRight') return 'Right'
  if (key === 'Escape' || key === 'Esc') return 'Esc'
  return key
}

export function parseKeyEventToKeys(e: KeyboardEvent): string[] | null {
  const key = e.key
  // Ignore lonely modifier presses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return null
  }

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const norm = normalizeKey(key)
  parts.push(norm)

  return parts
}

export function matchesShortcut(e: KeyboardEvent, keys: string[]): boolean {
  if (!keys || keys.length === 0) return false

  const hasCtrl = keys.includes('Ctrl') || keys.includes('Control')
  const hasAlt = keys.includes('Alt')
  const hasShift = keys.includes('Shift')

  const eventCtrl = e.ctrlKey || e.metaKey
  const eventAlt = e.altKey
  const eventShift = e.shiftKey

  if (Boolean(hasCtrl) !== Boolean(eventCtrl)) return false
  if (Boolean(hasAlt) !== Boolean(eventAlt)) return false
  if (Boolean(hasShift) !== Boolean(eventShift)) return false

  const nonMods = keys.filter((k) => !['Ctrl', 'Control', 'Alt', 'Shift', 'Meta'].includes(k))
  if (nonMods.length === 0) return false

  const targetKey = nonMods[0].toLowerCase()
  const eventKey = normalizeKey(e.key).toLowerCase()

  if (targetKey === eventKey) return true
  if (targetKey === 'b' && (e.code === 'KeyB' || e.code?.toLowerCase() === 'keyb')) return true
  if (targetKey === 'space' && (e.key === ' ' || e.code === 'Space')) return true
  if (targetKey === 'esc' && (e.key === 'Escape' || e.key === 'Esc')) return true

  return false
}

export function onShortcutsChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(SHORTCUTS_CHANGED_EVENT, callback)
  return () => {
    window.removeEventListener(SHORTCUTS_CHANGED_EVENT, callback)
  }
}
