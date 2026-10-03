// Deep site-specific webview theming. Each provider maps its own host(s) to a
// CSS builder that themes the site's chrome with the app theme's hex colors.
// Fragile against site DOM changes — repairs are localized to this file.

import type { ProviderOverrides } from '../shared/providerConfig'

export interface ThemeVars {
  bg: string
  surface: string
  surface2: string
  accent: string
  text: string
  text2: string
  border: string
  radius: number
  borderWidth: number
  ambientAura?: boolean
  ambientAuraMode?: 'viewport-frame' | 'chat-center'
  ambientAuraIntensity?: number
  ambientAuraColor?: string
  bubbleStyle?: string
  bubbleGradientDepth?: number
  codeBlockStyle?: string
  codeBlockMargin?: number
  composerGlow?: string
  themeSelectors?: any
  cssFeatures?: any
  composerHaloIntensity?: number
  messageGap?: number
  aiResponseWidthPx?: number | string
  userPromptWidthPx?: number | string
  fontWeight?: number
  fontWeightHeadings?: number
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  letterSpacing?: number
  pageWidthPx?: number
  bubbleMaxWidthPx?: number
  composerWidthPx?: number
  selectionBg?: string
  selectionFg?: string
  scrollbarThumb?: string
  scrollbarTrack?: string
  shadowAlpha?: number
  hoverTintAlpha?: number
  codeBlockBg?: string
  codeBlockRadius?: number
}

export interface ProviderTheme {
  hosts: string[]
  css: (v: ThemeVars) => string
}

// Shared helpers -----------------------------------------------------------

