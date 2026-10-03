import type { IconPack, IconStrokeWeight } from './iconContext'
export type { IconPack, IconStrokeWeight }

export type AestheticPreset = 'refined-modern' | 'cyberpunk-neon' | 'minimalist-slate' | 'iron-man-hud' | 'custom'
export type IconStyle = 'lucide-vector' | 'duotone-filled' | 'monochrome-slate'
export type SettingsLayout = 'vertical-sidebar' | 'horizontal-tabs' | 'collapsible-accordion'
export type Glassmorphism = 'glassmorphic' | 'solid-opaque' | 'ultra-glass'
export type MotionSpeed = 'smooth' | 'snappy' | 'reduced'
export type OmniboxMode = 'live' | 'enter'
export type DefaultSearchEngine = 'perplexity' | 'google' | 'duckduckgo'
export type TabGlowStyle = 'pill-glow' | 'laser-line' | 'badge-neon' | 'subtle-dot' | 'brand-dot' | 'gradient-pill' | 'clean-border'
export type WebviewFocusPolicy = 'auto-hover' | 'standard'
export type FontVibe = 'sans' | 'mono' | 'tech'
export type ThemeAdaptation = 'smart' | 'preset-palette'
export type WebviewBubbleStyle = 'gradient-pill' | 'glass-slate' | 'minimal-outline'
export type WebviewCodeBlockStyle = 'oled-contrast' | 'matrix-terminal' | 'soft-slate'
export type WebviewComposerGlow = 'electric-neon' | 'clean-border' | 'underglow-pill'
export type AmbientAuraMode = 'viewport-frame' | 'chat-center'

export interface InterfaceSettings {
  aestheticPreset: AestheticPreset
  iconStyle: IconStyle
  iconPack: IconPack
  iconStrokeWeight: IconStrokeWeight
  iconGlowEffect: boolean
  settingsLayout: SettingsLayout
  glassmorphism: Glassmorphism
  motionSpeed: MotionSpeed
  omniboxMode: OmniboxMode
  defaultSearchEngine: DefaultSearchEngine
  tabGlowStyle: TabGlowStyle
  webviewFocusPolicy: WebviewFocusPolicy
  fontVibe: FontVibe
  cornerRadius: number
  themeAdaptation: ThemeAdaptation
  accentColor?: string
  accentGlowColor?: string
  surfaceBgColor?: string
  webviewAmbientAura: boolean
  ambientAuraMode: AmbientAuraMode
  ambientAuraIntensity: number
  ambientAuraColor?: string
  webviewBubbleStyle: WebviewBubbleStyle
  bubbleGradientDepth: number
  webviewCodeBlockStyle: WebviewCodeBlockStyle
  codeBlockMargin: number
  webviewComposerGlow: WebviewComposerGlow
  composerHaloIntensity: number
  messageGap: number
  aiResponseWidthPx?: number | string
  userPromptWidthPx?: number | string
  surfaceDarkness?: number
  accentContrast?: number
  globalCustomCss?: string
  globalCustomJs?: string
  tabSwitcherLimit?: number
  pinnedPosition?: 'sidebar' | 'bottom'
}

export const DEFAULT_INTERFACE_SETTINGS: InterfaceSettings = {
  aestheticPreset: 'refined-modern',
  iconStyle: 'lucide-vector',
  iconPack: 'lucide-line',
  tabSwitcherLimit: 7,
  iconStrokeWeight: 'standard',
  iconGlowEffect: false,
  settingsLayout: 'vertical-sidebar',
  glassmorphism: 'glassmorphic',
  motionSpeed: 'smooth',
  omniboxMode: 'live',
  defaultSearchEngine: 'perplexity',
  tabGlowStyle: 'brand-dot',
  webviewFocusPolicy: 'auto-hover',
  fontVibe: 'sans',
  cornerRadius: 14,
  themeAdaptation: 'smart',
  accentColor: '#6366f1',
  accentGlowColor: '#818cf8',
  surfaceBgColor: '#0f111a',
  surfaceDarkness: 50,
  accentContrast: 100,
  webviewAmbientAura: false,
  ambientAuraMode: 'viewport-frame',
  ambientAuraIntensity: 45,
  ambientAuraColor: '',
  webviewBubbleStyle: 'glass-slate',
  bubbleGradientDepth: 30,
  webviewCodeBlockStyle: 'oled-contrast',
  codeBlockMargin: 18,
  webviewComposerGlow: 'clean-border',
  composerHaloIntensity: 45,
  messageGap: 16,
  aiResponseWidthPx: 860,
  userPromptWidthPx: 720,
  globalCustomCss: '',
  globalCustomJs: '',
  pinnedPosition: 'sidebar'
}

