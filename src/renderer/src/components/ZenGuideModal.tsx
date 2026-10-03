import { useState, useEffect } from 'react'
import type { ModelDef } from '../App'
import type {
  InterfaceSettings,
  AestheticPreset,
  IconPack
} from '../lib/interfaceSettings'
import {
  PRESET_CONFIGS,
  applyInterfaceCssVariables,
  saveInterfaceSettings,
  adjustAccentContrast,
  isPresetModified
} from '../lib/interfaceSettings'
import {
  BrandIcon,
  IconSparkles,
  IconZap,
  IconMonitor,
  IconKeyboard,
  IconGlobe,
  IconSearch,
  IconCheck,
  IconX,
  IconPin,
  IconShield,
  IconStar,
  IconPalette,
  IconHistory,
  IconPlus
} from './BrandIcons'
import { IconConfigProvider } from '../lib/iconContext'
import { modelColor } from '../lib/modelVisuals'
import { ShortcutsMatrix } from './ShortcutsMatrix'
import './ZenGuideModal.css'

export type NexusGuideStep = 'welcome' | 'style' | 'providers' | 'powers' | 'shortcuts'

interface Props {
  isOpen: boolean
  onClose: () => void
  models: ModelDef[]
  interfaceSettings: InterfaceSettings
  onUpdateInterfaceSettings: (settings: InterfaceSettings) => void
  onQuickStartTabs?: (selectedModelKeys: string[]) => void
  onOpenFullSettings?: (tab?: 'general' | 'models' | 'themes' | 'style' | 'webview' | 'shortcuts') => void
}

