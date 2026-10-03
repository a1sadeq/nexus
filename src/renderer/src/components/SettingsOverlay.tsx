import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppTheme, ThemeColors, ThemeState } from '../lib/themes'
import { PRESET_THEMES, DEFAULT_THEME_ID, applyTheme } from '../lib/themes'
import type { ModelDef } from '../App'
import type { ProviderConfigMap, ProviderOverrides } from '../../../shared/providerConfig'
import type { SkillDef } from '../../../shared/skills'
import {
  BrandIcon,
  IconSliders,
  IconGrid,
  IconPalette,
  IconLayers,
  IconMonitor,
  IconKeyboard,
  IconSparkles,
  IconZap,
  IconSearch,
  IconSettings,
  IconHistory,
  IconPin,
  IconShield,
  IconFolder,
  IconMessageSquare,
  IconTrash,
  IconPlus
} from './BrandIcons'
import {
  loadInterfaceSettings,
  saveInterfaceSettings,
  applyInterfaceCssVariables,
  adjustAccentContrast,
  computeSurfaceColors,
  PRESET_CONFIGS,
  type InterfaceSettings,
  type AestheticPreset
} from '../lib/interfaceSettings'
import { IconConfigProvider, type IconPack } from '../lib/iconContext'
import { modelColor, modelLabel, generateProviderKey } from '../lib/modelVisuals'
import { matchesShortcut, getShortcutKeys } from '../lib/shortcuts'
import { ShortcutsMatrix } from './ShortcutsMatrix'
import { SkillsSettingsSection } from './SkillsSettingsSection'
import { WorkspaceSettingsSection } from './WorkspaceSettingsSection'
import { StyleStudioCanvas } from './StyleStudioCanvas'
import { ProviderFeaturesSection } from './ProviderFeaturesSection'
import { generateAiThemingPrompt } from '../lib/promptGenerator'
import './SettingsOverlay.css'

interface Props {
  models: ModelDef[]
  setModels: (updater: (prev: ModelDef[]) => ModelDef[]) => void
  themeState: ThemeState
  setThemeState: (updater: (prev: ThemeState) => ThemeState) => void
  webviewThemeOn: boolean
  setWebviewThemeOn: (on: boolean) => void
  providerConfig: ProviderConfigMap
  setProviderConfig: (updater: (prev: ProviderConfigMap) => ProviderConfigMap) => void
  tabDiscardMinutes: number
  setTabDiscardMinutes: (mins: number) => void
  maxActiveTabs: number
  setMaxActiveTabs: (max: number) => void
  uiZoom: number
  setUiZoom: (val: number | ((prev: number) => number)) => void
  webviewZoom: number
  setWebviewZoom: (val: number | ((prev: number) => number)) => void
  initialSection?: 'general' | 'models' | 'features' | 'skills' | 'workspace' | 'themes' | 'style' | 'webview' | 'shortcuts'
  interfaceSettings?: InterfaceSettings
  onInterfaceSettingsChange?: (settings: InterfaceSettings) => void
  onOpenZenGuide?: () => void
  onOpenSkillEditor?: (skill?: SkillDef) => void
  onClose: () => void
}

const COLOR_LABELS: { key: keyof AppTheme['colors']; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surface2', label: 'Surface 2' },
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
  { key: 'text2', label: 'Text 2' },
  { key: 'border', label: 'Border' }
]

const COLOR_KEYS = ['bg', 'surface', 'surface2', 'accent', 'text', 'text2', 'border'] as const
type ColorKey = (typeof COLOR_KEYS)[number]

// ============================================================================
// Web Audio API Synthesizer (Zero dependencies, crisp haptic-like sound)
// ============================================================================
class SoundFX {
  private ctx: AudioContext | null = null
  private enabled = true

  constructor() {
    try {
      const saved = localStorage.getItem('nexus.settings_sfx')
      this.enabled = saved !== 'false'
    } catch {}
  }

  get isEnabled() {
    return this.enabled
  }

  toggle() {
    this.enabled = !this.enabled
    try {
      localStorage.setItem('nexus.settings_sfx', String(this.enabled))
    } catch {}
    if (this.enabled) this.pop()
    return this.enabled
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) this.ctx = new AudioCtx()
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  click() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(800, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.035)
      gain.gain.setValueAtTime(0.05, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.035)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.04)
    } catch {}
  }

  pop() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(520, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1040, this.ctx.currentTime + 0.06)
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.06)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.065)
    } catch {}
  }

  chime() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      ;[523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = this.ctx!.createOscillator()
        const gain = this.ctx!.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + i * 0.04)
        gain.gain.setValueAtTime(0.04, this.ctx!.currentTime + i * 0.04)
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx!.currentTime + i * 0.04 + 0.15)
        osc.connect(gain)
        gain.connect(this.ctx!.destination)
        osc.start(this.ctx!.currentTime + i * 0.04)
        osc.stop(this.ctx!.currentTime + i * 0.04 + 0.16)
      })
    } catch {}
  }
}
const sfx = new SoundFX()

// ============================================================================
// Universal Settings Search Index (Instant search across all 9 tabs)
// ============================================================================
interface SearchItem {
  id: string
  title: string
  subtitle: string
  tab: 'general' | 'models' | 'features' | 'skills' | 'workspace' | 'themes' | 'style' | 'webview' | 'shortcuts'
  category?: 'theme' | 'layout' | 'chat' | 'icons' | 'css'
  keywords: string[]
}

const SETTINGS_SEARCH_INDEX: SearchItem[] = [
  // General
  { id: 'ui-zoom', title: 'Nexus App UI Zoom', subtitle: 'Global display scale & magnification', tab: 'general', keywords: ['zoom', 'scale', 'ui', 'display', 'size', 'font', 'ctrl+shift++'] },
  { id: 'webview-zoom', title: 'AI Webviews Zoom', subtitle: 'Independent zoom scale for AI tabs', tab: 'general', keywords: ['zoom', 'webview', 'text', 'scale', 'browser', 'ctrl++'] },
  { id: 'session-sync', title: 'Account Sessions & Cookie Sync', subtitle: 'Import Google and AI sessions from browsers', tab: 'general', keywords: ['session', 'cookie', 'google', 'login', 'auth', 'browser', 'chrome', 'brave', 'json', 'paste'] },
  { id: 'tab-discard', title: 'Tab Discard System (RAM Saver)', subtitle: 'Auto-discard idle tabs after inactivity', tab: 'general', keywords: ['memory', 'ram', 'discard', 'inactive', 'sleep', 'performance', 'tabs'] },
  { id: 'max-active-tabs', title: 'Max Active Tabs Limit', subtitle: 'Strict threshold for in-memory tabs', tab: 'general', keywords: ['tabs', 'limit', 'active', 'ram', 'memory', 'max'] },
  { id: 'tab-switcher-limit', title: 'Ctrl+Tab Switcher Count', subtitle: 'Number of recent tabs shown in switcher HUD', tab: 'general', keywords: ['ctrl+tab', 'switcher', 'overlay', 'recent', 'hud'] },
  { id: 'pinned-chats-pos', title: 'Pinned Chats Position', subtitle: 'Left vertical sidebar vs bottom horizontal dock', tab: 'general', keywords: ['pinned', 'sidebar', 'dock', 'bottom', 'chats', 'position', 'layout'] },

  // AI Models
  { id: 'ai-providers', title: 'AI Provider Endpoints & URLs', subtitle: 'Configure Gemini, Claude, ChatGPT, Grok, DeepSeek', tab: 'models', keywords: ['model', 'provider', 'gemini', 'claude', 'chatgpt', 'deepseek', 'grok', 'mistral', 'url', 'brand', 'color'] },
  { id: 'custom-models', title: 'Add Custom AI Provider', subtitle: 'Register a new model endpoint or web URL', tab: 'models', keywords: ['add', 'custom', 'model', 'new', 'endpoint', 'provider'] },

  // AI Features & Hooks
  { id: 'ai-features', title: 'AI Features & Interceptors', subtitle: 'Keyboard shortcuts, DOM hooks & auto-actions', tab: 'features', keywords: ['feature', 'hook', 'prompt', 'shortcut', 'action', 'ctrl+b', 'ctrl+shift+o', 'interceptor', 'context'] },

  // Skills & Tools
  { id: 'skills-tools', title: 'Skills & Agent Framework', subtitle: 'Manage active agent skills, plugins & MCP tools', tab: 'skills', keywords: ['skill', 'tool', 'agent', 'mcp', 'plugin', 'framework', 'automation'] },

  // Workspace
  { id: 'workspace-settings', title: 'Workspace & Directory Storage', subtitle: 'Context compressors, Git repos & cache path', tab: 'workspace', keywords: ['workspace', 'folder', 'git', 'storage', 'export', 'project', 'directory', 'cache'] },

  // Themes
  { id: 'theme-palettes', title: 'Theme Palettes & OLED', subtitle: 'Preset color schemes & custom themes', tab: 'themes', keywords: ['theme', 'palette', 'dark', 'light', 'oled', 'midnight', 'cyber', 'color'] },
  { id: 'theme-customizer', title: 'Theme Customizer & Radius', subtitle: 'Edit surface, accent, and corner radii', tab: 'themes', keywords: ['customize', 'radius', 'surface', 'border', 'accent', 'swatch'] },

  // Interface & Style
  { id: 'aesthetic-presets', title: 'Aesthetic Presets (1-Click)', subtitle: 'Cyberpunk, Refined Modern, Slate & Brand Native', tab: 'style', category: 'theme', keywords: ['preset', 'aesthetic', '1-click', 'cyberpunk', 'modern', 'slate'] },
  { id: 'accent-contrast', title: 'Colors, Accent & Luminance', subtitle: 'Primary accent, glow halo, OLED surface darkness', tab: 'style', category: 'theme', keywords: ['color', 'accent', 'glow', 'darkness', 'contrast', 'luminance', 'vibrancy'] },
  { id: 'geometry-curvature', title: 'Corner Curvature & Typography', subtitle: 'App border radius & typography vibe (Sans/Mono/Tech)', tab: 'style', category: 'layout', keywords: ['geometry', 'radius', 'corner', 'curve', 'font', 'typography', 'sans', 'mono', 'tech'] },
  { id: 'glass-motion', title: 'Glassmorphism & Spring Motion', subtitle: 'Frosted glass backdrop filters & animation speed', tab: 'style', category: 'layout', keywords: ['glass', 'glassmorphism', 'motion', 'spring', 'speed', 'reduced', 'snappy'] },
  { id: 'ambient-aura', title: 'Ambient Aura Illumination', subtitle: 'Dynamic webview glow, viewport frame & spotlight', tab: 'style', category: 'chat', keywords: ['aura', 'ambient', 'glow', 'spotlight', 'intensity', 'illumination', 'frame'] },
  { id: 'chat-bubbles', title: 'AI Chat Bubbles & Width', subtitle: 'AI and user response max widths & gradient pills', tab: 'style', category: 'chat', keywords: ['bubble', 'chat', 'width', 'response', 'gradient', 'spacing', 'gap'] },
  { id: 'code-blocks-composer', title: 'Code Blocks & Composer Halo', subtitle: 'OLED code block styling & neon composer glow', tab: 'style', category: 'chat', keywords: ['code', 'block', 'composer', 'halo', 'neon', 'electric'] },
  { id: 'icon-packs', title: 'Icon Packs & Stroke Weight', subtitle: 'Lucide, Feather, Heroicons, Tabler, Phosphor', tab: 'style', category: 'icons', keywords: ['icon', 'pack', 'glyph', 'lucide', 'feather', 'heroicons', 'tabler', 'phosphor', 'stroke', 'weight'] },
  { id: 'tab-glow-style', title: 'Tab Active Glow Style', subtitle: 'Pill glow, underline laser & subtle halo', tab: 'style', category: 'layout', keywords: ['tab', 'glow', 'active', 'laser', 'pill', 'indicator'] },
  { id: 'custom-css-js', title: 'Webview CSS & JS Control Studio', subtitle: 'Live CSS & JS injection with real-time runner', tab: 'style', category: 'css', keywords: ['css', 'js', 'javascript', 'script', 'style', 'code', 'custom', 'inject', 'selector'] },

  // Webview Studio
  { id: 'webview-sandbox', title: 'Webview Live CSS Sandbox', subtitle: 'Two-way sync CSS editor & customthemes.conf', tab: 'webview', keywords: ['webview', 'css', 'sync', 'customthemes', 'sandbox', 'live', 'theme master'] },

  // Shortcuts
  { id: 'shortcuts-matrix', title: 'Keyboard Shortcuts Matrix', subtitle: 'Key recorder, customizable hotkeys & keycaps', tab: 'shortcuts', keywords: ['shortcut', 'hotkey', 'keyboard', 'ctrl', 'keycap', 'matrix', 'key recorder'] }
]

function SectionTitle({ children, onReset, badge }: { children: ReactNode; onReset?: () => void; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text)]">
        {children}
      </div>
      <div className="flex items-center gap-2">
        {badge && <span className="sleek-badge">{badge}</span>}
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title="Reset section to global theme"
            className="w-5 h-5 rounded-md flex items-center justify-center text-xs opacity-60 hover:opacity-100 hover:bg-white/10 transition-all cursor-pointer"
            style={{ color: 'var(--text2)' }}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}