function rgba(hex: string, alpha: number): string {
  const h = (hex || '#6366f1').replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  )
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = (hex || '#000000').replace('#', '').trim()
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('')
  const n = parseInt(clean || '0', 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = (((h % 360) + 360) % 360) / 360
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
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
}

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
    const factor = (d - 25) / 25
    bgL = 16 - factor * 11.5
    surfL = bgL + 4.5
    surf2L = surfL + 5.5
    const borderAlpha = (0.13 - factor * 0.04).toFixed(2)
    border = `rgba(255, 255, 255, ${borderAlpha})`
    isDark = true
    text = '#f8fafc'
    text2 = '#94a3b8'
  } else {
    // 0% (Soft Frosted Porcelain) -> 25% (Light / Frosted)
    const factor = d / 25
    bgL = 98 - factor * 82
    if (bgL > 60) {
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

function typography(v: ThemeVars): string {
  const parts: string[] = []
  if (v.fontWeight != null) parts.push(`font-weight: ${v.fontWeight} !important;`)
  if (v.fontSize != null) parts.push(`font-size: ${v.fontSize}px !important;`)
  if (v.fontFamily) parts.push(`font-family: ${v.fontFamily} !important;`)
  if (v.lineHeight != null) parts.push(`line-height: ${v.lineHeight} !important;`)
  if (v.letterSpacing != null) parts.push(`letter-spacing: ${v.letterSpacing}px !important;`)
  return parts.length ? `body { ${parts.join(' ')} }\n` : ''
}


export function getStructuralVars(v: ThemeVars): string {
  const depthAlpha = Math.max(0.1, Math.min(0.85, (v.bubbleGradientDepth ?? 30) / 100))
  const haloAlpha = Math.max(0.15, Math.min(0.9, (v.composerHaloIntensity ?? 50) / 100))
  const blurPx = Math.round(10 + haloAlpha * 14)

  const bubbleBg = v.bubbleStyle === 'gradient-pill' ? `linear-gradient(135deg, ${rgba(v.accent, depthAlpha)} 0%, ${v.surface2} 100%)` : v.bubbleStyle === 'minimal-outline' ? 'transparent' : v.surface2
  const bubbleBgColor = v.bubbleStyle === 'minimal-outline' ? 'transparent' : v.surface2
  const bubbleBorder = v.bubbleStyle === 'minimal-outline' ? `1px solid ${v.accent}` : `1px solid ${rgba(v.accent, Math.min(1, depthAlpha + 0.2))}`
  const bubbleShadow = v.bubbleStyle === 'gradient-pill' ? `0 4px 16px ${rgba(v.accent, depthAlpha * 0.75)}` : `0 2px 8px ${rgba(v.bg, 0.4)}`
  const userWidth = v.userPromptWidthPx ? (typeof v.userPromptWidthPx === 'number' ? `${v.userPromptWidthPx}px` : v.userPromptWidthPx) : (v.bubbleMaxWidthPx ? `${v.bubbleMaxWidthPx}px` : 'min(75vw, 720px)')
  const aiWidth = v.aiResponseWidthPx ? (typeof v.aiResponseWidthPx === 'number' ? `${v.aiResponseWidthPx}px` : v.aiResponseWidthPx) : '900px'
  const messageGap = `${v.messageGap ?? 16}px`

  const codeBg = v.codeBlockStyle === 'matrix-terminal' ? '#06080e' : v.codeBlockStyle === 'soft-slate' ? v.surface : '#07070b'
  const codeBorder = v.codeBlockStyle === 'matrix-terminal' ? `1px solid ${rgba(v.accent, 0.5)}` : `1px solid ${v.border}`
  const codeShadow = v.codeBlockStyle === 'matrix-terminal' ? `0 4px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.03)` : v.codeBlockStyle === 'soft-slate' ? 'none' : `0 4px 16px rgba(0,0,0,0.5)`
  const codeMargin = `${v.codeBlockMargin ?? 18}px 0`

  const compBorder = v.composerGlow === 'electric-neon' ? `1px solid ${rgba(v.accent, haloAlpha)}` : v.composerGlow === 'underglow-pill' ? `1px solid ${v.border}` : `1px solid ${v.border}`
  const compShadow = v.composerGlow === 'electric-neon' ? `0 0 ${blurPx}px ${rgba(v.accent, haloAlpha * 0.75)}` : v.composerGlow === 'underglow-pill' ? `0 8px ${blurPx}px ${rgba(v.accent, haloAlpha * 0.7)}` : 'none'
  const compBorderBottom = v.composerGlow === 'underglow-pill' ? `2px solid ${v.accent}` : compBorder

  return `
    :root {
      --nexus-bubble-bg: ${bubbleBg};
      --nexus-bubble-bg-color: ${bubbleBgColor};
      --nexus-bubble-border: ${bubbleBorder};
      --nexus-bubble-shadow: ${bubbleShadow};
      --nexus-user-width: ${userWidth};
      --nexus-ai-width: ${aiWidth};
      --nexus-message-gap: ${messageGap};
      
      --nexus-code-bg: ${codeBg};
      --nexus-code-border: ${codeBorder};
      --nexus-code-shadow: ${codeShadow};
      --nexus-code-margin: ${codeMargin};
      
      --nexus-composer-focus-border: ${compBorder};
      --nexus-composer-focus-border-bottom: ${compBorderBottom};
      --nexus-composer-focus-shadow: ${compShadow};
    }
  `
}

export function userBubbleRules(v: ThemeVars): string {
  return `
    background: var(--nexus-bubble-bg) !important;
    background-color: var(--nexus-bubble-bg-color) !important;
    background-image: var(--nexus-bubble-bg) !important;
    border: var(--nexus-bubble-border) !important;
    border-radius: ${v.radius}px !important;
    box-shadow: var(--nexus-bubble-shadow) !important;
    color: ${v.text} !important;
    width: max-content !important;
    max-width: var(--nexus-user-width) !important;
    margin-left: auto !important;
    margin-right: 0 !important;
    display: block !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    box-sizing: border-box !important;
    margin-bottom: var(--nexus-message-gap) !important;
  `
}

export function composerRules(v: ThemeVars): string {
  return `
    border: var(--nexus-composer-focus-border) !important;
    border-bottom: var(--nexus-composer-focus-border-bottom) !important;
    box-shadow: var(--nexus-composer-focus-shadow) !important;
    border-radius: ${v.radius}px !important;
  `
}

const base = (v: ThemeVars): string => {
  const auraColor = v.ambientAuraColor || v.accent
  const auraIntensity = v.ambientAuraIntensity ?? 45
  const auraAlpha = Math.max(0.1, Math.min(0.85, auraIntensity / 100))

  return `
  ${getStructuralVars(v)}
  html { background-color: ${v.bg} !important; }
  body { background-color: ${v.bg} !important; }
  ${typography(v)}
  a { color: ${v.accent} !important; }
  ::selection { background: ${v.selectionBg ?? v.accent} !important; color: ${v.selectionFg ?? v.bg} !important; }
  * { scrollbar-color: ${v.scrollbarThumb ?? v.surface2} ${v.scrollbarTrack ?? v.surface} !important; scrollbar-width: thin !important; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-thumb { background: ${v.scrollbarThumb ?? v.surface2} !important; border-radius: 9999px; }
  ::-webkit-scrollbar-thumb:hover { background: ${v.accent} !important; }
  ::-webkit-scrollbar-track { background: transparent !important; }

  /* Ambient Chat Aura */
  ${
    v.ambientAura && v.ambientAuraMode === 'chat-center'
      ? `
    body::after {
      content: '';
      position: fixed;
      top: 35%;
      left: 50%;
      transform: translate(-50%, -35%);
      width: 70vw;
      height: 70vh;
      background: radial-gradient(circle, ${rgba(auraColor, auraAlpha * 0.3)} 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
  `
      : v.ambientAura
        ? `
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      box-shadow: inset 0 0 ${Math.round(auraIntensity * 1.2)}px ${rgba(auraColor, auraAlpha * 0.45)}, inset 0 0 15px ${rgba(auraColor, 0.2)};
      z-index: 999999;
    }
  `
        : ''
  }

  /* Universal Code Block Styling & Margins */
  ${
    v.codeBlockStyle === 'matrix-terminal'
      ? `
    pre:not(code-block *):not([class*="segment-code"] *):not([class*="code-block"] pre):not([class*="codeBlock"] pre),
    [class*="code-block"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="code-block"] [class*="code-block"]),
    [class*="codeBlock"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="codeBlock"] [class*="codeBlock"]) {
      background-color: #050508 !important;
      border: var(--nexus-code-border) !important;
      box-shadow: 0 0 16px ${rgba(v.accent, 0.25)} !important;
      border-radius: ${v.radius}px !important;
      color: ${v.text} !important;
      margin: ${v.codeBlockMargin ?? 18}px 0 !important;
      padding: 14px 18px !important;
    }
  `
      : v.codeBlockStyle === 'soft-slate'
        ? `
    pre:not(code-block *):not([class*="segment-code"] *):not([class*="code-block"] pre):not([class*="codeBlock"] pre),
    [class*="code-block"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="code-block"] [class*="code-block"]),
    [class*="codeBlock"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="codeBlock"] [class*="codeBlock"]) {
      background-color: var(--nexus-code-bg) !important;
      border: 1px solid ${v.border} !important;
      border-radius: ${v.radius}px !important;
      color: ${v.text} !important;
      margin: ${v.codeBlockMargin ?? 18}px 0 !important;
      padding: 14px 18px !important;
    }
  `
        : `
    pre:not(code-block *):not([class*="segment-code"] *):not([class*="code-block"] pre):not([class*="codeBlock"] pre),
    [class*="code-block"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="code-block"] [class*="code-block"]),
    [class*="codeBlock"]:not(code-block):not(code-block *):not([class*="enable-luminous-code-block"]):not([class*="segment-code"] *):not([class*="codeBlock"] [class*="codeBlock"]) {
      background-color: ${v.codeBlockBg ?? '#07070b'} !important;
      border: ${v.borderWidth}px solid ${v.border} !important;
      border-radius: ${v.codeBlockRadius ?? v.radius}px !important;
      box-shadow: 0 4px 16px ${rgba(v.bg, v.shadowAlpha ?? 0.5)} !important;
      color: ${v.text} !important;
      margin: ${v.codeBlockMargin ?? 18}px 0 !important;
      padding: 14px 18px !important;
    }
  `
  }

  /* Universal Code Block & Pre Containment Safety */
  pre, code-block, [class*="code-block"], [class*="codeBlock"] {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  pre {
    overflow-x: auto !important;
    white-space: pre !important;
    word-break: normal !important;
    word-wrap: normal !important;
  }

  pre:not(code-block *):not([class*="segment-code"] *) code,
  pre:not(code-block *):not([class*="segment-code"] *) code[class*="language-"] {
    background-color: transparent !important;
    color: ${v.text} !important;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace !important;
    font-size: 14px !important;
    line-height: 1.6 !important;
  }
  code:not(pre code):not(code-block *):not([class*="segment-code"] *) {
    background-color: ${rgba(v.accent, 0.12)} !important;
    color: ${v.accent} !important;
    border-radius: 4px !important;
    padding: 1px 5px !important;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace !important;
  }
  ${v.fontWeightHeadings != null ? `h1, h2, h3, h4, h5, h6 { font-weight: ${v.fontWeightHeadings} !important; }` : ''}

  /* AI Response & Turn Container Max Width */
  ${
    v.aiResponseWidthPx
      ? `
  .conversation-container, [class*="conversation-turn"], [class*="chat-turn"],
  [class*="font-claude-message"], [class*="threadContentWidth"],
  [class*="ds-message"], [class*="chat-content"], [class*="message-list"],
  [class*="segment-content"], [class*="message-container"] {
    max-width: ${typeof v.aiResponseWidthPx === 'number' ? `${v.aiResponseWidthPx}px` : v.aiResponseWidthPx} !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  `
      : ''
  }
`
}

// Per-provider maps --------------------------------------------------------