export const PRESET_CONFIGS: Record<Exclude<AestheticPreset, 'custom'>, Partial<InterfaceSettings>> = {
  'refined-modern': {
    iconStyle: 'lucide-vector',
    iconPack: 'lucide-line',
    iconStrokeWeight: 'standard',
    iconGlowEffect: false,
    settingsLayout: 'vertical-sidebar',
    glassmorphism: 'glassmorphic',
    motionSpeed: 'smooth',
    omniboxMode: 'live',
    defaultSearchEngine: 'perplexity',
    tabGlowStyle: 'brand-dot',
    webviewFocusPolicy: 'auto-hover',
    fontVibe: 'sans',
    cornerRadius: 14,
    accentColor: '#6366f1',
    accentGlowColor: '#818cf8',
    surfaceBgColor: '#0b0c14',
    webviewAmbientAura: false,
    ambientAuraMode: 'viewport-frame',
    ambientAuraIntensity: 40,
    webviewBubbleStyle: 'glass-slate',
    bubbleGradientDepth: 25,
    webviewCodeBlockStyle: 'oled-contrast',
    codeBlockMargin: 18,
    webviewComposerGlow: 'clean-border',
    composerHaloIntensity: 40,
    messageGap: 16
  },
  'cyberpunk-neon': {
    iconStyle: 'lucide-vector',
    iconPack: 'cyber-hud',
    iconStrokeWeight: 'bold',
    iconGlowEffect: true,
    settingsLayout: 'vertical-sidebar',
    glassmorphism: 'ultra-glass',
    motionSpeed: 'snappy',
    omniboxMode: 'live',
    defaultSearchEngine: 'perplexity',
    tabGlowStyle: 'gradient-pill',
    webviewFocusPolicy: 'auto-hover',
    fontVibe: 'tech',
    cornerRadius: 4,
    accentColor: '#00f0ff',
    accentGlowColor: '#ff0055',
    surfaceBgColor: '#07070b',
    webviewAmbientAura: true,
    ambientAuraMode: 'viewport-frame',
    ambientAuraIntensity: 65,
    ambientAuraColor: '#00f0ff',
    webviewBubbleStyle: 'gradient-pill',
    bubbleGradientDepth: 45,
    webviewCodeBlockStyle: 'matrix-terminal',
    codeBlockMargin: 20,
    webviewComposerGlow: 'electric-neon',
    composerHaloIntensity: 70,
    messageGap: 18
  },
  'minimalist-slate': {
    iconStyle: 'monochrome-slate',
    iconPack: 'retro-monoline',
    iconStrokeWeight: 'thin',
    iconGlowEffect: false,
    settingsLayout: 'horizontal-tabs',
    glassmorphism: 'solid-opaque',
    motionSpeed: 'reduced',
    omniboxMode: 'live',
    defaultSearchEngine: 'google',
    tabGlowStyle: 'clean-border',
    webviewFocusPolicy: 'standard',
    fontVibe: 'mono',
    cornerRadius: 0,
    accentColor: '#e2e8f0',
    accentGlowColor: 'transparent',
    surfaceBgColor: '#0f1115',
    webviewAmbientAura: false,
    ambientAuraMode: 'viewport-frame',
    ambientAuraIntensity: 20,
    webviewBubbleStyle: 'minimal-outline',
    bubbleGradientDepth: 0,
    webviewCodeBlockStyle: 'soft-slate',
    codeBlockMargin: 14,
    webviewComposerGlow: 'clean-border',
    composerHaloIntensity: 0,
    messageGap: 12
  },
  'iron-man-hud': {
    iconStyle: 'duotone-filled',
    iconPack: 'cyber-hud',
    iconStrokeWeight: 'bold',
    iconGlowEffect: true,
    settingsLayout: 'vertical-sidebar',
    glassmorphism: 'ultra-glass',
    motionSpeed: 'snappy',
    omniboxMode: 'live',
    defaultSearchEngine: 'perplexity',
    tabGlowStyle: 'badge-neon',
    webviewFocusPolicy: 'auto-hover',
    fontVibe: 'tech',
    cornerRadius: 4,
    accentColor: '#00e5ff',
    accentGlowColor: '#00bfff',
    surfaceBgColor: '#050f14',
    webviewAmbientAura: true,
    ambientAuraMode: 'viewport-frame',
    ambientAuraIntensity: 65,
    ambientAuraColor: '#00e5ff',
    webviewBubbleStyle: 'glass-slate',
    bubbleGradientDepth: 35,
    webviewCodeBlockStyle: 'matrix-terminal',
    codeBlockMargin: 16,
    webviewComposerGlow: 'electric-neon',
    composerHaloIntensity: 75,
    messageGap: 16
  }
}

