import React, { useState, useEffect } from 'react'
import {
  BrandIcon,
  IconSparkles,
  IconPalette,
  IconMonitor,
  IconLayers,
  IconZap,
  IconSliders,
  IconSearch,
  IconShield,
  IconRotate,
  IconCopy,
  IconCheck,
  IconTerminal,
  IconDownload
} from './BrandIcons'
import {
  type InterfaceSettings,
  type AestheticPreset,
  isPresetModified,
  computeSurfaceColors
} from '../lib/interfaceSettings'
import { IconConfigProvider, type IconPack } from '../lib/iconContext'
import { modelColor, modelLabel } from '../lib/modelVisuals'
import { generateAiThemingPrompt, generateThemeSelectorPrompt } from '../lib/promptGenerator'
import type { ProviderOverrides } from '../../../shared/providerConfig'
import type { ModelDef } from '../App'

interface Props {
  styleSubTab: string
  styleCategoryTab: 'theme' | 'layout' | 'chat' | 'icons' | 'css'
  styleSearchQuery: string
  interfaceSettings: InterfaceSettings
  webviewThemeOn: boolean
  updateInterfaceSetting: (key: keyof InterfaceSettings, val: any) => void
  handleSelectPreset: (presetId: AestheticPreset) => void
  currentProviderOverrides: ProviderOverrides
  updateProviderOverrideField: (field: keyof ProviderOverrides, val: any) => void
  resetAllOverridesForCurrentProvider: () => void
  models: ModelDef[]
  setCopiedCssToast?: (msg: string | null) => void
}