export const PROVIDER_THEMES: ProviderTheme[] = [
  {
    // ChatGPT — chatgpt.com & chat.openai.com
    hosts: ['chatgpt.com', 'chat.openai.com'],
    css: (v) => `
      ${base(v)}
      /* backgrounds & typography */
      html, body, #__next, main, [class*="react-scroll-to-bottom"] {
        background-color: ${v.bg} !important;
        color: ${v.text} !important;
      }
      /* sidebar */
      nav, [class*="navigation"], [data-testid="sidebar"], #stage-sidebar {
        background-color: var(--nexus-code-bg) !important;
        border-color: ${v.border} !important;
      }
      nav a, nav button, nav span { color: ${v.text2} !important; }
      nav a:hover, nav button:hover {
        background-color: ${rgba(v.accent, 0.12)} !important;
        color: ${v.text} !important;
      }
      /* user message bubble */
      [data-message-author-role="user"] {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      [data-message-author-role="user"] > div,
      [data-message-author-role="user"] [class*="bg-token-message-surface"],
      [data-message-author-role="user"] [class*="whitespace-pre-wrap"],
      [data-message-author-role="user"] .bg-token-main-surface-secondary,
      article [data-message-author-role="user"] [class*="rounded-3xl"] {
        ${userBubbleRules(v)}
        padding: 10px 16px !important;
      }
      /* assistant message */
      [data-message-author-role="assistant"] {
        background-color: transparent !important;
        color: ${v.text} !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      [data-message-author-role="assistant"] p,
      [data-message-author-role="assistant"] li,
      [data-message-author-role="assistant"] h1,
      [data-message-author-role="assistant"] h2,
      [data-message-author-role="assistant"] h3 {
        color: ${v.text} !important;
      }
      /* composer / prompt input */
      #prompt-textarea,
      div[id="prompt-textarea"],
      form div[class*="composer-parent"],
      form div[class*="relative flex h-full max-w-full flex-1"] {
        background-color: var(--nexus-code-bg) !important;
        color: ${v.text} !important;
        ${composerRules(v)}
      }
      #prompt-textarea:focus,
      form:focus-within {
        border-color: ${v.accent} !important;
        box-shadow: 0 0 16px ${rgba(v.accent, 0.45)} !important;
      }
      button[data-testid="send-button"] {
        background-color: ${v.accent} !important;
        color: ${v.bg} !important;
      }
    `
  },
  {
    // Claude — claude.ai
    hosts: ['claude.ai'],
    css: (v) => `
      ${base(v)}
      html, body, main, div[class*="flex min-h-screen"] {
        background-color: ${v.bg} !important;
        color: ${v.text} !important;
      }
      nav, [class*="sidebar"], [data-testid="sidebar"] {
        background-color: var(--nexus-code-bg) !important;
        border-color: ${v.border} !important;
      }
      /* user message bubble */
      .font-user-message,
      [data-testid="user-message"],
      div[class*="UserMessage"],
      [class*="bg-bg-300"],
      [class*="bg-bg-200"] {
        ${userBubbleRules(v)}
        padding: 10px 16px !important;
      }
      /* composer */
      .ProseMirror,
      div[contenteditable="true"],
      fieldset[class*="border"] {
        background-color: var(--nexus-code-bg) !important;
        color: ${v.text} !important;
        ${composerRules(v)}
      }
      fieldset:focus-within, .ProseMirror:focus {
        border-color: ${v.accent} !important;
        box-shadow: 0 0 16px ${rgba(v.accent, 0.45)} !important;
      }
      button[aria-label="Send Message"] {
        background-color: ${v.accent} !important;
        color: ${v.bg} !important;
      }
    `
  },
  {
    // Perplexity — perplexity.ai
    hosts: ['perplexity.ai', 'www.perplexity.ai', 'pplx.ai'],
    css: (v) => `
      ${base(v)}
      /* Comprehensive Odin & Tailwind Dark Mode Token Overrides */
      :root, html, html.dark, [data-color-scheme="dark"], body {
        --background: 0 0% 0% !important;
        --foreground: 0 0% 100% !important;
        --card: 0 0% 7% !important;
        --card-foreground: 0 0% 100% !important;
        --popover: 0 0% 7% !important;
        --popover-foreground: 0 0% 100% !important;
        --primary: ${v.accent} !important;
        --primary-foreground: ${v.bg} !important;
        --secondary: ${v.surface} !important;
        --secondary-foreground: ${v.text} !important;
        --muted: ${v.surface2} !important;
        --muted-foreground: ${v.text2} !important;
        --accent: ${v.accent} !important;
        --accent-foreground: ${v.bg} !important;
        --border: ${v.border} !important;
        --input: ${v.border} !important;
        --ring: ${v.accent} !important;
        --text-main: ${v.text} !important;
        --text-off: ${v.text2} !important;
        --text-subtle: ${v.text2} !important;
        --bg-main: ${v.bg} !important;
        --bg-offset: ${v.surface} !important;
        --border-main: ${v.border} !important;
        --color-text-main: ${v.text} !important;
        --color-text-off: ${v.text2} !important;
        --color-text-subtle: ${v.text2} !important;
        --color-bg-main: ${v.bg} !important;
        --color-bg-offset: ${v.surface} !important;
        --color-border-main: ${v.border} !important;
        --bg-base: ${v.bg} !important;
        --bg-raised: ${v.surface} !important;
        --bg-subtle: ${rgba(v.surface2, 0.4)} !important;
        --bg-quiet: ${rgba(v.surface2, 0.25)} !important;
        --surface-base: ${v.bg} !important;
        --surface-raised: ${v.surface} !important;
        --surface-underlay: ${v.bg} !important;
        --surface-inverse: ${v.text} !important;
        --layer-subtle: ${rgba(v.surface2, 0.3)} !important;
        --layer-subtler: ${rgba(v.surface2, 0.2)} !important;
        --fg-primary: ${v.text} !important;
        --fg-secondary: ${v.text2} !important;
        --fg-tertiary: ${v.text2} !important;
        --border-heavy: ${v.border} !important;
        --border-medium: ${v.border} !important;
        --border-soft: ${rgba(v.border, 0.5)} !important;
        --border-subtlest: ${rgba(v.border, 0.3)} !important;
        --accent-bg-strong: ${v.accent} !important;
        --accent-fg-primary: ${v.accent} !important;
        --odin-dark-100: ${v.bg} !important;
        --odin-dark-200: ${v.surface} !important;
        --odin-dark-50: ${v.bg} !important;
        --odin-dark-1000: ${v.text} !important;
        --odin-dark-1000-a-7: ${rgba(v.surface2, 0.3)} !important;
        --odin-dark-1000-a-3½: ${rgba(v.surface2, 0.2)} !important;
        --odin-dark-1000-a-14: ${v.border} !important;
        --odin-dark-1000-a-65: ${v.text2} !important;
        --odin-dark-1000-a-50: ${v.text2} !important;
        background-color: ${v.bg} !important;
        color: ${v.text} !important;
      }
      html, body {
        background-color: ${v.bg} !important;
        color: ${v.text} !important;
      }
      /* Pure dark background across all structural panels */
      .bg-base,
      [class*="bg-base"],
      .\!bg-base\/95,
      .md\:bg-base,
      .scrollable-container,
      main,
      [role="main"],
      div[class*="threadContentWidth"] {
        background-color: ${v.bg} !important;
        background: ${v.bg} !important;
      }
      .bg-raised,
      [class*="bg-raised"] {
        background-color: var(--nexus-code-bg) !important;
      }
      /* Header pure dark / subtle border */
      .h-headerHeight,
      [class*="h-headerHeight"],
      header {
        background-color: ${v.bg} !important;
        border-color: ${v.border} !important;
      }
      /* Sidebar */
      aside,
      [class*="sidebar"],
      [data-testid="sidebar"],
      nav {
        background-color: var(--nexus-code-bg) !important;
        border-color: ${v.border} !important;
      }
      aside a, aside button, [class*="sidebar"] a, [class*="sidebar"] button {
        color: ${v.text2} !important;
      }
      aside a:hover, aside button:hover {
        background-color: ${rgba(v.accent, 0.12)} !important;
        color: ${v.text} !important;
      }
      /* Ensure 100% solid opacity and high contrast across answers, prose, markdown */
      .prose,
      .prose *,
      [class*="prose"],
      [class*="prose"] *,
      [dir="auto"],
      [dir="auto"] *,
      [id*="markdown-content"],
      [id*="markdown-content"] *,
      .markdown,
      [class*="markdown"],
      [class*="text-textMain"],
      [class*="text-foreground"],
      [class*="text-primary"] {
        --tw-prose-body: ${v.text} !important;
        --tw-prose-headings: ${v.text} !important;
        --tw-prose-lead: ${v.text} !important;
        --tw-prose-links: ${v.accent} !important;
        --tw-prose-bold: ${v.text} !important;
        --tw-prose-counters: ${v.text2} !important;
        --tw-prose-bullets: ${v.text2} !important;
        --tw-prose-quotes: ${v.text} !important;
        --tw-prose-code: ${v.text} !important;
        --tw-prose-invert-body: ${v.text} !important;
        --tw-prose-invert-headings: ${v.text} !important;
        --tw-prose-invert-bold: ${v.text} !important;
        --tw-text-opacity: 1 !important;
        opacity: 1 !important;
        color: ${v.text} !important;
      }
      p, span, h1, h2, h3, h4, h5, h6, li, ul, ol, strong {
        opacity: 1 !important;
      }
      .text-secondary,
      [class*="text-secondary"],
      [class*="text-textOff"],
      [class*="text-textSecondary"],
      [class*="text-muted"],
      [class*="text-subtle"] {
        color: ${v.text2} !important;
      }
      /* High-contrast Tables in AI Response */
      table,
      .prose table,
      div:has(> table) {
        background-color: var(--nexus-code-bg) !important;
        border-color: ${v.border} !important;
        color: ${v.text} !important;
        opacity: 1 !important;
      }
      table th,
      table th.bg-subtle,
      table thead th {
        background-color: ${rgba(v.surface2, 0.75)} !important;
        color: ${v.text} !important;
        border-color: ${v.border} !important;
        font-weight: 600 !important;
        opacity: 1 !important;
      }
      table td {
        background-color: transparent !important;
        color: ${v.text} !important;
        border-color: ${v.border} !important;
        opacity: 1 !important;
      }
      /* User query bubble: Translucent Dark Glass Pill */
      .group\/query .bg-subtle,
      [class*="group/query"] [class*="bg-subtle"],
      [data-testid="query-bubble"],
      [data-testid="user-query"],
      [class*="user-query"],
      [class*="query-text"],
      [class*="userQuery"] {
        ${userBubbleRules(v)}
        background: linear-gradient(135deg, ${rgba(v.accent, 0.22)} 0%, ${rgba(v.bg, 0.72)} 100%) !important;
        background-color: ${rgba(v.bg, 0.75)} !important;
        backdrop-filter: blur(16px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
        border: 1px solid ${rgba(v.accent, 0.45)} !important;
        box-shadow: 0 4px 20px ${rgba(v.bg, 0.6)}, 0 0 15px ${rgba(v.accent, 0.2)} !important;
        padding: 10px 18px !important;
        color: ${v.text} !important;
        border-radius: 16px !important;
      }
      .group\/query .bg-subtle *,
      [class*="group/query"] [class*="bg-subtle"] * {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        color: ${v.text} !important;
      }
      /* Perplexity Composer Box (Follow-up input card) */
      [data-ask-input-container="true"],
      [data-ask-input-container="true"] > div,
      [data-ask-input-container="true"] .rounded-2xl {
        background-color: var(--nexus-code-bg) !important;
        border-color: ${v.border} !important;
      }
      [data-ask-input-container="true"] {
        ${composerRules(v)}
      }
      [data-ask-input-container="true"]:focus-within {
        border-color: ${v.accent} !important;
        box-shadow: 0 0 16px ${rgba(v.accent, 0.45)} !important;
      }
      #ask-input,
      [contenteditable="true"]#ask-input,
      textarea, input {
        background-color: transparent !important;
        color: ${v.text} !important;
        caret-color: ${v.accent} !important;
      }
      textarea::placeholder, input::placeholder, [aria-placeholder] {
        color: ${v.text2} !important;
      }
      /* Follow-up suggestion buttons */
      .divide-y.border-t button,
      [class*="divide-y"] button {
        background-color: transparent !important;
        border-color: ${v.border} !important;
        color: ${v.text} !important;
      }
      .divide-y.border-t button:hover,
      [class*="divide-y"] button:hover {
        background-color: ${rgba(v.accent, 0.08)} !important;
      }
      .divide-y.border-t button:hover * {
        color: ${v.accent} !important;
      }
      /* Sources & Citation badges */
      [class*="sources"], [class*="Sources"], [class*="source-card"], [class*="citation"], .citation,
      .citation .bg-quiet,
      [data-pplx-citation] .bg-quiet {
        background-color: ${rgba(v.accent, 0.12)} !important;
        border: 1px solid ${rgba(v.accent, 0.3)} !important;
        color: ${v.accent} !important;
        border-radius: ${v.radius}px !important;
      }
      .citation *,
      [data-pplx-citation] * {
        color: ${v.accent} !important;
      }
    `
  },
  {
    // Kimi — kimi.moonshot.cn & kimi.ai
    hosts: ['kimi.ai', 'www.kimi.ai', 'moonshot.cn', 'kimi.moonshot.cn', 'kimi.com', 'www.kimi.com', 'qmk.top', 'statics.kimi.ai'],
    css: (v) => `
      ${base(v)}
      /* Pure dark background across all Kimi containers and Naive-UI root */
      :root, html, html.dark, body, #app, .app, .app.has-sidebar,
      .n-config-provider, .n-layout, .n-layout-content, .n-layout-scroll-container,
      .n-scrollbar, .n-scrollbar-container, .n-scrollbar-content,
      .chat-detail, .chat-detail-main, .chat-detail-content, .chat-content-list,
      .chat-scroll-container, .scroll-wrapper, .chat-main-wrapper,
      main, [role="main"], [class*="chat-detail"], [class*="chatDetail"],
      [class*="chat-wrapper"], [class*="chatWrapper"], [class*="chat-main"],
      [class*="chat-scroll"], [class*="scroll-wrapper"], [class*="chat-content"],
      [class*="chat-page"], [class*="chat-layout"], [class*="chat-session"],
      [class*="n-layout"], [class*="n-config"], [class*="n-scrollbar"] {
        background-color: ${v.bg} !important;
        background: ${v.bg} !important;
        --n-color: ${v.bg} !important;
        --n-color-modal: ${v.surface} !important;
        --n-color-popover: ${v.surface} !important;
        --n-color-embedded: ${v.bg} !important;
        --n-text-color: ${v.text} !important;
      }
      .chat-detail-main *,
      .chat-detail-content *,
      .chat-content-list *,
      .chat-scroll-container * {
        --n-color: ${v.bg} !important;
        --n-color-embedded: ${v.bg} !important;
      }
      /* centered main chat layout — eliminate right void */
      .chat-detail-main,
      .chat-detail-content,
      .chat-content-list,
      [class*="chat-container"],
      [class*="chat-main"] {
        max-width: ${typeof v.aiResponseWidthPx === 'number' ? `${v.aiResponseWidthPx}px` : v.aiResponseWidthPx || '920px'} !important;
        width: 100% !important;
        margin: 0 auto !important;
        float: none !important;
      }
      /* sidebar + chat list */
      .sidebar, [class*="sidebar"], [class*="chat-sidebar"],
      nav[class*="Sidebar"], [data-testid*="sidebar"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      [class*="chat-list"] [class*="chat-item"], [class*="conversation"] {
        background: transparent !important; border-color: ${v.border} !important;
        color: ${v.text2} !important;
      }
      [class*="chat-item"]:hover, [class*="conversation"]:hover {
        background: ${rgba(v.accent, v.hoverTintAlpha ?? 0.1)} !important;
      }
      [class*="chat-item"][class*="active"], [class*="conversation"][class*="active"] {
        background: ${rgba(v.accent, v.hoverTintAlpha != null ? v.hoverTintAlpha + 0.05 : 0.15)} !important;
        border-color: ${v.accent} !important; color: ${v.text} !important;
      }
      /* header */
      header, [class*="header"], [class*="topbar"], [class*="Topbar"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      /* Kimi User Bubble: Flex Column right alignment with independent shrink-wrap and translucent glass */
      .segment.segment-user,
      [class*="segment-user"],
      [class*="user-segment"] {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        width: 100% !important;
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      .segment.segment-user .segment-content,
      .segment.segment-user [class*="segment-content"],
      [class*="user-segment"] [class*="segment-content"],
      .segment.segment-user .segment-content-wrap {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        width: 100% !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .segment.segment-user .segment-content-box,
      [class*="segment-user"] .segment-content-box {
        ${userBubbleRules(v)}
        background: linear-gradient(135deg, ${rgba(v.accent, 0.22)} 0%, ${rgba(v.bg, 0.72)} 100%) !important;
        background-color: ${rgba(v.bg, 0.75)} !important;
        backdrop-filter: blur(16px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
        border: 1px solid ${rgba(v.accent, 0.45)} !important;
        box-shadow: 0 4px 20px ${rgba(v.bg, 0.6)}, 0 0 15px ${rgba(v.accent, 0.2)} !important;
        padding: 11px 18px !important;
        width: max-content !important;
        max-width: ${typeof v.userPromptWidthPx === 'number' ? `${v.userPromptWidthPx}px` : v.userPromptWidthPx || 'min(75vw, 720px)'} !important;
        min-width: 0 !important;
        word-break: break-word !important;
        overflow-wrap: break-word !important;
        box-sizing: border-box !important;
        margin-left: auto !important;
        margin-right: 0 !important;
      }
      .segment.segment-user .segment-content-box *,
      .segment.segment-user .user-content,
      .segment.segment-user .user-content * {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      .segment-user-action-row,
      .segment-user-actions,
      .okc-cards-container {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-top: 6px !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: flex-end !important;
        align-self: flex-end !important;
        width: fit-content !important;
        gap: 12px !important;
      }
      .segment-user-actions .simple-button {
        display: inline-flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 4px !important;
        background: transparent !important;
        border: none !important;
        color: ${v.text2} !important;
        opacity: 0.7 !important;
      }
      .segment-user-actions .simple-button:hover {
        color: ${v.accent} !important;
        opacity: 1 !important;
      }
      /* Kimi Assistant Messages: Clean Left Alignment */
      .segment.segment-assistant,
      [class*="segment-assistant"],
      .segment-assistant,
      [class*="assistant-segment"] {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: auto !important;
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        color: ${v.text} !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      .segment.segment-assistant .segment-content,
      .segment.segment-assistant [class*="segment-content"],
      .segment.segment-assistant .segment-content-box,
      [class*="segment-assistant"] .segment-content,
      [class*="segment-assistant"] .segment-content-box {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: auto !important;
        padding: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        color: ${v.text} !important;
        text-align: left !important;
      }
      /* Assistant Action Row: Clean Horizontal Toolbar */
      .segment-assistant-actions,
      .segment-assistant-actions-content,
      [class*="segment-assistant-actions"],
      [class*="assistant-actions"] {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 8px !important;
        margin-top: 10px !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        width: 100% !important;
      }
      .assistant-page,
      [class*="assistant-page"] {
        display: inline-flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 4px !important;
        background: transparent !important;
        border: none !important;
      }
      .assistant-page-info {
        font-size: 12px !important;
        color: ${v.text2} !important;
        margin: 0 4px !important;
      }
      .segment-assistant-actions-content .icon-button,
      [class*="segment-assistant-actions"] .icon-button,
      .assistant-page .icon-button {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 28px !important;
        height: 28px !important;
        background: transparent !important;
        border: none !important;
        color: ${v.text2} !important;
        cursor: pointer !important;
        border-radius: ${Math.max(4, v.radius - 4)}px !important;
      }
      .segment-assistant-actions-content .icon-button:hover,
      [class*="segment-assistant-actions"] .icon-button:hover,
      .assistant-page .icon-button:hover {
        color: ${v.accent} !important;
        background: ${rgba(v.accent, 0.12)} !important;
      }
      .assistant-page-item.disabled {
        opacity: 0.35 !important;
        cursor: not-allowed !important;
      }
      /* Kimi HUD Code Blocks: SINGLE cohesive container with clean top header bar */
      .segment-code,
      div[class*="segment-code"] {
        background-color: ${v.codeBlockStyle === 'matrix-terminal' ? '#050508' : v.codeBlockStyle === 'soft-slate' ? v.surface : (v.codeBlockBg ?? '#0f111a')} !important;
        border: ${v.borderWidth}px solid ${v.codeBlockStyle === 'matrix-terminal' ? rgba(v.accent, 0.6) : v.border} !important;
        border-radius: ${v.radius}px !important;
        box-shadow: ${v.codeBlockStyle === 'matrix-terminal' ? `0 0 16px ${rgba(v.accent, 0.25)}` : `0 4px 16px rgba(0,0,0,0.5)`} !important;
        margin: ${v.codeBlockMargin ?? 18}px 0 !important;
        overflow: hidden !important;
        display: block !important;
      }
      /* Flatten sticky release rail into a normal full-width header strip */
      .segment-code .sticky-release,
      .segment-code .sticky-release-rail,
      .segment-code .sticky-release-header {
        position: static !important;
        height: auto !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        transform: none !important;
      }
      .segment-code header,
      .segment-code .segment-code-header,
      .segment-code-header {
        background-color: ${rgba(v.surface, 0.75)} !important;
        border-bottom: 1px solid ${v.border} !important;
        border-top: none !important;
        border-left: none !important;
        border-right: none !important;
        box-shadow: none !important;
        padding: 8px 14px !important;
        margin: 0 !important;
        width: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        box-sizing: border-box !important;
      }
      .segment-code-header-content,
      .segment-code [class*="header-content"] {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        width: 100% !important;
      }
      .segment-code-lang,
      [class*="segment-code-lang"] {
        font-weight: 600 !important;
        font-size: 12px !important;
        color: ${v.accent} !important;
        text-transform: uppercase !important;
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        letter-spacing: 0.5px !important;
      }
      .segment-code .icon-button {
        background: transparent !important;
        border: none !important;
        color: ${v.text2} !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .segment-code .icon-button:hover {
        color: ${v.accent} !important;
      }
      .segment-code .syntax-highlighter,
      .segment-code [class*="segment-code-content"],
      .segment-code pre,
      .segment-code code {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
      }
      .segment-code pre {
        padding: 14px 18px !important;
      }
      .segment-code pre code {
        color: ${v.text} !important;
        font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace !important;
        font-size: 15px !important;
        line-height: 1.7 !important;
      }
      /* Kimi footer & outer input container reset */
      footer,
      [class*="footer"],
      .chat-action,
      .chat-editor,
      .chat-bottom,
      .bottom-action-container,
      .chat-notifications,
      .chat-detail-footer,
      .chat-footer,
      .chat-input-wrapper,
      .chat-input-container,
      .input-wrapper,
      .input-wrap,
      [class*="chat-input-wrapper"],
      [class*="chat-input-container"],
      [class*="chat-footer"],
      [class*="detail-footer"],
      [class*="bottom-mask"],
      [class*="bottom-bar"] {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      /* Remove any pseudo-element masks or dividers */
      .chat-action::before,
      .chat-action::after,
      .chat-editor::before,
      .chat-editor::after,
      .chat-editor-content::before,
      .chat-editor-content::after,
      .bottom-action-container::before,
      .bottom-action-container::after,
      .chat-bottom::before,
      .chat-bottom::after,
      .chat-detail-footer::before,
      .chat-detail-footer::after,
      .chat-input-wrapper::before,
      .chat-input-wrapper::after,
      .chat-input-container::before,
      .chat-input-container::after,
      [class*="chat-action"]::before,
      [class*="chat-action"]::after,
      [class*="bottom-mask"]::before,
      [class*="bottom-mask"]::after {
        content: none !important;
        display: none !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      /* Floating to-bottom button */
      .to-bottom,
      .to-bottom-show {
        background-color: var(--nexus-code-bg) !important;
        border: 1px solid ${v.border} !important;
        color: ${v.text} !important;
        border-radius: 999px !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6) !important;
      }
      /* ONLY the exact composer card (.chat-editor-content) gets translucent glass & halo */
      .chat-editor-content,
      .chat-editor .chat-editor-content {
        background: linear-gradient(135deg, ${rgba(v.surface, 0.85)} 0%, ${rgba(v.bg, 0.75)} 100%) !important;
        background-color: ${rgba(v.surface, 0.8)} !important;
        backdrop-filter: blur(16px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
        padding: 8px 12px !important;
        ${composerRules(v)}
      }
      .chat-editor:focus-within .chat-editor-content,
      .chat-editor-content:focus-within {
        border-color: ${v.accent} !important;
        box-shadow: 0 0 16px ${rgba(v.accent, 0.45)} !important;
      }
      /* Strip nested borders & backgrounds inside Kimi composer */
      .chat-editor-content *,
      .chat-input,
      .chat-input *,
      .chat-input-editor-container,
      .chat-input-editor,
      .chat-editor-action,
      .left-area,
      .right-area,
      .editor,
      div[class*="editor"],
      [contenteditable="true"] {
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
        background-color: transparent !important;
        color: ${v.text} !important;
        caret-color: ${v.accent} !important;
      }
      .chat-input-placeholder {
        color: ${v.text2} !important;
        opacity: 0.6 !important;
      }
      .icon-button.toolkit-trigger-btn {
        background: transparent !important;
        border: none !important;
        color: ${v.text2} !important;
      }
      .icon-button.toolkit-trigger-btn:hover {
        color: ${v.accent} !important;
      }
      .current-model,
      .model-name {
        color: ${v.text2} !important;
      }
      .current-model:hover {
        color: ${v.text} !important;
      }
      /* Send button */
      .send-button-container:not(.disabled),
      .send-button-container button:not([disabled]) {
        background-color: ${v.accent} !important;
        color: ${v.bg} !important;
        border-radius: 999px !important;
        cursor: pointer !important;
      }
      .send-button-container:not(.disabled) svg,
      .send-button-container:not(.disabled) path {
        color: ${v.bg} !important;
        fill: ${v.bg} !important;
      }
      .send-button-container.disabled {
        opacity: 0.35 !important;
        background-color: ${rgba(v.text, 0.15)} !important;
        border-radius: 999px !important;
      }
    `
  },
  {
    // Qwen — chat.qwen.ai
    hosts: ['chat.qwen.ai', 'qwen.ai', 'tongyi.aliyun.com'],
    css: (v) => `
      ${base(v)}
      /* Pure dark background across all Qwen outer containers */
      html, body, #root, #app,
      .splitter-container-left-panel,
      .splitter-container,
      .layout-main-chat-panel,
      .panel-group,
      .chat-left-panel,
      .chat-left,
      .chat-messages-container,
      .desktop-layout, .desktop-layout-content, .chat-page-container,
      .layout-main, .chat-panel, .chat-wrapper, .chat-session,
      [class*="splitter"],
      [class*="desktop-layout"], [class*="chat-page"], [class*="layout-main"],
      [class*="session-container"], [class*="body-container"], [class*="content-wrapper"],
      [class*="chat-container"], [class*="chat-panel"], [class*="panel-group"], [class*="chat-left"] {
        background-color: ${v.bg} !important;
        background: ${v.bg} !important;
        color: ${v.text} !important;
      }
      aside, [class*="sidebar"], nav[class*="nav"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      [class*="conversation"], [class*="chat-item"] {
        background: transparent !important; color: ${v.text2} !important;
        border-color: ${v.border} !important;
      }
      [class*="conversation"]:hover, [class*="chat-item"]:hover {
        background: ${rgba(v.accent, v.hoverTintAlpha ?? 0.1)} !important;
      }
      header, [class*="header"], [class*="topbar"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      .layout-main-chat-panel, .main-content, .chat-layout,
      .chat-content, .chat-messages {
        max-width: ${typeof v.aiResponseWidthPx === 'number' ? `${v.aiResponseWidthPx}px` : v.aiResponseWidthPx || '920px'} !important;
        width: 100% !important;
        margin: 0 auto !important;
        background: transparent !important;
      }
      /* user bubble */
      .chat-user-message-container-wrapper {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        width: 100% !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      .chat-user-message-container {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        width: max-content !important;
        max-width: 100% !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-left: auto !important;
        margin-right: 0 !important;
      }
      .chat-user-message-wrapper {
        display: flex !important;
        justify-content: flex-end !important;
        width: max-content !important;
        max-width: 100% !important;
        background: transparent !important;
        border: none !important;
      }
      .chat-user-message {
        ${userBubbleRules(v)}
        padding: 10px 16px !important;
        width: max-content !important;
        max-width: ${typeof v.userPromptWidthPx === 'number' ? `${v.userPromptWidthPx}px` : v.userPromptWidthPx || 'min(75vw, 720px)'} !important;
        min-width: 0 !important;
        word-break: break-word !important;
        overflow-wrap: break-word !important;
        box-sizing: border-box !important;
        margin-left: auto !important;
        margin-right: 0 !important;
      }
      .chat-user-message * {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      .message-hoc-container,
      .user-message-footer,
      .qwen-chat-package-comp-new-action-control {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        margin-top: 4px !important;
        display: flex !important;
        justify-content: flex-end !important;
        align-self: flex-end !important;
        width: fit-content !important;
      }
      .user-message-footer button {
        background: transparent !important;
        border: none !important;
        color: ${v.text2} !important;
        opacity: 0.7 !important;
      }
      .user-message-footer button:hover {
        color: ${v.accent} !important;
        opacity: 1 !important;
      }
      .qwen-markdown-code-body, .monaco-editor, .monaco-editor-background,
      .monaco-editor .margin, .monaco-editor .lines-content, [class*="monaco-editor"] {
        background-color: ${v.codeBlockStyle === 'matrix-terminal' ? '#050508' : (v.codeBlockBg ?? '#0f111a')} !important;
        color: ${v.text} !important;
        border-radius: ${v.radius}px !important;
      }
      .message-input-wrapper, .message-input-container {
        background-color: var(--nexus-code-bg) !important;
        ${composerRules(v)}
      }
      .message-input-wrapper:focus-within,
      .message-input-container:focus-within {
        border-color: ${v.accent} !important;
        box-shadow: 0 0 16px ${rgba(v.accent, 0.45)} !important;
      }
      textarea, [contenteditable="true"] {
        background-color: transparent !important; color: ${v.text} !important;
        border-color: ${v.border} !important; caret-color: ${v.accent} !important;
      }
      [class*="send"], button[type="submit"] {
        background-color: ${v.accent} !important; color: ${v.bg} !important;
      }
    `
  },
  {
    // Gemini — gemini.google.com
    hosts: ['gemini.google.com'],
    css: (v) => `
      ${base(v)}
      mat-sidenav, mat-sidenav-container, .mat-sidenav, .mat-drawer {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      .mat-toolbar, mat-toolbar, [class*="header"], [class*="topbar"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      .mat-mdc-list-item, [class*="conversation"], [class*="history"] {
        color: ${v.text2} !important;
      }
      .mat-mdc-list-item:hover { background: ${rgba(v.accent, v.hoverTintAlpha ?? 0.1)} !important; }
      .mat-mdc-list-item.mdc-list-item--activated {
        background: ${rgba(v.accent, v.hoverTintAlpha != null ? v.hoverTintAlpha + 0.05 : 0.15)} !important; color: ${v.text} !important;
      }
      .ql-editor, [contenteditable="true"] {
        background-color: var(--nexus-code-bg) !important; color: ${v.text} !important;
        caret-color: ${v.accent} !important;
      }
      /* Gemini user bubble — prevent full-width stretch */
      [class*="user-query-bubble"], [class*="query-bubble"] {
        ${userBubbleRules(v)}
        padding: 10px 16px !important;
      }
      .single-draft-response-container, .presented-response-container,
      [class*="draft-response-container"] {
        background-color: transparent !important;
        border: none !important;
        box-shadow: none !important;
        color: ${v.text} !important;
        padding: 0 !important;
        margin-bottom: ${v.messageGap ?? 16}px !important;
      }
      /* Gemini Code Block: The SINGLE cohesive outer container */
      code-block,
      code-block.enable-luminous-code-block,
      [class*="enable-luminous-code-block"],
      code-block .code-block,
      code-block .animated-opacity,
      .enable-luminous-code-block {
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
        background: transparent !important;
        background-color: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      code-block {
        margin: ${v.codeBlockMargin ?? 18}px 0 !important;
        display: block !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      code-block .formatted-code-block-internal-container {
        background-color: ${v.codeBlockStyle === 'matrix-terminal' ? '#050508' : v.codeBlockStyle === 'soft-slate' ? v.surface : (v.codeBlockBg ?? '#0f111a')} !important;
        border: ${v.borderWidth}px solid ${v.codeBlockStyle === 'matrix-terminal' ? rgba(v.accent, 0.6) : v.border} !important;
        border-radius: ${v.radius}px !important;
        box-shadow: ${v.codeBlockStyle === 'matrix-terminal' ? `0 0 16px ${rgba(v.accent, 0.25)}` : `0 4px 16px rgba(0,0,0,0.5)`} !important;
        overflow: hidden !important;
        display: block !important;
        margin: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      /* Clean integrated header (Bash + copy/download buttons) */
      code-block .code-block-decoration.header-formatted,
      code-block [class*="header-formatted"],
      code-block .code-block-decoration {
        background-color: ${rgba(v.surface, 0.7)} !important;
        border-bottom: 1px solid ${v.border} !important;
        border-top: none !important;
        border-left: none !important;
        border-right: none !important;
        box-shadow: none !important;
        padding: 10px 18px !important;
        margin: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      code-block .code-block-decoration span,
      code-block [class*="header-formatted"] span,
      code-block .code-block-decoration {
        font-weight: 700 !important;
        font-size: 15.5px !important;
        letter-spacing: 0.35px !important;
        color: ${v.accent} !important;
        text-transform: capitalize !important;
      }
      /* Strip all borders/shadows/backgrounds from pre and code inside Gemini */
      code-block pre,
      code-block code,
      code-block [class*="code-container"] {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      code-block pre {
        margin: 0 !important;
        padding: 16px 20px !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        overflow-x: auto !important;
        white-space: pre !important;
        word-break: normal !important;
        word-wrap: normal !important;
      }
      code-block pre code,
      code-block code {
        max-width: 100% !important;
        white-space: pre !important;
        word-break: normal !important;
        word-wrap: normal !important;
      }
      /* Gemini Code Block Font Size: Prominent 18px across all tokens and pre descendants */
      :root, html, body {
        --bard-code-block-font-size: 18px !important;
        --gem-code-block-font-size: 18px !important;
        --bard-monospace-font-size: 18px !important;
        --bard-code-font-size: 18px !important;
        --code-block-font-size: 18px !important;
      }
      code-block pre,
      code-block pre *,
      code-block code,
      code-block code *,
      code-block [data-test-id="code-content"],
      code-block [data-test-id="code-content"] *,
      code-block [class*="code-container"],
      code-block [class*="code-container"] *,
      .formatted-code-block-internal-container pre,
      .formatted-code-block-internal-container pre *,
      .formatted-code-block-internal-container code,
      .formatted-code-block-internal-container code *,
      pre.formatted,
      code.formatted,
      .code-container.formatted {
        font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', ui-monospace, monospace !important;
        font-size: 18px !important;
        line-height: 1.8 !important;
        font-weight: 500 !important;
        letter-spacing: 0.3px !important;
        color: ${v.text} !important;
      }
      ${
        v.pageWidthPx
          ? `
      .conversation-container { max-width: ${v.pageWidthPx}px !important; margin-left: auto !important; margin-right: auto !important; }
      `
          : ''
      }
      .conversation-container, main, .main-content, .chat-history, .chat-history-scroll-container, [class*="chat-history"] {
        max-width: 100% !important;
        overflow-x: hidden !important;
        box-sizing: border-box !important;
      }
      BARD-SIDENAV, [class*="sidenav"], [class*="side-nav"] {
        background-color: var(--nexus-code-bg) !important;
      }
      .text-input-field {
        background-color: var(--nexus-code-bg) !important;
        ${composerRules(v)}
      }
      ${v.composerWidthPx ? `.text-input-field { max-width: ${v.composerWidthPx}px !important; }` : ''}
      .leading-actions-wrapper {
        border: none !important;
        background-color: transparent !important;
      }
    `
  },
  {
    // DeepSeek — chat.deepseek.com
    hosts: ['chat.deepseek.com'],
    css: (v) => `
      ${base(v)}
      aside, [class*="sidebar"], nav {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      [class*="conversation"], [class*="chat-item"] {
        background: transparent !important; color: ${v.text2} !important;
      }
      [class*="conversation"]:hover, [class*="chat-item"]:hover {
        background: ${rgba(v.accent, v.hoverTintAlpha ?? 0.1)} !important;
      }
      header, [class*="header"] {
        background-color: var(--nexus-code-bg) !important; border-color: ${v.border} !important;
      }
      [class*="message"] { color: ${v.text} !important; }
      /* user message bubble */
      div[class*="user-message"], [class*="chat-message-user"], [class*="userBubble"] {
        ${userBubbleRules(v)}
        padding: 10px 16px !important;
      }
      ${
        v.pageWidthPx
          ? `
      [class*="main"], [class*="content"] { max-width: ${v.pageWidthPx}px !important; }
      `
          : ''
      }
      [class*="composer"], [class*="chat-input"], [class*="input-area"] {
        background-color: var(--nexus-code-bg) !important;
        ${composerRules(v)}
      }
      ${v.composerWidthPx ? `[class*="composer"], [class*="chat-input"], [class*="input-area"] { max-width: ${v.composerWidthPx}px !important; }` : ''}
      textarea, [contenteditable="true"] {
        background-color: var(--nexus-code-bg) !important; color: ${v.text} !important;
        border-color: ${v.border} !important; caret-color: ${v.accent} !important;
      }
      [class*="send"] {
        background-color: ${v.accent} !important; color: ${v.bg} !important;
      }
    `
  }
]