function Card({ children, className = '', glow = false }: { children: ReactNode; className?: string; glow?: boolean }) {
  return (
    <div
      className={`sleek-card p-4 sm:p-5 flex flex-col gap-4 relative overflow-hidden ${glow ? 'sleek-card-active' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SyncCssEditor — two-way CSS <-> config                              */
/* ------------------------------------------------------------------ */

interface ParsedEditor {
  colors?: Partial<Record<ColorKey, string>>
  geometry?: { radius?: number; borderWidth?: number }
  typography?: {
    fontWeight?: number
    fontWeightHeadings?: number
    fontSize?: number
    fontFamily?: string
    lineHeight?: number
    letterSpacing?: number
  }
  layout?: { pageWidth?: number; bubbleMaxWidth?: number; composerWidth?: number }
  effects?: {
    selectionBg?: string
    selectionFg?: string
    scrollbarThumb?: string
    scrollbarTrack?: string
    shadowAlpha?: number
    hoverTintAlpha?: number
    codeBlockBg?: string
    codeBlockRadius?: number
  }
  customCss?: string
}

// Clamp table mirrors the GUI slider bounds so editor and controls agree.
const CLAMP: Record<string, [number, number]> = {
  radius: [0, 48],
  borderWidth: [0, 8],
  fontWeight: [400, 900],
  fontWeightHeadings: [400, 900],
  fontSize: [10, 32],
  lineHeight: [1, 3],
  letterSpacing: [-2, 8],
  shadowAlpha: [0, 1],
  hoverTintAlpha: [0, 1],
  codeBlockRadius: [0, 32],
  pageWidth: [320, 2400],
  bubbleMaxWidth: [320, 2400],
  composerWidth: [320, 2400]
}
const clampNum = (k: string, n: number): number => {
  const [lo, hi] = CLAMP[k] ?? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  return Math.min(hi, Math.max(lo, n))
}

function buildCssText(
  cfg: ProviderOverrides,
  global: { colors: ThemeColors; radius: number },
  providerLabel: string,
  themeName: string
): string {
  const L: string[] = []
  L.push('/* =============================================================== */')
  L.push(`/* ${providerLabel} — applied webview theme`)
  L.push(`/* Base: ${themeName} · edits two-way sync with the GUI controls    */`)
  L.push('/* =============================================================== */')
  L.push('')
  L.push('/* ---- Global theme (variables, read-only reference) ---- */')
  for (const k of COLOR_KEYS) L.push(`--${k}: ${global.colors[k]};`)
  L.push(`--radius: ${global.radius}px;`)
  L.push('')
  L.push('/* ---- Provider overrides ---- */')
  const o: string[] = []
  if (cfg.colors) {
    for (const k of COLOR_KEYS) if (cfg.colors[k]) o.push(`color-${k}: ${cfg.colors[k]};`)
  }
  if (cfg.geometry?.radius != null) o.push(`border-radius: ${cfg.geometry.radius}px;`)
  if (cfg.geometry?.borderWidth != null) o.push(`border-width: ${cfg.geometry.borderWidth}px;`)
  if (cfg.typography?.fontWeight != null) o.push(`font-weight: ${cfg.typography.fontWeight};`)
  if (cfg.typography?.fontWeightHeadings != null)
    o.push(`font-weight-headings: ${cfg.typography.fontWeightHeadings};`)
  if (cfg.typography?.fontSize != null) o.push(`font-size: ${cfg.typography.fontSize}px;`)
  if (cfg.typography?.lineHeight != null) o.push(`line-height: ${cfg.typography.lineHeight};`)
  if (cfg.typography?.letterSpacing != null)
    o.push(`letter-spacing: ${cfg.typography.letterSpacing}px;`)
  if (cfg.typography?.fontFamily) o.push(`font-family: ${cfg.typography.fontFamily};`)
  if (cfg.layout?.pageWidth != null)
    o.push(`max-width: ${cfg.layout.pageWidth}px;  /* page-width */`)
  if (cfg.layout?.bubbleMaxWidth != null)
    o.push(`max-width: ${cfg.layout.bubbleMaxWidth}px;  /* bubble-max-width */`)
  if (cfg.layout?.composerWidth != null)
    o.push(`max-width: ${cfg.layout.composerWidth}px;  /* composer-width */`)
  if (cfg.effects) {
    if (cfg.effects.selectionBg) o.push(`selection-bg: ${cfg.effects.selectionBg};`)
    if (cfg.effects.selectionFg) o.push(`selection-fg: ${cfg.effects.selectionFg};`)
    if (cfg.effects.scrollbarThumb) o.push(`scrollbar-thumb: ${cfg.effects.scrollbarThumb};`)
    if (cfg.effects.scrollbarTrack) o.push(`scrollbar-track: ${cfg.effects.scrollbarTrack};`)
    if (cfg.effects.codeBlockBg) o.push(`code-block-bg: ${cfg.effects.codeBlockBg};`)
    if (cfg.effects.shadowAlpha != null) o.push(`shadow-alpha: ${cfg.effects.shadowAlpha};`)
    if (cfg.effects.hoverTintAlpha != null)
      o.push(`hover-tint-alpha: ${cfg.effects.hoverTintAlpha};`)
    if (cfg.effects.codeBlockRadius != null)
      o.push(`code-block-radius: ${cfg.effects.codeBlockRadius}px;`)
  }
  if (o.length) L.push(...o)
  else L.push('/* none — inherits global theme */')
  L.push('')
  L.push('/* ---- Custom CSS (unmatched rules land here) ---- */')
  if (cfg.customCss) L.push(cfg.customCss)
  return L.join('\n')
}

const LINE_PATTERNS: { key: string; re: RegExp }[] = [
  {
    key: 'colorBg',
    re: /^\s*color-(bg|surface|surface2|accent|text|text2|border):\s*(#[0-9a-fA-F]{3,8})/
  },
  { key: 'radius', re: /^\s*border-radius:\s*(\d+)px/ },
  { key: 'borderWidth', re: /^\s*border-width:\s*(\d+)px/ },
  { key: 'fontWeight', re: /^\s*font-weight:\s*(\d+)/ },
  { key: 'fontWeightHeadings', re: /^\s*font-weight-headings:\s*(\d+)/ },
  { key: 'fontSize', re: /^\s*font-size:\s*(\d+)px/ },
  { key: 'lineHeight', re: /^\s*line-height:\s*([\d.]+)/ },
  { key: 'letterSpacing', re: /^\s*letter-spacing:\s*(-?[\d.]+)px/ },
  { key: 'fontFamily', re: /^\s*font-family:\s*([^;\n]+)/ },
  { key: 'maxWidthPage', re: /^\s*max-width:\s*(\d+)px[^\n]*page-width/ },
  { key: 'maxWidthBubble', re: /^\s*max-width:\s*(\d+)px[^\n]*bubble-max-width/ },
  { key: 'maxWidthComposer', re: /^\s*max-width:\s*(\d+)px[^\n]*composer-width/ },
  { key: 'selectionBg', re: /^\s*selection-bg:\s*(#[0-9a-fA-F]{3,8})/ },
  { key: 'selectionFg', re: /^\s*selection-fg:\s*(#[0-9a-fA-F]{3,8})/ },
  { key: 'scrollbarThumb', re: /^\s*scrollbar-thumb:\s*(#[0-9a-fA-F]{3,8})/ },
  { key: 'scrollbarTrack', re: /^\s*scrollbar-track:\s*(#[0-9a-fA-F]{3,8})/ },
  { key: 'codeBlockBg', re: /^\s*code-block-bg:\s*(#[0-9a-fA-F]{3,8})/ },
  { key: 'shadowAlpha', re: /^\s*shadow-alpha:\s*([\d.]+)/ },
  { key: 'hoverTintAlpha', re: /^\s*hover-tint-alpha:\s*([\d.]+)/ },
  { key: 'codeBlockRadius', re: /^\s*code-block-radius:\s*(\d+)px/ }
]

function parseCssText(raw: string): ParsedEditor {
  const out: ParsedEditor = { customCss: '' }
  const custom: string[] = []
  let section: 'global' | 'overrides' | 'custom' = 'overrides'
  let inRule = false // brace-context: lines inside { ... } are rule furniture, preserved verbatim

  for (const line of raw.split('\n')) {
    const label = line.trim().toLowerCase()
    if (label.startsWith('/* ---- global theme')) {
      section = 'global'
      inRule = false
      continue
    }
    if (label.startsWith('/* ---- provider overrides')) {
      section = 'overrides'
      inRule = false
      continue
    }
    if (label.startsWith('/* ---- custom css')) {
      section = 'custom'
      inRule = false
      continue
    }
    if (/^\s*$/.test(line)) continue
    // Generated header block we own — never reaches the custom bucket.
    if (/^\s*\/\* =/.test(line)) continue
    if (/applied webview theme/.test(line)) continue
    if (/^\s*\/\* Base:/.test(line)) continue
    if (/^\s*\/\* none — inherits global theme/.test(line)) continue

    // Global reference section: consumed but not committed to overrides.
    if (section === 'global') continue

    const opens = (line.match(/{/g) ?? []).length
    const closes = (line.match(/}/g) ?? []).length
    if (opens > closes) inRule = true
    else if (closes > opens) inRule = false
    else if (opens > 0) inRule = false // balanced on this line

    if (opens > 0 || inRule) {
      // Rule furniture — keep scoped rules scoped: preserve verbatim, do NOT extract.
      custom.push(line)
      continue
    }

    // Bare declaration line — matched props drive the GUI, the rest is custom.
    let matched = false
    for (const { key, re } of LINE_PATTERNS) {
      const m = re.exec(line)
      if (!m) continue
      matched = true
      switch (key) {
        case 'colorBg': {
          const k = m[1] as ColorKey
          out.colors = { ...(out.colors || {}), [k]: m[2].toLowerCase() }
          break
        }
        case 'radius':
          out.geometry = { ...(out.geometry || {}), radius: clampNum('radius', Number(m[1])) }
          break
        case 'borderWidth':
          out.geometry = {
            ...(out.geometry || {}),
            borderWidth: clampNum('borderWidth', Number(m[1]))
          }
          break
        case 'fontWeight':
          out.typography = {
            ...(out.typography || {}),
            fontWeight: clampNum('fontWeight', Number(m[1]))
          }
          break
        case 'fontWeightHeadings':
          out.typography = {
            ...(out.typography || {}),
            fontWeightHeadings: clampNum('fontWeightHeadings', Number(m[1]))
          }
          break
        case 'fontSize':
          out.typography = {
            ...(out.typography || {}),
            fontSize: clampNum('fontSize', Number(m[1]))
          }
          break
        case 'lineHeight':
          out.typography = {
            ...(out.typography || {}),
            lineHeight: clampNum('lineHeight', Number(m[1]))
          }
          break
        case 'letterSpacing':
          out.typography = {
            ...(out.typography || {}),
            letterSpacing: clampNum('letterSpacing', Number(m[1]))
          }
          break
        case 'fontFamily': {
          const v = m[1].replace(/["']/g, '').trim().replace(/,\s*$/, '')
          if (v) out.typography = { ...(out.typography || {}), fontFamily: v }
          break
        }
        case 'maxWidthPage':
          out.layout = { ...(out.layout || {}), pageWidth: clampNum('pageWidth', Number(m[1])) }
          break
        case 'maxWidthBubble':
          out.layout = {
            ...(out.layout || {}),
            bubbleMaxWidth: clampNum('bubbleMaxWidth', Number(m[1]))
          }
          break
        case 'maxWidthComposer':
          out.layout = {
            ...(out.layout || {}),
            composerWidth: clampNum('composerWidth', Number(m[1]))
          }
          break
        case 'selectionBg':
          out.effects = { ...(out.effects || {}), selectionBg: m[1].toLowerCase() }
          break
        case 'selectionFg':
          out.effects = { ...(out.effects || {}), selectionFg: m[1].toLowerCase() }
          break
        case 'scrollbarThumb':
          out.effects = { ...(out.effects || {}), scrollbarThumb: m[1].toLowerCase() }
          break
        case 'scrollbarTrack':
          out.effects = { ...(out.effects || {}), scrollbarTrack: m[1].toLowerCase() }
          break
        case 'codeBlockBg':
          out.effects = { ...(out.effects || {}), codeBlockBg: m[1].toLowerCase() }
          break
        case 'shadowAlpha':
          out.effects = {
            ...(out.effects || {}),
            shadowAlpha: clampNum('shadowAlpha', Number(m[1]))
          }
          break
        case 'hoverTintAlpha':
          out.effects = {
            ...(out.effects || {}),
            hoverTintAlpha: clampNum('hoverTintAlpha', Number(m[1]))
          }
          break
        case 'codeBlockRadius':
          out.effects = {
            ...(out.effects || {}),
            codeBlockRadius: clampNum('codeBlockRadius', Number(m[1]))
          }
          break
      }
      break
    }
    if (!matched) custom.push(line)
  }

  const trimmed = custom.join('\n').trim()
  if (trimmed) out.customCss = trimmed
  return out
}

function SyncCssEditor({
  cfg,
  globalColors,
  globalRadius,
  providerLabel,
  themeName,
  onParsed
}: {
  cfg: ProviderOverrides
  globalColors: ThemeColors
  globalRadius: number
  providerLabel: string
  themeName: string
  onParsed: (p: ParsedEditor) => void
}) {
  const cssText = useMemo(
    () =>
      buildCssText(cfg, { colors: globalColors, radius: globalRadius }, providerLabel, themeName),
    [cfg, globalColors, globalRadius, providerLabel, themeName]
  )
  const [text, setText] = useState<string>(() => cssText)
  const textRef = useRef(text)
  const focusedRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Prop -> text sync only while the user is NOT editing (avoids cursor jumps).
  useEffect(() => {
    if (focusedRef.current) return
    setText(cssText)
  }, [cssText])

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  const commit = (raw: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    onParsed(parseCssText(raw))
  }

  const handleChange = (raw: string) => {
    textRef.current = raw
    setText(raw)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => commit(textRef.current), 300)
  }

  return (
    <textarea
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={() => {
        focusedRef.current = true
      }}
      onBlur={() => {
        focusedRef.current = false
        commit(textRef.current) // flush pending edits immediately on blur
      }}
      spellCheck={false}
      wrap="off"
      className="w-full h-full resize-none rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
      placeholder="/* Type CSS — matched properties sync to the sliders, the rest lands in custom CSS */"
    />
  )
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

export default function SettingsOverlay({
  models,
  setModels,
  themeState,
  setThemeState,
  webviewThemeOn,
  setWebviewThemeOn,
  providerConfig,
  setProviderConfig,
  tabDiscardMinutes,
  setTabDiscardMinutes,
  maxActiveTabs,
  setMaxActiveTabs,
  uiZoom,
  setUiZoom,
  webviewZoom,
  setWebviewZoom,
  initialSection,
  interfaceSettings: parentInterfaceSettings,
  onInterfaceSettingsChange,
  onOpenZenGuide,
  onOpenSkillEditor,
  onClose
}: Props) {
  const [tab, setTab] = useState<'general' | 'models' | 'features' | 'skills' | 'workspace' | 'themes' | 'style' | 'webview' | 'shortcuts'>(() => {
    if (initialSection) return initialSection
    const saved = localStorage.getItem('nexus.settingsTab') || localStorage.getItem('vicinae.settingsTab')
    return saved === 'general' || saved === 'models' || saved === 'features' || saved === 'skills' || saved === 'workspace' || saved === 'themes' || saved === 'style' || saved === 'webview' || saved === 'shortcuts'
      ? (saved as any)
      : 'general'
  })

  useEffect(() => {
    if (initialSection) {
      setTab(initialSection)
    } else {
      const saved = localStorage.getItem('nexus.settingsTab') || localStorage.getItem('vicinae.settingsTab')
      if (saved === 'general' || saved === 'models' || saved === 'features' || saved === 'skills' || saved === 'workspace' || saved === 'themes' || saved === 'style' || saved === 'webview' || saved === 'shortcuts') {
        setTab(saved as any)
      }
    }
  }, [initialSection])

  useEffect(() => {
    localStorage.setItem('nexus.settingsTab', tab)
  }, [tab])

  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(
    () => parentInterfaceSettings || loadInterfaceSettings()
  )

  useEffect(() => {
    if (parentInterfaceSettings) {
      setInterfaceSettings(parentInterfaceSettings)
    }
  }, [parentInterfaceSettings])

  const updateInterfaceSetting = <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => {
    setInterfaceSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveInterfaceSettings(next)
      applyInterfaceCssVariables(next)
      onInterfaceSettingsChange?.(next)
      return next
    })
  }

  const handleSelectPreset = (preset: AestheticPreset) => {
    if (preset === 'custom') {
      updateInterfaceSetting('aestheticPreset', 'custom')
      return
    }
    const overrides = PRESET_CONFIGS[preset]
    setInterfaceSettings((prev) => {
      const next: InterfaceSettings = {
        ...prev,
        ...overrides,
        aestheticPreset: preset
      }
      saveInterfaceSettings(next)
      applyInterfaceCssVariables(next)
      onInterfaceSettingsChange?.(next)
      return next
    })
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [sfxEnabled, setSfxEnabled] = useState(() => sfx.isEnabled)
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({})

  const matchingSearchItems = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return []
    return SETTINGS_SEARCH_INDEX.filter((item) => {
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
      )
    })
  }, [globalSearch])

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
    // @ts-ignore
    window.electron?.ipcRenderer.send('claim_window_focus')
  }, [])

  // Escape key or Settings shortcut to close settings overlay, and / or Ctrl+F to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) &&
        !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)
      ) {
        e.preventDefault()
        e.stopPropagation()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === 'Escape' || e.key === 'Esc' || matchesShortcut(e, getShortcutKeys('settings-open'))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onClose])

  const [customName, setCustomName] = useState('My Theme')
  const [selProvider, setSelProvider] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('nexus.settings_sel_provider') || localStorage.getItem('vicinae.settings_sel_provider')
      if (saved && models.some((m) => m.key === saved)) return saved
    } catch {}
    return models[0]?.key ?? ''
  })

  const handleSelectProvider = (key: string) => {
    setSelProvider(key)
    try {
      localStorage.setItem('nexus.settings_sel_provider', key)
    } catch {}
  }
  
  const [hasFileOverride, setHasFileOverride] = useState(false)
  useEffect(() => {
    // Check if the current provider has a file override in customthemes.conf
    window.electron?.ipcRenderer?.invoke('get_custom_theme_entry', selProvider)
      .then((entry) => {
        if (entry) {
          setHasFileOverride(true)
          // Load it into the editor if the editor currently has no custom CSS for this provider
          setProviderConfig(prev => {
            const currentConfigCss = prev[selProvider]?.customCss
            if (!currentConfigCss && entry.css) {
              const nextMap = { ...prev, [selProvider]: { ...prev[selProvider], customCss: entry.css } }
              try { localStorage.setItem('nexus.provider_config', JSON.stringify(nextMap)) } catch {}
              return nextMap
            }
            return prev
          })
        } else {
          setHasFileOverride(false)
        }
      })
      .catch(() => setHasFileOverride(false))
  }, [selProvider])

  // Draft edits on top of a preset, applied live but only persisted on "Save as custom".
  const [draft, setDraft] = useState<AppTheme | null>(null)
  // Live AI-webview mirror (main streams ~3fps while start_webview_preview is active)
  const [previewFrame, setPreviewFrame] = useState<string | null>(null)
  // False when the selected provider has no open tab — no view to capture.
  const [previewAvailable, setPreviewAvailable] = useState(true)
  const [previewFitMode, setPreviewFitMode] = useState<'contain' | 'cover'>(() => {
    try {
      const saved = localStorage.getItem('nexus.preview_fit_mode')
      if (saved === 'cover' || saved === 'contain') return saved
    } catch {}
    return 'contain'
  })

  const [liveStageFit, setLiveStageFit] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nexus.livestage_fit') === 'true'
    } catch {
      return false
    }
  })

  const toggleLiveStageFit = () => {
    setLiveStageFit((prev) => {
      const next = !prev
      try {
        localStorage.setItem('nexus.livestage_fit', String(next))
      } catch {}
      return next
    })
  }

  const [signInStatus, setSignInStatus] = useState<string>('')
  const [signInProfiles, setSignInProfiles] = useState<
    Array<{ id: string; browser: string; name: string; hasGoogleAuth: boolean; lastAccessed?: number; isLatest?: boolean }>
  >([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [showJsonPaste, setShowJsonPaste] = useState(false)
  const [jsonPayload, setJsonPayload] = useState('')
  const [isApplyingJson, setIsApplyingJson] = useState(false)
  const [sessionSyncResult, setSessionSyncResult] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [syncingProfileId, setSyncingProfileId] = useState<string | null>(null)

  const [styleSubTab, setStyleSubTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('nexus.style_sub_tab') || localStorage.getItem('vicinae.style_sub_tab')
      if (saved) return saved
    } catch {}
    return 'ALL'
  })
  const [styleCategoryTab, setStyleCategoryTab] = useState<'theme' | 'layout' | 'chat' | 'icons' | 'css'>(() => {
    try {
      const saved = localStorage.getItem('nexus.style_category_tab')
      if (saved) return saved as 'theme' | 'layout' | 'chat' | 'icons' | 'css'
    } catch {}
    return 'theme'
  })
  const [styleSearchQuery, setStyleSearchQuery] = useState('')

  const handleSelectStyleCategory = (cat: 'theme' | 'layout' | 'chat' | 'icons' | 'css') => {
    setStyleCategoryTab(cat)
    try {
      localStorage.setItem('nexus.style_category_tab', cat)
    } catch {}
  }

  const [copiedCssToast, setCopiedCssToast] = useState<string | null>(null)

  // Per-Tab & Per-Provider Sub-Tab Scroll & Focus Position Memory
  const scrollMapRef = useRef<Record<string, number>>({})
  const lastFocusMapRef = useRef<Record<string, string>>({})
  const activeContentScrollRef = useRef<HTMLDivElement | null>(null)

  // Initialize scroll and focus maps from localStorage
  useEffect(() => {
    try {
      const savedScroll = localStorage.getItem('nexus.settings_scroll_map') || localStorage.getItem('vicinae.settings_scroll_map')
      if (savedScroll) scrollMapRef.current = JSON.parse(savedScroll)
      const savedFocus = localStorage.getItem('nexus.settings_last_focus_map') || localStorage.getItem('vicinae.settings_last_focus_map')
      if (savedFocus) lastFocusMapRef.current = JSON.parse(savedFocus)
    } catch {}
  }, [])

  const getActiveScrollKey = useCallback(() => {
    return tab === 'style' ? `style:${styleSubTab}` : tab
  }, [tab, styleSubTab])

  const handleContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    const key = getActiveScrollKey()
    scrollMapRef.current[key] = top
    try {
      localStorage.setItem('nexus.settings_scroll_map', JSON.stringify(scrollMapRef.current))
    } catch {}
  }

  const handleContentFocusCapture = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement
    const settingKey = target.getAttribute('data-setting-key') || target.getAttribute('name') || target.id
    if (settingKey) {
      const key = getActiveScrollKey()
      lastFocusMapRef.current[key] = settingKey
      try {
        localStorage.setItem('nexus.settings_last_focus_map', JSON.stringify(lastFocusMapRef.current))
      } catch {}
    }
  }

  // Restore scroll position and focus when tab or subTab changes, or on mount
  useLayoutEffect(() => {
    const key = getActiveScrollKey()
    const restore = () => {
      if (activeContentScrollRef.current) {
        const savedTop = scrollMapRef.current[key] || 0
        activeContentScrollRef.current.scrollTop = savedTop
      }
      const savedFocusKey = lastFocusMapRef.current[key]
      if (savedFocusKey && activeContentScrollRef.current) {
        const el = activeContentScrollRef.current.querySelector<HTMLElement>(
          `[data-setting-key="${savedFocusKey}"], [name="${savedFocusKey}"], #${savedFocusKey}`
        )
        if (el && typeof el.focus === 'function' && document.activeElement !== el) {
          el.focus({ preventScroll: true })
        }
      }
    }
    restore()
    const raf = requestAnimationFrame(restore)
    const timer = setTimeout(restore, 60)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [tab, styleSubTab, getActiveScrollKey])

  const handleSelectSubTab = (subTab: 'ALL' | string) => {
    setStyleSubTab(subTab)
    try {
      localStorage.setItem('nexus.style_sub_tab', subTab)
      if (subTab !== 'ALL') {
        localStorage.setItem('nexus.settings_sel_provider', subTab)
        setSelProvider(subTab)
      }
    } catch {}
  }

  const currentProviderOverrides: ProviderOverrides = (styleSubTab !== 'ALL' ? providerConfig[styleSubTab] : undefined) || {}

  const updateProviderOverrideField = <K extends keyof ProviderOverrides>(field: K, value: ProviderOverrides[K] | undefined) => {
    if (styleSubTab === 'ALL') return

    // If setting accentColor, also synchronize with model definition color (AI Provider's icon main color)
    if (field === 'accentColor') {
      const colorVal = typeof value === 'string' && value ? value : undefined
      setModels((prev) =>
        prev.map((pm) => (pm.key === styleSubTab ? { ...pm, color: colorVal } : pm))
      )
    }

    setProviderConfig((prev) => {
      const prevOv = prev[styleSubTab] || {}
      const nextOv = { ...prevOv }
      if (value === undefined || value === '') {
        delete nextOv[field]
      } else {
        nextOv[field] = value
      }
      const nextMap = { ...prev, [styleSubTab]: nextOv }
      try {
        localStorage.setItem('nexus.provider_config', JSON.stringify(nextMap))
      } catch {}
      // @ts-ignore
      window.electron?.ipcRenderer?.send('set_provider_config', nextMap)
      return nextMap
    })
  }

  const resetAllOverridesForCurrentProvider = () => {
    if (styleSubTab === 'ALL') return
    setModels((prev) =>
      prev.map((pm) => (pm.key === styleSubTab ? { ...pm, color: undefined } : pm))
    )
    setProviderConfig((prev) => {
      const nextMap = { ...prev }
      delete nextMap[styleSubTab]
      try {
        localStorage.setItem('nexus.provider_config', JSON.stringify(nextMap))
      } catch {}
      // @ts-ignore
      window.electron?.ipcRenderer?.send('set_provider_config', nextMap)
      return nextMap
    })
  }

  const handleSyncAllSessions = async () => {
    setIsSyncing(true)
    setSessionSyncResult(null)
    try {
      // @ts-ignore
      const res = await window.electron?.googleSignIn?.syncAll()
      if (res && res.success) {
        try { localStorage.setItem('nexus.has_synced_sessions', 'true') } catch {}
        setSessionSyncResult({
          type: 'success',
          message: res.message || `Successfully synced ${res.count ?? 0} session cookies from browser profiles.`
        })
      } else {
        setSessionSyncResult({
          type: 'error',
          message: res?.message || 'No active session cookies found in detected browser profiles.'
        })
      }
    } catch (err) {
      setSessionSyncResult({
        type: 'error',
        message: `Sync failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSyncProfile = async (profileId: string, profileName: string) => {
    setSyncingProfileId(profileId)
    setSessionSyncResult(null)
    try {
      // @ts-ignore
      const res = await window.electron?.googleSignIn?.syncProfile(profileId)
      if (res && res.success) {
        try { localStorage.setItem('nexus.has_synced_sessions', 'true') } catch {}
        setSessionSyncResult({
          type: 'success',
          message: res.message || `Successfully synced ${res.count ?? 0} session cookie(s) from "${profileName}".`
        })
      } else {
        setSessionSyncResult({
          type: 'error',
          message: res?.message || `No active AI cookies found in profile "${profileName}".`
        })
      }
    } catch (err) {
      setSessionSyncResult({
        type: 'error',
        message: `Sync failed for ${profileName}: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setSyncingProfileId(null)
    }
  }

  const handleApplyJsonCookies = async () => {
    if (!jsonPayload.trim()) return
    setIsApplyingJson(true)
    setSessionSyncResult(null)
    try {
      // @ts-ignore
      const res = await window.electron?.googleSignIn?.importJson(jsonPayload.trim())
      if (res && res.success) {
        try { localStorage.setItem('nexus.has_synced_sessions', 'true') } catch {}
        setSessionSyncResult({
          type: 'success',
          message: res.message || `Successfully injected ${res.count ?? 0} cookies and reloaded active AI views!`
        })
        setJsonPayload('')
        setShowJsonPaste(false)
      } else {
        setSessionSyncResult({
          type: 'error',
          message: res?.message || res?.error || 'Failed to inject cookies. Please check your JSON format.'
        })
      }
    } catch (err) {
      setSessionSyncResult({
        type: 'error',
        message: `Import failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setIsApplyingJson(false)
    }
  }

  useEffect(() => {
    // @ts-ignore
    window.electron?.googleSignIn?.getProfiles?.().then((profiles: any) => {
      if (Array.isArray(profiles) && profiles.length > 0) {
        setSignInProfiles(profiles)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const onEv = (_e: unknown, ev: { stage: string; email?: string; message?: string; profiles?: Array<{ id: string; browser: string; name: string; hasGoogleAuth: boolean }> }) => {
      switch (ev.stage) {
        case 'opening-browser':
          setSignInStatus('Opening your browser… sign in to Google there, then return here.')
          setSignInProfiles([])
          break
        case 'waiting':
          setSignInStatus('Waiting for you to sign in in your browser…')
          break
        case 'success':
          setSignInStatus(`Signed in as ${ev.email ?? 'you'}. Reloading Gemini…`)
          break
        case 'error':
          setSignInStatus(`Sign-in failed: ${ev.message ?? 'unknown error'}`)
          break
        case 'keyring-error':
          setSignInStatus(`Sign-in failed: ${ev.message ?? 'Chrome keyring locked'}`)
          break
        case 'no-auth':
          setSignInStatus('No Google session found. Pick a browser profile with a Google login:')
          setSignInProfiles(ev.profiles ?? [])
          break
      }
    }
    // @ts-ignore
    window.electron?.googleSignIn?.onEvent(onEv)
    return () => {
      // @ts-ignore
      window.electron?.ipcRenderer.removeListener('google-signin-event', onEv)
    }
  }, [])

  const activeTheme =
    themeState.customs.find((t) => t.id === themeState.activeId) ??
    PRESET_THEMES.find((t) => t.id === themeState.activeId) ??
    PRESET_THEMES[0]

  const displayed = draft ?? activeTheme

  const applyToActive = (mut: (t: AppTheme) => AppTheme) => {
    const isCustom = themeState.customs.some((t) => t.id === themeState.activeId)
    if (isCustom) {
      setThemeState((prev) => ({
        ...prev,
        customs: prev.customs.map((t) => (t.id === prev.activeId ? mut(t) : t))
      }))
    } else {
      setDraft(mut(activeTheme))
    }
  }

  useEffect(() => {
    setDraft(null)
  }, [themeState.activeId])

  useEffect(() => {
    applyTheme(displayed)
    applyInterfaceCssVariables(interfaceSettings)
  }, [displayed, interfaceSettings])

  // Push the CURRENTLY DISPLAYED theme (incl. in-flight preset edits, which
  // live only in `draft` and never touch themeState) to the main process so
  // the AI webview + live preview track the editor live. App.tsx only re-sends
  // on themeState/activeId changes, which misses draft-only preset tweaks.
  useEffect(() => {
    const activeColors = displayed.colors
    const darkness = interfaceSettings.surfaceDarkness ?? 50
    const baseSurface = interfaceSettings.surfaceBgColor || activeColors.bg || '#0b0c14'
    const palette = computeSurfaceColors(baseSurface, darkness)

    const contrast = interfaceSettings.accentContrast ?? 100
    const baseAccent = interfaceSettings.accentColor || activeColors.accent || '#6366f1'
    const transformedAccent = adjustAccentContrast(baseAccent, contrast)

    const themeColors = {
      ...activeColors,
      bg: palette.bg,
      surface: palette.surface,
      surface2: palette.surface2,
      border: palette.border,
      accent: transformedAccent
    }
    window.electron?.ipcRenderer.send('set_webview_theme', {
      on: webviewThemeOn,
      colors: themeColors,
      radius: interfaceSettings.cornerRadius ?? displayed.radius,
      ambientAura: interfaceSettings.webviewAmbientAura,
      ambientAuraMode: interfaceSettings.ambientAuraMode,
      ambientAuraIntensity: interfaceSettings.ambientAuraIntensity,
      ambientAuraColor: interfaceSettings.ambientAuraColor || interfaceSettings.accentColor,
      bubbleStyle: interfaceSettings.webviewBubbleStyle,
      bubbleGradientDepth: interfaceSettings.bubbleGradientDepth,
      codeBlockStyle: interfaceSettings.webviewCodeBlockStyle,
      codeBlockMargin: interfaceSettings.codeBlockMargin,
      composerGlow: interfaceSettings.webviewComposerGlow,
      composerHaloIntensity: interfaceSettings.composerHaloIntensity,
      messageGap: interfaceSettings.messageGap,
      aiResponseWidthPx: interfaceSettings.aiResponseWidthPx,
      userPromptWidthPx: interfaceSettings.userPromptWidthPx
    })
  }, [displayed, webviewThemeOn, interfaceSettings])

  useEffect(() => {
    if (tab !== 'webview' && !(tab === 'style' && styleCategoryTab === 'css')) return
    if (tab === 'style' && styleSubTab === 'ALL') return
    
    let cancelled = false
    const providerToPreview = tab === 'webview' ? selProvider : styleSubTab
    
    window.electron?.ipcRenderer
      .invoke('start_webview_preview', providerToPreview)
      .then((ok: boolean) => {
        if (!cancelled) setPreviewAvailable(!!ok)
      })
    const onFrame = (_e: unknown, dataUrl: string) => setPreviewFrame(dataUrl)
    // @ts-ignore
    const unsubFrame = window.electron?.ipcRenderer.on('webview_preview_frame', onFrame)
    return () => {
      cancelled = true
      if (typeof unsubFrame === 'function') {
        unsubFrame()
      } else {
        window.electron?.ipcRenderer.removeListener('webview_preview_frame', onFrame)
      }
      window.electron?.ipcRenderer.send('stop_webview_preview')
      setPreviewFrame(null)
      setPreviewAvailable(true)
    }
  }, [tab, selProvider, styleSubTab, styleCategoryTab])

  const selectTheme = (id: string) => {
    setThemeState((prev) => ({ ...prev, activeId: id }))
  }

  const handleRandomizeTheme = () => {
    sfx.chime()
    const allThemes = [...PRESET_THEMES, ...themeState.customs]
    const otherThemes = allThemes.filter((t) => t.id !== themeState.activeId)
    if (otherThemes.length === 0) return
    const pick = otherThemes[Math.floor(Math.random() * otherThemes.length)]
    selectTheme(pick.id)
    setCopiedCssToast(`🎲 Activated "${pick.name}" theme`)
    setTimeout(() => setCopiedCssToast(null), 2500)
  }

  const saveCustom = () => {
    const base = displayed
    const id = `custom-${Date.now()}`
    const saved: AppTheme = { ...base, id, name: customName.trim() || 'My Theme', isCustom: true }
    setThemeState((prev) => ({ activeId: id, customs: [...prev.customs, saved] }))
    setDraft(null)
  }

  const resetToDefault = () => {
    setDraft(null)
    setThemeState((prev) => ({ ...prev, activeId: DEFAULT_THEME_ID }))
  }

  const providerCfg = providerConfig[selProvider] || {}
  const set = (patch: Partial<ProviderOverrides>) =>
    setProviderConfig((prev) => ({ ...prev, [selProvider]: { ...prev[selProvider], ...patch } }))

  const clearSection = <K extends keyof ProviderOverrides>(k: K) =>
    setProviderConfig((prev) => {
      const cur = prev[selProvider]
      if (!cur) return prev
      const next = { ...cur }
      delete next[k]
      return { ...prev, [selProvider]: next }
    })

  const resetProvider = () =>
    setProviderConfig((prev) => {
      const { [selProvider]: _removed, ...rest } = prev
      return rest
    })

  const commitParsed = (parsed: ParsedEditor) => {
    setProviderConfig((prev) => {
      const cur = prev[selProvider] ?? {}
      const next = { ...cur }
      const apply = <K extends keyof ProviderOverrides>(
        k: K,
        v?: Partial<NonNullable<ProviderOverrides[K]>>
      ) => {
        if (v && Object.keys(v).length > 0) next[k] = v as NonNullable<ProviderOverrides[K]>
        else delete next[k]
      }
      apply('colors', parsed.colors)
      apply('geometry', parsed.geometry)
      apply('typography', parsed.typography)
      apply('layout', parsed.layout)
      apply('effects', parsed.effects)
      if (parsed.customCss != null) {
        const trimmed = parsed.customCss.trim()
        if (trimmed) next.customCss = trimmed
        else delete next.customCss
      }
      if (Object.keys(next).length === 0) {
        const { [selProvider]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [selProvider]: next }
    })
  }

  const activeColors =
    themeState.customs.find((t) => t.id === themeState.activeId)?.colors ??
    PRESET_THEMES.find((t) => t.id === themeState.activeId)?.colors ??
    PRESET_THEMES[0].colors

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="absolute inset-0 z-[99999] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 cosmic-backdrop-fade outline-none"
    >
      <div
        className="w-[96vw] h-[95vh] max-w-[1620px] rounded-2xl shadow-2xl border flex overflow-hidden cosmic-modal-pop"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* ============================================================= */}
        {/* LEFT COLUMN: Modern Master Studio Sidebar                     */}
        {/* ============================================================= */}
        <div
          className="w-[260px] shrink-0 border-r flex flex-col justify-between p-3.5 bg-black/35 select-none"
          style={{ borderColor: 'var(--border)' }}
        >
          {/* Top Brand & SFX Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-sm"
                  style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, transparent) 0%, transparent 100%), var(--surface2)',
                    borderColor: 'var(--border)',
                    color: 'var(--accent)'
                  }}
                >
                  <IconSettings size={16} />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                    <span>Nexus Studio</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-(--text2)">v1.0</span>
                  </h2>
                  <span className="text-[10px] text-(--text2)">Preferences & Styles</span>
                </div>
              </div>

              {/* Sound FX Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  const next = sfx.toggle()
                  setSfxEnabled(next)
                }}
                className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs transition-all hover:bg-white/10 cursor-pointer shadow-sm active:scale-95"
                style={{
                  background: sfxEnabled ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'rgba(255,255,255,0.04)',
                  borderColor: sfxEnabled ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)',
                  color: sfxEnabled ? 'var(--accent)' : 'var(--text2)'
                }}
                title={sfxEnabled ? 'Sound Effects: ON (Click to mute)' : 'Sound Effects: OFF (Click to unmute)'}
              >
                {sfxEnabled ? '🔊' : '🔇'}
              </button>
            </div>

            {/* Quick Find Search Box */}
            <div className="relative flex items-center mt-1">
              <IconSearch size={13} className="absolute left-2.5 text-(--text2) pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Quick find setting... (/)"
                className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-black/40 border text-xs text-(--text) placeholder:text-(--text2) outline-none transition-colors"
                style={{ borderColor: globalSearch ? 'var(--accent)' : 'rgba(255,255,255,0.08)' }}
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  className="absolute right-2 text-xs text-(--text2) hover:text-white p-0.5 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* If Global Search has a query, render the search matches inline */}
            {globalSearch.trim() ? (
              <div className="flex flex-col gap-1 overflow-y-auto custom-scrollbar max-h-[380px] p-1 rounded-xl bg-black/30 border border-white/5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-(--text2) px-2 py-1">
                  <span>Matches ({matchingSearchItems.length})</span>
                  <button onClick={() => setGlobalSearch('')} className="text-[10px] text-(--accent) hover:underline cursor-pointer">Clear</button>
                </div>
                {matchingSearchItems.length === 0 ? (
                  <div className="p-3 text-xs text-center text-(--text2) opacity-70">
                    No settings match "{globalSearch}"
                  </div>
                ) : (
                  matchingSearchItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        sfx.click()
                        setTab(item.tab)
                        if (item.category) setStyleCategoryTab(item.category)
                        setGlobalSearch('')
                      }}
                      className="p-2 rounded-xl text-left flex flex-col gap-0.5 border border-transparent hover:border-indigo-500/40 hover:bg-white/5 transition-all cursor-pointer group"
                    >
                      <span className="text-xs font-semibold text-white group-hover:text-indigo-300">{item.title}</span>
                      <span className="text-[10px] text-(--text2) truncate">{item.subtitle}</span>
                      <span className="text-[9px] font-mono text-indigo-400 self-start px-1.5 py-0.2 rounded bg-indigo-500/10 border border-indigo-500/20 uppercase mt-0.5">
                        {item.tab} {item.category ? `› ${item.category}` : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              /* Grouped Navigation Rail */
              <div className="flex flex-col gap-3.5 overflow-y-auto custom-scrollbar pr-0.5 max-h-[calc(100vh-230px)]">
                {/* GROUP 1: SYSTEM & PREFERENCES */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-(--text2) px-2 py-0.5 opacity-60">
                    System & App
                  </span>
                  {[
                    { id: 'general', label: 'General', sub: 'Zoom, Sessions & RAM', icon: IconSliders },
                    { id: 'workspace', label: 'Workspace', sub: 'Storage & Exports', icon: IconFolder },
                    { id: 'shortcuts', label: 'Shortcuts', sub: 'Key Matrix & Keycaps', icon: IconKeyboard }
                  ].map(({ id, label, sub, icon: IconComponent }) => {
                    const isActive = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          sfx.click()
                          setTab(id as any)
                        }}
                        className={`sleek-nav-btn ${isActive ? 'active' : ''}`}
                        style={{ color: isActive ? '#fff' : 'var(--text2)' }}
                      >
                        <div
                          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform"
                          style={{
                            background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                            color: isActive ? '#fff' : 'var(--text2)'
                          }}
                        >
                          <IconComponent size={13} />
                        </div>
                        <div className="flex flex-col text-left min-w-0">
                          <span className="text-xs font-semibold leading-tight truncate">{label}</span>
                          <span className="text-[10px] opacity-60 leading-tight truncate">{sub}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* GROUP 2: AI & INTELLIGENCE */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-(--text2) px-2 py-0.5 opacity-60">
                    AI Engine
                  </span>
                  {[
                    { id: 'models', label: 'AI Providers', sub: 'Endpoints & URLs', icon: IconGrid, count: models.length },
                    { id: 'features', label: 'AI Features & Hooks', sub: 'Interceptors & Prompts', icon: IconSliders },
                    { id: 'skills', label: 'Skills & Tools', sub: 'Agents & Automation', icon: IconZap }
                  ].map(({ id, label, sub, icon: IconComponent, count }) => {
                    const isActive = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          sfx.click()
                          setTab(id as any)
                        }}
                        className={`sleek-nav-btn ${isActive ? 'active' : ''}`}
                        style={{ color: isActive ? '#fff' : 'var(--text2)' }}
                      >
                        <div
                          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform"
                          style={{
                            background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                            color: isActive ? '#fff' : 'var(--text2)'
                          }}
                        >
                          <IconComponent size={13} />
                        </div>
                        <div className="flex flex-col text-left min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold leading-tight truncate">{label}</span>
                            {count !== undefined && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-(--text2)">{count}</span>
                            )}
                          </div>
                          <span className="text-[10px] opacity-60 leading-tight truncate">{sub}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* GROUP 3: VISUALS & THEMES */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-(--text2) px-2 py-0.5 opacity-60">
                    Design & Studio
                  </span>
                  {[
                    { id: 'themes', label: 'Themes & Palettes', sub: 'Presets & OLED Radius', icon: IconPalette },
                    { id: 'style', label: 'Interface & Style', sub: 'Studio, Aura & Glass', icon: IconLayers },
                    { id: 'webview', label: 'Webview Sandbox', sub: 'Live CSS Playground', icon: IconMonitor }
                  ].map(({ id, label, sub, icon: IconComponent }) => {
                    const isActive = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          sfx.click()
                          setTab(id as any)
                        }}
                        className={`sleek-nav-btn ${isActive ? 'active' : ''}`}
                        style={{ color: isActive ? '#fff' : 'var(--text2)' }}
                      >
                        <div
                          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform"
                          style={{
                            background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                            color: isActive ? '#fff' : 'var(--text2)'
                          }}
                        >
                          <IconComponent size={13} />
                        </div>
                        <div className="flex flex-col text-left min-w-0">
                          <span className="text-xs font-semibold leading-tight truncate">{label}</span>
                          <span className="text-[10px] opacity-60 leading-tight truncate">{sub}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer */}
          <div className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            {onOpenZenGuide && (
              <button
                type="button"
                onClick={() => {
                  sfx.pop()
                  onOpenZenGuide()
                }}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-white/5 cursor-pointer shadow-sm active:scale-98"
                style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                title="Open Interactive Nexus Helper Guide (F1)"
              >
                <IconSparkles size={13} style={{ color: 'var(--accent)' }} />
                <span>Nexus Guide (F1)</span>
              </button>
            )}

            <div className="flex items-center justify-between px-1 text-[11px] text-(--text2)">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: activeColors.accent, boxShadow: `0 0 6px ${activeColors.accent}` }} />
                <span className="text-[10px] font-mono truncate max-w-[120px]">{activeTheme.name}</span>
              </div>
              <span className="text-[10px] opacity-50 font-mono">Esc to exit</span>
            </div>
          </div>
        </div>

        {/* ============================================================= */}
        {/* RIGHT COLUMN: Active Content Panel                            */}
        {/* ============================================================= */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-black/15">
          {/* Header Bar: Breadcrumbs & Close */}
          <div
            className="px-5 py-3 border-b flex justify-between items-center gap-4 shrink-0 bg-black/25"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-(--text2) opacity-70">
                {tab === 'general' || tab === 'workspace' || tab === 'shortcuts'
                  ? 'System & App'
                  : tab === 'models' || tab === 'features' || tab === 'skills'
                    ? 'AI Engine'
                    : 'Design & Studio'}
              </span>
              <span className="text-(--text2) opacity-40">/</span>
              <span className="text-sm font-bold text-white flex items-center gap-1.5">
                {tab === 'general' && 'General Preferences'}
                {tab === 'workspace' && 'Workspace & Storage'}
                {tab === 'shortcuts' && 'Keyboard Shortcuts Matrix'}
                {tab === 'models' && 'AI Providers & Endpoints'}
                {tab === 'features' && 'AI Features & Interceptors'}
                {tab === 'skills' && 'Skills & Autonomous Tools'}
                {tab === 'themes' && 'Themes & Color Palettes'}
                {tab === 'style' && 'Interface & Style Studio'}
                {tab === 'webview' && 'Live AI Webview & CSS Sandbox'}
              </span>
            </div>

            <button
              onClick={() => {
                sfx.click()
                onClose()
              }}
              className="w-8 h-8 rounded-xl border flex items-center justify-center text-xs hover:bg-white/10 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
              style={{ color: 'var(--text2)', borderColor: 'var(--border)', background: 'var(--bg)' }}
              title="Close settings (Esc)"
            >
              ✕
            </button>
          </div>

          {/* AI Models */}
          {tab === 'general' ? (
            <div
              ref={activeContentScrollRef}
              onScroll={handleContentScroll}
              onFocusCapture={handleContentFocusCapture}
              className="flex flex-col gap-5 max-w-4xl mx-auto w-full h-full text-sm p-4 sm:p-6 overflow-y-auto custom-scrollbar"
              style={{ color: 'var(--text)' }}
            >
              <SectionTitle badge="Display Scale">
                <IconSliders size={13} style={{ color: 'var(--accent)' }} />
                <span>Global Zoom Levels</span>
              </SectionTitle>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">Nexus App UI Zoom</span>
                    <span className="sleek-badge">{Math.round(uiZoom * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={Math.round(uiZoom * 100)}
                    onChange={(e) => setUiZoom(parseInt(e.target.value) / 100)}
                    className="vc-range"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      {[80, 100, 125, 150].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            sfx.pop()
                            setUiZoom(val / 100)
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer ${
                            Math.round(uiZoom * 100) === val
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                              : 'bg-white/5 text-(--text2) border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        sfx.pop()
                        setUiZoom(1.0)
                      }}
                      className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      Reset (Ctrl+Shift+0)
                    </button>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">AI Webviews Zoom</span>
                    <span className="sleek-badge">{Math.round(webviewZoom * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={Math.round(webviewZoom * 100)}
                    onChange={(e) => setWebviewZoom(parseInt(e.target.value) / 100)}
                    className="vc-range"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      {[80, 100, 125, 150].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            sfx.pop()
                            setWebviewZoom(val / 100)
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer ${
                            Math.round(webviewZoom * 100) === val
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                              : 'bg-white/5 text-(--text2) border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        sfx.pop()
                        setWebviewZoom(1.0)
                      }}
                      className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      Reset (Ctrl+0)
                    </button>
                  </div>
                </Card>
              </div>

              <SectionTitle badge="Multi-Browser Sync">
                <IconShield size={13} style={{ color: 'var(--accent)' }} />
                <span>Account & AI Provider Sessions</span>
              </SectionTitle>

              <Card>
                <div className="flex flex-col gap-3">
                  <div>
                    <span className="font-bold text-sm text-white">Session Synchronization</span>
                    <p className="text-[12px] opacity-80 leading-relaxed mt-0.5" style={{ color: 'var(--text2)' }}>
                      Import active sessions for Gemini, ChatGPT, Claude, Perplexity, DeepSeek, Grok, and Mistral from your installed browsers, or paste cookies directly using Cookie-Editor JSON.
                    </p>
                  </div>

                  {/* Primary Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      onClick={() => {
                        sfx.click()
                        handleSyncAllSessions()
                      }}
                      disabled={isSyncing}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 shadow-md cursor-pointer active:scale-98"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {isSyncing ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Syncing All Sessions…
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                          </svg>
                          Sync All Sessions from Browser
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        sfx.pop()
                        setShowJsonPaste((prev) => !prev)
                      }}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-2 transition-all hover:bg-white/5 ml-auto cursor-pointer"
                      style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      <span>{showJsonPaste ? 'Hide Cookie Paste' : 'Paste Cookies (JSON)'}</span>
                    </button>
                  </div>

                  {/* Status Messages */}
                  {sessionSyncResult && (
                    <div
                      className={`p-3 rounded-xl text-xs border ${
                        sessionSyncResult.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : sessionSyncResult.type === 'error'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                      }`}
                    >
                      {sessionSyncResult.message}
                    </div>
                  )}

                  {signInStatus && (
                    <p className="text-[12px] leading-relaxed font-medium" style={{ color: 'var(--text2)' }}>
                      {signInStatus}
                    </p>
                  )}

                  {/* Expandable Cookie-Editor JSON Paste Area */}
                  {showJsonPaste && (
                    <div className="flex flex-col gap-2 p-3.5 rounded-xl border mt-1" style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-white">
                          Cookie-Editor JSON Payload
                        </span>
                        <span className="text-[11px] opacity-70" style={{ color: 'var(--text2)' }}>
                          Export as JSON from Cookie-Editor extension
                        </span>
                      </div>
                      <textarea
                        value={jsonPayload}
                        onChange={(e) => setJsonPayload(e.target.value)}
                        placeholder='[{"domain": ".chatgpt.com", "name": "__Secure-next-auth.session-token", "value": "...", ...}]'
                        rows={5}
                        className="w-full p-2.5 font-mono text-xs rounded-xl border outline-none resize-y"
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <button
                          onClick={() => {
                            sfx.click()
                            handleApplyJsonCookies()
                          }}
                          disabled={isApplyingJson || !jsonPayload.trim()}
                          className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-sm"
                          style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                          {isApplyingJson ? 'Applying…' : 'Apply Cookies & Refresh'}
                        </button>
                        <button
                          onClick={() => {
                            sfx.pop()
                            setJsonPayload('')
                            setShowJsonPaste(false)
                          }}
                          className="text-xs opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                          style={{ color: 'var(--text2)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Detected Browser Profiles */}
                  {signInProfiles.length > 0 ? (
                    <div className="flex flex-col gap-2 mt-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">
                          Detected Browser Profiles:
                        </span>
                        <span className="sleek-badge">
                          {signInProfiles.length} Profile(s)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {signInProfiles.map((p) => (
                          <div
                            key={p.id}
                            className="p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all"
                            style={{
                              background: p.isLatest ? 'rgba(99, 102, 241, 0.08)' : 'var(--surface2)',
                              borderColor: p.isLatest ? 'rgba(99, 102, 241, 0.35)' : 'var(--border)'
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-semibold truncate text-white">
                                  {p.browser.charAt(0).toUpperCase() + p.browser.slice(1)} — {p.name}
                                </span>
                                <span className="text-[11px] opacity-70 truncate mt-0.5" style={{ color: 'var(--text2)' }}>
                                  {p.isLatest ? 'Most recently active profile' : 'Active session detected'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {p.isLatest && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold shrink-0 border border-amber-500/40 flex items-center gap-1 shadow-sm">
                                    <span>★</span> Latest
                                  </span>
                                )}
                                {p.hasGoogleAuth && !p.isLatest && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium shrink-0 border border-emerald-500/30">
                                    auth found
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 pt-0.5">
                              <button
                                onClick={() => {
                                  sfx.click()
                                  handleSyncProfile(p.id, p.name)
                                }}
                                disabled={syncingProfileId === p.id || isSyncing}
                                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                              >
                                {syncingProfileId === p.id ? (
                                  <>
                                    <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                    </svg>
                                    Syncing…
                                  </>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                    </svg>
                                    Sync Profile
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="p-3 rounded-xl border text-xs text-center opacity-70 mt-2"
                      style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text2)' }}
                    >
                      No browser profiles with active Google sessions found. You can import cookies via JSON or log in using the Browser button above.
                    </div>
                  )}
                </div>
              </Card>

              <SectionTitle badge="RAM Saver">
                <IconZap size={13} style={{ color: 'var(--accent)' }} />
                <span>Memory & Performance</span>
              </SectionTitle>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-bold text-xs text-white">Tab Discard System</span>
                    <p className="text-[11px] opacity-75 leading-relaxed" style={{ color: 'var(--text2)' }}>
                      Auto-discards background tabs after inactivity to keep memory usage minimal.
                    </p>
                    <div className="pt-2">
                      <select
                        value={tabDiscardMinutes.toString()}
                        onChange={(e) => {
                          sfx.pop()
                          setTabDiscardMinutes(parseInt(e.target.value, 10))
                        }}
                        className="sleek-select w-full px-3 py-2 rounded-xl border outline-none text-xs font-semibold"
                        style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        <option value="5">5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="0">Never (High RAM usage)</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-bold text-xs text-white">Max Active Tabs Threshold</span>
                    <p className="text-[11px] opacity-75 leading-relaxed" style={{ color: 'var(--text2)' }}>
                      Hard limit on tabs kept in memory. Oldest background views are immediately discarded.
                    </p>
                    <div className="pt-2">
                      <select
                        value={maxActiveTabs.toString()}
                        onChange={(e) => {
                          sfx.pop()
                          setMaxActiveTabs(parseInt(e.target.value, 10))
                        }}
                        className="sleek-select w-full px-3 py-2 rounded-xl border outline-none text-xs font-semibold"
                        style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        <option value="0">Unlimited (Timer based only)</option>
                        <option value="1">1 (Strictly Active Only)</option>
                        <option value="3">3 tabs</option>
                        <option value="5">5 tabs</option>
                        <option value="10">10 tabs</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-bold text-xs text-white">Ctrl+Tab Switcher Count</span>
                    <p className="text-[11px] opacity-75 leading-relaxed" style={{ color: 'var(--text2)' }}>
                      Set maximum recent tabs to display in the fast Ctrl+Tab switching HUD.
                    </p>
                    <div className="pt-2">
                      <select
                        value={interfaceSettings?.tabSwitcherLimit?.toString() || '7'}
                        onChange={(e) => {
                          sfx.pop()
                          onInterfaceSettingsChange?.({ ...interfaceSettings!, tabSwitcherLimit: parseInt(e.target.value, 10) })
                        }}
                        className="sleek-select w-full px-3 py-2 rounded-xl border outline-none text-xs font-semibold"
                        style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        <option value="3">3 tabs</option>
                        <option value="5">5 tabs</option>
                        <option value="7">7 tabs</option>
                        <option value="10">10 tabs</option>
                        <option value="15">15 tabs</option>
                        <option value="999">Show All</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-bold text-xs text-white">Pinned Chats Position</span>
                    <p className="text-[11px] opacity-75 leading-relaxed" style={{ color: 'var(--text2)' }}>
                      Position pinned chats as a vertical side rail or a horizontal dock at the bottom.
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          sfx.pop()
                          updateInterfaceSetting('pinnedPosition', 'sidebar')
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          (interfaceSettings?.pinnedPosition || 'sidebar') === 'sidebar'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white shadow-sm'
                            : 'bg-white/5 border-white/10 text-(--text2) hover:bg-white/10'
                        }`}
                      >
                        <span>⫤ Vertical (Left)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          sfx.pop()
                          updateInterfaceSetting('pinnedPosition', 'bottom')
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          interfaceSettings?.pinnedPosition === 'bottom'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white shadow-sm'
                            : 'bg-white/5 border-white/10 text-(--text2) hover:bg-white/10'
                        }`}
                      >
                        <span>⬒ Bottom Dock</span>
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          ) : tab === 'models' ? (
            <div
              ref={activeContentScrollRef}
              onScroll={handleContentScroll}
              onFocusCapture={handleContentFocusCapture}
              className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4 min-h-0 custom-scrollbar max-w-5xl mx-auto w-full"
            >
              <SectionTitle badge={`${models.length} Configured`}>
                <IconGrid size={13} style={{ color: 'var(--accent)' }} />
                <span>AI Providers & Endpoints</span>
              </SectionTitle>

              <div className="flex flex-col gap-3">
                {models.map((m, idx) => {
                  const isExpanded = !!expandedModels[m.key]
                  const provColor = m.color || providerConfig[m.key]?.accentColor || modelColor(m.key)

                  return (
                    <Card key={`model-card-${idx}`} className="p-4">
                      {/* Top Primary Row */}
                      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-sm transition-transform hover:scale-105"
                          style={{
                            background: 'var(--surface2)',
                            borderColor: provColor,
                            boxShadow: `0 0 10px ${provColor}33`
                          }}
                          title={`${m.label} Brand Icon`}
                        >
                          <BrandIcon
                            id={m.key}
                            size={18}
                            customSvg={m.icon}
                            style={{ color: provColor }}
                          />
                        </div>

                        {/* Name Input */}
                        <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-2">
                          <input
                            data-setting-key={`model-label-${idx}`}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold w-full sm:w-44 outline-none border transition-colors"
                            style={{
                              background: 'var(--surface2)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)'
                            }}
                            placeholder="Provider Name"
                            value={m.label}
                            onChange={(e) => {
                              const newLabel = e.target.value
                              setModels((prev) =>
                                prev.map((pm, i) => {
                                  if (i !== idx) return pm
                                  const isAutoSlug =
                                    !pm.key ||
                                    pm.key.startsWith('new-model') ||
                                    pm.key.startsWith('custom-model') ||
                                    pm.key === generateProviderKey(pm.label || '', [])
                                  const otherKeys = prev.filter((_, oi) => oi !== idx).map((o) => o.key)
                                  const newKey = isAutoSlug ? generateProviderKey(newLabel, otherKeys) : pm.key
                                  return { ...pm, label: newLabel, key: newKey }
                                })
                              )
                            }}
                          />

                          <input
                            data-setting-key={`model-key-${idx}`}
                            className="px-2.5 py-1.5 rounded-xl text-[11px] font-mono w-full sm:w-32 outline-none border opacity-80 transition-colors"
                            style={{
                              background: 'var(--surface)',
                              borderColor: 'var(--border)',
                              color: 'var(--text2)'
                            }}
                            placeholder="key-slug"
                            title="Unique ID slug for provider (e.g. gemini-v2)"
                            value={m.key}
                            onChange={(e) => {
                              const cleanKey = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
                              setModels((prev) =>
                                prev.map((pm, i) => (i === idx ? { ...pm, key: cleanKey } : pm))
                              )
                            }}
                          />

                          <input
                            data-setting-key={`model-url-${idx}`}
                            className="px-3 py-1.5 rounded-xl text-xs flex-1 outline-none border min-w-0 font-mono transition-colors"
                            style={{
                              background: 'var(--surface2)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)'
                            }}
                            placeholder="https://..."
                            value={m.url}
                            onChange={(e) =>
                              setModels((prev) =>
                                prev.map((pm, i) => (i === idx ? { ...pm, url: e.target.value } : pm))
                              )
                            }
                          />
                        </div>

                        {/* Color & Controls */}
                        <div className="flex items-center gap-2 shrink-0">
                          <label
                            className="flex items-center gap-1.5 px-2 py-1 rounded-xl border cursor-pointer shrink-0 transition-all hover:bg-white/5"
                            style={{
                              background: 'var(--surface2)',
                              borderColor: 'var(--border)',
                              color: 'var(--text2)'
                            }}
                            title="Provider accent color (resets to brand color when empty)"
                          >
                            <input
                              type="color"
                              data-setting-key={`model-color-${idx}`}
                              className="w-5 h-5 border-0 bg-transparent cursor-pointer p-0"
                              value={m.color || providerConfig[m.key]?.accentColor || modelColor(m.key)}
                              onChange={(e) => {
                                const newColor = e.target.value
                                setModels((prev) =>
                                  prev.map((pm, i) => (i === idx ? { ...pm, color: newColor } : pm))
                                )
                                setProviderConfig((prev) => {
                                  const prevOv = prev[m.key] || {}
                                  const nextMap = { ...prev, [m.key]: { ...prevOv, accentColor: newColor } }
                                  try { localStorage.setItem('nexus.provider_config', JSON.stringify(nextMap)) } catch {}
                                  // @ts-ignore
                                  window.electron?.ipcRenderer?.send('set_provider_config', nextMap)
                                  return nextMap
                                })
                              }}
                            />
                            {(m.color || providerConfig[m.key]?.accentColor) && (
                              <button
                                type="button"
                                className="px-1 text-xs hover:opacity-100 opacity-60 cursor-pointer"
                                style={{ color: 'var(--text2)' }}
                                onClick={() => {
                                  sfx.pop()
                                  setModels((prev) =>
                                    prev.map((pm, i) => (i === idx ? { ...pm, color: undefined } : pm))
                                  )
                                  setProviderConfig((prev) => {
                                    const prevOv = prev[m.key] || {}
                                    const nextOv = { ...prevOv }
                                    delete nextOv.accentColor
                                    const nextMap = { ...prev, [m.key]: nextOv }
                                    try { localStorage.setItem('nexus.provider_config', JSON.stringify(nextMap)) } catch {}
                                    // @ts-ignore
                                    window.electron?.ipcRenderer?.send('set_provider_config', nextMap)
                                    return nextMap
                                  })
                                }}
                                title="Reset to original brand color"
                              >
                                ✕
                              </button>
                            )}
                          </label>

                          <button
                            type="button"
                            onClick={() => {
                              sfx.click()
                              setExpandedModels((prev) => ({ ...prev, [m.key]: !prev[m.key] }))
                            }}
                            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                              isExpanded
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                                : 'bg-white/5 text-(--text2) border-white/10 hover:bg-white/10'
                            }`}
                            title="Expand additional details"
                          >
                            <span>{isExpanded ? '▴ Less' : '▾ More'}</span>
                          </button>

                          <button
                            type="button"
                            className="p-2 rounded-xl border border-rose-500/20 text-rose-400 hover:bg-rose-500/15 transition-all shrink-0 cursor-pointer"
                            title="Remove model provider"
                            onClick={() => {
                              sfx.pop()
                              const key = m.key
                              setModels((prev) => prev.filter((_, i) => i !== idx))
                              setProviderConfig((prev) => {
                                const { [key]: _removed, ...rest } = prev
                                return rest
                              })
                              if (selProvider === key) setSelProvider(models[0]?.key ?? '')
                            }}
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Advanced Drawer */}
                      {isExpanded && (
                        <div className="flex flex-col gap-2.5 pt-3 border-t border-white/5">
                          <div>
                            <span className="text-[11px] font-semibold text-(--text2) mb-1 block">Description & Model Purpose:</span>
                            <input
                              data-setting-key={`model-desc-${idx}`}
                              className="px-3 py-1.5 rounded-xl text-xs outline-none border w-full transition-colors"
                              style={{
                                background: 'var(--surface2)',
                                borderColor: 'var(--border)',
                                color: 'var(--text)'
                              }}
                              placeholder="Provider Description (e.g. Google AI Studio Gemini 2.0 Flash model with reasoning)"
                              value={m.desc || ''}
                              onChange={(e) =>
                                setModels((prev) =>
                                  prev.map((pm, i) => (i === idx ? { ...pm, desc: e.target.value } : pm))
                                )
                              }
                            />
                          </div>

                          <div>
                            <span className="text-[11px] font-semibold text-(--text2) mb-1 block">Custom SVG Icon Markup:</span>
                            <input
                              data-setting-key={`model-icon-${idx}`}
                              className="px-3 py-1.5 rounded-xl text-[11px] font-mono outline-none border w-full transition-colors"
                              style={{
                                background: 'var(--surface2)',
                                borderColor: 'var(--border)',
                                color: 'var(--text2)'
                              }}
                              placeholder="<svg>...</svg> (Custom Icon SVG markup)"
                              value={m.icon || ''}
                              onChange={(e) =>
                                setModels((prev) =>
                                  prev.map((pm, i) => (i === idx ? { ...pm, icon: e.target.value } : pm))
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>

              <button
                type="button"
                className="mt-2 w-full py-3.5 border-2 border-dashed rounded-2xl font-bold text-xs transition-all cursor-pointer hover:border-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/5 active:scale-99 flex items-center justify-center gap-2"
                style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'var(--text2)' }}
                onClick={() => {
                  sfx.click()
                  setModels((prev) => {
                    const newKey = generateProviderKey('New Model', prev.map((p) => p.key))
                    return [
                      ...prev,
                      { key: newKey, label: 'New Model', url: 'https://example.com', desc: '' }
                    ]
                  })
                }}
              >
                <IconPlus size={14} />
                <span>Add AI Provider</span>
              </button>
            </div>
        ) : tab === 'features' ? (
          <div
            ref={activeContentScrollRef}
            onScroll={handleContentScroll}
            onFocusCapture={handleContentFocusCapture}
            className="flex-1 min-h-0 flex flex-col h-full overflow-hidden"
          >
            <ProviderFeaturesSection
              models={models}
              providerConfig={providerConfig}
              setProviderConfig={setProviderConfig}
              setToast={setCopiedCssToast}
            />
          </div>
        ) : tab === 'skills' ? (
          <div
            ref={activeContentScrollRef}
            onScroll={handleContentScroll}
            onFocusCapture={handleContentFocusCapture}
            className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar h-full"
          >
            <SkillsSettingsSection onOpenEditor={onOpenSkillEditor} />
          </div>
        ) : tab === 'workspace' ? (
          <div
            ref={activeContentScrollRef}
            onScroll={handleContentScroll}
            onFocusCapture={handleContentFocusCapture}
            className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar h-full"
          >
            <WorkspaceSettingsSection />
          </div>
        ) : tab === 'themes' ? (
          <div
            ref={activeContentScrollRef}
            onScroll={handleContentScroll}
            onFocusCapture={handleContentFocusCapture}
            className="p-5 overflow-y-auto flex-1 flex flex-col gap-6 min-h-0 custom-scrollbar max-w-5xl mx-auto w-full"
          >
            {/* Header Action Banner */}
            <Card>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                    style={{
                      background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, transparent) 0%, transparent 100%), var(--surface2)',
                      borderColor: 'var(--border)',
                      color: 'var(--accent)'
                    }}
                  >
                    <IconPalette size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-(--text) flex items-center gap-2">
                      <span>Themes & Color Presets</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {themeState.customs.length + PRESET_THEMES.length} Themes
                      </span>
                    </h3>
                    <p className="text-xs text-(--text2) mt-0.5">
                      Curated color harmonies, OLED modes, and custom palette builder.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleRandomizeTheme}
                    className="px-3.5 py-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                    title="Quickly test a random color theme"
                  >
                    <span>🎲</span>
                    <span>Random Theme</span>
                  </button>

                  {/* Webview Theme Master Toggle */}
                  <label
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border cursor-pointer transition-colors"
                    style={{
                      background: webviewThemeOn ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--surface2)',
                      borderColor: webviewThemeOn ? 'var(--accent)' : 'var(--border)'
                    }}
                    title="Inject theme CSS variables directly into all active AI webview tabs"
                  >
                    <input
                      type="checkbox"
                      checked={webviewThemeOn}
                      onChange={(e) => {
                        sfx.click()
                        setWebviewThemeOn(e.target.checked)
                      }}
                      className="sr-only"
                    />
                    <span
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        webviewThemeOn ? 'bg-(--accent) text-white' : 'bg-white/10 text-white/40'
                      }`}
                    >
                      {webviewThemeOn ? '✓' : ''}
                    </span>
                    <span className="text-xs font-semibold text-(--text)">Webviews</span>
                  </label>
                </div>
              </div>
            </Card>

            {/* Theme Picker Grid: presets + customs */}
            <Card>
              <SectionTitle>
                <IconSparkles size={14} />
                <span>Palette Collection</span>
              </SectionTitle>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-1">
                {[...PRESET_THEMES, ...themeState.customs].map((t) => {
                  const isSel = t.id === themeState.activeId
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        sfx.click()
                        selectTheme(t.id)
                      }}
                      className={`sleek-card p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 group relative overflow-hidden ${
                        isSel ? 'border-(--accent) shadow-lg' : 'hover:border-white/20'
                      }`}
                      style={{
                        background: isSel
                          ? 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 16%, var(--surface)) 0%, var(--surface) 100%)'
                          : 'var(--surface)',
                        borderColor: isSel ? 'var(--accent)' : 'var(--border)',
                        boxShadow: isSel ? '0 4px 20px color-mix(in srgb, var(--accent) 25%, transparent)' : 'none'
                      }}
                    >
                      {/* Top row: name and badges */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold truncate text-(--text)">
                            {t.name}
                          </span>
                          {t.isCustom && (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                              Custom
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSel ? (
                            <span className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full bg-(--accent) flex items-center gap-1 shadow-sm">
                              ✓ Active
                            </span>
                          ) : null}

                          {t.isCustom && (
                            <button
                              type="button"
                              className="w-5 h-5 rounded-md flex items-center justify-center text-xs opacity-50 hover:opacity-100 hover:text-red-400 hover:bg-white/10 transition-all cursor-pointer"
                              style={{ color: 'var(--text2)' }}
                              onClick={(e) => {
                                e.stopPropagation()
                                sfx.pop()
                                setThemeState((prev) => ({
                                  activeId: prev.activeId === t.id ? DEFAULT_THEME_ID : prev.activeId,
                                  customs: prev.customs.filter((c) => c.id !== t.id)
                                }))
                              }}
                              title="Delete custom theme"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 5-dot color strip with subtle shadows */}
                      <div className="flex items-center gap-1.5 p-1 rounded-lg bg-black/30 border border-white/5">
                        {(['bg', 'surface', 'surface2', 'accent', 'text'] as const).map((k) => (
                          <div
                            key={k}
                            className="flex-1 h-3.5 rounded-md border border-black/30 transition-transform group-hover:scale-105"
                            style={{
                              background: t.colors[k],
                              boxShadow: k === 'accent' ? `0 0 6px ${t.colors.accent}66` : 'none'
                            }}
                            title={`${k}: ${t.colors[k]}`}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* Customize: live-edits the active theme */}
            <Card>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/5">
                <SectionTitle>
                  <IconSliders size={14} />
                  <span>Customize Active Theme</span>
                </SectionTitle>

                <div className="flex items-center gap-2">
                  <input
                    className="px-3 py-1.5 rounded-xl text-xs outline-none border w-36 font-semibold"
                    style={{
                      background: 'var(--surface2)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Theme name"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      sfx.chime()
                      saveCustom()
                    }}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-(--accent) text-white hover:brightness-110 shadow-sm transition-all cursor-pointer"
                  >
                    Save as custom
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sfx.pop()
                      resetToDefault()
                    }}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-(--border) text-(--text2) hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Color Pickers Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
                {COLOR_LABELS.map(({ key, label }) => {
                  const currentColor = displayed.colors[key]
                  return (
                    <div
                      key={key}
                      className="p-3 rounded-xl border flex flex-col gap-2 transition-all hover:border-white/20"
                      style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}
                    >
                      <span className="text-[11px] font-semibold text-(--text2) uppercase tracking-wide truncate">
                        {label}
                      </span>
                      <div className="flex items-center gap-2.5">
                        <label className="relative w-7 h-7 rounded-lg shrink-0 cursor-pointer overflow-hidden border border-black/30 shadow-inner group">
                          <div
                            className="w-full h-full transition-transform group-hover:scale-110"
                            style={{ background: currentColor }}
                          />
                          <input
                            type="color"
                            value={currentColor}
                            onChange={(e) =>
                              applyToActive((t) => ({
                                ...t,
                                colors: { ...t.colors, [key]: e.target.value }
                              }))
                            }
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </label>
                        <span className="text-xs font-mono font-semibold text-(--text) uppercase truncate">
                          {currentColor}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Live Border Radius Controller */}
              <div
                className="mt-2 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4"
                style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 border flex items-center justify-center text-xs font-mono font-bold text-white transition-all shadow-sm"
                    style={{
                      background: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                      borderColor: 'var(--accent)',
                      borderRadius: `${displayed.radius}px`
                    }}
                  >
                    {displayed.radius}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-(--text) flex items-center gap-2">
                      <span>Corner Curvature</span>
                      <span className="text-[10px] font-mono text-(--accent)">{displayed.radius}px</span>
                    </span>
                    <p className="text-[11px] text-(--text2) mt-0.5">
                      Sets the global border radius applied across tabs, cards, inputs, and modals.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1">
                    {[
                      { label: 'Sharp', val: 0 },
                      { label: 'Subtle', val: 8 },
                      { label: 'Smooth', val: 14 },
                      { label: 'Pill', val: 24 }
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          sfx.pop()
                          applyToActive((t) => ({ ...t, radius: preset.val }))
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                          displayed.radius === preset.val
                            ? 'bg-(--accent) text-white font-bold shadow-sm'
                            : 'bg-black/30 border border-white/5 text-(--text2) hover:text-white'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={32}
                    value={displayed.radius}
                    onChange={(e) =>
                      applyToActive((t) => ({ ...t, radius: Number(e.target.value) }))
                    }
                    className="vc-range accent-(--accent) w-32 cursor-pointer"
                  />
                </div>
              </div>
            </Card>
          </div>
        ) : tab === 'style' ? (
          /* Interface & Style Studio: Sub-Tabs (ALL + Providers) + Two-Column Studio */
          <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-hidden">
            {/* Toast Notification */}
            {copiedCssToast && (
              <div className="fixed bottom-6 right-6 z-[999999] px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-xs shadow-2xl flex items-center gap-2 border border-emerald-400/40 animate-pulse">
                <span>{copiedCssToast}</span>
              </div>
            )}

            {/* TOP SUB-TAB BAR: ALL + AI Providers */}
            {/* TOP BAR: Target Scope Selector + Instant Filter Search */}
            <div className="flex flex-col gap-2.5 shrink-0 pb-1">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Target Scope Pill selector */}
                <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar flex-1 pb-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-(--text2) shrink-0 flex items-center gap-1.5 mr-1">
                    <IconPalette size={13} style={{ color: 'var(--accent)' }} />
                    <span>Scope:</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      sfx.click()
                      handleSelectSubTab('ALL')
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                    style={{
                      background: styleSubTab === 'ALL' ? 'var(--accent)' : 'var(--bg)',
                      color: styleSubTab === 'ALL' ? '#fff' : 'var(--text2)',
                      border: '1px solid var(--border)',
                      boxShadow: styleSubTab === 'ALL' ? '0 2px 10px rgba(99, 102, 241, 0.35)' : 'none'
                    }}
                  >
                    <span>🌐</span>
                    <span>ALL (Global Defaults)</span>
                  </button>

                  {models.map((m) => {
                    const isSel = styleSubTab === m.key
                    const ov = providerConfig[m.key]
                    const hasOverrides = ov && Object.keys(ov).length > 0 && Object.values(ov).some(v => v !== undefined && v !== '' && (typeof v !== 'object' || Object.keys(v).length > 0))
                    const color = ov?.accentColor || m.color || modelColor(m.key)

                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => {
                          sfx.click()
                          handleSelectSubTab(m.key)
                        }}
                        className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shrink-0 cursor-pointer"
                        style={{
                          background: isSel ? 'var(--surface2)' : 'var(--bg)',
                          color: isSel ? 'var(--text)' : 'var(--text2)',
                          border: isSel ? `1px solid ${color}` : '1px solid var(--border)',
                          boxShadow: isSel ? `0 0 10px ${color}33` : 'none'
                        }}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                        <span className="truncate max-w-[90px]">{modelLabel(m.key)}</span>
                        {hasOverrides && (
                          <span className="text-[10px] font-mono font-bold text-amber-400">✦</span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Instant Filter Search Bar */}
                <div className="relative flex items-center w-full sm:w-64 shrink-0">
                  <input
                    type="text"
                    value={styleSearchQuery}
                    onChange={(e) => setStyleSearchQuery(e.target.value)}
                    placeholder="Filter options (radius, font, aura...)"
                    className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-black/40 border border-(--border) text-xs text-(--text) placeholder:text-(--text2) focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <IconSearch size={13} className="absolute left-2.5 text-(--text2) pointer-events-none" />
                  {styleSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setStyleSearchQuery('')}
                      className="absolute right-2 text-xs text-(--text2) hover:text-(--text) p-0.5 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Horizontal Category Selector Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar p-1 rounded-xl bg-black/30 border border-white/5 shrink-0">
                {[
                  { id: 'theme', label: 'Theme & Colors', icon: IconSparkles, desc: 'Presets, accents & OLED' },
                  { id: 'layout', label: 'Layout & Shapes', icon: IconLayers, desc: 'Curvature, glass & motion' },
                  { id: 'chat', label: 'AI Chat & Aura', icon: IconMessageSquare, desc: 'Aura, bubbles & code' },
                  { id: 'icons', label: 'Icons & Glyphs', icon: IconZap, desc: 'Icon packs & stroke weights' },
                  { id: 'css', label: 'Custom CSS & JS', icon: IconKeyboard, desc: 'Webview styling & scripts' }
                ].map((cat) => {
                  const isSel = !styleSearchQuery && styleCategoryTab === cat.id
                  const Icon = cat.icon

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        sfx.click()
                        setStyleSearchQuery('')
                        handleSelectStyleCategory(cat.id as any)
                      }}
                      className={`sleek-pill-tab ${isSel ? 'active' : ''}`}
                    >
                      <Icon size={13} />
                      <span>{cat.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* TWO-COLUMN STUDIO BODY: Canvas + Live Interactive Preview */}
            <div className="flex-1 min-h-0 flex gap-3.5 overflow-hidden h-full">

              {/* 2. CENTER COLUMN: Style Configuration & Rich Micro-Diagrams Canvas */}
              <div
                ref={activeContentScrollRef}
                onScroll={handleContentScroll}
                onFocusCapture={handleContentFocusCapture}
                className="flex-1 min-w-0 overflow-y-auto custom-scrollbar pr-1 overscroll-contain h-full"
                style={{ color: 'var(--text)' }}
              >
                <StyleStudioCanvas
                  webviewThemeOn={webviewThemeOn}
                  styleSubTab={styleSubTab}
                  styleCategoryTab={styleCategoryTab}
                  styleSearchQuery={styleSearchQuery}
                  interfaceSettings={interfaceSettings}
                  updateInterfaceSetting={updateInterfaceSetting}
                  handleSelectPreset={handleSelectPreset}
                  currentProviderOverrides={currentProviderOverrides}
                  updateProviderOverrideField={updateProviderOverrideField}
                  resetAllOverridesForCurrentProvider={resetAllOverridesForCurrentProvider}
                  models={models}
                  setCopiedCssToast={setCopiedCssToast}
                />
              </div>

              {/* RIGHT COLUMN: Live Interactive Preview Stage (Responsive Full-Height with Glass Refraction & Fit Toggle) */}
              {styleCategoryTab === 'css' && styleSubTab !== 'ALL' ? (
                <div
                  className="flex-1 min-h-0 rounded-2xl border overflow-hidden flex flex-col relative bg-black/50 shadow-inner p-1.5"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between pb-1.5 px-1 opacity-60">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white">Live Webview Stream</span>
                    <span className="text-[9px] font-mono">Editing CSS for {modelLabel(styleSubTab)}</span>
                  </div>
                  <div className="flex-1 relative overflow-hidden rounded-xl border border-white/10">
                    {!previewAvailable ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2.5 px-6 text-center">
                        <BrandIcon id={styleSubTab} size={36} className="opacity-40" />
                        <span className="text-xs leading-relaxed text-(--text2)">
                          No active <strong className="text-white">{modelLabel(styleSubTab)}</strong> tab is currently open.<br/>
                          Open it in Nexus to view live webview mirror stream.
                        </span>
                      </div>
                    ) : previewFrame ? (
                      <img
                        src={previewFrame}
                        alt="live preview"
                        className={previewFitMode === 'contain' ? 'w-full h-full object-contain' : 'w-full h-full object-cover object-top'}
                        style={{ imageRendering: 'auto' }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-(--text2)">
                        Waiting for preview stream…
                      </div>
                    )}
                  </div>
                </div>
              ) : (() => {
                const effAccent = (styleSubTab !== 'ALL' ? currentProviderOverrides.accentColor : undefined) || interfaceSettings.accentColor || '#6366f1'
                const effSecondaryGlow = (styleSubTab !== 'ALL' ? currentProviderOverrides.accentGlowColor : undefined) || interfaceSettings.accentGlowColor || '#22d3ee'
                const effDarkness = (styleSubTab !== 'ALL' ? currentProviderOverrides.surfaceDarkness : undefined) ?? interfaceSettings.surfaceDarkness ?? 25
                const effContrast = (styleSubTab !== 'ALL' ? currentProviderOverrides.accentContrast : undefined) ?? interfaceSettings.accentContrast ?? 100

                const pAccent = adjustAccentContrast(effAccent, effContrast)
                const pSecondaryGlow = adjustAccentContrast(effSecondaryGlow, effContrast)
                const pRadius = (styleSubTab !== 'ALL' ? currentProviderOverrides.geometry?.radius : undefined) ?? interfaceSettings.cornerRadius ?? 14
                const pFontVibe = (styleSubTab !== 'ALL' ? currentProviderOverrides.fontVibe : undefined) || interfaceSettings.fontVibe || 'sans'
                const pGlass = (styleSubTab !== 'ALL' ? currentProviderOverrides.glassmorphism : undefined) || interfaceSettings.glassmorphism || 'glassmorphic'
                const pMotion = (styleSubTab !== 'ALL' ? currentProviderOverrides.motionSpeed : undefined) || interfaceSettings.motionSpeed || 'smooth'

                const pIconPack = (styleSubTab !== 'ALL' ? currentProviderOverrides.iconPack : undefined) || interfaceSettings.iconPack || 'lucide-line'
                const pIconWeight = (styleSubTab !== 'ALL' ? currentProviderOverrides.iconStrokeWeight : undefined) || interfaceSettings.iconStrokeWeight || 'standard'
                const pIconGlow = (styleSubTab !== 'ALL' ? currentProviderOverrides.iconGlowEffect : undefined) ?? interfaceSettings.iconGlowEffect

                const pTabGlow = (styleSubTab !== 'ALL' ? currentProviderOverrides.tabGlowStyle : undefined) || interfaceSettings.tabGlowStyle || 'pill-glow'

                const pAura = (styleSubTab !== 'ALL' ? currentProviderOverrides.ambientAura : undefined) ?? interfaceSettings.webviewAmbientAura
                const pAuraMode = (styleSubTab !== 'ALL' ? currentProviderOverrides.ambientAuraMode : undefined) || interfaceSettings.ambientAuraMode || 'viewport-frame'
                const pAuraIntensity = (styleSubTab !== 'ALL' ? currentProviderOverrides.ambientAuraIntensity : undefined) ?? interfaceSettings.ambientAuraIntensity ?? 45
                const pAuraColor = adjustAccentContrast((styleSubTab !== 'ALL' ? currentProviderOverrides.ambientAuraColor : undefined) || interfaceSettings.ambientAuraColor || effAccent, effContrast)

                const pAiResponseWidth = (styleSubTab !== 'ALL' ? currentProviderOverrides.aiResponseWidthPx : undefined) ?? interfaceSettings.aiResponseWidthPx ?? 860
                const pUserPromptWidth = (styleSubTab !== 'ALL' ? currentProviderOverrides.userPromptWidthPx : undefined) ?? interfaceSettings.userPromptWidthPx ?? 720
                const pBubble = (styleSubTab !== 'ALL' ? currentProviderOverrides.bubbleStyle : undefined) || interfaceSettings.webviewBubbleStyle || 'gradient-pill'
                const pBubbleDepth = (styleSubTab !== 'ALL' ? currentProviderOverrides.bubbleGradientDepth : undefined) ?? interfaceSettings.bubbleGradientDepth ?? 30
                const pCodeBlock = (styleSubTab !== 'ALL' ? currentProviderOverrides.codeBlockStyle : undefined) || interfaceSettings.webviewCodeBlockStyle || 'oled-black'
                const pCodeMargin = (styleSubTab !== 'ALL' ? currentProviderOverrides.codeBlockMargin : undefined) ?? interfaceSettings.codeBlockMargin ?? 18
                const pComposer = (styleSubTab !== 'ALL' ? currentProviderOverrides.composerGlow : undefined) || interfaceSettings.webviewComposerGlow || 'electric-neon'
                const pHalo = (styleSubTab !== 'ALL' ? currentProviderOverrides.composerHaloIntensity : undefined) ?? interfaceSettings.composerHaloIntensity ?? 50
                const pGap = (styleSubTab !== 'ALL' ? currentProviderOverrides.messageGap : undefined) ?? interfaceSettings.messageGap ?? 16
                const pModelKey = styleSubTab === 'ALL' ? 'gemini' : styleSubTab

                // Dynamic Glass & OLED Darkness calculations
                const glassBackdropFilter = pGlass === 'solid-opaque' ? 'none' : pGlass === 'ultra-glass' ? 'blur(24px)' : 'blur(14px)'
                const darknessAlpha = Math.min(0.98, Math.max(0.6, 0.72 + (effDarkness / 100) * 0.26))
                const cardBaseR = Math.round(18 * (1 - effDarkness / 100))
                const cardBaseG = Math.round(20 * (1 - effDarkness / 100))
                const cardBaseB = Math.round(30 * (1 - effDarkness / 100))
                const glassCardBg = pGlass === 'solid-opaque'
                  ? `rgb(${cardBaseR}, ${cardBaseG}, ${cardBaseB})`
                  : pGlass === 'ultra-glass'
                    ? `rgba(${cardBaseR + 8}, ${cardBaseG + 8}, ${cardBaseB + 14}, ${darknessAlpha - 0.18})`
                    : `rgba(${cardBaseR}, ${cardBaseG}, ${cardBaseB}, ${darknessAlpha})`
                const glassBorder = pGlass === 'solid-opaque'
                  ? 'rgba(255, 255, 255, 0.08)'
                  : pGlass === 'ultra-glass'
                    ? `rgba(255, 255, 255, ${0.18 * (1 + effContrast / 200)})`
                    : `rgba(255, 255, 255, ${0.09 * (1 + effContrast / 200)})`

                const motionMs = pMotion === 'reduced' ? 0 : pMotion === 'snappy' ? 80 : 180
                const motionEasing = pMotion === 'reduced' ? 'linear' : pMotion === 'snappy' ? 'cubic-bezier(0.2, 0.9, 0.3, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)'
                const motionStyle = {
                  transitionDuration: `${motionMs}ms`,
                  transitionTimingFunction: motionEasing
                }

                const userBubbleMaxWidth = pUserPromptWidth === '100%' ? '100%' : `${Math.min(94, Math.max(60, Math.round((Number(pUserPromptWidth) || 720) / 9)))}%`
                const aiResponseContainerMaxWidth = pAiResponseWidth === '100%' ? '100%' : `${Math.min(100, Math.max(70, Math.round((Number(pAiResponseWidth) || 860) / 9)))}%`

                return (
                  <IconConfigProvider iconPack={pIconPack as IconPack} strokeWeight={pIconWeight} glowEffect={pIconGlow}>
                    <div
                      className="w-[330px] sm:w-[370px] lg:w-[410px] xl:w-[460px] 2xl:w-[500px] shrink-0 flex flex-col gap-3.5 overflow-y-auto custom-scrollbar p-2 relative transition-all"
                      style={{
                        fontFamily:
                          pFontVibe === 'mono'
                            ? 'JetBrains Mono, monospace'
                            : pFontVibe === 'tech'
                              ? 'Rajdhani, sans-serif'
                              : 'Inter, sans-serif',
                        ...motionStyle
                      }}
                    >
                      {/* Ambient mesh background orbs for frosted glass refraction */}
                      <div className="absolute top-16 -left-12 w-48 h-48 rounded-full bg-cyan-500/15 blur-2xl pointer-events-none" />
                      <div className="absolute top-72 -right-12 w-52 h-52 rounded-full bg-purple-500/15 blur-2xl pointer-events-none" />
                      <div className="absolute bottom-20 left-6 w-40 h-40 rounded-full bg-rose-500/15 blur-2xl pointer-events-none" />

                      <div className="flex items-center justify-between relative z-10">
                        <span className="text-sm font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text)' }}>
                          <IconSparkles size={16} style={{ color: pAccent }} />
                          {styleSubTab === 'ALL' ? 'Global Live Stage' : `${modelLabel(styleSubTab)} Live Stage`}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleLiveStageFit}
                            className="text-[10px] font-mono px-2.5 py-1 rounded-full border flex items-center gap-1 cursor-pointer transition-all hover:bg-white/10"
                            style={{
                              background: liveStageFit ? pAccent : 'rgba(255,255,255,0.06)',
                              borderColor: liveStageFit ? pAccent : 'rgba(255,255,255,0.15)',
                              color: liveStageFit ? '#fff' : 'var(--text2)',
                              ...motionStyle
                            }}
                            title="Toggle compact fit view for smaller screens"
                          >
                            <span>{liveStageFit ? '🔍 Compact' : '⛶ Normal'}</span>
                          </button>
                          <span
                            className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border uppercase"
                            style={{
                              background: `color-mix(in srgb, ${pAccent} 18%, transparent)`,
                              color: pAccent,
                              borderColor: `color-mix(in srgb, ${pAccent} 35%, transparent)`
                            }}
                          >
                            Realtime
                          </span>
                        </div>
                      </div>

                      <div className={`flex flex-col gap-4 transition-all relative z-10 ${liveStageFit ? 'scale-[0.88] origin-top-left -mr-[13%]' : ''}`}>
                        {/* 1. Live AI Webview Chat Simulation Stage */}
                        <div
                          className="p-5 sm:p-6 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-2xl"
                          style={{
                            background: glassCardBg,
                            backdropFilter: glassBackdropFilter,
                            WebkitBackdropFilter: glassBackdropFilter,
                            borderColor: glassBorder,
                            borderRadius: `${pRadius}px`,
                            boxShadow:
                              pAura && pAuraMode !== 'chat-center'
                                ? `inset 0 0 ${Math.round(pAuraIntensity * 0.8)}px color-mix(in srgb, ${pAuraColor} ${pAuraIntensity}%, transparent), 0 16px 45px rgba(0,0,0,0.7)`
                                : '0 16px 45px rgba(0,0,0,0.6)',
                            ...motionStyle
                          }}
                        >
                          {/* Chat Center Ambient Halo */}
                          {pAura && pAuraMode === 'chat-center' && (
                            <div
                              className="absolute inset-0 pointer-events-none"
                              style={{
                                background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, ${pAuraColor} ${pAuraIntensity * 0.55}%, transparent) 0%, transparent 70%)`
                              }}
                            />
                          )}

                          {/* Top Header Bar */}
                          <div className="flex items-center justify-between border-b border-white/5 pb-3 relative z-10">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center border shadow-sm"
                                style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.1)' }}
                              >
                                <BrandIcon id={pModelKey} size={14} style={{ color: pAccent }} />
                              </div>
                              <span className="text-xs sm:text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                                {styleSubTab === 'ALL' ? 'AI Workspace Live View' : `${modelLabel(styleSubTab)} Live View`}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-white/10 text-(--text2)">
                                {pAiResponseWidth === '100%' ? '100% W' : `${pAiResponseWidth}px`}
                              </span>
                              {pAura && (
                                <span
                                  className="text-[10px] px-2 py-0.5 rounded font-mono uppercase font-bold"
                                  style={{ background: `color-mix(in srgb, ${pAccent} 20%, transparent)`, color: pAccent }}
                                >
                                  {pAuraMode === 'chat-center' ? 'CENTER AURA' : 'FRAME AURA'}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* User Message Bubble with Rich Text */}
                          <div className="flex justify-end relative z-10" style={{ marginBottom: `${pGap - 8}px` }}>
                            <div
                              className="p-4 text-xs sm:text-sm font-medium leading-relaxed transition-all shadow-md"
                              style={{
                                width: 'fit-content',
                                maxWidth: userBubbleMaxWidth,
                                marginLeft: 'auto',
                                borderRadius: `${Math.max(4, pRadius - 2)}px`,
                                background:
                                  pBubble === 'gradient-pill'
                                    ? `linear-gradient(135deg, color-mix(in srgb, ${pAccent} ${pBubbleDepth}%, var(--surface2)) 0%, var(--surface2) 100%)`
                                    : pBubble === 'minimal-outline'
                                      ? 'transparent'
                                      : 'var(--surface2)',
                                border:
                                  pBubble === 'minimal-outline'
                                    ? `1px solid ${pAccent}`
                                    : `1px solid color-mix(in srgb, ${pAccent} 45%, var(--border))`,
                                color: 'var(--text)',
                                boxShadow: pBubble === 'gradient-pill' ? `0 4px 18px color-mix(in srgb, ${pAccent} 35%, transparent)` : 'none',
                                ...motionStyle
                              }}
                            >
                              Can you design a high-throughput caching pipeline with Redis streams and telemetry metrics? Please include consumer group initialization and graceful shutdown handling.
                            </div>
                          </div>

                          {/* AI Assistant Message with Rich Prose & Formatted Code */}
                          <div className="flex flex-col gap-2.5 relative z-10 transition-all" style={{ maxWidth: aiResponseContainerMaxWidth, marginBottom: `${pGap - 8}px` }}>
                            <div className="flex items-center justify-between text-xs text-(--text2)">
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: `${pAccent}25` }}>
                                  <BrandIcon id={pModelKey} size={11} style={{ color: pAccent }} />
                                </div>
                                <span className="font-bold" style={{ color: pAccent }}>{modelLabel(pModelKey)} Assistant</span>
                                <span className="opacity-60">&bull; Just now</span>
                              </div>
                              <span className="text-[10px] font-mono text-emerald-400/90 font-semibold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                200 OK
                              </span>
                            </div>

                            {/* Markdown Prose Introduction */}
                            <p className="text-xs sm:text-sm leading-relaxed text-gray-200">
                              Here is a production-ready pipeline architecture featuring consumer group auto-provisioning, pipelined batch acknowledgment, and Prometheus latency gauges:
                            </p>

                            {/* Syntax Highlighted Code Block with Header Bar */}
                            <div
                              className="text-xs font-mono leading-relaxed transition-all rounded-xl overflow-hidden border shadow-lg"
                              style={{
                                margin: `${Math.max(6, pCodeMargin - 6)}px 0`,
                                borderRadius: `${Math.max(4, pRadius - 4)}px`,
                                background:
                                  pCodeBlock === 'matrix-terminal'
                                    ? '#040d07'
                                    : pCodeBlock === 'soft-slate'
                                      ? 'var(--surface2)'
                                      : '#05060a',
                                borderColor:
                                  pCodeBlock === 'matrix-terminal'
                                    ? 'rgba(16, 185, 129, 0.4)'
                                    : pCodeBlock === 'soft-slate'
                                      ? `color-mix(in srgb, ${pAccent} 35%, var(--border))`
                                      : 'rgba(255, 255, 255, 0.1)',
                                boxShadow:
                                  pCodeBlock === 'matrix-terminal'
                                    ? '0 0 20px rgba(16, 185, 129, 0.15)'
                                    : '0 6px 20px rgba(0,0,0,0.5)',
                                ...motionStyle
                              }}
                            >
                              {/* Code Header Bar */}
                              <div className="flex items-center justify-between px-3.5 py-1.5 bg-black/40 border-b border-white/5 text-[10px]">
                                <span className="font-mono text-gray-400 flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-rose-500/80" />
                                  <span className="w-2 h-2 rounded-full bg-amber-500/80" />
                                  <span className="w-2 h-2 rounded-full bg-emerald-500/80" />
                                  <span className="ml-1 font-semibold text-white/90">telemetry_pipeline.ts</span>
                                </span>
                                <span className="font-mono text-[9px] text-cyan-300 font-bold px-1.5 py-0.2 rounded bg-cyan-500/15">
                                  TypeScript
                                </span>
                              </div>

                              {/* Code Content */}
                              <div className="p-3.5 space-y-0.5 text-[11px] text-gray-300">
                                <div><span className="text-purple-400">const</span> stream = <span className="text-purple-400">await</span> redis.<span className="text-blue-400">xreadgroup</span>(</div>
                                <div className="pl-3"><span className="text-emerald-400">&apos;GROUP&apos;</span>, <span className="text-emerald-400">&apos;nexus-workers&apos;</span>, <span className="text-emerald-400">&apos;worker-01&apos;</span>,</div>
                                <div className="pl-3"><span className="text-emerald-400">&apos;BLOCK&apos;</span>, <span className="text-amber-400">2000</span>, <span className="text-emerald-400">&apos;COUNT&apos;</span>, <span className="text-amber-400">10</span>,</div>
                                <div className="pl-3"><span className="text-emerald-400">&apos;STREAMS&apos;</span>, <span className="text-emerald-400">&apos;events:telemetry&apos;</span>, <span className="text-emerald-400">&apos;&gt;&apos;</span></div>
                                <div>)</div>
                                <div className="pt-1"><span className="text-purple-400">for</span> (<span className="text-purple-400">const</span> [id, fields] <span className="text-purple-400">of</span> stream[<span className="text-amber-400">0</span>][<span className="text-amber-400">1</span>]) &#123;</div>
                                <div className="pl-3"><span className="text-purple-400">await</span> <span className="text-blue-400">processTelemetryRecord</span>(id, fields)</div>
                                <div className="pl-3"><span className="text-purple-400">await</span> redis.<span className="text-blue-400">xack</span>(<span className="text-emerald-400">&apos;events:telemetry&apos;</span>, <span className="text-emerald-400">&apos;nexus-workers&apos;</span>, id)</div>
                                <div>&#125;</div>
                              </div>
                            </div>

                            {/* Architectural Bullet Points */}
                            <div className="space-y-1 text-xs text-gray-300 pt-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold" style={{ color: pAccent }}>•</span>
                                <span><strong>Pipelined Ack:</strong> Guarantees at-least-once message processing without data loss.</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold" style={{ color: pAccent }}>•</span>
                                <span><strong>Dynamic Backpressure:</strong> Automatically throttles ingestion under high worker load.</span>
                              </div>
                            </div>

                            {/* Action Bar / Status Footer */}
                            <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-gray-400">
                              <span className="font-mono text-[10px] text-gray-400">⚡ 124ms &bull; 412 tokens</span>
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 cursor-pointer text-white/80 transition-colors">
                                  Copy Code
                                </span>
                                <span className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 cursor-pointer text-white/80 transition-colors">
                                  Retry ↺
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Interactive Prompt Composer Bar */}
                          <div
                            className="flex items-center gap-2.5 p-3 rounded-xl border bg-black/40 text-xs sm:text-sm transition-all relative z-10"
                            style={{
                              borderRadius: `${Math.max(4, pRadius - 2)}px`,
                              borderColor:
                                pComposer === 'electric-neon'
                                  ? pAccent
                                  : 'var(--border)',
                              boxShadow:
                                pComposer === 'electric-neon'
                                  ? `0 0 ${Math.round(10 + pHalo * 0.14)}px color-mix(in srgb, ${pAccent} ${pHalo * 0.65}%, transparent)`
                                  : pComposer === 'underglow-pill'
                                    ? `0 4px ${Math.round(8 + pHalo * 0.12)}px color-mix(in srgb, ${pAccent} ${pHalo * 0.55}%, transparent)`
                                    : 'none',
                              ...motionStyle
                            }}
                          >
                            <span className="text-xs opacity-60 flex-1 truncate">Ask a follow up question or paste code...</span>
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 shadow-md cursor-pointer transition-transform hover:scale-105"
                              style={{ background: pAccent, ...motionStyle }}
                            >
                              <span className="text-xs font-bold">↑</span>
                            </div>
                          </div>
                        </div>

                        {/* 2. Live Tab Strip Preview with 4 Distinct Tab Glow Styles */}
                        <div
                          className="p-4 rounded-2xl border flex flex-col gap-3 transition-all shadow-md"
                          style={{ background: glassCardBg, backdropFilter: glassBackdropFilter, WebkitBackdropFilter: glassBackdropFilter, borderColor: glassBorder, ...motionStyle }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-(--text2)">Tab Bar & Illumination</span>
                            <span className="text-[10px] opacity-70 font-mono capitalize">{pTabGlow.replace('-', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-black/30 border border-white/5 overflow-x-auto">
                            {/* Active Tab */}
                            <div
                              data-active="true"
                              className="chat-tab-pill flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium cursor-default transition-all relative overflow-hidden"
                              style={{
                                borderRadius: `${Math.max(4, pRadius)}px`,
                                background:
                                  pTabGlow === 'pill-glow'
                                    ? `color-mix(in srgb, ${pAccent} 22%, var(--surface))`
                                    : pTabGlow === 'badge-neon'
                                      ? `color-mix(in srgb, ${pAccent} 12%, var(--surface))`
                                      : 'var(--surface)',
                                border:
                                  pTabGlow === 'pill-glow'
                                    ? `1px solid ${pAccent}`
                                    : pTabGlow === 'laser-line'
                                      ? '1px solid transparent'
                                      : `1px solid color-mix(in srgb, ${pAccent} 40%, var(--border))`,
                                borderBottom: pTabGlow === 'laser-line' ? `2px solid ${pAccent}` : undefined,
                                boxShadow:
                                  pTabGlow === 'pill-glow'
                                    ? `0 0 16px color-mix(in srgb, ${pSecondaryGlow} 45%, transparent)`
                                    : pTabGlow === 'laser-line'
                                      ? `0 4px 12px ${pSecondaryGlow}`
                                      : 'none',
                                ...motionStyle
                              }}
                            >
                              <div
                                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                                style={{ boxShadow: `0 0 8px ${pAccent}` }}
                              >
                                <BrandIcon id={styleSubTab === 'ALL' ? 'gemini' : styleSubTab} size={12} style={{ color: pAccent }} />
                              </div>
                              <span className="truncate max-w-[110px]" style={{ color: 'var(--text)' }}>
                                {styleSubTab === 'ALL' ? 'Gemini Pro' : modelLabel(styleSubTab)}
                              </span>
                              {pTabGlow === 'badge-neon' && (
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: pSecondaryGlow, boxShadow: `0 0 6px ${pSecondaryGlow}` }} />
                              )}
                              <span className="opacity-60 text-xs">✕</span>
                            </div>

                            {/* Inactive Tab */}
                            <div
                              data-active="false"
                              className="chat-tab-pill flex items-center gap-2 px-3 py-2 text-xs sm:text-sm opacity-60 cursor-default border border-transparent hover:opacity-90 transition-all"
                              style={{ borderRadius: `${Math.max(4, pRadius)}px`, ...motionStyle }}
                            >
                              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0">
                                <BrandIcon id="chatgpt" size={12} />
                              </div>
                              <span className="truncate max-w-[90px]">ChatGPT</span>
                            </div>
                          </div>
                        </div>

                        {/* 3. Live Universal Icon Showcase Widget */}
                        <div
                          className="p-4 rounded-2xl border flex flex-col gap-3 transition-all shadow-md"
                          style={{ background: glassCardBg, backdropFilter: glassBackdropFilter, WebkitBackdropFilter: glassBackdropFilter, borderColor: glassBorder, ...motionStyle }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-(--text2)">Universal Glyph Showcase</span>
                            <span className="text-[10px] opacity-70 font-mono capitalize">{pIconPack.replace('-', ' ')}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2.5 p-2.5 rounded-xl bg-black/30 border border-white/5">
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconSearch size={20} />
                              <span className="text-[10px] opacity-70 font-mono">Search</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconSettings size={20} />
                              <span className="text-[10px] opacity-70 font-mono">Settings</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconHistory size={20} />
                              <span className="text-[10px] opacity-70 font-mono">History</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconSparkles size={20} style={{ color: pAccent }} />
                              <span className="text-[10px] opacity-70 font-mono">Sparkle</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconZap size={20} style={{ color: pAccent }} />
                              <span className="text-[10px] opacity-70 font-mono">Energy</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconPin size={20} />
                              <span className="text-[10px] opacity-70 font-mono">Pin</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconLayers size={20} />
                              <span className="text-[10px] opacity-70 font-mono">Layers</span>
                            </div>
                            <div className="flex flex-col items-center justify-center p-2.5 rounded-lg bg-white/5 gap-1.5 text-(--text) transition-all hover:bg-white/10">
                              <IconShield size={20} />
                              <span className="text-[10px] opacity-70 font-mono">Shield</span>
                            </div>
                          </div>
                        </div>

                        {/* 4. Live Interactive Action Button */}
                        <div
                          className="p-4 rounded-2xl border flex flex-col gap-2.5 transition-all shadow-md"
                          style={{ background: glassCardBg, backdropFilter: glassBackdropFilter, WebkitBackdropFilter: glassBackdropFilter, borderColor: glassBorder, ...motionStyle }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-(--text2)">Buttons & Motion Speed</span>
                            <span className="text-[10px] opacity-70 font-mono capitalize">{pMotion} ({motionMs}ms)</span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 text-white shadow-md transition-all active:scale-95 cursor-pointer"
                              style={{
                                background: pAccent,
                                borderRadius: `${Math.max(4, pRadius - 2)}px`,
                                boxShadow: `0 0 16px color-mix(in srgb, ${pAccent} 45%, transparent)`,
                                ...motionStyle
                              }}
                            >
                              <IconZap size={15} />
                              Click Test ({pMotion})
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </IconConfigProvider>
                )
              })()}
            </div>
          </div>
        ) : tab === 'webview' ? (
          /* Live AI Webview & CSS Sandbox Studio */
          <div className="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden">
            {/* LEFT: Provider Selector & Controls */}
            <div className="w-[200px] shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
              <SectionTitle>
                <IconMonitor size={14} />
                <span>AI Providers</span>
              </SectionTitle>

              <div className="flex flex-col gap-1.5">
                {models.map((m) => {
                  const isSel = selProvider === m.key
                  const ov = providerConfig[m.key]
                  const hasOverrides = ov && Object.keys(ov).length > 0 && Object.values(ov).some(v => v !== undefined && v !== '' && (typeof v !== 'object' || Object.keys(v).length > 0))
                  const color = ov?.accentColor || m.color || modelColor(m.key)

                  return (
                    <button
                      key={m.key}
                      onClick={() => handleSelectProvider(m.key)}
                      className="flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer"
                      style={
                        isSel
                          ? { background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }
                          : {
                              background: 'var(--bg)',
                              color: 'var(--text2)',
                              border: '1px solid var(--border)'
                            }
                      }
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                        <span className="truncate">{modelLabel(m.key)}</span>
                      </div>
                      {(isSel && hasFileOverride) ? (
                        <span className="text-[10px] opacity-90 font-mono font-bold text-amber-300">✦ conf</span>
                      ) : hasOverrides ? (
                        <span className="text-[10px] opacity-75 font-mono">✦ Custom</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {/* Webview Theme Master Toggle */}
              <Card>
                <SectionTitle onReset={() => clearSection('on')}>
                  <IconShield size={13} />
                  <span>Theme Master</span>
                </SectionTitle>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-(--text2)">Theme injection:</span>
                  <select
                    value={providerCfg.on || 'default'}
                    onChange={(e) =>
                      set({ on: (e.target.value || 'default') as ProviderOverrides['on'] })
                    }
                    className="px-2.5 py-1.5 rounded-lg border bg-[var(--surface2)] text-[var(--text)] text-xs font-semibold focus:outline-none"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="default">Follow Global</option>
                    <option value="on">Always On</option>
                    <option value="off">Off (Vanilla AI)</option>
                  </select>
                </div>
              </Card>

              {/* Reset overrides */}
              <button
                onClick={resetProvider}
                className="shrink-0 w-full py-2 px-2.5 rounded-xl border border-dashed text-xs font-semibold transition-colors hover:bg-[var(--surface2)] text-rose-400 hover:text-rose-300 cursor-pointer"
                style={{ borderColor: 'rgba(244, 63, 94, 0.3)' }}
                title={`Removes every override for ${modelLabel(selProvider)} — inherits the global theme again`}
              >
                ↺ Reset {modelLabel(selProvider)} Overrides
              </button>

              {/* Live CSS Sync Info */}
              <div className="p-3 rounded-xl border bg-black/25 flex flex-col gap-1 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
                <span className="font-semibold text-white">Live CSS Hot-Reload</span>
                <p className="leading-relaxed opacity-75">
                  CSS edits in the right editor instantly inject into the active {modelLabel(selProvider)} webview in real time without erasing custom rules.
                </p>
              </div>
            </div>

            {/* CENTER: Live AI Webview Stream / Mirror */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 rounded-2xl border p-3.5 shadow-lg" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between shrink-0 pb-2 border-b border-white/5 gap-2">
                <div className="flex items-center gap-2">
                  <BrandIcon id={selProvider} size={16} />
                  <span className="text-xs font-bold uppercase tracking-wider text-white truncate">
                    {modelLabel(selProvider)} Live Stream
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Fit mode toggle */}
                  <div className="flex items-center p-0.5 rounded-lg border bg-black/30 text-[10px] font-mono" style={{ borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewFitMode('contain')
                        try { localStorage.setItem('nexus.preview_fit_mode', 'contain') } catch {}
                      }}
                      className="px-2 py-0.5 rounded transition-colors cursor-pointer"
                      style={{
                        background: previewFitMode === 'contain' ? 'var(--accent)' : 'transparent',
                        color: previewFitMode === 'contain' ? '#fff' : 'var(--text2)'
                      }}
                      title="Fit entire webview (header to composer) into frame"
                    >
                      Full View (Fit)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewFitMode('cover')
                        try { localStorage.setItem('nexus.preview_fit_mode', 'cover') } catch {}
                      }}
                      className="px-2 py-0.5 rounded transition-colors cursor-pointer"
                      style={{
                        background: previewFitMode === 'cover' ? 'var(--accent)' : 'transparent',
                        color: previewFitMode === 'cover' ? '#fff' : 'var(--text2)'
                      }}
                      title="Fill frame"
                    >
                      Fill
                    </button>
                  </div>

                  <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
                    Live Mirror
                  </span>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 rounded-xl border overflow-hidden flex items-center justify-center relative bg-black/50 shadow-inner p-1.5"
                style={{ borderColor: 'var(--border)' }}
              >
                {!previewAvailable ? (
                  <div className="flex flex-col items-center gap-2.5 px-6 text-center max-w-md">
                    <BrandIcon id={selProvider} size={36} className="opacity-40" />
                    <span className="text-xs leading-relaxed text-(--text2)">
                      No active <strong className="text-white">{modelLabel(selProvider)}</strong> tab is currently open.
                      <br />
                      Open or switch to {modelLabel(selProvider)} in Nexus to view live webview mirror stream.
                    </span>
                  </div>
                ) : previewFrame ? (
                  <div className="w-full h-full flex items-center justify-center overflow-hidden">
                    <img
                      src={previewFrame}
                      alt={`${modelLabel(selProvider)} live preview`}
                      className={
                        previewFitMode === 'contain'
                          ? 'max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-all border border-white/10'
                          : 'w-full h-full object-cover object-top rounded-lg shadow-2xl transition-all'
                      }
                      style={{
                        imageRendering: 'auto'
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-(--text2)">
                    Waiting for preview stream…
                  </span>
                )}
              </div>
            </div>

            {/* Toast Notification for Webview Tab */}
            {copiedCssToast && (
              <div className="fixed bottom-6 right-6 z-[999999] px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-xs shadow-2xl flex items-center gap-2 border border-emerald-400/40 animate-pulse">
                <span>{copiedCssToast}</span>
              </div>
            )}

            {/* RIGHT: Live CSS Sync Editor & Snippets */}
            <div className="w-[410px] shrink-0 min-h-0 flex flex-col gap-2 rounded-2xl border p-3.5 shadow-lg" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between shrink-0 pb-2 border-b border-white/5">
                <SectionTitle>
                  <IconKeyboard size={14} />
                  <span>CSS Sync & AI Theming</span>
                </SectionTitle>
                <span className="text-[10px] font-mono text-(--text2)">
                  Hot-Reloads Live
                </span>
              </div>

              {/* AI Theming Prompt & Computed CSS Action Bar */}
              <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-black/40 border border-white/10">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const activeModel = models.find((m) => m.key === selProvider)
                        const providerUrl = activeModel?.url || 'https://z.ai'

                        // Fetch full computed CSS and live sanitized DOM HTML concurrently
                        const [fullCss, domResult] = await Promise.all([
                          // @ts-ignore
                          window.electron?.ipcRenderer?.invoke('get_full_provider_css', selProvider, providerUrl).catch(() => ''),
                          // @ts-ignore
                          window.electron?.ipcRenderer?.invoke('extract_provider_live_dom', selProvider, providerUrl).catch(() => ({ success: false }))
                        ])

                        const hasLiveDom = domResult && domResult.success && domResult.html
                        const promptText = generateAiThemingPrompt({
                          providerName: modelLabel(selProvider),
                          providerUrl,
                          colors: (displayed ?? activeTheme).colors,
                          interfaceSettings,
                          providerOverrides: providerCfg,
                          computedCss: fullCss || undefined,
                          liveDomHtml: hasLiveDom ? domResult.html : undefined
                        })

                        await navigator.clipboard.writeText(promptText)
                        if (hasLiveDom) {
                          setCopiedCssToast(`✓ Copied Complete AI Prompt with Live HTML & Computed CSS for ${modelLabel(selProvider)}!`)
                        } else {
                          setCopiedCssToast(`✓ Copied AI Prompt with Computed CSS! (Tip: Open a tab for ${modelLabel(selProvider)} to include live HTML)`)
                        }
                        setTimeout(() => setCopiedCssToast(null), 4000)
                      } catch (err) {
                        console.error('Failed to copy AI prompt:', err)
                      }
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border border-indigo-500/40 text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                    title="Generate a comprehensive prompt with live HTML & computed CSS tokens to feed to an AI for site-specific CSS"
                  >
                    <IconSparkles size={13} />
                    <span>✨ Copy AI Theming Prompt</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const activeModel = models.find((m) => m.key === selProvider)
                        // @ts-ignore
                        const fullCss = await window.electron?.ipcRenderer?.invoke('get_full_provider_css', selProvider, activeModel?.url)
                        if (fullCss && typeof fullCss === 'string') {
                          await navigator.clipboard.writeText(fullCss)
                          setCopiedCssToast(`✓ Copied Full Computed CSS for ${modelLabel(selProvider)}!`)
                          setTimeout(() => setCopiedCssToast(null), 3000)
                        }
                      } catch (err) {
                        console.error('Failed to copy full CSS:', err)
                      }
                    }}
                    className="py-1.5 px-2 rounded-lg text-xs font-bold border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer flex items-center gap-1"
                    title="Copy full active CSS stylesheet with all variables computed"
                  >
                    <span>📋 Copy CSS</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText()
                        if (text) {
                          const current = providerConfig[selProvider]?.customCss || ''
                          const next = current ? `${current}\n\n${text}` : text
                          set({ customCss: next })
                          setCopiedCssToast(`✓ Pasted & Applied Custom CSS to ${modelLabel(selProvider)}!`)
                          setTimeout(() => setCopiedCssToast(null), 3000)
                        }
                      } catch (err) {
                        console.error('Failed to paste from clipboard:', err)
                      }
                    }}
                    className="flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer text-center"
                    title="Paste raw CSS from clipboard directly into this provider's custom rules"
                  >
                    📥 Paste & Apply CSS
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProviderConfig((prev) => ({ ...prev }))
                      setCopiedCssToast(`✓ Re-injected ${modelLabel(selProvider)} CSS live!`)
                      setTimeout(() => setCopiedCssToast(null), 2500)
                    }}
                    className="py-1 px-2 rounded-lg text-[11px] font-semibold border border-white/10 text-gray-300 hover:bg-white/5 transition-colors cursor-pointer"
                    title="Re-inject active CSS payload into live webview immediately"
                  >
                    ⚡ Re-inject Live
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 mt-1 border-t border-white/10 pt-2">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Configuration File (customthemes.conf)</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const activeModel = models.find((m) => m.key === selProvider)
                          // @ts-ignore
                          const baseCss = await window.electron?.ipcRenderer?.invoke('get_provider_base_css', selProvider, activeModel?.url)
                          if (baseCss && typeof baseCss === 'string') {
                            await navigator.clipboard.writeText(baseCss)
                            setCopiedCssToast(`✓ Copied Base CSS for ${modelLabel(selProvider)}!`)
                            setTimeout(() => setCopiedCssToast(null), 3000)
                          }
                        } catch (err) {
                          console.error('Failed to copy base CSS:', err)
                        }
                      }}
                      className="py-1 px-2 rounded-lg text-[10px] font-semibold border border-blue-500/30 text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 transition-colors cursor-pointer"
                      title="Copy the default built-in CSS to clipboard"
                    >
                      📖 Copy Base CSS
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const activeModel = models.find((m) => m.key === selProvider)
                          const currentCss = providerConfig[selProvider]?.customCss || ''
                          // @ts-ignore
                          const success = await window.electron?.ipcRenderer?.invoke('save_custom_theme_file', selProvider, currentCss, activeModel?.url)
                          if (success) {
                            setHasFileOverride(true)
                            setCopiedCssToast(`✓ Saved to customthemes.conf & applied live!`)
                            setTimeout(() => setCopiedCssToast(null), 3000)
                          }
                        } catch (err) {
                          console.error('Failed to save custom theme:', err)
                        }
                      }}
                      className="flex-1 py-1 px-2 rounded-lg text-[10px] font-bold border border-amber-500/50 text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 transition-colors cursor-pointer text-center shadow-sm"
                      title="Save your Custom CSS from the editor below permanently into customthemes.conf"
                    >
                      💾 Save to customthemes.conf
                    </button>

                    {hasFileOverride && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            // @ts-ignore
                            const success = await window.electron?.ipcRenderer?.invoke('reset_custom_theme_file', selProvider)
                            if (success) {
                              setHasFileOverride(false)
                              setCopiedCssToast(`↺ Removed override for ${modelLabel(selProvider)}`)
                              setTimeout(() => setCopiedCssToast(null), 3000)
                            }
                          } catch (err) {
                            console.error('Failed to reset custom theme:', err)
                          }
                        }}
                        className="py-1 px-2 rounded-lg text-[10px] font-semibold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer"
                        title="Delete the override for this provider from customthemes.conf"
                      >
                        ↺ Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Snippets */}
              <div className="flex flex-wrap items-center gap-1.5 py-1">
                <span className="text-[11px] font-semibold text-(--text2)">Snippets:</span>
                {[
                  { label: '+ Hide Header', snippet: 'header, nav, [class*="header"] { display: none !important; }\n' },
                  { label: '+ Code Font 18px', snippet: 'pre, code, [class*="code"] { font-size: 18px !important; }\n' },
                  { label: '+ Compact Composer', snippet: 'form, [class*="composer"], textarea { max-width: 760px !important; margin: 0 auto !important; }\n' },
                  { label: '+ Transparent Bg', snippet: 'html, body, main { background: transparent !important; }\n' }
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      const current = providerConfig[selProvider]?.customCss || ''
                      const next = current ? `${current}\n${item.snippet}` : item.snippet
                      set({ customCss: next })
                    }}
                    className="px-2 py-0.5 rounded-md text-[11px] font-mono border transition-colors hover:bg-(--surface2) cursor-pointer"
                    style={{ borderColor: 'rgba(245, 158, 11, 0.25)', color: 'var(--accent)' }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0">
                <SyncCssEditor
                  cfg={providerCfg}
                  globalColors={activeColors}
                  globalRadius={activeTheme.radius}
                  providerLabel={modelLabel(selProvider)}
                  themeName={activeTheme.name}
                  onParsed={commitParsed}
                />
              </div>
            </div>
          </div>
        ) : (
          /* Shortcuts tab: categorized shortcuts matrix with interactive key recorder */
          <div
            ref={activeContentScrollRef}
            onScroll={handleContentScroll}
            onFocusCapture={handleContentFocusCapture}
            className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar overscroll-contain h-full"
          >
            <ShortcutsMatrix />
          </div>
        )}
      </div>
    </div>
  </div>
)
}