export function ZenGuideModal({
  isOpen,
  onClose,
  models,
  interfaceSettings,
  onUpdateInterfaceSettings,
  onQuickStartTabs,
  onOpenFullSettings
}: Props) {
  // Step sequence: 1. Welcome & Vision -> 2. Style Studio -> 3. AI Providers & Sync -> 4. Superpowers -> 5. Shortcuts
  const [activeStep, setActiveStep] = useState<NexusGuideStep>('welcome')

  // Selected quick-starter models
  const [selectedStarterModels, setSelectedStarterModels] = useState<string[]>(() => {
    return models.slice(0, 4).map((m) => m.key)
  })

  // Simulated download toast state for testing in Step 4
  const [downloadDemoToast, setDownloadDemoToast] = useState<{ visible: boolean; message: string }>({
    visible: true,
    message: 'telemetry_pipeline.ts (14.2 KB)'
  })

  // Session sync state & Detected browser profiles
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const [syncingProfileId, setSyncingProfileId] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [signInProfiles, setSignInProfiles] = useState<
    Array<{ id: string; browser: string; name: string; hasGoogleAuth: boolean; lastAccessed?: number; isLatest?: boolean }>
  >([])

  // Load detected browser profiles
  useEffect(() => {
    // @ts-ignore
    window.electron?.googleSignIn?.getProfiles?.().then((profiles: any) => {
      if (Array.isArray(profiles) && profiles.length > 0) {
        const sorted = [...profiles].sort((a, b) => {
          if (a.isLatest && !b.isLatest) return -1
          if (!a.isLatest && b.isLatest) return 1
          return (b.lastAccessed || 0) - (a.lastAccessed || 0)
        })
        setSignInProfiles(sorted)
      }
    }).catch(() => {})
  }, [])

  // Listen to profile events
  useEffect(() => {
    const onEv = (_e: unknown, ev: { stage: string; email?: string; message?: string; profiles?: Array<{ id: string; browser: string; name: string; hasGoogleAuth: boolean }> }) => {
      if (ev.stage === 'no-auth' && Array.isArray(ev.profiles)) {
        setSignInProfiles(ev.profiles)
      }
    }
    // @ts-ignore
    window.electron?.googleSignIn?.onEvent(onEv)
    return () => {
      // @ts-ignore
      window.electron?.ipcRenderer?.removeListener('google-signin-event', onEv)
    }
  }, [])

  // Don't show again on startup state
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem('nexus.has_seen_guide') === 'true' ||
        localStorage.getItem('vicinae.has_seen_guide') === 'true'
      )
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (dontShowAgain) {
      try {
        localStorage.setItem('nexus.has_seen_guide', 'true')
      } catch {}
    } else {
      try {
        localStorage.removeItem('nexus.has_seen_guide')
        localStorage.removeItem('vicinae.has_seen_guide')
      } catch {}
    }
  }, [dontShowAgain])

  if (!isOpen) return null

  const handleApplyPreset = (preset: AestheticPreset) => {
    const overrides = PRESET_CONFIGS[preset]
    const next: InterfaceSettings = {
      ...interfaceSettings,
      aestheticPreset: preset,
      ...overrides
    }
    saveInterfaceSettings(next)
    applyInterfaceCssVariables(next)
    onUpdateInterfaceSettings(next)
  }

  const handleUpdateSetting = <K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) => {
    const next: InterfaceSettings = {
      ...interfaceSettings,
      [key]: value
    }
    saveInterfaceSettings(next)
    applyInterfaceCssVariables(next)
    onUpdateInterfaceSettings(next)
  }

  const handleToggleStarterModel = (key: string) => {
    setSelectedStarterModels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  const handleSyncAllSessions = async () => {
    setIsSyncingAll(true)
    setSyncStatus('Detecting and syncing session cookies across all browser profiles…')
    try {
      // @ts-ignore
      const result = await window.electron?.googleSignIn?.syncSessions?.()
      if (result?.success) {
        setSyncStatus(`✓ Successfully imported ${result.count ?? result.importedCount ?? 'all active'} sessions!`)
      } else {
        setSyncStatus('Checked browser profiles. Sessions are active or can be imported per profile below.')
      }
    } catch {
      setSyncStatus('Cookie sync completed.')
    } finally {
      setIsSyncingAll(false)
    }
  }

  const handleSyncProfile = async (profileId: string, profileName: string) => {
    setSyncingProfileId(profileId)
    setSyncStatus(`Importing session cookies from "${profileName}"…`)
    try {
      // @ts-ignore
      const res = await window.electron?.googleSignIn?.syncProfile(profileId)
      if (res && res.success) {
        try { localStorage.setItem('nexus.has_synced_sessions', 'true') } catch {}
        setSyncStatus(`✓ Synced ${res.count ?? 0} session cookies from "${profileName}".`)
      } else {
        setSyncStatus(res?.message || `No active AI cookies found in "${profileName}".`)
      }
    } catch (err) {
      setSyncStatus(`Sync failed for ${profileName}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncingProfileId(null)
    }
  }

  const handleFinish = () => {
    if (onQuickStartTabs && selectedStarterModels.length > 0) {
      onQuickStartTabs(selectedStarterModels)
    }
    setDontShowAgain(true)
    onClose()
  }

  const effAccent = adjustAccentContrast(interfaceSettings.accentColor || '#6366f1', interfaceSettings.accentContrast ?? 100)
  const effSecondaryGlow = adjustAccentContrast(interfaceSettings.accentGlowColor || '#22d3ee', interfaceSettings.accentContrast ?? 100)
  const effDarkness = interfaceSettings.surfaceDarkness ?? 25
  const effContrast = interfaceSettings.accentContrast ?? 100
  const effRadius = interfaceSettings.cornerRadius ?? 14
  const effGlass = interfaceSettings.glassmorphism || 'glassmorphic'
  const effMotion = interfaceSettings.motionSpeed || 'smooth'
  const effIconPack = interfaceSettings.iconPack || 'lucide-line'
  const effIconWeight = interfaceSettings.iconStrokeWeight || 'standard'
  const effIconGlow = interfaceSettings.iconGlowEffect
  const effTabGlow = interfaceSettings.tabGlowStyle || 'pill-glow'
  const effAura = interfaceSettings.webviewAmbientAura
  const effAuraMode = interfaceSettings.ambientAuraMode || 'viewport-frame'
  const effAuraIntensity = interfaceSettings.ambientAuraIntensity ?? 45
  const effBubble = interfaceSettings.webviewBubbleStyle || 'gradient-pill'
  const effCodeBlock = interfaceSettings.webviewCodeBlockStyle || 'oled-contrast'
  const effComposer = interfaceSettings.webviewComposerGlow || 'electric-neon'
  const effAiWidth = interfaceSettings.aiResponseWidthPx ?? 860

  // Glassmorphism & Darkness math
  const glassBackdropFilter = effGlass === 'solid-opaque' ? 'none' : effGlass === 'ultra-glass' ? 'blur(24px)' : 'blur(14px)'
  const darknessAlpha = Math.min(0.98, Math.max(0.6, 0.72 + (effDarkness / 100) * 0.26))
  const cardBaseR = Math.round(18 * (1 - effDarkness / 100))
  const cardBaseG = Math.round(20 * (1 - effDarkness / 100))
  const cardBaseB = Math.round(30 * (1 - effDarkness / 100))
  const glassCardBg = effGlass === 'solid-opaque'
    ? `rgb(${cardBaseR}, ${cardBaseG}, ${cardBaseB})`
    : effGlass === 'ultra-glass'
      ? `rgba(${cardBaseR + 8}, ${cardBaseG + 8}, ${cardBaseB + 14}, ${darknessAlpha - 0.18})`
      : `rgba(${cardBaseR}, ${cardBaseG}, ${cardBaseB}, ${darknessAlpha})`
  const glassBorder = effGlass === 'solid-opaque'
    ? 'rgba(255, 255, 255, 0.08)'
    : effGlass === 'ultra-glass'
      ? `rgba(255, 255, 255, ${0.18 * (1 + effContrast / 200)})`
      : `rgba(255, 255, 255, ${0.09 * (1 + effContrast / 200)})`

  const motionMs = effMotion === 'reduced' ? 0 : effMotion === 'snappy' ? 80 : 180
  const motionEasing = effMotion === 'reduced' ? 'linear' : effMotion === 'snappy' ? 'cubic-bezier(0.2, 0.9, 0.3, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)'
  const motionStyle = {
    transitionDuration: `${motionMs}ms`,
    transitionTimingFunction: motionEasing
  }

  const stepsList: Array<{ id: NexusGuideStep; label: string; icon: React.ComponentType<any> }> = [
    { id: 'welcome', label: '1. Welcome & Vision', icon: IconSparkles },
    { id: 'style', label: '2. Live Style Studio', icon: IconPalette },
    { id: 'providers', label: '3. AI Suite & Sync', icon: IconMonitor },
    { id: 'powers', label: '4. Superpowers', icon: IconZap },
    { id: 'shortcuts', label: '5. Shortcuts Matrix', icon: IconKeyboard }
  ]

  return (
    <IconConfigProvider iconPack={effIconPack as IconPack} strokeWeight={effIconWeight} glowEffect={effIconGlow}>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 zen-guide-backdrop cosmic-backdrop-fade">
        {/* Background Animated Mesh Aura */}
        <div className="zen-mesh-bg">
          <div className="zen-mesh-blob-1" />
          <div className="zen-mesh-blob-2" />
          <div className="zen-mesh-blob-3" />
        </div>

        {/* Main Guide Modal Card (Grand Semi-Fullscreen Cyberpunk Glassmorphic Canvas) */}
        <div
          className="relative w-[97vw] max-w-[1580px] h-[94vh] max-h-[1050px] rounded-3xl border flex flex-col overflow-hidden shadow-2xl z-10 cosmic-modal-pop"
          style={{
            background: glassCardBg,
            backdropFilter: glassBackdropFilter,
            WebkitBackdropFilter: glassBackdropFilter,
            borderColor: `color-mix(in srgb, ${effAccent} 35%, rgba(255, 255, 255, 0.16))`,
            boxShadow: `0 25px 80px -15px rgba(0, 0, 0, 0.95), 0 0 60px -10px color-mix(in srgb, ${effAccent} 35%, transparent)`,
            ...motionStyle
          }}
        >
          {/* Top Header & Fluid Navigation Pills */}
          <div
            className="p-4 sm:p-5 border-b flex flex-col lg:flex-row items-center justify-between gap-3 shrink-0"
            style={{ borderColor: 'rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.45)' }}
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center border shadow-lg relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${effAccent} 35%, rgba(0,0,0,0.5)) 0%, rgba(0,0,0,0.7) 100%)`,
                  borderColor: effAccent,
                  boxShadow: `0 0 16px color-mix(in srgb, ${effAccent} 40%, transparent)`
                }}
              >
                <IconSparkles size={20} style={{ color: effAccent }} />
                <div className="absolute inset-0 bg-white/10 animate-[laserScan_3s_infinite_linear]" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-base sm:text-lg tracking-tight text-white">
                    Nexus AI Workstation
                  </span>
                  <span
                    className="text-[10px] px-2.5 py-0.5 rounded-full font-mono uppercase font-bold border"
                    style={{
                      background: `color-mix(in srgb, ${effAccent} 18%, transparent)`,
                      color: effAccent,
                      borderColor: `color-mix(in srgb, ${effAccent} 35%, transparent)`
                    }}
                  >
                    Nexus Master Guide
                  </span>
                </div>
                <p className="text-xs text-gray-300 opacity-80 mt-0.5">
                  Multi-model sovereign intelligence, deep webview hot-theming & tactile keyboard power
                </p>
              </div>
            </div>

            {/* Step Navigation Pills */}
            <div className="flex items-center gap-1 p-1 rounded-2xl border bg-black/50 shadow-inner overflow-x-auto max-w-full" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              {stepsList.map((tab) => {
                const IconComp = tab.icon
                const isActive = activeStep === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveStep(tab.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
                    style={{
                      background: isActive ? effAccent : 'transparent',
                      color: isActive ? '#fff' : 'var(--text2)',
                      boxShadow: isActive ? `0 2px 12px color-mix(in srgb, ${effAccent} 45%, transparent)` : 'none',
                      ...motionStyle
                    }}
                  >
                    <IconComp size={14} />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer shrink-0"
              title="Close guide"
            >
              <IconX size={16} />
            </button>
          </div>

          {/* Dynamic Step Content */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* ================= STEP 1: WELCOME & VISION (GRAND HERO SHOWCASE) ================= */}
            {activeStep === 'welcome' && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar flex flex-col gap-6 max-w-6xl mx-auto w-full">
                {/* Hero Manifesto Banner */}
                <div
                  className="p-6 sm:p-8 rounded-3xl border flex flex-col lg:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, color-mix(in srgb, ${effAccent} 18%, rgba(15, 17, 26, 0.95)) 0%, color-mix(in srgb, ${effSecondaryGlow} 12%, rgba(10, 12, 20, 0.98)) 100%)`,
                    borderColor: `color-mix(in srgb, ${effAccent} 35%, rgba(255,255,255,0.15))`,
                    boxShadow: `0 16px 50px -10px rgba(0, 0, 0, 0.7), 0 0 35px -5px color-mix(in srgb, ${effAccent} 25%, transparent)`
                  }}
                >
                  <div className="flex flex-col gap-3.5 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full animate-ping" style={{ background: effAccent }} />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-300">
                        Next-Generation AI Desktop Architecture
                      </span>
                    </div>
                    <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                      One Workspace. All AI Superpowers. Zero Compromises.
                    </h1>
                    <p className="text-sm sm:text-base text-gray-300 leading-relaxed opacity-90">
                      Nexus unites <strong>Gemini</strong>, <strong>ChatGPT</strong>, <strong>Claude</strong>, <strong>Perplexity</strong>, <strong>DeepSeek</strong>, and custom endpoints into a high-performance, keyboard-driven native workstation with real-time deep webview theming, persistent chat memory, and autonomous SuperAntigravity specialist workflows.
                    </p>
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setActiveStep('style')}
                        className="px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 text-white shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                        style={{
                          background: `linear-gradient(135deg, ${effAccent} 0%, ${effSecondaryGlow} 100%)`,
                          boxShadow: `0 0 20px color-mix(in srgb, ${effAccent} 50%, transparent)`
                        }}
                      >
                        <IconSparkles size={16} />
                        <span>Start Guided Tour →</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveStep('powers')}
                        className="px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold border text-gray-200 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                        style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                      >
                        <span>Explore Flagship Powers</span>
                      </button>
                    </div>
                  </div>

                  {/* Right Animated Holographic Nexus Prism */}
                  <div className="relative w-44 h-44 sm:w-56 sm:h-56 shrink-0 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full blur-2xl opacity-40 animate-pulse" style={{ background: effAccent }} />
                    <div
                      className="w-36 h-36 sm:w-44 sm:h-44 rounded-3xl border flex items-center justify-center shadow-2xl relative"
                      style={{
                        background: 'rgba(10, 12, 20, 0.85)',
                        borderColor: `color-mix(in srgb, ${effAccent} 50%, rgba(255,255,255,0.2))`,
                        boxShadow: `0 0 30px color-mix(in srgb, ${effAccent} 35%, transparent)`
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3 p-3">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <BrandIcon id="gemini" size={22} style={{ color: '#06b6d4' }} />
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <BrandIcon id="claude" size={22} style={{ color: '#d97706' }} />
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <BrandIcon id="chatgpt" size={22} style={{ color: '#10b981' }} />
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <BrandIcon id="deepseek" size={22} style={{ color: '#3b82f6' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4 Core Workstation Capability Pillars */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      title: 'Multi-Model Intelligence',
                      desc: 'Run all leading AI models in isolated native webview sessions with zero cross-talk and instant rotation.',
                      icon: IconGlobe,
                      color: '#06b6d4'
                    },
                    {
                      title: 'Deep Webview Hot-Theming',
                      desc: 'Full aesthetic engine injecting OLED black, optical glass, ambient aura edge halos & universal icon packs.',
                      icon: IconPalette,
                      color: '#ec4899'
                    },
                    {
                      title: 'SuperAntigravity Skills',
                      desc: 'Trigger autonomous security reviews, deep research, and reasoning frameworks via Ctrl+S & Ctrl+Shift+S.',
                      icon: IconZap,
                      color: '#eab308'
                    },
                    {
                      title: 'Tactile Keyboard Fluidity',
                      desc: 'Instant Omni-Launcher (Ctrl+T), fuzzy history search (Ctrl+H), chat pinning (Alt+P) and customizable hotkeys.',
                      icon: IconKeyboard,
                      color: '#8b5cf6'
                    }
                  ].map((pillar, i) => {
                    const IconComp = pillar.icon
                    return (
                      <div
                        key={i}
                        className="p-5 rounded-2xl border flex flex-col gap-3 transition-all zen-bento-card relative overflow-hidden"
                        style={{
                          background: 'rgba(15, 17, 26, 0.75)',
                          borderColor: 'rgba(255, 255, 255, 0.08)'
                        }}
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm"
                          style={{
                            background: `color-mix(in srgb, ${pillar.color} 20%, transparent)`,
                            borderColor: `color-mix(in srgb, ${pillar.color} 40%, transparent)`,
                            color: pillar.color
                          }}
                        >
                          <IconComp size={20} />
                        </div>
                        <h3 className="font-bold text-sm text-white">{pillar.title}</h3>
                        <p className="text-xs text-gray-400 leading-relaxed">{pillar.desc}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ================= STEP 2: LIVE STYLE STUDIO (INTERACTIVE SPLIT SANDBOX) ================= */}
            {activeStep === 'style' && (
              <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 p-5 sm:p-6 overflow-hidden h-full">
                {/* Left Column: Style Controls (Scrollable) */}
                <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2 h-full">
                  <div>
                    <h2 className="text-lg font-bold text-white">Live Aesthetic & Theming Studio</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Fine-tune curated presets, OLED darkness, optical glass, icon packs, and ambient aura refractions.
                    </p>
                  </div>

                  {/* 1. Curated Aesthetic Presets */}
                  <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-col gap-2.5">
                    <span className="text-xs font-semibold text-white">1-Click Curated Presets:</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'refined-modern', label: 'Refined Modern OS', desc: 'Indigo glass & soft curves' },
                        { id: 'cyberpunk-neon', label: 'Cyberpunk Neon', desc: 'Cyan / Pink & sharp angles' },
                        { id: 'minimalist-slate', label: 'Minimalist Slate', desc: 'Matte slate & instant motion' },
                        { id: 'matrix-terminal', label: 'Matrix Terminal', desc: 'Emerald green & terminal HUD' }
                      ].map((p) => {
                        const isSelected = interfaceSettings.aestheticPreset === p.id
                        const isModified = isSelected && isPresetModified(interfaceSettings)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleApplyPreset(p.id as AestheticPreset)}
                            className="p-3 rounded-xl border flex flex-col gap-1 text-left transition-all cursor-pointer relative"
                            style={{
                              background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'rgba(0,0,0,0.3)',
                              borderColor: isSelected ? (isModified ? '#f59e0b' : effAccent) : 'rgba(255,255,255,0.08)',
                              boxShadow: isSelected ? (isModified ? '0 0 12px rgba(245, 158, 11, 0.3)' : `0 0 12px color-mix(in srgb, ${effAccent} 35%, transparent)`) : 'none'
                            }}
                          >
                            <div className="flex items-center justify-between gap-1.5 w-full">
                              <span className="font-semibold text-xs text-white">{p.label}</span>
                              {isModified && (
                                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full border bg-amber-500/20 text-amber-400 border-amber-500/50">
                                  ✦ Mod
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] opacity-60 text-gray-400 leading-tight">{p.desc}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* 2. Colors, Luminance & Surface Darkness */}
                  <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-col gap-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Colors, Luminance & Vibrancy:</span>
                      <span className="text-[11px] font-mono opacity-80" style={{ color: effAccent }}>
                        {effAccent.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Primary Accent Color & Custom Rainbow Picker */}
                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-black/20 border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-300">Primary Accent Color:</span>
                          <span className="text-[10px] font-mono text-gray-400">Custom Picker</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {['#6366f1', '#06b6d4', '#10b981', '#ec4899', '#f59e0b', '#8b5cf6', '#3b82f6'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => handleUpdateSetting('accentColor', c)}
                              className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110 cursor-pointer"
                              style={{
                                background: c,
                                borderColor: effAccent.toLowerCase() === c.toLowerCase() ? '#ffffff' : 'transparent',
                                boxShadow: effAccent.toLowerCase() === c.toLowerCase() ? `0 0 10px ${c}` : 'none'
                              }}
                            />
                          ))}

                          {/* Glowing Rainbow Picker for Custom Color */}
                          <label
                            className="w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-transform hover:scale-110 shadow-sm relative overflow-hidden shrink-0"
                            style={{
                              background: 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
                              borderColor: 'rgba(255, 255, 255, 0.4)'
                            }}
                            title="Pick custom accent color"
                          >
                            <input
                              type="color"
                              value={effAccent.startsWith('#') && effAccent.length === 7 ? effAccent : '#6366f1'}
                              onChange={(e) => handleUpdateSetting('accentColor', e.target.value)}
                              className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                            />
                          </label>
                        </div>
                      </div>

                      {/* Secondary Neon Glow Color & Custom Glow Picker */}
                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-black/20 border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-300">Secondary Neon Glow:</span>
                          <span className="text-[10px] font-mono" style={{ color: effSecondaryGlow }}>{effSecondaryGlow.toUpperCase()}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {['#22d3ee', '#ec4899', '#10b981', '#f59e0b', '#a855f7', '#3b82f6', '#f43f5e'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => handleUpdateSetting('accentGlowColor', c)}
                              className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110 cursor-pointer"
                              style={{
                                background: c,
                                borderColor: effSecondaryGlow.toLowerCase() === c.toLowerCase() ? '#ffffff' : 'transparent',
                                boxShadow: effSecondaryGlow.toLowerCase() === c.toLowerCase() ? `0 0 10px ${c}` : 'none'
                              }}
                            />
                          ))}

                          {/* Glowing Rainbow Picker for Custom Neon Glow */}
                          <label
                            className="w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer transition-transform hover:scale-110 shadow-sm relative overflow-hidden shrink-0"
                            style={{
                              background: 'conic-gradient(from 0deg, #22d3ee, #ec4899, #10b981, #f59e0b, #a855f7, #22d3ee)',
                              borderColor: 'rgba(255, 255, 255, 0.4)'
                            }}
                            title="Pick custom secondary neon glow"
                          >
                            <input
                              type="color"
                              value={effSecondaryGlow.startsWith('#') && effSecondaryGlow.length === 7 ? effSecondaryGlow : '#22d3ee'}
                              onChange={(e) => handleUpdateSetting('accentGlowColor', e.target.value)}
                              className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                            />
                          </label>
                        </div>

                        {/* Dual-Tone Laser Scan Strip */}
                        <div className="relative h-2 rounded-full overflow-hidden mt-1 border border-white/10" style={{ background: '#05070d' }}>
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

                    {/* Dual Sliders: Surface Darkness & Accent Contrast */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Surface Darkness OLED Slider */}
                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-black/20 border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-300">Surface Darkness (OLED Black):</span>
                          <span className="text-xs font-mono font-bold" style={{ color: effAccent }}>{effDarkness}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={effDarkness}
                          onChange={(e) => handleUpdateSetting('surfaceDarkness', Number(e.target.value))}
                        />
                      </div>

                      {/* Accent Contrast & Vibrancy Slider */}
                      <div className="flex flex-col gap-2 p-3 rounded-lg bg-black/20 border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-300">Accent Contrast & Vibrancy:</span>
                          <span className="text-xs font-mono font-bold" style={{ color: effAccent }}>{effContrast}%</span>
                        </div>
                        <input
                          type="range"
                          min={60}
                          max={160}
                          value={effContrast}
                          onChange={(e) => handleUpdateSetting('accentContrast', Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. Universal Icon Packs & Caliper Weight */}
                  <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Universal Icon System:</span>
                      <span className="text-xs font-mono font-bold capitalize" style={{ color: effAccent }}>{effIconPack.replace('-', ' ')}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {[
                        { id: 'lucide-line', label: 'Lucide' },
                        { id: 'phosphor-duotone', label: 'Phosphor' },
                        { id: 'heroicons-solid', label: 'Heroicons' },
                        { id: 'tabler-minimal', label: 'Tabler' },
                        { id: 'feather-neo', label: 'Feather' }
                      ].map((pack) => (
                        <button
                          key={pack.id}
                          type="button"
                          onClick={() => handleUpdateSetting('iconPack', pack.id as IconPack)}
                          className="py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer text-center"
                          style={{
                            background: effIconPack === pack.id ? `color-mix(in srgb, ${effAccent} 20%, transparent)` : 'rgba(0,0,0,0.3)',
                            borderColor: effIconPack === pack.id ? effAccent : 'rgba(255,255,255,0.08)',
                            color: effIconPack === pack.id ? '#fff' : 'var(--text2)'
                          }}
                        >
                          {pack.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Ambient Chat Aura & Webview Lighting */}
                  <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-white">Ambient Chat Edge Refraction (Aura):</span>
                        <span className="text-[11px] text-gray-400">Immersive edge halo synced with active provider</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateSetting('webviewAmbientAura', !effAura)}
                        className="px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer"
                        style={{
                          background: effAura ? effAccent : 'rgba(255,255,255,0.06)',
                          borderColor: effAura ? effAccent : 'rgba(255,255,255,0.15)',
                          color: effAura ? '#fff' : 'var(--text2)'
                        }}
                      >
                        {effAura ? 'Aura Active ✦' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Responsive Realtime Live Stage Sandbox */}
                <div
                  className="w-full lg:w-[460px] xl:w-[500px] shrink-0 flex flex-col gap-3.5 overflow-y-auto custom-scrollbar p-2 relative"
                  style={motionStyle}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                      <IconSparkles size={14} style={{ color: effAccent }} />
                      Realtime Live Stage Preview
                    </span>
                    <span
                      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border uppercase"
                      style={{
                        background: `color-mix(in srgb, ${effAccent} 20%, transparent)`,
                        color: effAccent,
                        borderColor: `color-mix(in srgb, ${effAccent} 35%, transparent)`
                      }}
                    >
                      Instant Hot-Sync
                    </span>
                  </div>

                  {/* 1. Live Chat Simulation Card */}
                  <div
                    className="p-5 rounded-2xl border flex flex-col gap-3.5 relative overflow-hidden shadow-2xl"
                    style={{
                      background: glassCardBg,
                      backdropFilter: glassBackdropFilter,
                      WebkitBackdropFilter: glassBackdropFilter,
                      borderColor: glassBorder,
                      borderRadius: `${effRadius}px`,
                      boxShadow: effAura && effAuraMode !== 'chat-center'
                        ? `inset 0 0 ${Math.round(effAuraIntensity * 0.7)}px color-mix(in srgb, ${effAccent} ${effAuraIntensity}%, transparent), 0 14px 40px rgba(0,0,0,0.7)`
                        : '0 14px 40px rgba(0,0,0,0.6)',
                      ...motionStyle
                    }}
                  >
                    {/* Center Aura Halo */}
                    {effAura && effAuraMode === 'chat-center' && (
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, ${effAccent} ${effAuraIntensity * 0.55}%, transparent) 0%, transparent 70%)`
                        }}
                      />
                    )}

                    {/* Top Bar */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-2.5 relative z-10">
                      <div className="flex items-center gap-2">
                        <BrandIcon id="gemini" size={16} style={{ color: effAccent }} />
                        <span className="text-xs font-bold text-white">Nexus AI Workspace</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-gray-300">
                        {effAiWidth}px W
                      </span>
                    </div>

                    {/* User Prompt */}
                    <div className="flex justify-end relative z-10">
                      <div
                        className="p-3 text-xs font-medium leading-relaxed shadow-md"
                        style={{
                          borderRadius: `${Math.max(4, effRadius - 2)}px`,
                          background: effBubble === 'gradient-pill'
                            ? `linear-gradient(135deg, color-mix(in srgb, ${effAccent} 35%, var(--surface2)) 0%, var(--surface2) 100%)`
                            : effBubble === 'minimal-outline'
                              ? 'transparent'
                              : 'var(--surface2)',
                          border: effBubble === 'minimal-outline'
                            ? `1px solid ${effAccent}`
                            : `1px solid color-mix(in srgb, ${effAccent} 50%, var(--border))`,
                          color: '#fff',
                          ...motionStyle
                        }}
                      >
                        Explain the Redis stream architecture and consumer group auto-provisioning.
                      </div>
                    </div>

                    {/* Assistant Response with Code */}
                    <div className="flex flex-col gap-2 relative z-10">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="font-bold" style={{ color: effAccent }}>Gemini 1.5 Pro</span>
                        <span className="opacity-60">&bull; 200 OK</span>
                      </div>
                      <div
                        className="p-3 text-xs font-mono rounded-xl border shadow-lg leading-relaxed"
                        style={{
                          background: effCodeBlock === 'matrix-terminal' ? '#040d07' : '#05060a',
                          borderColor: effCodeBlock === 'matrix-terminal' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255,255,255,0.1)',
                          borderRadius: `${Math.max(4, effRadius - 4)}px`,
                          ...motionStyle
                        }}
                      >
                        <div><span className="text-purple-400">const</span> stream = <span className="text-purple-400">await</span> redis.<span className="text-blue-400">xreadgroup</span>(</div>
                        <div className="pl-3"><span className="text-emerald-400">&apos;GROUP&apos;</span>, <span className="text-emerald-400">&apos;nexus-workers&apos;</span>, <span className="text-emerald-400">&apos;worker-01&apos;</span></div>
                        <div>)</div>
                      </div>
                    </div>

                    {/* Composer Bar */}
                    <div
                      className="p-2.5 rounded-xl border bg-black/40 flex items-center justify-between text-xs text-gray-400 relative z-10"
                      style={{
                        borderRadius: `${Math.max(4, effRadius - 2)}px`,
                        borderColor: effComposer === 'electric-neon' ? effAccent : 'var(--border)',
                        boxShadow: effComposer === 'electric-neon' ? `0 0 12px color-mix(in srgb, ${effAccent} 50%, transparent)` : 'none',
                        ...motionStyle
                      }}
                    >
                      <span>Ask follow up question...</span>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: effAccent }}>
                        ↑
                      </div>
                    </div>
                  </div>

                  {/* 2. Live Tab Strip Preview */}
                  <div
                    className="p-3.5 rounded-2xl border flex flex-col gap-2"
                    style={{ background: glassCardBg, borderColor: glassBorder, ...motionStyle }}
                  >
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span className="font-bold uppercase tracking-wider">Tab Bar & Illumination</span>
                      <span className="font-mono text-[10px] capitalize">{effTabGlow.replace('-', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2 p-1 rounded-xl bg-black/40 border border-white/5">
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm"
                        style={{
                          background: effTabGlow === 'pill-glow' ? `color-mix(in srgb, ${effAccent} 22%, var(--surface))` : 'var(--surface)',
                          border: effTabGlow === 'pill-glow' ? `1px solid ${effAccent}` : `1px solid color-mix(in srgb, ${effAccent} 40%, var(--border))`,
                          borderBottom: effTabGlow === 'laser-line' ? `2px solid ${effAccent}` : undefined,
                          boxShadow: effTabGlow === 'pill-glow' ? `0 0 14px color-mix(in srgb, ${effSecondaryGlow} 45%, transparent)` : 'none'
                        }}
                      >
                        <BrandIcon id="gemini" size={12} style={{ color: effAccent }} />
                        <span>Gemini Active</span>
                        {effTabGlow === 'badge-neon' && <span className="w-1.5 h-1.5 rounded-full" style={{ background: effSecondaryGlow }} />}
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium opacity-60 text-gray-400">
                        <BrandIcon id="claude" size={12} />
                        <span>Claude</span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Glyph Showcase */}
                  <div
                    className="p-3.5 rounded-2xl border flex flex-col gap-2"
                    style={{ background: glassCardBg, borderColor: glassBorder, ...motionStyle }}
                  >
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span className="font-bold uppercase tracking-wider">Live Icon Glyphs</span>
                      <span className="font-mono text-[10px]">{effIconPack}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="p-2 rounded-lg bg-white/5 flex flex-col items-center gap-1 text-white">
                        <IconSparkles size={16} style={{ color: effAccent }} />
                        <span className="text-[9px] font-mono opacity-70">Sparkle</span>
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 flex flex-col items-center gap-1 text-white">
                        <IconSearch size={16} />
                        <span className="text-[9px] font-mono opacity-70">Search</span>
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 flex flex-col items-center gap-1 text-white">
                        <IconShield size={16} />
                        <span className="text-[9px] font-mono opacity-70">Shield</span>
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 flex flex-col items-center gap-1 text-white">
                        <IconZap size={16} style={{ color: effAccent }} />
                        <span className="text-[9px] font-mono opacity-70">Energy</span>
                      </div>
                    </div>
                  </div>

                  {onOpenFullSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onOpenFullSettings('style')
                      }}
                      className="w-full py-2.5 px-4 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all hover:bg-white/5 cursor-pointer shadow-sm mt-auto"
                      style={{ borderColor: 'rgba(255,255,255,0.12)', color: effAccent }}
                    >
                      <span>Open Full 8-Card Studio in Settings →</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ================= STEP 3: AI SUITE SETUP & BROWSER PROFILES ================= */}
            {activeStep === 'providers' && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar flex flex-col gap-6 max-w-6xl mx-auto w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <h2 className="text-lg sm:text-xl font-bold text-white">
                      AI Suite & Browser Profile Session Sync
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Import active logins from Chrome, Brave, and Edge profiles, and select starter model tabs.
                    </p>
                  </div>

                  {/* Sync All Button */}
                  <button
                    onClick={handleSyncAllSessions}
                    disabled={isSyncingAll}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 shadow-md cursor-pointer shrink-0 text-white"
                    style={{ background: effAccent }}
                  >
                    <IconShield size={14} />
                    <span>{isSyncingAll ? 'Syncing All Profiles…' : 'Sync All Browser Sessions'}</span>
                  </button>
                </div>

                {syncStatus && (
                  <div className="p-3.5 rounded-xl text-xs border bg-black/40 border-white/10 font-mono text-emerald-400 shadow-sm">
                    {syncStatus}
                  </div>
                )}

                {/* Detected Browser Profiles Grid */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Detected Browser Profiles:</span>
                    <span className="text-[11px] text-gray-400">
                      {signInProfiles.length > 0 ? `${signInProfiles.length} active profile(s) found` : 'Scanning browser profiles…'}
                    </span>
                  </div>

                  {signInProfiles.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {signInProfiles.map((p) => (
                        <div
                          key={p.id}
                          className="p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all zen-bento-card"
                          style={{
                            background: p.isLatest ? 'rgba(99, 102, 241, 0.14)' : 'rgba(0,0,0,0.3)',
                            borderColor: p.isLatest ? effAccent : 'rgba(255,255,255,0.08)'
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold truncate text-white">
                                {p.browser.charAt(0).toUpperCase() + p.browser.slice(1)} — {p.name}
                              </span>
                              <span className="text-[11px] text-gray-400 truncate mt-0.5">
                                {p.isLatest ? 'Most recently active profile' : 'Active session detected'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {p.isLatest && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40 flex items-center gap-1 shadow-sm">
                                  <IconStar size={10} />
                                  <span>Latest</span>
                                </span>
                              )}
                              {p.hasGoogleAuth && !p.isLatest && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium border border-emerald-500/30">
                                  session found
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleSyncProfile(p.id, p.name)}
                              disabled={syncingProfileId === p.id || isSyncingAll}
                              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer text-white"
                              style={{ background: effAccent }}
                            >
                              {syncingProfileId === p.id ? (
                                <span>Syncing…</span>
                              ) : (
                                <>
                                  <IconShield size={12} />
                                  <span>Sync Profile</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border bg-black/20 border-white/5 text-xs text-gray-400">
                      Scanning Chrome, Brave, and Edge profile directories. If profiles are not detected, you can import cookies via Settings JSON import.
                    </div>
                  )}
                </div>

                {/* Quick Starter Tabs Selection */}
                <div className="flex flex-col gap-3 pt-2 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Choose Starter Tabs (Auto-Opens on Finish):</span>
                    <span className="text-[11px] font-mono text-gray-400">{selectedStarterModels.length} models selected</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {models.map((m) => {
                      const isSelected = selectedStarterModels.includes(m.key)
                      const mColor = m.color || modelColor(m.key)
                      return (
                        <button
                          key={m.key}
                          onClick={() => handleToggleStarterModel(m.key)}
                          className="p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-all cursor-pointer"
                          style={{
                            background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(0,0,0,0.3)',
                            borderColor: isSelected ? mColor : 'rgba(255, 255, 255, 0.08)',
                            boxShadow: isSelected ? `0 0 14px color-mix(in srgb, ${mColor} 30%, transparent)` : 'none'
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.08)' }}>
                              <BrandIcon id={m.key} size={16} style={{ color: mColor }} />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold text-xs text-white">{m.label}</span>
                              <span className="text-[10px] opacity-60 text-gray-400 truncate max-w-[130px]">{m.url}</span>
                            </div>
                          </div>

                          <div
                            className="w-5 h-5 rounded-md flex items-center justify-center border transition-colors shrink-0"
                            style={{
                              background: isSelected ? effAccent : 'transparent',
                              borderColor: isSelected ? effAccent : 'rgba(255,255,255,0.2)'
                            }}
                          >
                            {isSelected && <IconCheck size={12} style={{ color: '#fff' }} />}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ================= STEP 4: SUPERPOWERS & SUPERANTIGRAVITY SKILLS BENTO ================= */}
            {activeStep === 'powers' && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar flex flex-col gap-6 max-w-6xl mx-auto w-full">
                <div className="flex flex-col">
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    Nexus Flagship Superpowers & Skills
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Engineered to eliminate friction: autonomous reasoning frameworks, smart downloads, high-res captures, and instant omni-navigation.
                  </p>
                </div>

                {/* 6 Modern Bento Cards with Rich Micro-Diagrams */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Card 1: SuperAntigravity Skills Engine (Ctrl+S / Ctrl+Shift+S) */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <IconZap size={20} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <kbd className="zen-keycap">Ctrl</kbd>
                        <kbd className="zen-keycap">S</kbd>
                        <span className="text-[10px] text-gray-400 opacity-60">or</span>
                        <kbd className="zen-keycap">Ctrl</kbd>
                        <kbd className="zen-keycap">Shift</kbd>
                        <kbd className="zen-keycap">S</kbd>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">SuperAntigravity Skills Engine</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Instant invocation of specialist reasoning rules, security auditing frameworks, and custom prompt templates.
                      </p>
                    </div>
                    {/* Micro-Diagram: Skills Palette Preview */}
                    <div className="p-3 rounded-xl border bg-black/40 border-amber-500/20 flex flex-col gap-2 shadow-sm">
                      <div className="flex items-center justify-between text-[11px] font-mono text-amber-300">
                        <span>⚡ Skills Palette</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 font-bold">ACTIVE</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between p-1.5 rounded bg-white/5 text-[10px]">
                          <span className="font-semibold text-white">security-review</span>
                          <span className="text-[9px] text-emerald-400 font-mono">Top 1% Hunter</span>
                        </div>
                        <div className="flex items-center justify-between p-1.5 rounded bg-white/5 text-[10px]">
                          <span className="font-semibold text-white">deep-research</span>
                          <span className="text-[9px] text-cyan-400 font-mono">Multi-Source</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Smart Download Manager & In-Webview HUD Toasts */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                        <IconGlobe size={20} />
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase">
                        downloads/nexus
                      </span>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Smart Download Routing & HUD</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Automatic routing to dedicated folders with native in-webview glass notification toasts and instant file location opening.
                      </p>
                    </div>
                    {/* Micro-Diagram: Interactive Download Toast Simulation */}
                    <div className="p-3 rounded-xl border bg-black/50 border-cyan-500/30 flex flex-col gap-2 shadow-lg">
                      <div className="flex items-center justify-between text-[11px] text-white">
                        <span className="font-bold truncate max-w-[170px] text-cyan-200">{downloadDemoToast.message}</span>
                        <span className="text-[9px] text-emerald-400 font-mono">100%</span>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => setDownloadDemoToast({ visible: true, message: 'Opened Location ✓' })}
                          className="flex-1 py-1 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white transition-colors cursor-pointer text-center"
                        >
                          📂 Open Location
                        </button>
                        <button
                          type="button"
                          onClick={() => setDownloadDemoToast({ visible: true, message: 'File Opened ✓' })}
                          className="py-1 px-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-[10px] font-bold text-cyan-300 transition-colors cursor-pointer text-center"
                        >
                          ⚡ Open
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Universal Omni-Launcher (Ctrl+T) */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                        <IconPlus size={20} />
                      </div>
                      <div className="flex items-center gap-1">
                        <kbd className="zen-keycap">Ctrl</kbd>
                        <kbd className="zen-keycap">T</kbd>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Omni-Launcher & Search</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        1-click model switching, custom endpoint navigation, and fuzzy query matching from a single unified modal.
                      </p>
                    </div>
                    {/* Micro-Diagram: Omni Launcher Preview */}
                    <div className="p-2.5 rounded-xl border bg-black/40 border-white/10 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1">
                        {['gemini', 'claude', 'chatgpt', 'deepseek'].map((k) => (
                          <div key={k} className="flex-1 py-1 rounded bg-white/5 border border-white/10 flex items-center justify-center">
                            <BrandIcon id={k} size={12} style={{ color: modelColor(k) }} />
                          </div>
                        ))}
                      </div>
                      <div className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[10px] text-gray-400 font-mono flex items-center justify-between">
                        <span>https://claude.ai/new</span>
                        <kbd className="text-[9px] px-1 rounded bg-white/10 text-white">↵</kbd>
                      </div>
                    </div>
                  </div>

                  {/* Card 4: High-Resolution AI Webview Capture & Memory */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500/15 text-purple-400 border border-purple-500/30">
                        <IconMonitor size={20} />
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 uppercase">
                        High-Res 1080p
                      </span>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Crisp Captures & Provider Memory</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Full-resolution viewport snapshots and persistent provider focus memory upon re-opening settings.
                      </p>
                    </div>
                    {/* Micro-Diagram: High-Res Viewport */}
                    <div className="p-2.5 rounded-xl border bg-black/40 border-purple-500/25 flex items-center justify-between text-[11px] font-mono text-purple-200">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span>Last Focused: Claude</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20">Saved</span>
                    </div>
                  </div>

                  {/* Card 5: Pinned Chats & Sticky Sidebar (Alt+P) */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <IconPin size={20} />
                      </div>
                      <div className="flex items-center gap-1">
                        <kbd className="zen-keycap">Alt</kbd>
                        <kbd className="zen-keycap">P</kbd>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Chat Pinning & Persistent Sidebar</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Lock critical reference prompts and active research sessions safely in memory with zero accidental tab discards.
                      </p>
                    </div>
                    {/* Micro-Diagram: Pinned Item */}
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-white">
                      <div className="flex items-center gap-2">
                        <BrandIcon id="claude" size={14} style={{ color: '#d97706' }} />
                        <span className="font-semibold text-[11px]">System Architecture & Auth</span>
                      </div>
                      <IconPin size={12} className="text-amber-400" />
                    </div>
                  </div>

                  {/* Card 7: Visual Tab Overview (Ctrl+Shift+A) */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                          <line x1="8" x2="22" y1="21" y2="21"/>
                          <line x1="12" x2="12" y1="17" y2="21"/>
                        </svg>
                      </div>
                      <div className="flex items-center gap-1">
                        <kbd className="zen-keycap">Ctrl</kbd>
                        <kbd className="zen-keycap">Shift</kbd>
                        <kbd className="zen-keycap">A</kbd>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Visual Tab Overview</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Fuzzy search, preview thumbnails, and manage all your active chat tabs from a beautiful birds-eye overlay.
                      </p>
                    </div>
                    {/* Micro-Diagram: Tab Search Widget */}
                    <div className="p-2 rounded-xl border bg-black/40 border-white/10 flex flex-col gap-1">
                      <div className="flex items-center gap-2 p-1 rounded bg-white/5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span className="text-[10px] text-white">Quantum state</span>
                      </div>
                      <div className="flex items-center gap-2 p-1 rounded bg-fuchsia-500/20 border border-fuchsia-500/50 shadow-md">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-[10px] text-white font-bold">Async pipeline</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 6: Unified Multi-Provider History (Ctrl+H) */}
                  <div className="p-5 rounded-2xl zen-bento-card flex flex-col justify-between gap-3 border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        <IconHistory size={20} />
                      </div>
                      <div className="flex items-center gap-1">
                        <kbd className="zen-keycap">Ctrl</kbd>
                        <kbd className="zen-keycap">H</kbd>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white mb-1">Unified Multi-Model History</h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Instant fuzzy search across chat transcripts from Gemini, Claude, ChatGPT, and DeepSeek in one universal index.
                      </p>
                    </div>
                    {/* Micro-Diagram: History Search Widget */}
                    <div className="p-2 rounded-xl border bg-black/40 border-white/10 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] p-1 rounded bg-white/5">
                        <span className="truncate max-w-[140px] text-white">Quantum state entanglement</span>
                        <span className="text-[9px] font-mono text-cyan-400">Gemini</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] p-1 rounded bg-white/5">
                        <span className="truncate max-w-[140px] text-white">Async Tokio pipeline</span>
                        <span className="text-[9px] font-mono text-amber-400">Claude</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= STEP 5: TACTILE SHORTCUTS MATRIX ================= */}
            {activeStep === 'shortcuts' && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar flex flex-col gap-5 max-w-6xl mx-auto w-full">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    Tactile Keyboard Shortcuts Matrix
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Designed for ultra-fluid keyboard-driven navigation. Filter, search, and click any shortcut below to customize its key combination.
                  </p>
                </div>

                <ShortcutsMatrix />
              </div>
            )}
          </div>

          {/* Bottom Action & Footer Bar */}
          <div
            className="p-4 sm:p-5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0"
            style={{ borderColor: 'rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.4)' }}
          >
            {/* Don't show again checkbox */}
            <label className="flex items-center gap-2 text-xs text-gray-400 hover:text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="accent-(--accent)"
              />
              <span>Don&apos;t show this guide automatically on launch</span>
            </label>

            {/* Step Navigation Buttons */}
            <div className="flex items-center gap-2.5 ml-auto">
              {activeStep !== 'welcome' && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeStep === 'style') setActiveStep('welcome')
                    else if (activeStep === 'providers') setActiveStep('style')
                    else if (activeStep === 'powers') setActiveStep('providers')
                    else if (activeStep === 'shortcuts') setActiveStep('powers')
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border text-gray-300 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                >
                  ← Back
                </button>
              )}

              {activeStep !== 'shortcuts' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeStep === 'welcome') setActiveStep('style')
                    else if (activeStep === 'style') setActiveStep('providers')
                    else if (activeStep === 'providers') setActiveStep('powers')
                    else if (activeStep === 'powers') setActiveStep('shortcuts')
                  }}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:opacity-90 shadow-md cursor-pointer text-white"
                  style={{ background: effAccent }}
                >
                  <span>Next Step →</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinish}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-transform hover:scale-105 shadow-xl cursor-pointer text-white"
                  style={{
                    background: `linear-gradient(135deg, ${effAccent} 0%, ${effSecondaryGlow} 100%)`,
                    boxShadow: `0 4px 20px color-mix(in srgb, ${effAccent} 50%, transparent)`
                  }}
                >
                  <IconZap size={14} />
                  <span>Finish & Launch Nexus</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </IconConfigProvider>
  )
}