const STORAGE_KEY = 'nexus.interfaceSettings'
const LEGACY_STORAGE_KEY = 'vicinae.interfaceSettings'

export function loadInterfaceSettings(): InterfaceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return DEFAULT_INTERFACE_SETTINGS
    const parsed = JSON.parse(raw) as Partial<InterfaceSettings>
    return { ...DEFAULT_INTERFACE_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_INTERFACE_SETTINGS
  }
}

export function isPresetModified(settings: InterfaceSettings): boolean {
  if (!settings.aestheticPreset || settings.aestheticPreset === 'custom') return false
  const presetConfig = PRESET_CONFIGS[settings.aestheticPreset]
  if (!presetConfig) return false
  for (const [k, v] of Object.entries(presetConfig)) {
    if (v !== undefined && settings[k as keyof InterfaceSettings] !== v) {
      return true
    }
  }
  return false
}

export function saveInterfaceSettings(settings: InterfaceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.warn('Failed to save interface settings:', err)
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('')
  }
  const num = parseInt(clean, 16)
  if (isNaN(num)) return { r: 99, g: 102, b: 241 }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360 / 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100

  if (s === 0) {
    const val = Math.round(l * 255)
    return { r: val, g: val, b: val }
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hue2rgb(p, q, h + 1 / 3)
  const g = hue2rgb(p, q, h)
  const b = hue2rgb(p, q, h - 1 / 3)

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  }
}

/**
 * Adjusts an accent color's vibrancy and contrast based on a percentage (0% to 150%).
 * 0% = Pure Monochrome / Grayscale, 50% = Muted tone, 100% = true base hex, 150% = electric saturated punch.
 */
export function adjustAccentContrast(hex: string, contrastPercent: number = 100): string {
  if (!hex || !hex.startsWith('#')) return hex
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)

  const mult = Math.max(0, contrastPercent) / 100
  let newS = s * mult
  if (contrastPercent > 100) {
    newS = Math.min(100, s + (100 - s) * (mult - 1) * 0.8)
  } else {
    newS = Math.max(0, s * mult)
  }

  let newL = l
  if (contrastPercent > 100) {
    newL = Math.min(75, Math.max(30, l * (1 + (mult - 1) * 0.15)))
  } else {
    newL = Math.max(20, l * (0.8 + 0.2 * mult))
  }

  const resRgb = hslToRgb(h, newS, newL)
  return rgbToHex(resRgb.r, resRgb.g, resRgb.b)
}

/**
 * Computes the full surface theme background palette from a base surface hex and darkness percentage (0% to 100%).
 * 0% = Soft Frosted Porcelain / Light Theme (#f8fafc / #ffffff)
 * 50% = Obsidian Midnight (#0b0c14)
 * 100% = Pure OLED Black (#000000)
 */