export function mergeOverrides(v: ThemeVars, o?: ProviderOverrides): ThemeVars {
  if (!o) return v
  const out: ThemeVars = { ...v }
  if (o.colors) Object.assign(out, o.colors)
  if (o.accentColor) out.accent = o.accentColor
  if (o.accentContrast != null || o.accentColor != null) {
    const baseAccent = o.accentColor || out.accent || '#6366f1'
    const contrast = o.accentContrast ?? 100
    out.accent = adjustAccentContrast(baseAccent, contrast)
  }
  if (o.surfaceDarkness != null || o.surfaceBgColor != null) {
    const base = o.surfaceBgColor || out.bg || '#0b0c14'
    const darkness = o.surfaceDarkness ?? 50
    const palette = computeSurfaceColors(base, darkness)
    out.bg = palette.bg
    out.surface = palette.surface
    out.surface2 = palette.surface2
    out.border = palette.border
    out.text = palette.text
    out.text2 = palette.text2
  } else if (o.surfaceBgColor) {
    out.bg = o.surfaceBgColor
  }
  if (o.geometry?.radius != null) out.radius = o.geometry.radius
  if (o.geometry?.borderWidth != null) out.borderWidth = o.geometry.borderWidth
  if (o.ambientAura != null) out.ambientAura = o.ambientAura
  if (o.ambientAuraMode != null) out.ambientAuraMode = o.ambientAuraMode
  if (o.ambientAuraIntensity != null) out.ambientAuraIntensity = o.ambientAuraIntensity
  if (o.ambientAuraColor != null) out.ambientAuraColor = o.ambientAuraColor
  if (o.themeSelectors != null) out.themeSelectors = o.themeSelectors
  if (o.cssFeatures != null) out.cssFeatures = o.cssFeatures
  if (o.bubbleStyle != null) out.bubbleStyle = o.bubbleStyle
  if (o.bubbleGradientDepth != null) out.bubbleGradientDepth = o.bubbleGradientDepth
  if (o.codeBlockStyle != null) out.codeBlockStyle = o.codeBlockStyle
  if (o.codeBlockMargin != null) out.codeBlockMargin = o.codeBlockMargin
  if (o.composerGlow != null) out.composerGlow = o.composerGlow
  if (o.composerHaloIntensity != null) out.composerHaloIntensity = o.composerHaloIntensity
  if (o.messageGap != null) out.messageGap = o.messageGap
  if (o.aiResponseWidthPx != null) out.aiResponseWidthPx = o.aiResponseWidthPx
  if (o.userPromptWidthPx != null) out.userPromptWidthPx = o.userPromptWidthPx
  if (o.typography?.fontWeight != null) out.fontWeight = o.typography.fontWeight
  if (o.typography?.fontWeightHeadings != null)
    out.fontWeightHeadings = o.typography.fontWeightHeadings
  if (o.typography?.fontSize != null) out.fontSize = o.typography.fontSize
  if (o.typography?.fontFamily != null) out.fontFamily = o.typography.fontFamily
  if (o.typography?.lineHeight != null) out.lineHeight = o.typography.lineHeight
  if (o.typography?.letterSpacing != null) out.letterSpacing = o.typography.letterSpacing
  if (o.layout?.pageWidth != null) out.pageWidthPx = o.layout.pageWidth
  if (o.layout?.bubbleMaxWidth != null) out.bubbleMaxWidthPx = o.layout.bubbleMaxWidth
  if (o.layout?.composerWidth != null) out.composerWidthPx = o.layout.composerWidth
  if (o.effects?.selectionBg != null) out.selectionBg = o.effects.selectionBg
  if (o.effects?.selectionFg != null) out.selectionFg = o.effects.selectionFg
  if (o.effects?.scrollbarThumb != null) out.scrollbarThumb = o.effects.scrollbarThumb
  if (o.effects?.scrollbarTrack != null) out.scrollbarTrack = o.effects.scrollbarTrack
  if (o.effects?.shadowAlpha != null) out.shadowAlpha = o.effects.shadowAlpha
  if (o.effects?.hoverTintAlpha != null) out.hoverTintAlpha = o.effects.hoverTintAlpha
  if (o.effects?.codeBlockBg != null) out.codeBlockBg = o.effects.codeBlockBg
  if (o.effects?.codeBlockRadius != null) out.codeBlockRadius = o.effects.codeBlockRadius
  return out
}