export const StyleStudioCanvas: React.FC<Props> = ({
  styleSubTab,
  styleCategoryTab,
  styleSearchQuery,
  interfaceSettings,
  webviewThemeOn,
  updateInterfaceSetting,
  handleSelectPreset,
  currentProviderOverrides,
  updateProviderOverrideField,
  resetAllOverridesForCurrentProvider,
  models = [],
  setCopiedCssToast
}) => {
  const isGlobal = styleSubTab === 'ALL'
  const prov = currentProviderOverrides || {}

  // Webview CSS & JS Studio States
  const [codeStudioTab, setCodeStudioTab] = useState<'css' | 'js'>('css')
  const [cssViewMode, setCssViewMode] = useState<'custom' | 'full'>('custom')
  const [jsViewMode, setJsViewMode] = useState<'custom' | 'full'>('custom')
  const [fullAppliedCss, setFullAppliedCss] = useState<string>('')
  const [fullAppliedJs, setFullAppliedJs] = useState<string>('')
  const [isLoadingFullCss, setIsLoadingFullCss] = useState(false)
  const [isLoadingFullJs, setIsLoadingFullJs] = useState(false)
  const [copiedFullCss, setCopiedFullCss] = useState(false)
  const [copiedFullJs, setCopiedFullJs] = useState(false)
  const [jsRunOutput, setJsRunOutput] = useState<{ success: boolean; message: string } | null>(null)
  const [isExecutingJs, setIsExecutingJs] = useState(false)

  // Filter matching
  const matchFilter = (cat: 'theme' | 'layout' | 'chat' | 'icons' | 'css', keywords: string[]) => {
    if (styleSearchQuery.trim()) {
      const q = styleSearchQuery.toLowerCase().trim()
      return keywords.some((k) => k.toLowerCase().includes(q))
    }
    return styleCategoryTab === cat
  }

  // Effective Values
  const effAccent = (isGlobal ? interfaceSettings.accentColor : prov.accentColor) || interfaceSettings.accentColor || '#6366f1'
  const effSecondaryGlow = (isGlobal ? interfaceSettings.accentGlowColor : prov.accentGlowColor) || interfaceSettings.accentGlowColor || '#22d3ee'
  const effDarkness = (isGlobal ? interfaceSettings.surfaceDarkness : prov.surfaceDarkness) ?? interfaceSettings.surfaceDarkness ?? 25
  const effContrast = (isGlobal ? interfaceSettings.accentContrast : prov.accentContrast) ?? interfaceSettings.accentContrast ?? 100
  const effSurfaceBg = (isGlobal ? interfaceSettings.surfaceBgColor : prov.surfaceBgColor) || interfaceSettings.surfaceBgColor || '#0b0c14'

  const effRadius = (isGlobal ? interfaceSettings.cornerRadius : prov.geometry?.radius) ?? interfaceSettings.cornerRadius ?? 14
  const effFontVibe = (isGlobal ? interfaceSettings.fontVibe : prov.fontVibe) || interfaceSettings.fontVibe || 'sans'
  const effGlass = (isGlobal ? interfaceSettings.glassmorphism : prov.glassmorphism) || interfaceSettings.glassmorphism || 'glassmorphic'
  const effMotion = (isGlobal ? interfaceSettings.motionSpeed : prov.motionSpeed) || interfaceSettings.motionSpeed || 'smooth'

  const effIconPack = (isGlobal ? interfaceSettings.iconPack : prov.iconPack) || interfaceSettings.iconPack || 'lucide-line'
  const effIconWeight = (isGlobal ? interfaceSettings.iconStrokeWeight : prov.iconStrokeWeight) || interfaceSettings.iconStrokeWeight || 'standard'
  const effIconGlow = (isGlobal ? interfaceSettings.iconGlowEffect : prov.iconGlowEffect) ?? interfaceSettings.iconGlowEffect

  const effTabGlow = (isGlobal ? interfaceSettings.tabGlowStyle : prov.tabGlowStyle) || interfaceSettings.tabGlowStyle || 'pill-glow'

  const effAura = (isGlobal ? interfaceSettings.webviewAmbientAura : prov.ambientAura) ?? interfaceSettings.webviewAmbientAura
  const effAuraMode = (isGlobal ? interfaceSettings.ambientAuraMode : prov.ambientAuraMode) || interfaceSettings.ambientAuraMode || 'viewport-frame'
  const effAuraIntensity = (isGlobal ? interfaceSettings.ambientAuraIntensity : prov.ambientAuraIntensity) ?? interfaceSettings.ambientAuraIntensity ?? 45
  const effAuraColor = (isGlobal ? interfaceSettings.ambientAuraColor : prov.ambientAuraColor) || interfaceSettings.ambientAuraColor || effAccent

  const effAiWidth = (isGlobal ? interfaceSettings.aiResponseWidthPx : prov.aiResponseWidthPx) ?? interfaceSettings.aiResponseWidthPx ?? 860
  const effUserWidth = (isGlobal ? interfaceSettings.userPromptWidthPx : prov.userPromptWidthPx) ?? interfaceSettings.userPromptWidthPx ?? 720
  const effBubble = (isGlobal ? interfaceSettings.webviewBubbleStyle : prov.bubbleStyle) || interfaceSettings.webviewBubbleStyle || 'gradient-pill'
  const effCodeBlock = (isGlobal ? interfaceSettings.webviewCodeBlockStyle : prov.codeBlockStyle) || interfaceSettings.webviewCodeBlockStyle || 'oled-black'
  const effComposerGlow = (isGlobal ? interfaceSettings.webviewComposerGlow : prov.composerGlow) || interfaceSettings.webviewComposerGlow || 'electric-neon'
  const effMessageGap = (isGlobal ? interfaceSettings.messageGap : prov.messageGap) ?? interfaceSettings.messageGap ?? 16
  const effCustomCss = (isGlobal ? interfaceSettings.globalCustomCss : prov.customCss) || ''
  const effCustomJs = (isGlobal ? interfaceSettings.globalCustomJs : prov.features?.customInitScript) || ''
  const effThemeSelectors = (isGlobal ? undefined : prov.themeSelectors) || {}

  // Fetch full applied CSS and JS from main process when on CSS tab or provider switches
  useEffect(() => {
    let active = true
    if (styleCategoryTab === 'css') {
      setIsLoadingFullCss(true)
      // @ts-ignore
      window.electron?.ipcRenderer
        ?.invoke('get_full_provider_css', isGlobal ? 'ALL' : styleSubTab)
        .then((css: string) => {
          if (active && typeof css === 'string') setFullAppliedCss(css)
        })
        .catch(() => {})
        .finally(() => {
          if (active) setIsLoadingFullCss(false)
        })

      setIsLoadingFullJs(true)
      // @ts-ignore
      window.electron?.ipcRenderer
        ?.invoke('get_full_provider_js', isGlobal ? '' : styleSubTab)
        .then((js: string) => {
          if (active && typeof js === 'string') setFullAppliedJs(js)
        })
        .catch(() => {})
        .finally(() => {
          if (active) setIsLoadingFullJs(false)
        })
    }
    return () => {
      active = false
    }
  }, [styleCategoryTab, styleSubTab, isGlobal, prov.customCss, prov.features?.customInitScript])

  // Is field custom overridden?
  const isOverridden = (field: string): boolean => {
    if (isGlobal) return false
    if (field === 'cornerRadius') return prov.geometry?.radius !== undefined
    if (field === 'customInitScript' || field === 'customJs') return Boolean(prov.features?.customInitScript)
    if (field === 'webviewAmbientAura') return prov.ambientAura !== undefined
    if (field === 'ambientAuraMode') return prov.ambientAuraMode !== undefined
    if (field === 'ambientAuraIntensity') return prov.ambientAuraIntensity !== undefined
    if (field === 'ambientAuraColor') return prov.ambientAuraColor !== undefined
    if (field === 'webviewBubbleStyle') return prov.bubbleStyle !== undefined
    if (field === 'bubbleGradientDepth') return prov.bubbleGradientDepth !== undefined
    if (field === 'webviewCodeBlockStyle') return prov.codeBlockStyle !== undefined
    if (field === 'codeBlockMargin') return prov.codeBlockMargin !== undefined
    if (field === 'webviewComposerGlow') return prov.composerGlow !== undefined
    if (field === 'composerHaloIntensity') return prov.composerHaloIntensity !== undefined
    if (field === 'messageGap') return prov.messageGap !== undefined
    if (field.startsWith('themeSelectors.')) return prov.themeSelectors?.[field.split('.')[1]] !== undefined
    return (prov as any)[field] !== undefined
  }

  // Set field value
  const setVal = (field: string, val: any) => {
    if (isGlobal) {
      if (field === 'secondaryGlowColor' || field === 'accentGlowColor') updateInterfaceSetting('accentGlowColor', val)
      else if (field === 'customCss') updateInterfaceSetting('globalCustomCss', val)
      else if (field === 'customInitScript' || field === 'customJs') updateInterfaceSetting('globalCustomJs', val)
      else updateInterfaceSetting(field as keyof InterfaceSettings, val)
    } else {
      if (field === 'cornerRadius') updateProviderOverrideField('geometry', val !== undefined ? { radius: val } : undefined)
      else if (field === 'secondaryGlowColor') updateProviderOverrideField('accentGlowColor', val)
      else if (field === 'webviewAmbientAura') updateProviderOverrideField('ambientAura', val)
      else if (field === 'ambientAuraMode') updateProviderOverrideField('ambientAuraMode', val)
      else if (field === 'ambientAuraIntensity') updateProviderOverrideField('ambientAuraIntensity', val)
      else if (field === 'ambientAuraColor') updateProviderOverrideField('ambientAuraColor', val)
      else if (field === 'webviewBubbleStyle') updateProviderOverrideField('bubbleStyle', val)
      else if (field === 'bubbleGradientDepth') updateProviderOverrideField('bubbleGradientDepth', val)
      else if (field === 'webviewCodeBlockStyle') updateProviderOverrideField('codeBlockStyle', val)
      else if (field === 'codeBlockMargin') updateProviderOverrideField('codeBlockMargin', val)
      else if (field === 'webviewComposerGlow') updateProviderOverrideField('composerGlow', val)
      else if (field === 'composerHaloIntensity') updateProviderOverrideField('composerHaloIntensity', val)
      else if (field === 'messageGap') updateProviderOverrideField('messageGap', val)
      else if (field.startsWith('cssFeatures.')) {
        const key = field.split('.')[1]
        const newVal = val
        const nextFeatures = { ...(prov.cssFeatures || {}), [key]: newVal }
        updateProviderOverrideField('cssFeatures', nextFeatures)
      }
      else if (field.startsWith('themeSelectors.')) {
        const key = field.split('.')[1]
        const newVal = val ? val : undefined
        const nextSelectors = { ...(prov.themeSelectors || {}), [key]: newVal }
        if (newVal === undefined) delete nextSelectors[key]
        updateProviderOverrideField('themeSelectors', Object.keys(nextSelectors).length > 0 ? nextSelectors : undefined)
      }
      else if (field === 'customInitScript' || field === 'customJs') {
        const nextFeatures = {
          ...(prov.features || {}),
          customInitScript: val ? val : undefined
        }
        if (!val) delete nextFeatures.customInitScript
        updateProviderOverrideField('features', Object.keys(nextFeatures).length > 0 ? nextFeatures : undefined)
      }
      else updateProviderOverrideField(field as keyof ProviderOverrides, val)
    }
  }

  // Reset field value to inherit
  const resetVal = (field: string) => {
    setVal(field, undefined)
  }

  // Code Studio Reset & Execution Handlers
  const handleResetCss = () => {
    if (isGlobal) {
      updateInterfaceSetting('globalCustomCss', '')
    } else {
      setVal('customCss', undefined)
    }
    if (setCopiedCssToast) {
      setCopiedCssToast(`✓ Reset ${isGlobal ? 'Global' : modelLabel(styleSubTab)} Custom CSS to default!`)
      setTimeout(() => setCopiedCssToast(null), 3000)
    }
  }

  const handleResetJs = () => {
    if (isGlobal) {
      updateInterfaceSetting('globalCustomJs', '')
    } else {
      setVal('customJs', undefined)
    }
    if (setCopiedCssToast) {
      setCopiedCssToast(`✓ Reset ${isGlobal ? 'Global' : modelLabel(styleSubTab)} Custom JS to default!`)
      setTimeout(() => setCopiedCssToast(null), 3000)
    }
  }

  const handleResetAllCode = () => {
    if (isGlobal) {
      updateInterfaceSetting('globalCustomCss', '')
      updateInterfaceSetting('globalCustomJs', '')
    } else {
      setVal('customCss', undefined)
      setVal('customJs', undefined)
    }
    if (setCopiedCssToast) {
      setCopiedCssToast(`✓ Reset all ${isGlobal ? 'Global' : modelLabel(styleSubTab)} Custom CSS & JS!`)
      setTimeout(() => setCopiedCssToast(null), 3000)
    }
  }

  const handleLoadFullCssIntoEditor = () => {
    if (!fullAppliedCss) return
    setVal('customCss', fullAppliedCss)
    setCssViewMode('custom')
    if (setCopiedCssToast) {
      setCopiedCssToast(`✓ Loaded complete computed CSS into Custom Editor!`)
      setTimeout(() => setCopiedCssToast(null), 3000)
    }
  }

  const handleLoadFullJsIntoEditor = () => {
    if (!fullAppliedJs) return
    setVal('customJs', fullAppliedJs)
    setJsViewMode('custom')
    if (setCopiedCssToast) {
      setCopiedCssToast(`✓ Loaded complete runtime JS into Custom Editor!`)
      setTimeout(() => setCopiedCssToast(null), 3000)
    }
  }

  const handleExecuteLiveJs = async (codeToRun: string) => {
    if (!codeToRun || !codeToRun.trim()) return
    setIsExecutingJs(true)
    setJsRunOutput(null)
    try {
      const targetKey = isGlobal ? '' : styleSubTab
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke('execute_live_provider_js', targetKey, codeToRun)
      if (res && res.success) {
        setJsRunOutput({ success: true, message: res.result || 'Executed successfully' })
      } else {
        setJsRunOutput({ success: false, message: res?.error || 'Execution failed' })
      }
    } catch (err: any) {
      setJsRunOutput({ success: false, message: err?.message || String(err) })
    } finally {
      setIsExecutingJs(false)
      setTimeout(() => {
        setJsRunOutput(null)
      }, 7000)
    }
  }

  // Render Inherited vs Custom Badge with Individual Reset Icon
  const renderBadge = (field: string) => {
    if (isGlobal) return null
    const custom = isOverridden(field)
    return (
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all"
          style={{
            background: custom ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.06)',
            borderColor: custom ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.12)',
            color: custom ? '#818cf8' : 'var(--text2)'
          }}
        >
          {custom ? 'Custom' : 'Inherited'}
        </span>
        {custom && (
          <button
            type="button"
            onClick={() => resetVal(field)}
            className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 transition-colors cursor-pointer"
            title="Reset to inherit from Global ALL"
          >
            ↺
          </button>
        )}
      </div>
    )
  }

  // Render Section-level Reset Button
  const renderSectionReset = (fields: string[]) => {
    if (isGlobal) return null
    const hasAny = fields.some((f) => isOverridden(f))
    if (!hasAny) return null
    return (
      <button
        type="button"
        onClick={() => fields.forEach((f) => resetVal(f))}
        className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border text-rose-300 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 transition-colors cursor-pointer"
      >
        ↺ Reset Section
      </button>
    )
  }

  // Quick Preset Application for Provider
  const applyProviderPreset = (presetId: string) => {
    if (isGlobal) {
      handleSelectPreset(presetId as AestheticPreset)
      return
    }
    if (presetId === 'refined-modern') {
      updateProviderOverrideField('accentColor', '#6366f1')
      updateProviderOverrideField('accentGlowColor', '#22d3ee')
      updateProviderOverrideField('geometry', { radius: 14 })
      updateProviderOverrideField('fontVibe', 'sans')
      updateProviderOverrideField('glassmorphism', 'glassmorphic')
      updateProviderOverrideField('motionSpeed', 'smooth')
    } else if (presetId === 'cyberpunk-neon') {
      updateProviderOverrideField('accentColor', '#22d3ee')
      updateProviderOverrideField('accentGlowColor', '#f43f5e')
      updateProviderOverrideField('geometry', { radius: 4 })
      updateProviderOverrideField('fontVibe', 'tech')
      updateProviderOverrideField('glassmorphism', 'ultra-glass')
      updateProviderOverrideField('motionSpeed', 'snappy')
    } else if (presetId === 'minimalist-slate') {
      updateProviderOverrideField('accentColor', '#94a3b8')
      updateProviderOverrideField('accentGlowColor', '#475569')
      updateProviderOverrideField('geometry', { radius: 0 })
      updateProviderOverrideField('fontVibe', 'mono')
      updateProviderOverrideField('glassmorphism', 'solid-opaque')
      updateProviderOverrideField('motionSpeed', 'reduced')
    } else if (presetId === 'brand-native') {
      updateProviderOverrideField('accentColor', modelColor(styleSubTab))
      updateProviderOverrideField('geometry', { radius: 14 })
      updateProviderOverrideField('fontVibe', 'sans')
      updateProviderOverrideField('glassmorphism', 'glassmorphic')
      updateProviderOverrideField('motionSpeed', 'smooth')
    }
  }

  // Playful Random Palette Generator for instant visual delight
  const handleRandomizePalette = () => {
    const PALETTES = [
      { accent: '#06b6d4', glow: '#f43f5e', bg: '#080b14', darkness: 20, name: 'Cyber Neon' },
      { accent: '#8b5cf6', glow: '#38bdf8', bg: '#0a0b14', darkness: 30, name: 'Tokyo Midnight' },
      { accent: '#10b981', glow: '#34d399', bg: '#060d0a', darkness: 25, name: 'Emerald Matrix' },
      { accent: '#f59e0b', glow: '#ef4444', bg: '#0f0a06', darkness: 20, name: 'Solar Flare' },
      { accent: '#ec4899', glow: '#a855f7', bg: '#0e0714', darkness: 35, name: 'Velvet Synth' },
      { accent: '#3b82f6', glow: '#60a5fa', bg: '#080c16', darkness: 20, name: 'Nordic Frost' },
      { accent: '#14b8a6', glow: '#fbbf24', bg: '#070f0e', darkness: 25, name: 'Arcade Teal' }
    ]
    const chosen = PALETTES[Math.floor(Math.random() * PALETTES.length)]
    if (isGlobal) {
      updateInterfaceSetting('accentColor', chosen.accent)
      updateInterfaceSetting('accentGlowColor', chosen.glow)
      updateInterfaceSetting('surfaceBgColor', chosen.bg)
      updateInterfaceSetting('surfaceDarkness', chosen.darkness)
    } else {
      updateProviderOverrideField('accentColor', chosen.accent)
      updateProviderOverrideField('accentGlowColor', chosen.glow)
      updateProviderOverrideField('surfaceBgColor', chosen.bg)
      updateProviderOverrideField('surfaceDarkness', chosen.darkness)
    }
    setCopiedCssToast?.(`🎲 Applied ${chosen.name} Palette!`)
    setTimeout(() => setCopiedCssToast?.(null), 2500)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4.5 items-start">
      {/* Top Banner when viewing specific AI Provider */}
      {!isGlobal && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl relative overflow-hidden transition-all"
          style={{
            background: 'linear-gradient(145deg, rgba(99, 102, 241, 0.14) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(99, 102, 241, 0.35)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 25px rgba(99, 102, 241, 0.15)'
          }}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border shadow-md" style={{ background: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.15)' }}>
              <BrandIcon id={styleSubTab} size={24} style={{ color: effAccent }} />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base text-white">{modelLabel(styleSubTab)} Studio Overrides</span>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-mono uppercase bg-(--accent)/20 text-(--accent) font-bold border border-(--accent)/30">
                  {Object.keys(prov).length > 0 ? `${Object.keys(prov).length} Custom Overrides` : 'Inheriting Global'}
                </span>
              </div>
              <span className="text-xs text-indigo-200/75 mt-0.5">
                Fine-tune individual colors, curves, glass, icons, tab glow & chat aura for {modelLabel(styleSubTab)}. Unset options inherit from &apos;ALL&apos;.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => {
                const isCurrentlyOn = prov.on === 'on' || (prov.on !== 'off' && webviewThemeOn)
                setVal('on', isCurrentlyOn ? 'off' : 'on')
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 ${
                prov.on === 'off' || (prov.on !== 'on' && !webviewThemeOn)
                  ? 'text-gray-400 bg-gray-500/10 border-gray-500/30 hover:bg-gray-500/20'
                  : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${prov.on === 'off' || (prov.on !== 'on' && !webviewThemeOn) ? 'bg-gray-400' : 'bg-emerald-400 animate-pulse'}`} />
              <span>{prov.on === 'off' || (prov.on !== 'on' && !webviewThemeOn) ? 'Theme Disabled' : 'Theme Enabled'}</span>
            </button>
            {Object.keys(prov).length > 0 && (
              <button
                type="button"
                onClick={resetAllOverridesForCurrentProvider}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold border text-rose-300 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm active:scale-95"
              >
                <span>↺ Reset All</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 1. Curated Aesthetic Presets (Indigo Theme) */}
      {matchFilter('theme', ['preset', 'aesthetic', 'modern', 'cyberpunk', 'slate', 'theme', 'spring', 'curve', '1-click']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(99, 102, 241, 0.09) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(99, 102, 241, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(99, 102, 241, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(99, 102, 241, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shrink-0">
                <IconSparkles size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">
                  {isGlobal ? 'Smart Aesthetic Presets' : `${modelLabel(styleSubTab)} Quick Style Presets`}
                </h3>
                <p className="text-xs text-indigo-200/75 mt-0.5">
                  1-click curated themes auto-adapting colors, curves, glows & motion {isGlobal ? 'globally' : `for ${modelLabel(styleSubTab)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRandomizePalette}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all hover:bg-white/10 border border-indigo-400/40 text-indigo-300 cursor-pointer shadow-sm active:scale-95"
                title="Randomize harmonious palette (Cyberpunk, Tokyo Midnight, Emerald Matrix, Solar Flare...)"
              >
                <span>🎲</span>
                <span>Randomize</span>
              </button>
              {!isGlobal && renderSectionReset(['accentColor', 'secondaryGlowColor', 'fontVibe', 'glassmorphism', 'motionSpeed'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                Aesthetics
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {[
              { id: 'refined-modern', label: 'Refined Modern OS', desc: 'Indigo glass, soft 14px curves & 180ms spring motion' },
              { id: 'cyberpunk-neon', label: 'Cyberpunk Neon', desc: 'Electric Cyan / Magenta, neon glows, sharp 4px angles & snappy 80ms' },
              { id: 'minimalist-slate', label: 'Minimalist Slate', desc: 'Industrial matte slate, clean 0px borders & instant motion' },
              ...(!isGlobal ? [{ id: 'brand-native', label: `${modelLabel(styleSubTab)} Native`, desc: `Official ${modelLabel(styleSubTab)} brand palette with glassmorphism` }] : [])
            ].map((preset) => {
              const isSelected = isGlobal ? interfaceSettings.aestheticPreset === preset.id : false
              const isModified = isGlobal && isSelected && isPresetModified(interfaceSettings)
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyProviderPreset(preset.id)}
                  className="p-3.5 rounded-xl border flex flex-col text-left gap-1.5 transition-all relative overflow-hidden active:scale-98 cursor-pointer"
                  style={{
                    background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'rgba(0,0,0,0.3)',
                    borderColor: isSelected ? (isModified ? '#f59e0b' : 'var(--accent)') : 'rgba(255,255,255,0.08)',
                    boxShadow: isSelected ? (isModified ? '0 0 14px rgba(245, 158, 11, 0.25)' : '0 0 14px rgba(99, 102, 241, 0.25)') : 'none'
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs sm:text-sm text-white">{preset.label}</span>
                    <div className="flex items-center gap-1.5">
                      {isModified && (
                        <span
                          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 shadow-sm"
                          style={{
                            background: 'rgba(245, 158, 11, 0.22)',
                            borderColor: 'rgba(245, 158, 11, 0.6)',
                            color: '#fbbf24'
                          }}
                          title="Options customized from preset defaults"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span>✦ Customized</span>
                        </span>
                      )}
                      {isSelected && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shadow-sm"
                          style={{
                            background: isModified ? '#f59e0b' : 'var(--accent)',
                            boxShadow: isModified ? '0 0 8px #f59e0b' : '0 0 8px var(--accent)'
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <span className="text-xs opacity-75 leading-relaxed" style={{ color: 'var(--text2)' }}>
                    {preset.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. Colors, Luminance & Vibrancy (Cyan / Spectrum Theme) */}
      {matchFilter('theme', ['color', 'accent', 'primary', 'glow', 'secondary', 'neon', 'darkness', 'surface', 'contrast', 'vibrancy', 'spectrum', 'swatch', 'oled', 'chroma']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(34, 211, 238, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(34, 211, 238, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(34, 211, 238, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(34, 211, 238, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shrink-0">
                <IconPalette size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Colors, Luminance & Vibrancy</h3>
                <p className="text-xs text-cyan-200/75 mt-0.5">Dynamic color engine with OLED depth, contrast scaling & spectrum swatches</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['accentColor', 'secondaryGlowColor', 'surfaceDarkness', 'accentContrast', 'surfaceBgColor'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase tracking-wider">
                Color Engine
              </span>
            </div>
          </div>

          {/* Interactive Swatch Beam Specimen */}
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_#22d3ee]" />
                Live Swatch Beam Specimen
              </span>
              <span className="text-[11px] font-mono opacity-70" style={{ color: effAccent }}>
                {effAccent.toUpperCase()}
              </span>
            </div>

            <div className="flex items-center gap-3 p-2 rounded-lg bg-black/50 border border-white/5 overflow-x-auto">
              <div
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium border shadow-sm shrink-0"
                style={{
                  background: `color-mix(in srgb, ${effAccent} 15%, var(--surface))`,
                  borderColor: effAccent,
                  color: effAccent
                }}
              >
                <BrandIcon id={isGlobal ? 'gemini' : styleSubTab} size={12} style={{ color: effAccent }} />
                <span>{isGlobal ? 'Gemini Active' : `${modelLabel(styleSubTab)} Active`}</span>
              </div>

              <div
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-md shrink-0 transition-transform active:scale-95"
                style={{
                  background: effAccent,
                  boxShadow: `0 0 14px color-mix(in srgb, ${effSecondaryGlow} 40%, transparent)`
                }}
              >
                Action Button
              </div>

              <div className="flex items-center gap-1 text-[10px] font-mono opacity-60 ml-auto shrink-0">
                <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: effAccent }} />
                <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: effSecondaryGlow }} />
                <span className="ml-1">Darkness: {effDarkness}%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary Accent Color */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/20 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Primary Accent Color</span>
                {renderBadge('accentColor')}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {!isGlobal && (
                  <button
                    type="button"
                    onClick={() => setVal('accentColor', modelColor(styleSubTab))}
                    className="w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center relative cursor-pointer"
                    style={{
                      background: modelColor(styleSubTab),
                      borderColor: effAccent === modelColor(styleSubTab) ? '#fff' : 'transparent',
                      boxShadow: effAccent === modelColor(styleSubTab) ? `0 0 10px ${modelColor(styleSubTab)}` : 'none'
                    }}
                    title={`${modelLabel(styleSubTab)} Brand Color`}
                  >
                    <BrandIcon id={styleSubTab} size={13} style={{ color: '#fff' }} />
                  </button>
                )}
                {['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setVal('accentColor', c)}
                    className="w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 cursor-pointer"
                    style={{
                      background: c,
                      borderColor: effAccent.toLowerCase() === c.toLowerCase() ? '#ffffff' : 'transparent',
                      boxShadow: effAccent.toLowerCase() === c.toLowerCase() ? `0 0 10px ${c}` : 'none'
                    }}
                  />
                ))}
                {/* Glowing Rainbow Picker */}
                <label
                  className="w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-sm relative overflow-hidden"
                  style={{
                    background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
                    borderColor: 'rgba(255, 255, 255, 0.4)'
                  }}
                  title="Pick custom color"
                >
                  <input
                    type="color"
                    value={effAccent.startsWith('#') && effAccent.length === 7 ? effAccent : '#6366f1'}
                    onChange={(e) => setVal('accentColor', e.target.value)}
                    className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                  />
                </label>
              </div>
            </div>

            {/* Secondary Neon Glow Color & Dual-Tone Laser Strip */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/20 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Secondary Neon Glow Color</span>
                {renderBadge('secondaryGlowColor')}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {['#22d3ee', '#ec4899', '#10b981', '#f59e0b', '#a855f7', '#3b82f6', '#f43f5e'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setVal('secondaryGlowColor', c)}
                    className="w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 cursor-pointer"
                    style={{
                      background: c,
                      borderColor: effSecondaryGlow.toLowerCase() === c.toLowerCase() ? '#ffffff' : 'transparent',
                      boxShadow: effSecondaryGlow.toLowerCase() === c.toLowerCase() ? `0 0 10px ${c}` : 'none'
                    }}
                  />
                ))}
                <label
                  className="w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-sm relative overflow-hidden"
                  style={{
                    background: 'conic-gradient(from 0deg, #22d3ee, #ec4899, #10b981, #f59e0b, #a855f7, #22d3ee)',
                    borderColor: 'rgba(255, 255, 255, 0.4)'
                  }}
                  title="Pick custom glow"
                >
                  <input
                    type="color"
                    value={effSecondaryGlow.startsWith('#') && effSecondaryGlow.length === 7 ? effSecondaryGlow : '#22d3ee'}
                    onChange={(e) => setVal('secondaryGlowColor', e.target.value)}
                    className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                  />
                </label>
              </div>

              {/* Dual-Tone Laser Strip Specimen */}
              <div className="relative h-3 rounded-full overflow-hidden mt-1 border border-white/10" style={{ background: '#05070d' }}>
                <div
                  className="absolute inset-0 transition-all duration-300"
                  style={{
                    background: `linear-gradient(90deg, ${effAccent} 0%, ${effSecondaryGlow} 100%)`,
                    boxShadow: `0 0 12px ${effSecondaryGlow}`
                  }}
                />
                <div className="absolute top-0 bottom-0 w-4 bg-white/60 blur-[2px] animate-[laserScan_2.5s_infinite_linear]" />
              </div>
            </div>
          </div>

          {/* Sliders in Dual Column with Layered 3D Depth Gauge & Chromatic Wave */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Surface Darkness Slider & 3D Layered Gauge */}
            <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Surface Darkness</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold" style={{ color: effAccent }}>{effDarkness}%</span>
                  {renderBadge('surfaceDarkness')}
                </div>
              </div>

              {/* Layered 3D Depth Gauge */}
              {(() => {
                const previewPalette = computeSurfaceColors(effSurfaceBg || '#0b0c14', effDarkness)
                return (
                  <div className="h-10 rounded-lg bg-black/60 border border-white/5 relative flex items-center justify-around px-2 overflow-hidden">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-9 h-4 rounded border transition-all shadow-sm" style={{ background: previewPalette.bg, borderColor: previewPalette.border }} />
                      <span className="text-[9px] font-mono opacity-50">L0 Canvas</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div
                        className="w-9 h-4 rounded border transition-all shadow-sm"
                        style={{
                          background: previewPalette.surface,
                          borderColor: previewPalette.border
                        }}
                      />
                      <span className="text-[9px] font-mono opacity-50">L1 Surface</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div
                        className="w-9 h-4 rounded border transition-all shadow-sm"
                        style={{
                          background: previewPalette.surface2,
                          borderColor: previewPalette.border
                        }}
                      />
                      <span className="text-[9px] font-mono opacity-50">L2 Elevated</span>
                    </div>
                  </div>
                )
              })()}

              <input
                type="range"
                min={0}
                max={100}
                value={effDarkness}
                onChange={(e) => setVal('surfaceDarkness', Number(e.target.value))}
                className="vc-range"
              />
            </div>

            {/* Accent Contrast Slider & Chromatic Vibrancy Wave */}
            <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Accent Contrast & Vibrancy</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold" style={{ color: effAccent }}>{effContrast}%</span>
                  {renderBadge('accentContrast')}
                </div>
              </div>

              {/* Chromatic Vibrancy Wave Gauge */}
              <div className="h-10 rounded-lg bg-black/60 border border-white/5 relative flex items-center px-3 overflow-hidden">
                <svg className="w-full h-7" viewBox="0 0 100 24" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={`chromaWave-${styleSubTab}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={effAccent} stopOpacity="0.4" />
                      <stop offset="50%" stopColor={effSecondaryGlow} stopOpacity={Math.min(1, effContrast / 90)} />
                      <stop offset="100%" stopColor={effAccent} stopOpacity="0.9" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M 0,12 Q 25,${12 - (effContrast / 150) * 10} 50,12 T 100,12`}
                    fill="none"
                    stroke={`url(#chromaWave-${styleSubTab})`}
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <input
                type="range"
                min={0}
                max={150}
                value={effContrast}
                onChange={(e) => setVal('accentContrast', Number(e.target.value))}
                className="vc-range"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Geometry, Curvature & Typography (Emerald Theme) */}
      {matchFilter('layout', ['geometry', 'corner', 'radius', 'curve', 'curvature', 'typography', 'font', 'vibe', 'sans', 'tech', 'mono', 'shape']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(16, 185, 129, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(16, 185, 129, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(16, 185, 129, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                <IconMonitor size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Geometry, Curvature & Typography</h3>
                <p className="text-xs text-emerald-200/75 mt-0.5">Corner radius curvature, text vibes, and edge geometry</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['cornerRadius', 'fontVibe'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                Shapes & Fonts
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {/* Left: Dynamic Curvature Morph & Slider */}
            <div className="flex flex-col gap-3">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]" />
                      Live Curvature Morphing Box
                    </span>
                    <span className="text-[11px] opacity-70 text-(--text2)">Corners morph dynamically in real-time</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-emerald-300 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">
                      {effRadius}px
                    </span>
                    {renderBadge('cornerRadius')}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-black/50 border border-white/5">
                  <div
                    className="w-24 h-12 border-2 border-emerald-400/80 bg-emerald-500/15 flex items-center justify-center transition-all duration-75 relative shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                    style={{ borderRadius: `${effRadius}px` }}
                  >
                    <span className="text-[10px] font-mono font-bold text-emerald-200">{effRadius}px</span>
                    <span className="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_#6ee7b7]" />
                    <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_#6ee7b7]" />
                    <span className="absolute -bottom-1 -left-1 w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_#6ee7b7]" />
                    <span className="absolute -bottom-1 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_#6ee7b7]" />
                  </div>
                  <div className="flex flex-col gap-1.5 flex-1 items-end">
                    <div className="px-2.5 py-1 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm transition-all" style={{ borderRadius: `${effRadius}px` }}>
                      Button
                    </div>
                    <div className="px-2.5 py-0.5 text-[9px] font-mono bg-white/10 text-white border border-white/10 shadow-sm transition-all" style={{ borderRadius: `${effRadius}px` }}>
                      Tab Pill
                    </div>
                  </div>
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={24}
                value={effRadius}
                onChange={(e) => setVal('cornerRadius', Number(e.target.value))}
                className="vc-range"
              />
            </div>

            {/* Right: Typography Vibe & Live Specimen Cards */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Typographic Personality</span>
                {renderBadge('fontVibe')}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'sans', label: 'Clean Sans', font: 'Inter, sans-serif', sample: 'Aa Bb 12' },
                  { id: 'tech', label: 'Cyber Tech', font: 'Rajdhani, sans-serif', sample: 'λ := ∀x' },
                  { id: 'mono', label: 'Monospace', font: 'JetBrains Mono, monospace', sample: 'const 0x' }
                ].map((f) => {
                  const isSel = effFontVibe === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setVal('fontVibe', f.id)}
                      className="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer text-center"
                      style={{
                        background: isSel ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0,0,0,0.3)',
                        borderColor: isSel ? '#10b981' : 'rgba(255,255,255,0.08)',
                        boxShadow: isSel ? '0 0 12px rgba(16, 185, 129, 0.25)' : 'none',
                        fontFamily: f.font
                      }}
                    >
                      <span className="text-sm font-bold text-white">{f.sample}</span>
                      <span className="text-[10px] opacity-70">{f.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Surfaces, Atmosphere & Motion Dynamics (Purple Theme) */}
      {matchFilter('layout', ['surface', 'glass', 'glassmorphism', 'motion', 'speed', 'spring', 'physics', 'backdrop']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(168, 85, 247, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(168, 85, 247, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(168, 85, 247, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(168, 85, 247, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                <IconSparkles size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Surfaces, Atmosphere & Motion Dynamics</h3>
                <p className="text-xs text-purple-200/75 mt-0.5">Glassmorphic backdrop-blur refraction & interactive spring physics speed</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['glassmorphism', 'motionSpeed'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                Glass & Physics
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Optical Glass Finish */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Optical Glass Finish</span>
                {renderBadge('glassmorphism')}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { id: 'glassmorphic', label: 'Glassmorphic', desc: '14px Frosted' },
                  { id: 'ultra-glass', label: 'Ultra Glass', desc: '24px Deep Blur' },
                  { id: 'solid-opaque', label: 'Solid Opaque', desc: '0px Crisp Matte' }
                ].map((g) => {
                  const isSel = effGlass === g.id
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setVal('glassmorphism', g.id)}
                      className="p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 transition-all cursor-pointer"
                      style={{
                        background: isSel ? 'rgba(168, 85, 247, 0.2)' : 'rgba(0,0,0,0.3)',
                        borderColor: isSel ? '#a855f7' : 'rgba(255,255,255,0.08)',
                        boxShadow: isSel ? '0 0 12px rgba(168, 85, 247, 0.25)' : 'none'
                      }}
                    >
                      <span className="text-xs font-bold text-white">{g.label}</span>
                      <span className="text-[10px] opacity-70">{g.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Right: Motion Dynamics & Spring Speed */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Motion Physics & Spring Speed</span>
                {renderBadge('motionSpeed')}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { id: 'smooth', label: 'Smooth', desc: '180ms Spring' },
                  { id: 'snappy', label: 'Snappy', desc: '80ms Fast' },
                  { id: 'reduced', label: 'Reduced', desc: '0ms Instant' }
                ].map((m) => {
                  const isSel = effMotion === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setVal('motionSpeed', m.id)}
                      className="p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 transition-all cursor-pointer"
                      style={{
                        background: isSel ? 'rgba(168, 85, 247, 0.2)' : 'rgba(0,0,0,0.3)',
                        borderColor: isSel ? '#a855f7' : 'rgba(255,255,255,0.08)',
                        boxShadow: isSel ? '0 0 12px rgba(168, 85, 247, 0.25)' : 'none'
                      }}
                    >
                      <span className="text-xs font-bold text-white">{m.label}</span>
                      <span className="text-[10px] opacity-70">{m.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Universal Icon System (UI Glyphs) (Sky Blue Theme) */}
      {matchFilter('icons', ['icon', 'pack', 'glyph', 'stroke', 'caliper', 'halo', 'vector']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(14, 165, 233, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(14, 165, 233, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(14, 165, 233, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(14, 165, 233, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-sky-500/20 text-sky-300 border border-sky-500/40 shrink-0">
                <IconZap size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Universal Icon System (UI Glyphs)</h3>
                <p className="text-xs text-sky-200/75 mt-0.5">5 custom SVG vector icon packs with caliper stroke weights & neon halo auras</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['iconPack', 'iconStrokeWeight', 'iconGlowEffect'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 uppercase tracking-wider">
                Vector Glyphs
              </span>
            </div>
          </div>

          {/* 5 Universal Icon Packs with Multi-Glyph Live SVG Showcases */}
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { id: 'lucide-line', label: 'Lucide Line', desc: 'Clean vector lines' },
              { id: 'cyber-hud', label: 'Cyber HUD', desc: 'Futuristic HUD markers' },
              { id: 'duotone-glow', label: 'Duotone Glow', desc: '2-tone shaded fill' },
              { id: 'solid-silhouette', label: 'Solid Silhouette', desc: 'Solid filled silhouettes' },
              { id: 'retro-monoline', label: 'Retro Monoline', desc: 'Geometric 90s monoline' }
            ].map((pack) => {
              const isSel = effIconPack === pack.id
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setVal('iconPack', pack.id)}
                  className="p-3 rounded-xl border flex flex-col items-center gap-2.5 transition-all cursor-pointer relative"
                  style={{
                    background: isSel ? 'rgba(14, 165, 233, 0.2)' : 'rgba(0,0,0,0.3)',
                    borderColor: isSel ? '#0ea5e9' : 'rgba(255,255,255,0.08)',
                    boxShadow: isSel ? '0 0 14px rgba(14, 165, 233, 0.3)' : 'none'
                  }}
                >
                  <IconConfigProvider iconPack={pack.id as IconPack} strokeWeight={effIconWeight} glowEffect={effIconGlow}>
                    <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-black/40 border border-white/5">
                      <IconSearch size={14} style={{ color: effAccent }} />
                      <IconSparkles size={14} style={{ color: effSecondaryGlow }} />
                      <IconShield size={14} />
                    </div>
                  </IconConfigProvider>
                  <div className="text-center">
                    <span className="font-bold text-xs text-white block">{pack.label}</span>
                    <span className="text-[10px] opacity-70 block">{pack.desc}</span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Stroke Weight */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Stroke Weight</span>
                {renderBadge('iconStrokeWeight')}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'thin', label: 'Thin', val: '1.25px' },
                  { id: 'standard', label: 'Standard', val: '2.0px' },
                  { id: 'bold', label: 'Bold', val: '2.75px' }
                ].map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setVal('iconStrokeWeight', w.id)}
                    className="py-2 px-3 rounded-lg border text-xs font-bold transition-all cursor-pointer"
                    style={{
                      background: effIconWeight === w.id ? 'rgba(14, 165, 233, 0.2)' : 'rgba(0,0,0,0.3)',
                      borderColor: effIconWeight === w.id ? '#0ea5e9' : 'rgba(255,255,255,0.08)',
                      color: effIconWeight === w.id ? '#38bdf8' : 'var(--text)'
                    }}
                  >
                    {w.label} ({w.val})
                  </button>
                ))}
              </div>
            </div>

            {/* Neon Glyph Halo Aura */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-xs text-white">Neon Glyph Halo Aura</span>
                <span className="text-[11px] opacity-70 text-(--text2)">Cast colorful reactive glows around icons</span>
              </div>
              <div className="flex items-center gap-3">
                {renderBadge('iconGlowEffect')}
                <button
                  type="button"
                  onClick={() => setVal('iconGlowEffect', !effIconGlow)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer"
                  style={{
                    background: effIconGlow ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                    borderColor: effIconGlow ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                    color: effIconGlow ? '#fff' : 'var(--text2)'
                  }}
                >
                  {effIconGlow ? 'Enabled ✦' : 'Disabled'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Active Tab Indicator & Illumination (Violet Theme) */}
      {matchFilter('layout', ['tab', 'glow', 'indicator', 'laser', 'badge', 'illumination', 'active', 'pill']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(139, 92, 246, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(139, 92, 246, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(139, 92, 246, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(139, 92, 246, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-violet-500/20 text-violet-300 border border-violet-500/40 shrink-0">
                <IconLayers size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Active Tab Indicator & Illumination</h3>
                <p className="text-xs text-violet-200/75 mt-0.5">Custom active glowing tab indicators and color schemes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['tabGlowStyle', 'tabAccentMode'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase tracking-wider">
                Navigation Glow
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { id: 'pill-glow', label: 'Pill Glow', desc: 'Solid full glow' },
              { id: 'laser-line', label: 'Laser Line', desc: 'Bottom laser underline' },
              { id: 'badge-neon', label: 'Badge Neon', desc: 'Floating badge glow' },
              { id: 'subtle-dot', label: 'Subtle Dot', desc: 'Minimal dot indicator' }
            ].map((t) => {
              const isSel = effTabGlow === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setVal('tabGlowStyle', t.id)}
                  className="p-3 rounded-xl border flex flex-col items-center text-center gap-1.5 transition-all cursor-pointer"
                  style={{
                    background: isSel ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0,0,0,0.3)',
                    borderColor: isSel ? '#8b5cf6' : 'rgba(255,255,255,0.08)',
                    boxShadow: isSel ? '0 0 14px rgba(139, 92, 246, 0.3)' : 'none'
                  }}
                >
                  <div
                    className="px-3 py-1 rounded-full text-xs font-semibold border"
                    style={{
                      background: isSel ? `color-mix(in srgb, ${effAccent} 20%, transparent)` : 'transparent',
                      borderColor: isSel ? effAccent : 'rgba(255,255,255,0.1)',
                      color: isSel ? effAccent : 'var(--text2)'
                    }}
                  >
                    Active Tab
                  </div>
                  <span className="font-bold text-xs text-white">{t.label}</span>
                  <span className="text-[10px] opacity-70">{t.desc}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 7. AI Webview Chat Theming & Layouts (Rose Theme) */}
      {matchFilter('chat', ['chat', 'aura', 'webview', 'bubble', 'code', 'composer', 'margin', 'gap', 'width', 'response']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(244, 63, 94, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(244, 63, 94, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(244, 63, 94, 0.12)'
          }}
        >
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'rgba(244, 63, 94, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0">
                <IconSliders size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">AI Webview Chat Theming & Layouts</h3>
                <p className="text-xs text-rose-200/75 mt-0.5">Atmospheric chat aura, max container calipers, syntax code blocks & bubble styling</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isGlobal && renderSectionReset(['webviewAmbientAura', 'ambientAuraMode', 'ambientAuraIntensity', 'ambientAuraColor', 'aiResponseWidthPx', 'userPromptWidthPx', 'webviewBubbleStyle', 'bubbleGradientDepth', 'webviewCodeBlockStyle', 'codeBlockMargin', 'webviewComposerGlow', 'composerHaloIntensity', 'messageGap'])}
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider">
                Webview Engine
              </span>
            </div>
          </div>

          {/* Ambient Chat Aura Controls */}
          <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-xs text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse shadow-[0_0_8px_#fb7185]" />
                  Ambient Chat Aura
                </span>
                <span className="text-[11px] opacity-70 text-(--text2)">Immersive edge halo refraction</span>
              </div>
              <div className="flex items-center gap-3">
                {renderBadge('webviewAmbientAura')}
                {effAura && (
                  <div
                    className="sleek-reactor-orb border border-white/20 shadow-md cursor-pointer"
                    style={{
                      background: `radial-gradient(circle, ${effAuraColor} 0%, rgba(0,0,0,0.7) 100%)`,
                      boxShadow: `0 0 ${Math.max(6, Math.round(effAuraIntensity / 3))}px ${effAuraColor}`
                    }}
                    title="Ambient Aura Reactor (Click to cycle colors!)"
                    onClick={() => {
                      const colors = ['#6366f1', '#22d3ee', '#f43f5e', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#3b82f6']
                      const nextColor = colors[(colors.indexOf(effAuraColor) + 1) % colors.length]
                      setVal('ambientAuraColor', nextColor)
                    }}
                  >
                    <span className="text-[10px] select-none font-bold text-white drop-shadow">✦</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setVal('webviewAmbientAura', !effAura)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer shadow-sm active:scale-95"
                  style={{
                    background: effAura ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                    borderColor: effAura ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                    color: effAura ? '#fff' : 'var(--text2)'
                  }}
                >
                  {effAura ? 'Aura Active ✦' : 'Disabled'}
                </button>
              </div>
            </div>

            {effAura && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                {/* Aura Mode */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-white">Aura Origin / Mode</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'viewport-frame', label: 'Viewport Frame' },
                      { id: 'chat-center', label: 'Chat Center' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setVal('ambientAuraMode', m.id)}
                        className="py-2 px-3 rounded-lg border text-xs font-semibold transition-all cursor-pointer text-center"
                        style={{
                          background: effAuraMode === m.id ? 'rgba(244, 63, 94, 0.2)' : 'rgba(0,0,0,0.3)',
                          borderColor: effAuraMode === m.id ? '#f43f5e' : 'rgba(255,255,255,0.08)',
                          color: effAuraMode === m.id ? '#fda4af' : 'var(--text)'
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Aura Intensity Slider */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Aura Intensity</span>
                    <span className="text-xs font-mono font-bold text-rose-300">{effAuraIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={effAuraIntensity}
                    onChange={(e) => setVal('ambientAuraIntensity', Number(e.target.value))}
                    className="vc-range"
                  />
                </div>

                {/* Aura Custom Color Picker */}
                <div className="flex flex-col gap-2 p-2 rounded-xl bg-black/20 border border-white/5 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-white">Aura Color</span>
                    {renderBadge('ambientAuraColor')}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!isGlobal && (
                      <button
                        type="button"
                        onClick={() => setVal('ambientAuraColor', modelColor(styleSubTab))}
                        className="w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center relative cursor-pointer"
                        style={{
                          background: modelColor(styleSubTab),
                          borderColor: effAuraColor === modelColor(styleSubTab) ? '#fff' : 'transparent',
                          boxShadow: effAuraColor === modelColor(styleSubTab) ? `0 0 10px ${modelColor(styleSubTab)}` : 'none'
                        }}
                        title={`${modelLabel(styleSubTab)} Brand Color`}
                      >
                        <BrandIcon id={styleSubTab} size={13} style={{ color: '#fff' }} />
                      </button>
                    )}
                    {['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setVal('ambientAuraColor', c)}
                        className="w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 cursor-pointer"
                        style={{
                          background: c,
                          borderColor: effAuraColor.toLowerCase() === c.toLowerCase() ? '#ffffff' : 'transparent',
                          boxShadow: effAuraColor.toLowerCase() === c.toLowerCase() ? `0 0 10px ${c}` : 'none'
                        }}
                      />
                    ))}
                    <div className="w-[1px] h-6 bg-white/10 mx-1" />
                    <button
                      type="button"
                      onClick={() => setVal('ambientAuraColor', effAccent)}
                      className="w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 cursor-pointer flex items-center justify-center"
                      style={{
                        background: effAccent,
                        borderColor: effAuraColor.toLowerCase() === effAccent.toLowerCase() ? '#ffffff' : 'rgba(255, 255, 255, 0.2)',
                        boxShadow: effAuraColor.toLowerCase() === effAccent.toLowerCase() ? `0 0 10px ${effAccent}` : 'none'
                      }}
                      title="Match Primary Accent Color"
                    >
                      <IconSparkles size={13} className="text-white drop-shadow-md mix-blend-difference" />
                    </button>
                    <label
                      className="w-7 h-7 rounded-lg relative overflow-hidden border-2 cursor-pointer hover:scale-110 transition-all flex items-center justify-center group"
                      style={{
                        background: effAuraColor,
                        borderColor: 'rgba(255, 255, 255, 0.4)'
                      }}
                      title="Pick custom aura color"
                    >
                      <IconPalette size={14} className="opacity-0 group-hover:opacity-100 transition-opacity absolute drop-shadow-md text-white mix-blend-difference" />
                      <input
                        type="color"
                        value={effAuraColor.startsWith('#') && effAuraColor.length === 7 ? effAuraColor : '#22d3ee'}
                        onChange={(e) => setVal('ambientAuraColor', e.target.value)}
                        className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Calipers & Widths */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI Response Max Width */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">AI Response Max Width</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-rose-300">{effAiWidth === '100%' ? '100% W' : `${effAiWidth}px`}</span>
                  {renderBadge('aiResponseWidthPx')}
                </div>
              </div>
              <input
                type="range"
                min={600}
                max={1200}
                value={effAiWidth === '100%' ? 1200 : Number(effAiWidth)}
                onChange={(e) => setVal('aiResponseWidthPx', Number(e.target.value))}
                className="vc-range"
              />
            </div>

            {/* User Prompt Max Width */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">User Prompt Max Width</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-rose-300">{effUserWidth === '100%' ? '100% W' : `${effUserWidth}px`}</span>
                  {renderBadge('userPromptWidthPx')}
                </div>
              </div>
              <input
                type="range"
                min={400}
                max={1000}
                value={effUserWidth === '100%' ? 1000 : Number(effUserWidth)}
                onChange={(e) => setVal('userPromptWidthPx', Number(e.target.value))}
                className="vc-range"
              />
            </div>
          </div>

          {/* User Bubble Glass Style & Gradient Depth */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">User Bubble Glass Style</span>
                {renderBadge('webviewBubbleStyle')}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'gradient-pill', label: 'Gradient Pill' },
                  { id: 'glass-slate', label: 'Glass Slate' },
                  { id: 'minimal-outline', label: 'Minimal' }
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setVal('webviewBubbleStyle', b.id)}
                    className="p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center"
                    style={{
                      background: effBubble === b.id ? 'rgba(244, 63, 94, 0.2)' : 'rgba(0,0,0,0.3)',
                      borderColor: effBubble === b.id ? '#f43f5e' : 'rgba(255,255,255,0.08)',
                      color: effBubble === b.id ? '#fda4af' : 'var(--text)'
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Code Block Style */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">AI Code Block Style</span>
                {renderBadge('webviewCodeBlockStyle')}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'oled-contrast', label: 'OLED Contrast' },
                  { id: 'matrix-terminal', label: 'Terminal HUD' },
                  { id: 'soft-slate', label: 'Soft Slate' }
                ].map((c) => {
                  const isSel = effCodeBlock === c.id || (c.id === 'oled-contrast' && (effCodeBlock as string) === 'oled-black')
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setVal('webviewCodeBlockStyle', c.id)}
                      className="p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center"
                      style={{
                        background: isSel ? 'rgba(244, 63, 94, 0.2)' : 'rgba(0,0,0,0.3)',
                        borderColor: isSel ? '#f43f5e' : 'rgba(255,255,255,0.08)',
                        color: isSel ? '#fda4af' : 'var(--text)'
                      }}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Prompt Composer Glow & Margins */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Prompt Composer Glow</span>
                {renderBadge('webviewComposerGlow')}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'electric-neon', label: 'Electric Neon' },
                  { id: 'underglow-pill', label: 'Underglow' },
                  { id: 'clean-border', label: 'Clean Border' }
                ].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setVal('webviewComposerGlow', g.id)}
                    className="p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center"
                    style={{
                      background: effComposerGlow === g.id ? 'rgba(244, 63, 94, 0.2)' : 'rgba(0,0,0,0.3)',
                      borderColor: effComposerGlow === g.id ? '#f43f5e' : 'rgba(255,255,255,0.08)',
                      color: effComposerGlow === g.id ? '#fda4af' : 'var(--text)'
                    }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Gap */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-black/30 border border-white/5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-white">Message Vertical Gap</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-rose-300">{effMessageGap}px</span>
                  {renderBadge('messageGap')}
                </div>
              </div>
              <input
                type="range"
                min={8}
                max={36}
                value={effMessageGap}
                onChange={(e) => setVal('messageGap', Number(e.target.value))}
                className="vc-range"
              />
            </div>
          </div>
        </div>
      )}

      {/* 8. Webview CSS & JavaScript Control Studio (Amber / Indigo Theme) */}
      {matchFilter('css', ['css', 'custom', 'style', 'override', 'code', 'inject', 'js', 'javascript', 'script', 'automation']) && (
        <div
          className="col-span-1 xl:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col gap-4 relative overflow-hidden transition-all shadow-lg"
          style={{
            background: 'linear-gradient(145deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 17, 26, 0.95) 100%)',
            borderColor: 'rgba(245, 158, 11, 0.28)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 25px rgba(245, 158, 11, 0.12)'
          }}
        >
          {/* Main Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'rgba(245, 158, 11, 0.18)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                <IconTerminal size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">
                  {isGlobal ? 'Global Webview Styling & Scripting Studio' : `${modelLabel(styleSubTab)} Webview Styling & Scripting Studio`}
                </h3>
                <p className="text-xs text-amber-200/75 mt-0.5">
                  Real-time control over all CSS stylesheets & JavaScript automations injected into AI webviews
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isGlobal && renderSectionReset(['customCss', 'customInitScript'])}
              <button
                type="button"
                onClick={handleResetAllCode}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-rose-500/30 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Reset both custom CSS and JavaScript to default"
              >
                <IconRotate size={12} />
                <span>Reset All Code</span>
              </button>
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                Webview Engine
              </span>
            </div>
          </div>

          {/* Studio Tab Switcher: CSS vs JS */}
          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-black/50 border border-white/10 w-fit">
            <button
              type="button"
              onClick={() => setCodeStudioTab('css')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                codeStudioTab === 'css'
                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <IconPalette size={14} />
              <span>Cascading Style Sheets (CSS)</span>
              {effCustomCss.trim() && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/25 text-amber-300 border border-amber-500/40">
                  Custom Active
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCodeStudioTab('js')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                codeStudioTab === 'js'
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-sm'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <IconTerminal size={14} />
              <span>JavaScript Automations (JS)</span>
              {effCustomJs.trim() && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/25 text-cyan-300 border border-cyan-500/40">
                  Custom Active
                </span>
              )}
            </button>
          </div>

          {/* ===================== TAB 1: CSS STUDIO ===================== */}
          {codeStudioTab === 'css' && (
            <div className="flex flex-col gap-4">
              {/* CSS Sub-bar: Mode toggles and actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCssViewMode('custom')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      cssViewMode === 'custom'
                        ? 'bg-amber-500/30 text-amber-200 border border-amber-500/50 shadow-sm'
                        : 'text-white/50 hover:text-white border border-transparent'
                    }`}
                  >
                    ✨ Custom CSS Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setCssViewMode('full')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      cssViewMode === 'full'
                        ? 'bg-amber-500/30 text-amber-200 border border-amber-500/50 shadow-sm'
                        : 'text-white/50 hover:text-white border border-transparent'
                    }`}
                  >
                    🔍 Full Applied CSS {fullAppliedCss ? `(${fullAppliedCss.split('\n').length} lines)` : ''}
                  </button>
                </div>

                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  <button
                    type="button"
                    onClick={handleResetCss}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-rose-500/30 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                    title="Reset custom CSS rules to default"
                  >
                    <IconRotate size={12} />
                    <span>Reset CSS</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const activeModel = models.find((m) => m.key === styleSubTab)
                        const targetKey = isGlobal ? 'gemini' : styleSubTab
                        const providerUrl = activeModel?.url || 'https://z.ai'

                        const [fullCss, domResult] = await Promise.all([
                          // @ts-ignore
                          window.electron?.ipcRenderer?.invoke('get_full_provider_css', targetKey, providerUrl).catch(() => ''),
                          // @ts-ignore
                          window.electron?.ipcRenderer?.invoke('extract_provider_live_dom', targetKey, providerUrl).catch(() => ({ success: false }))
                        ])

                        const hasLiveDom = domResult && domResult.success && domResult.html
                        const promptText = generateAiThemingPrompt({
                          providerName: isGlobal ? 'Global AI Workstation Theme' : modelLabel(styleSubTab),
                          providerUrl,
                          interfaceSettings,
                          providerOverrides: isGlobal ? undefined : currentProviderOverrides,
                          computedCss: fullCss || undefined,
                          liveDomHtml: hasLiveDom ? domResult.html : undefined
                        })

                        await navigator.clipboard.writeText(promptText)
                        if (setCopiedCssToast) {
                          if (hasLiveDom) {
                            setCopiedCssToast(`✓ Copied Complete AI Prompt with Live HTML & Computed CSS for ${isGlobal ? 'Global Theme' : modelLabel(styleSubTab)}!`)
                          } else {
                            setCopiedCssToast(`✓ Copied AI Prompt with Computed CSS! (Tip: Open a tab for ${isGlobal ? 'Global Theme' : modelLabel(styleSubTab)} to include live HTML)`)
                          }
                          setTimeout(() => setCopiedCssToast(null), 4000)
                        }
                      } catch (err) {
                        console.error('Failed to copy AI prompt:', err)
                      }
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-indigo-500/40 text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                    title="Generate a comprehensive prompt with live HTML & computed CSS tokens for an AI assistant"
                  >
                    <IconSparkles size={12} />
                    <span>✨ Copy AI Prompt</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const modelKeyToFetch = isGlobal ? 'ALL' : styleSubTab
                        const activeModel = models.find((m) => m.key === styleSubTab)
                        // @ts-ignore
                        const fullCss = await window.electron?.ipcRenderer?.invoke('get_full_provider_css', modelKeyToFetch, activeModel?.url)
                        const text = fullCss || fullAppliedCss || ''
                        if (text) {
                          await navigator.clipboard.writeText(text)
                          setCopiedFullCss(true)
                          setTimeout(() => setCopiedFullCss(false), 2500)
                          if (setCopiedCssToast) {
                            setCopiedCssToast(`✓ Copied full applied CSS to clipboard!`)
                            setTimeout(() => setCopiedCssToast(null), 3000)
                          }
                        }
                      } catch (err) {
                        console.error('Failed to copy full CSS:', err)
                      }
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedFullCss ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    <span>{copiedFullCss ? 'Copied Full CSS!' : 'Copy Full CSS'}</span>
                  </button>
                </div>
              </div>

              {/* View 1: Custom CSS Editor */}
              {cssViewMode === 'custom' && (
                <div className="flex flex-col gap-4">
                  {!isGlobal && (
                    <div className="flex flex-col gap-3 p-4 rounded-2xl border border-emerald-500/20 bg-black/40 relative overflow-hidden shadow-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-white/10">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-white block">CSS Injection Features</span>
                        </div>
                        <span className="text-[9px] uppercase font-bold tracking-wider text-white/40">Fine-grained</span>
                      </div>
                      <p className="text-[10px] text-white/50 mb-1">
                        Toggle which CSS modules Nexus injects into this provider. Disable modules that conflict with the native layout.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { id: 'colors', label: 'Colors & Backgrounds', desc: 'Inject surface colors and text colors' },
                          { id: 'bubbles', label: 'Bubble Shapes', desc: 'Inject rounded corners, borders, shadows' },
                          { id: 'structural', label: 'Structural (Width & Margins)', desc: 'Force max-widths, wrapping, and alignment' },
                          { id: 'typography', label: 'Typography', desc: 'Inject font family and sizing' }
                        ].map((feat) => {
                          const val = prov.cssFeatures?.[feat.id] ?? true
                          return (
                            <label
                              key={feat.id}
                              className="flex items-start gap-3 p-2.5 rounded-xl border border-white/5 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={val}
                                onChange={(e) => setVal(`cssFeatures.${feat.id}`, e.target.checked)}
                                className="mt-0.5 accent-emerald-500 cursor-pointer"
                              />
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-white/90">{feat.label}</span>
                                <span className="text-[9px] text-white/50">{feat.desc}</span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {!isGlobal && (
                    <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-black/40 border border-white/5">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div>
                          <span className="text-[13px] font-bold text-white block">Dynamic Theme Selectors</span>
                          <span className="text-[10px] text-amber-200/75">Auto-applies Nexus styles to these elements</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const activeModel = models.find((m) => m.key === styleSubTab)
                              const targetKey = isGlobal ? 'gemini' : styleSubTab
                              const providerUrl = activeModel?.url || 'https://z.ai'

                              // Fetch live sanitized DOM HTML
                              // @ts-ignore
                              const domResult = await window.electron?.ipcRenderer?.invoke('extract_provider_live_dom', targetKey, providerUrl).catch(() => ({ success: false }))

                              const hasLiveDom = domResult && domResult.success && domResult.html
                              const promptText = generateThemeSelectorPrompt({
                                providerName: modelLabel(styleSubTab),
                                providerUrl,
                                liveDomHtml: hasLiveDom ? domResult.html : undefined
                              })

                              await navigator.clipboard.writeText(promptText)
                              if (setCopiedCssToast) {
                                if (hasLiveDom) {
                                  setCopiedCssToast(`✓ Copied Selector Extraction Prompt with Live HTML!`)
                                } else {
                                  setCopiedCssToast(`✓ Copied Selector Extraction Prompt! (Tip: Open a tab for ${modelLabel(styleSubTab)} to include live HTML)`)
                                }
                                setTimeout(() => setCopiedCssToast(null), 4000)
                              }
                            } catch (err) {
                              console.error('Failed to copy AI prompt:', err)
                            }
                          }}
                          className="px-2.5 py-1 rounded-md text-[10px] font-bold border border-amber-500/40 text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                          title="Generate AI prompt to extract these selectors from the live webview HTML"
                        >
                          <IconSparkles size={11} />
                          <span>Extract via AI</span>
                        </button>
                      </div>

                      {/* Group A: Macro Shell & Layout */}
                      <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                        <span className="text-[11px] font-bold text-amber-400/90 uppercase tracking-wider">Macro Shell & Layout</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">App Container</span>
                            <input
                              type="text"
                              value={effThemeSelectors.appContainer || ''}
                              onChange={(e) => setVal('themeSelectors.appContainer', e.target.value)}
                              placeholder="#app, main, #chat-container"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Chat Thread Wrapper</span>
                            <input
                              type="text"
                              value={effThemeSelectors.chatWrapper || ''}
                              onChange={(e) => setVal('themeSelectors.chatWrapper', e.target.value)}
                              placeholder="e.g. #messages-container, .max-w-3xl"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Sidebar</span>
                            <input
                              type="text"
                              value={effThemeSelectors.sidebar || ''}
                              onChange={(e) => setVal('themeSelectors.sidebar', e.target.value)}
                              placeholder="#sidebar > div, aside"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Nav Bar / Header</span>
                            <input
                              type="text"
                              value={effThemeSelectors.header || ''}
                              onChange={(e) => setVal('themeSelectors.header', e.target.value)}
                              placeholder="nav.drag-region, header"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Model Selector Badge</span>
                            <input
                              type="text"
                              value={effThemeSelectors.modelDropdown || ''}
                              onChange={(e) => setVal('themeSelectors.modelDropdown', e.target.value)}
                              placeholder="[class*='model-selector'], div.model-badge"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Group B: Chat Messages & Content */}
                      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                        <span className="text-[11px] font-bold text-amber-400/90 uppercase tracking-wider">Chat Messages & Content</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">User Message</span>
                            <input
                              type="text"
                              value={effThemeSelectors.userMessage || ''}
                              onChange={(e) => setVal('themeSelectors.userMessage', e.target.value)}
                              placeholder=".chat-user div.rounded-xl, [data-author='user']"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">AI Message</span>
                            <input
                              type="text"
                              value={effThemeSelectors.aiMessage || ''}
                              onChange={(e) => setVal('themeSelectors.aiMessage', e.target.value)}
                              placeholder=".chat-assistant, .ai-message"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Markdown Prose</span>
                            <input
                              type="text"
                              value={effThemeSelectors.markdownProse || ''}
                              onChange={(e) => setVal('themeSelectors.markdownProse', e.target.value)}
                              placeholder=".markdown-prose, .prose"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Thinking Block</span>
                            <input
                              type="text"
                              value={effThemeSelectors.thinkingBlock || ''}
                              onChange={(e) => setVal('themeSelectors.thinkingBlock', e.target.value)}
                              placeholder=".thinking-chain-container, .thought-process"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Code Block</span>
                            <input
                              type="text"
                              value={effThemeSelectors.codeBlock || ''}
                              onChange={(e) => setVal('themeSelectors.codeBlock', e.target.value)}
                              placeholder="[class^='language-'], pre, .code-wrapper"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Group C: Composer & Actions */}
                      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                        <span className="text-[11px] font-bold text-amber-400/90 uppercase tracking-wider">Composer & Actions</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Composer (Chat Input)</span>
                            <input
                              type="text"
                              value={effThemeSelectors.composer || ''}
                              onChange={(e) => setVal('themeSelectors.composer', e.target.value)}
                              placeholder="#messages-container ~ div:last-child, textarea, form [contenteditable='true']"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Send Button</span>
                            <input
                              type="text"
                              value={effThemeSelectors.sendButton || ''}
                              onChange={(e) => setVal('themeSelectors.sendButton', e.target.value)}
                              placeholder="button[type='submit'], [class*='send']"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">Action Buttons / Toolbar</span>
                            <input
                              type="text"
                              value={effThemeSelectors.actionButtons || ''}
                              onChange={(e) => setVal('themeSelectors.actionButtons', e.target.value)}
                              placeholder="[class*='action-bar'], .message-actions"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Snippets */}
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-black/40 border border-white/5">
                    <span className="text-[11px] font-semibold text-(--text2)">Quick CSS Snippets:</span>
                    {[
                      { label: 'User Query Accent', code: '/* Highlight user prompt bubble */\n.user-query {\n  border: 1px solid var(--nexus-accent) !important;\n  box-shadow: 0 0 16px rgba(99, 102, 241, 0.25);\n}\n' },
                      { label: 'OLED Chat Bg', code: '/* True OLED deep black canvas */\nbody, html, #root {\n  background-color: #000000 !important;\n}\n' },
                      { label: 'Glowing Code Blocks', code: '/* Neon glow on code headers */\npre, code {\n  box-shadow: 0 0 18px rgba(34, 211, 238, 0.2) !important;\n  border-color: rgba(34, 211, 238, 0.4) !important;\n}\n' },
                      { label: 'Hidden Scrollbars', code: '/* Ultra-sleek minimalist scroll */\n*::-webkit-scrollbar {\n  display: none !important;\n}\n' },
                      { label: 'Compact Chat Spacing', code: '/* Snug bubble margins */\n.message-wrapper, [data-message-author-role] {\n  margin-top: 6px !important;\n  margin-bottom: 6px !important;\n}\n' }
                    ].map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          const current = effCustomCss || ''
                          const next = current.includes(s.code.trim()) ? current : current ? `${current}\n\n${s.code}` : s.code
                          setVal('customCss', next)
                        }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-white/5 hover:bg-white/10 border border-white/10 text-amber-200 transition-colors cursor-pointer"
                      >
                        + {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom CSS Textarea */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>Custom CSS Rules ({isGlobal ? 'Global — All Providers' : modelLabel(styleSubTab)}):</span>
                      <span className="text-[10px] font-mono text-amber-300/80">Auto-injected into active tabs</span>
                    </div>
                    <textarea
                      value={effCustomCss}
                      onChange={(e) => setVal('customCss', e.target.value)}
                      placeholder={`/* Custom CSS rules for ${isGlobal ? 'all providers' : modelLabel(styleSubTab)} */\n.user-message {\n  border: 1px solid var(--nexus-accent);\n}`}
                      rows={8}
                      className="code-editor-textarea custom-scrollbar w-full font-mono text-xs p-3.5 rounded-xl bg-black/60 border border-white/10 text-gray-200 focus:border-amber-400 focus:outline-none transition-all shadow-inner leading-relaxed"
                      spellCheck={false}
                    />
                    <span className="text-[10px] text-white/40">
                      Changes apply instantly to live webview instances without reloading. Leave empty to use default Nexus styling.
                    </span>
                  </div>
                </div>
              )}

              {/* View 2: Full Applied CSS Inspector */}
              {cssViewMode === 'full' && (
                <div className="flex flex-col gap-3 p-4 rounded-xl bg-black/60 border border-amber-500/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                    <div>
                      <span className="text-xs font-bold text-amber-300 block">Complete Live Applied Stylesheet</span>
                      <span className="text-[10px] text-white/50">
                        The entire CSS bundle computed by Nexus and actively injected into the webview tab
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleLoadFullCssIntoEditor}
                        className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-amber-500/40 text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                        title="Copy this full computed stylesheet into your custom editor so you can edit any part of it"
                      >
                        <IconDownload size={12} />
                        <span>Load into Custom Editor</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (fullAppliedCss) {
                            await navigator.clipboard.writeText(fullAppliedCss)
                            setCopiedFullCss(true)
                            setTimeout(() => setCopiedFullCss(false), 2500)
                          }
                        }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-white/10 text-white/80 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        {copiedFullCss ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        <span>{copiedFullCss ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                    </div>
                  </div>

                  {isLoadingFullCss ? (
                    <div className="py-12 text-center text-xs text-amber-300/70 font-mono animate-pulse">
                      Generating live computed stylesheet...
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={fullAppliedCss || '/* No computed CSS loaded yet */'}
                      rows={16}
                      className="code-editor-textarea custom-scrollbar w-full font-mono text-[11px] p-3 rounded-lg bg-black/80 border border-white/10 text-amber-200/90 focus:outline-none selection:bg-amber-500/30 leading-relaxed"
                      spellCheck={false}
                    />
                  )}
                  <span className="text-[10px] text-white/40">
                    Includes theme tokens, root CSS variables, dynamic bubble layouts, typography rules, selector bridges, and user custom rules.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 2: JAVASCRIPT STUDIO ===================== */}
          {codeStudioTab === 'js' && (
            <div className="flex flex-col gap-4">
              {/* JS Sub-bar: Mode toggles and actions */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-black/40 border border-white/5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setJsViewMode('custom')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      jsViewMode === 'custom'
                        ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/50 shadow-sm'
                        : 'text-white/50 hover:text-white border border-transparent'
                    }`}
                  >
                    ✨ Custom JavaScript Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setJsViewMode('full')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      jsViewMode === 'full'
                        ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/50 shadow-sm'
                        : 'text-white/50 hover:text-white border border-transparent'
                    }`}
                  >
                    🔍 Full Applied JS {fullAppliedJs ? `(${fullAppliedJs.split('\n').length} lines)` : ''}
                  </button>
                </div>

                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  <button
                    type="button"
                    onClick={handleResetJs}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-rose-500/30 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                    title="Reset custom JavaScript scripts to default"
                  >
                    <IconRotate size={12} />
                    <span>Reset JS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecuteLiveJs(jsViewMode === 'custom' ? effCustomJs : fullAppliedJs)}
                    disabled={isExecutingJs || !(jsViewMode === 'custom' ? effCustomJs.trim() : fullAppliedJs.trim())}
                    className="px-3 py-1 rounded-md text-[11px] font-bold border border-emerald-500/40 text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 active:scale-95 disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                    title="Execute this JavaScript immediately in the live active provider webview tab"
                  >
                    <IconZap size={12} className={isExecutingJs ? 'animate-spin' : ''} />
                    <span>{isExecutingJs ? 'Executing...' : '▶ Run in Active Tab'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const modelKeyToFetch = isGlobal ? '' : styleSubTab
                        // @ts-ignore
                        const fullJs = await window.electron?.ipcRenderer?.invoke('get_full_provider_js', modelKeyToFetch)
                        const text = fullJs || fullAppliedJs || ''
                        if (text) {
                          await navigator.clipboard.writeText(text)
                          setCopiedFullJs(true)
                          setTimeout(() => setCopiedFullJs(false), 2500)
                          if (setCopiedCssToast) {
                            setCopiedCssToast(`✓ Copied full applied JS to clipboard!`)
                            setTimeout(() => setCopiedCssToast(null), 3000)
                          }
                        }
                      } catch (err) {
                        console.error('Failed to copy full JS:', err)
                      }
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedFullJs ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    <span>{copiedFullJs ? 'Copied Full JS!' : 'Copy Full JS'}</span>
                  </button>
                </div>
              </div>

              {/* Live Execution Feedback Alert */}
              {jsRunOutput && (
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in transition-all ${
                    jsRunOutput.success
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {jsRunOutput.success ? <IconCheck size={14} className="text-emerald-400" /> : <IconRotate size={14} className="text-rose-400" />}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-bold">
                      {jsRunOutput.success ? 'Webview Execution Succeeded:' : 'Webview Execution Returned Error:'}
                    </span>
                    <pre className="font-mono text-[11px] whitespace-pre-wrap break-all opacity-90 overflow-x-auto max-h-32 custom-scrollbar">
                      {jsRunOutput.message}
                    </pre>
                  </div>
                </div>
              )}

              {/* View 1: Custom JS Editor */}
              {jsViewMode === 'custom' && (
                <div className="flex flex-col gap-4">
                  {/* Context Explanation */}
                  <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex flex-col gap-1 text-xs text-cyan-200/90">
                    <div className="flex items-center gap-2 font-bold text-cyan-300">
                      <IconZap size={14} />
                      <span>Webview Runtime Automation Environment</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-cyan-100/70">
                      Your custom script executes automatically on every page load (<code className="font-mono text-cyan-300">did-finish-load</code>) inside the guest webview.
                      Built-in automations run concurrently: Shift+Scroll horizontal mouse wheel handling, <code className="font-mono text-cyan-300">/</code> composer focus hotkey, title synchronization, caret preservation, and memory virtualization.
                    </p>
                  </div>

                  {/* Quick JS Snippets */}
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-black/40 border border-white/5">
                    <span className="text-[11px] font-semibold text-(--text2)">Quick JS Snippets:</span>
                    {[
                      {
                        label: 'Auto-Focus Composer',
                        code: `// Auto-focus chat input field\nconst composer = document.querySelector('textarea, [contenteditable="true"]');\nif (composer) composer.focus();\n`
                      },
                      {
                        label: 'Log Page Diagnostics',
                        code: `// Log webview diagnostics\nconsole.log('[Nexus Script] Title:', document.title, '| URL:', window.location.href);\n`
                      },
                      {
                        label: 'Force Dark Theme DOM',
                        code: `// Force HTML dark classes\ndocument.documentElement.classList.add('dark');\ndocument.documentElement.setAttribute('data-theme', 'dark');\n`
                      },
                      {
                        label: 'Remove Floating Banners',
                        code: `// Dismiss annoying promo banners\ndocument.querySelectorAll('.banner, .announcement-bar, [aria-modal="true"]').forEach(el => el.remove());\n`
                      },
                      {
                        label: 'Scroll to Bottom Helper',
                        code: `// Scroll conversation to bottom\nwindow.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });\n`
                      }
                    ].map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          const current = effCustomJs || ''
                          const next = current.includes(s.code.trim()) ? current : current ? `${current}\n\n${s.code}` : s.code
                          setVal('customJs', next)
                        }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-200 transition-colors cursor-pointer"
                      >
                        + {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom JS Textarea */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>Custom JavaScript ({isGlobal ? 'Global — All Providers' : modelLabel(styleSubTab)}):</span>
                      <span className="text-[10px] font-mono text-cyan-300/80">Full DOM & window access</span>
                    </div>
                    <textarea
                      value={effCustomJs}
                      onChange={(e) => setVal('customJs', e.target.value)}
                      placeholder={`// Custom JavaScript executed on page load for ${isGlobal ? 'all providers' : modelLabel(styleSubTab)}\nconsole.log('Nexus provider loaded:', window.location.hostname);`}
                      rows={8}
                      className="code-editor-textarea custom-scrollbar w-full font-mono text-xs p-3.5 rounded-xl bg-black/60 border border-white/10 text-gray-200 focus:border-cyan-400 focus:outline-none transition-all shadow-inner leading-relaxed"
                      spellCheck={false}
                    />
                    <span className="text-[10px] text-white/40">
                      Scripts run safely isolated inside the webview context. Click &ldquo;▶ Run in Active Tab&rdquo; above to test code on the live tab immediately without reloading.
                    </span>
                  </div>
                </div>
              )}

              {/* View 2: Full Applied JS Inspector */}
              {jsViewMode === 'full' && (
                <div className="flex flex-col gap-3 p-4 rounded-xl bg-black/60 border border-cyan-500/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                    <div>
                      <span className="text-xs font-bold text-cyan-300 block">Complete Live Injected Runtime Script</span>
                      <span className="text-[10px] text-white/50">
                        The entire JavaScript bundle injected into the webview on every did-finish-load event
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleLoadFullJsIntoEditor}
                        className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-cyan-500/40 text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/25 transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                        title="Copy the entire runtime script into your custom editor so you can fork and customize all built-in automations"
                      >
                        <IconDownload size={12} />
                        <span>Load into Custom Editor</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (fullAppliedJs) {
                            await navigator.clipboard.writeText(fullAppliedJs)
                            setCopiedFullJs(true)
                            setTimeout(() => setCopiedFullJs(false), 2500)
                          }
                        }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-white/10 text-white/80 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        {copiedFullJs ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        <span>{copiedFullJs ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                    </div>
                  </div>

                  {isLoadingFullJs ? (
                    <div className="py-12 text-center text-xs text-cyan-300/70 font-mono animate-pulse">
                      Generating live runtime bundle...
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={fullAppliedJs || '// No runtime script loaded yet'}
                      rows={16}
                      className="code-editor-textarea custom-scrollbar w-full font-mono text-[11px] p-3 rounded-lg bg-black/80 border border-white/10 text-cyan-200/90 focus:outline-none selection:bg-cyan-500/30 leading-relaxed"
                      spellCheck={false}
                    />
                  )}
                  <span className="text-[10px] text-white/40">
                    Includes horizontal wheel scroll interception, &apos;/&apos; prompt focus hotkey, title mutation observers, input caret retention, memory GC virtualization, and your custom script.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {styleSearchQuery && (
        <div className="col-span-1 xl:col-span-2 p-4 text-center text-xs text-(--text2)">
          Showing matching options for &ldquo;<span className="text-(--text) font-semibold">{styleSearchQuery}</span>&rdquo; across all categories.
        </div>
      )}
    </div>
  )
}