export function computeSurfaceColors(baseHex: string = '#0b0c14', darknessPercent: number = 50): {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  text2: string
  isDark: boolean
} {
  const d = Math.max(0, Math.min(100, darknessPercent)) // 0 (Porcelain) to 100 (OLED Black)
  const { r, g, b } = hexToRgb(baseHex)
  const { h, s } = rgbToHsl(r, g, b)

  let bgL: number
  let surfL: number
  let surf2L: number
  let border: string
  let isDark: boolean
  let text: string
  let text2: string

  if (d >= 50) {
    // 50% (Obsidian) -> 100% (OLED Black)
    // factor: 0 (at 50%) -> 1 (at 100%)
    const factor = (d - 50) / 50
    bgL = (1 - factor) * 4.5
    surfL = bgL + (1 - factor) * 3 + 1.2
    surf2L = surfL + (1 - factor) * 4 + 2.5
    const borderAlpha = (0.09 - factor * 0.05).toFixed(2)
    border = `rgba(255, 255, 255, ${borderAlpha})`
    isDark = true
    text = '#f8fafc'
    text2 = '#94a3b8'
  } else if (d >= 25) {
    // 25% (Elevated Slate) -> 50% (Obsidian Midnight)
    // factor: 0 (at 25%) -> 1 (at 50%)
    const factor = (d - 25) / 25
    bgL = 16 - factor * 11.5 // 16% down to 4.5%
    surfL = bgL + 4.5
    surf2L = surfL + 5.5
    const borderAlpha = (0.13 - factor * 0.04).toFixed(2)
    border = `rgba(255, 255, 255, ${borderAlpha})`
    isDark = true
    text = '#f8fafc'
    text2 = '#94a3b8'
  } else {
    // 0% (Soft Frosted Porcelain) -> 25% (Light / Frosted)
    // factor: 0 (at 0%) -> 1 (at 25%)
    const factor = d / 25
    bgL = 98 - factor * 82 // 98% (Porcelain) down to 16%
    if (bgL > 60) {
      // Pure / Soft Frosted Porcelain Light Mode
      surfL = Math.min(100, bgL + 1.8) // #ffffff
      surf2L = Math.max(90, bgL - 3.5) // #f1f5f9
      const borderAlpha = (0.08 + (1 - factor) * 0.04).toFixed(2)
      border = `rgba(0, 0, 0, ${borderAlpha})`
      isDark = false
      text = '#0f172a' // Deep Charcoal
      text2 = '#475569' // Muted Charcoal
    } else {
      surfL = bgL + 3.5
      surf2L = surfL + 4.5
      border = `rgba(255, 255, 255, 0.12)`
      isDark = true
      text = '#f8fafc'
      text2 = '#94a3b8'
    }
  }

  const effectiveSat = isDark ? Math.min(30, s * 0.6) : Math.min(15, s * 0.3)
  const bgRgb = hslToRgb(h, effectiveSat, bgL)
  const surfRgb = hslToRgb(h, effectiveSat, surfL)
  const surf2Rgb = hslToRgb(h, effectiveSat, surf2L)

  return {
    bg: rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b),
    surface: rgbToHex(surfRgb.r, surfRgb.g, surfRgb.b),
    surface2: rgbToHex(surf2Rgb.r, surf2Rgb.g, surf2Rgb.b),
    border,
    text,
    text2,
    isDark
  }
}

