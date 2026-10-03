export interface ThemeColors {
  bg: string
  surface: string
  surface2: string
  accent: string
  text: string
  text2: string
  border: string
}

export interface AppTheme {
  id: string
  name: string
  isCustom: boolean
  colors: ThemeColors
  radius: number
}

export interface ThemeState {
  activeId: string
  customs: AppTheme[]
}

const STORAGE_KEY = 'nexus.themes'
const LEGACY_STORAGE_KEY = 'vicinae.themes'
export const DEFAULT_THEME_ID = 'iron-man-hud'

export const PRESET_THEMES: AppTheme[] = [
  {
    id: 'iron-man-hud',
    name: 'Iron Man HUD',
    isCustom: false,
    colors: {
      bg: '#050f14',
      surface: '#07101e',
      surface2: '#0b192e',
      accent: '#00e5ff',
      text: '#e0f7fa',
      text2: '#4dd0e1',
      border: '#0d47a1'
    },
    radius: 4
  },
  {
    id: 'default-dark',
    name: 'Default Dark',
    isCustom: false,
    colors: {
      bg: '#1a1a2e',
      surface: '#16213e',
      surface2: '#0f3460',
      accent: '#e94560',
      text: '#eaeaea',
      text2: '#8899aa',
      border: '#2a2a2e'
    },
    radius: 8
  },
  {
    id: 'light',
    name: 'Light',
    isCustom: false,
    colors: {
      bg: '#f4f6fb',
      surface: '#ffffff',
      surface2: '#e8ecf4',
      accent: '#e94560',
      text: '#1a1a2e',
      text2: '#5a6b85',
      border: '#d7dce8'
    },
    radius: 10
  },
  {
    id: 'midnight',
    name: 'Midnight',
    isCustom: false,
    colors: {
      bg: '#0a0a0f',
      surface: '#101018',
      surface2: '#1a1a26',
      accent: '#7dd3fc',
      text: '#e5e7f0',
      text2: '#8b93a7',
      border: '#22222e'
    },
    radius: 12
  },
  {
    id: 'dracula',
    name: 'Dracula',
    isCustom: false,
    colors: {
      bg: '#282a36',
      surface: '#21222c',
      surface2: '#44475a',
      accent: '#bd93f9',
      text: '#f8f8f2',
      text2: '#6272a4',
      border: '#44475a'
    },
    radius: 8
  },
  {
    id: 'nord',
    name: 'Nord',
    isCustom: false,
    colors: {
      bg: '#2e3440',
      surface: '#3b4252',
      surface2: '#434c5e',
      accent: '#88c0d0',
      text: '#eceff4',
      text2: '#8f9bb3',
      border: '#434c5e'
    },
    radius: 6
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    isCustom: false,
    colors: {
      bg: '#1a1b26',
      surface: '#16161e',
      surface2: '#24283b',
      accent: '#7aa2f7',
      text: '#c0caf5',
      text2: '#565f89',
      border: '#292e42'
    },
    radius: 8
  }
]

export function loadThemeState(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ThemeState
      if (parsed && typeof parsed.activeId === 'string' && Array.isArray(parsed.customs)) {
        return parsed
      }
    }
  } catch {
    // corrupted storage -> fall through to defaults
  }
  return { activeId: DEFAULT_THEME_ID, customs: [] }
}

export function saveThemeState(state: ThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full / unavailable -> non-fatal
  }
}

export function findTheme(state: ThemeState): AppTheme {
  const custom = state.customs.find((t) => t.id === state.activeId)
  if (custom) return custom
  const preset = PRESET_THEMES.find((t) => t.id === state.activeId)
  return preset ?? PRESET_THEMES[0]
}

const THEME_VAR_KEYS: (keyof ThemeColors)[] = [
  'bg',
  'surface',
  'surface2',
  'accent',
  'text',
  'text2',
  'border'
]

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement
  for (const key of THEME_VAR_KEYS) {
    root.style.setProperty(`--${key}`, theme.colors[key])
  }
  root.style.setProperty('--radius', `${theme.radius}px`)
  root.dataset.theme = theme.id
}