export function applyInterfaceCssVariables(settings: InterfaceSettings): void {
  const root = document.documentElement

  // 1. Accent & Glow Colors & Contrast Transformation
  const contrast = settings.accentContrast ?? 100
  const baseAccent = settings.accentColor || '#6366f1'
  const transformedAccent = adjustAccentContrast(baseAccent, contrast)
  root.style.setProperty('--accent', transformedAccent)

  const baseGlow = settings.accentGlowColor || transformedAccent
  const transformedGlow = adjustAccentContrast(baseGlow, contrast)
  root.style.setProperty('--accent-glow', transformedGlow)

  root.style.setProperty('--accent-contrast', `${contrast}%`)
  root.style.setProperty('--accent-glow-opacity', `${Math.min(1, contrast / 100)}`)

  // 2. Surface Darkness & Dynamic Theme Background Palette
  const darkness = settings.surfaceDarkness ?? 50
  const baseSurface = settings.surfaceBgColor || (
    settings.aestheticPreset === 'cyberpunk-neon' ? '#07070b' :
    settings.aestheticPreset === 'minimalist-slate' ? '#0f1115' : '#0b0c14'
  )
  const palette = computeSurfaceColors(baseSurface, darkness)

  root.style.setProperty('--surface-darkness', `${darkness}%`)
  root.style.setProperty('--surface-custom', baseSurface)
  root.style.setProperty('--bg', palette.bg)
  root.style.setProperty('--surface', palette.surface)
  root.style.setProperty('--surface2', palette.surface2)
  root.style.setProperty('--border', palette.border)
  root.style.setProperty('--text', palette.text)
  root.style.setProperty('--text2', palette.text2)

  // 3. Corner Radius
  const rad = settings.cornerRadius ?? 12
  root.style.setProperty('--theme-radius', `${rad}px`)
  root.style.setProperty('--radius', `${rad}px`)

  // 4. Motion Speed
  if (settings.motionSpeed === 'smooth') {
    root.style.setProperty('--motion-duration', '180ms')
    root.style.setProperty('--motion-easing', 'cubic-bezier(0.16, 1, 0.3, 1)')
  } else if (settings.motionSpeed === 'snappy') {
    root.style.setProperty('--motion-duration', '80ms')
    root.style.setProperty('--motion-easing', 'ease-out')
  } else {
    root.style.setProperty('--motion-duration', '0ms')
    root.style.setProperty('--motion-easing', 'linear')
  }

  // 5. Glassmorphism & Blur
  if (settings.glassmorphism === 'ultra-glass') {
    root.style.setProperty('--glass-blur', '24px')
    root.style.setProperty('--glass-bg-opacity', '0.65')
    root.style.setProperty('--card-depth-shadow', '0 20px 50px rgba(0, 0, 0, 0.65)')
  } else if (settings.glassmorphism === 'glassmorphic') {
    root.style.setProperty('--glass-blur', '14px')
    root.style.setProperty('--glass-bg-opacity', '0.82')
    root.style.setProperty('--card-depth-shadow', '0 12px 36px rgba(0, 0, 0, 0.45)')
  } else {
    root.style.setProperty('--glass-blur', '0px')
    root.style.setProperty('--glass-bg-opacity', '1.0')
    root.style.setProperty('--card-depth-shadow', 'none')
  }

  // 6. Preset-specific attribute flags on body
  document.body.dataset.preset = settings.aestheticPreset
  document.body.dataset.iconStyle = settings.iconStyle
  document.body.dataset.iconPack = settings.iconPack || 'lucide-line'
  document.body.dataset.iconStroke = settings.iconStrokeWeight || 'standard'
  document.body.dataset.iconGlow = settings.iconGlowEffect ? 'true' : 'false'
  document.body.dataset.tabGlow = settings.tabGlowStyle
  document.body.dataset.glassmorphism = settings.glassmorphism
  document.body.dataset.motionSpeed = settings.motionSpeed
  document.body.dataset.fontVibe = settings.fontVibe || 'sans'
  document.body.dataset.pinnedPosition = settings.pinnedPosition || 'sidebar'

  // 7. Global Custom CSS Injector
  let globalStyleEl = document.getElementById('nexus-global-custom-css') as HTMLStyleElement | null
  if (settings.globalCustomCss && settings.globalCustomCss.trim()) {
    if (!globalStyleEl) {
      globalStyleEl = document.createElement('style')
      globalStyleEl.id = 'nexus-global-custom-css'
      document.head.appendChild(globalStyleEl)
    }
    globalStyleEl.textContent = settings.globalCustomCss
  } else if (globalStyleEl) {
    globalStyleEl.remove()
  }
}

