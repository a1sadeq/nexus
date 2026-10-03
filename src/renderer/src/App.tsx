import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  serializeState,
  deserializeState,
  switchToModel,
  addNewChat,
  openHistoryTab,
  createTab,
  countModelUsage,
  isProviderHomeUrl
} from './lib/tabs'
import { getShortcutKeys, getShortcutMap, onShortcutsChanged } from './lib/shortcuts'
import type { Tab, HistoryItem, ModelKey } from './lib/tabs'
import ModelNotch from './components/ModelNotch'
import ChatTabs from './components/ChatTabs'
import { BRAND_IDS, modelLabel, modelColor } from './lib/modelVisuals'
import { BrandIcon } from './components/BrandIcons'
import { pushClosedTab, reopenClosedTab, type ClosedTabEntry } from './lib/tabs'
import type { SkillDef } from '../../shared/skills'
import { BaseSkillsModal } from './components/BaseSkillsModal'
import { SkillsPaletteModal } from './components/SkillsPaletteModal'
import { CategoryManagerModal } from './components/CategoryManagerModal'
import { SkillParameterModal } from './components/SkillParameterModal'
import { SkillEditorModal } from './components/SkillEditorModal'
import HistoryOverlay from './components/HistoryOverlay'
import TabOverviewOverlay from './components/TabOverviewOverlay'
import NewTabOverlay from './components/NewTabOverlay'
import { ExportOverlay } from './components/ExportOverlay'

import SettingsOverlay from './components/SettingsOverlay'
import { loadThemeState, saveThemeState, applyTheme, findTheme } from './lib/themes'
import {
  loadInterfaceSettings,
  saveInterfaceSettings,
  applyInterfaceCssVariables,
  computeSurfaceColors,
  adjustAccentContrast,
  type InterfaceSettings
} from './lib/interfaceSettings'
import type { ProviderConfigMap } from '../../shared/providerConfig'
import UrlBarModal from './components/UrlBarModal'
import { JarvisBootOverlay } from './components/JarvisBootOverlay'
import { ZenGuideModal } from './components/ZenGuideModal'
import { HudStatusHeader } from './components/HudStatusHeader'
import { FolderUploadModal } from './components/FolderUploadModal'
import type { FolderScanResult } from '../../shared/folderUpload'
import './App.css'

export interface ModelDef {
  key: string
  label: string
  url: string
  icon?: string
  /** Custom provider color — overrides brand DOT_COLOR when set. */
  color?: string
  /** Custom provider description or model details. */
  desc?: string
}

const DEFAULT_MODELS: ModelDef[] = [
  {
    key: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>'
  },
  {
    key: 'qwen',
    label: 'Qwen',
    url: 'https://chat.qwen.ai',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>'
  },
  {
    key: 'kimi',
    label: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>'
  }
]

const TABS_STORAGE_KEY = 'vicinae.tabs'

function App() {
  const [models, setModels] = useState<ModelDef[]>(() => {
    try {
      const saved = localStorage.getItem('vicinae.models')
      return saved ? JSON.parse(saved) : DEFAULT_MODELS
    } catch {
      return DEFAULT_MODELS
    }
  })
  useEffect(() => {
    localStorage.setItem('vicinae.models', JSON.stringify(models))
  }, [models])

  const [initialTabs] = useState(() => {
    const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
    if (restored && restored.tabs.length > 0) return restored
    const initial = createTab('gemini', 'New Chat', 'https://gemini.google.com')
    return { tabs: [initial], activeId: initial.id }
  })
  const [tabs, setTabs] = useState<Tab[]>(initialTabs.tabs)
  const [activeId, setActiveId] = useState<string | null>(initialTabs.activeId)

  // MRU State
  const [mruTabIds, setMruTabIds] = useState<string[]>(initialTabs.tabs.map(t => t.id))
  useEffect(() => {
    if (activeId) {
      setMruTabIds(prev => {
        const filtered = prev.filter(id => id !== activeId)
        return [activeId, ...filtered]
      })
    }
  }, [activeId])

  const mruRef = useRef(mruTabIds)
  const tabsRef = useRef(tabs)
  
  useEffect(() => { mruRef.current = mruTabIds }, [mruTabIds])
  useEffect(() => { tabsRef.current = tabs }, [tabs])

  const activeTab = tabs.find((t) => t.id === activeId)
  

  const [showHistory, setShowHistory] = useState(false)
  const [showTabOverview, setShowTabOverview] = useState(false)
  
  const [showNewTab, setShowNewTab] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showUrlBar, setShowUrlBar] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [folderUploadData, setFolderUploadData] = useState<FolderScanResult | null>(null)
  const [showBootSequence, setShowBootSequence] = useState(true)
  const [uiZoom, setUiZoom] = useState(() => {
    const saved = localStorage.getItem('vicinae.uiZoom')
    return saved ? parseFloat(saved) : 1.0
  })
  const [webviewZoom, setWebviewZoom] = useState(() => {
    const saved = localStorage.getItem('vicinae.webviewZoom')
    return saved ? parseFloat(saved) : 1.0
  })

  // Apply zooms whenever they change
  useEffect(() => {
    localStorage.setItem('vicinae.uiZoom', String(uiZoom))
    // @ts-ignore
    window.electron?.zoom?.setUiZoom(uiZoom)
  }, [uiZoom])

  useEffect(() => {
    localStorage.setItem('vicinae.webviewZoom', String(webviewZoom))
    // @ts-ignore
    window.electron?.zoom?.setWebviewZoom(webviewZoom)
  }, [webviewZoom])

  const [tabDiscardMinutes, setTabDiscardMinutes] = useState(10)
  const [maxActiveTabs, setMaxActiveTabs] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(loadInterfaceSettings)

  // Apply interface CSS variables immediately on startup and whenever interfaceSettings changes
  useEffect(() => {
    applyInterfaceCssVariables(interfaceSettings)
  }, [interfaceSettings])

  const [themeState, setThemeState] = useState(loadThemeState)
  useEffect(() => {
    applyTheme(findTheme(themeState))
  }, [themeState.activeId, themeState.customs])
  useEffect(() => {
    saveThemeState(themeState)
  }, [themeState])

  // Webview theme: persisted toggle; re-sent to main whenever theme or interface settings change
  const [webviewThemeOn, setWebviewThemeOn] = useState(
    () => localStorage.getItem('vicinae.webviewThemeOn') === '1'
  )
  useEffect(() => {
    localStorage.setItem('vicinae.webviewThemeOn', webviewThemeOn ? '1' : '0')
    const activeColors = findTheme(themeState).colors
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
      radius: interfaceSettings.cornerRadius ?? findTheme(themeState).radius,
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
  }, [webviewThemeOn, themeState.activeId, themeState.customs, interfaceSettings])

  // Per-provider webview overrides: loaded from main (single source of truth),
  // pushed back on change. Guarded so the first invoke resolution never wipes
  // providers.json with an empty object.
  const [providerConfig, setProviderConfig] = useState<ProviderConfigMap>({})
  const [providerConfigLoaded, setProviderConfigLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.electron?.ipcRenderer.invoke('get_provider_config').then((map: ProviderConfigMap) => {
      if (!cancelled) {
        setProviderConfig(map || {})
        setProviderConfigLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!providerConfigLoaded) return
    window.electron?.ipcRenderer.send('set_provider_config', providerConfig)
  }, [providerConfig, providerConfigLoaded])

  const usageCounts = useMemo(() => countModelUsage(tabs, history), [tabs, history])

  const modelColors = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of models) map[m.key] = m.color || modelColor(m.key)
    return map
  }, [models])
  const colorFor = (key: string) => modelColors[key] || modelColor(key)

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id))
  }
  
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const captureActiveSnapshot = useCallback(
    async (targetId?: string) => {
      const id = targetId ?? activeId
      if (!id || !window.electron?.ipcRenderer) return null
      try {
        // @ts-ignore
        const snap = await window.electron.ipcRenderer.invoke('capture_tab_snapshot', id)
        if (!snap) return null
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, thumbnail: snap } : t)))
        setHistory((prev) => {
          const tab = tabs.find((t) => t.id === id)
          const updated = prev.map((h) =>
            h.id === id || (tab && h.url === tab.url) ? { ...h, thumbnail: snap } : h
          )
          // @ts-ignore
          window.electron?.ipcRenderer
            .invoke('save_history', JSON.stringify(updated))
            .catch(() => {})
          return updated
        })
        return snap
      } catch (e) {
        console.error('Failed to capture snapshot:', e)
        return null
      }
    },
    [activeId, tabs]
  )

  const scheduleSnapshotCapture = useCallback(
    (id: string, delay = 1500) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = setTimeout(() => {
        captureActiveSnapshot(id)
      }, delay)
    },
    [captureActiveSnapshot]
  )

  useEffect(() => {
    // @ts-ignore
    

    // @ts-ignore
    window.electron?.ipcRenderer
      .invoke('list_history')
      .then((data: HistoryItem[]) => {
        if (Array.isArray(data)) setHistory(data)
        setHistoryLoaded(true)
      })
      .catch((e: Error) => console.error('Failed to load history:', e))
  }, [])

  const [focusMode, setFocusMode] = useState(false)
  const [_closedTabsStack, setClosedTabsStack] = useState<ClosedTabEntry[]>([])
  
  // -- SKILLS STATE --
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [showBaseSkillsModal, setShowBaseSkillsModal] = useState(false)
  const [showSkillsPalette, setShowSkillsPalette] = useState(false)
  const [showSkillParamsModal, setShowSkillParamsModal] = useState(false)
  const [selectedSkillForParams, setSelectedSkillForParams] = useState<SkillDef | null>(null)
  const [showSkillEditorModal, setShowSkillEditorModal] = useState(false)
  const [showCategoryManagerModal, setShowCategoryManagerModal] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillDef | null>(null)

  const refreshSkills = useCallback(() => {
    if (window.electron?.skills) {
      window.electron.skills.list().then((list: SkillDef[]) => {
        if (Array.isArray(list)) setSkills(list)
      }).catch((e: Error) => console.error('Failed to load skills:', e))
    }
  }, [])

  useEffect(() => {
    refreshSkills()
    const unsubscribe = window.electron?.skills?.onUpdated?.(() => {
      refreshSkills()
    })
    return () => { if (unsubscribe) unsubscribe() }
  }, [refreshSkills])

  useEffect(() => {
    if (showBaseSkillsModal || showSkillsPalette || showSkillParamsModal || showSkillEditorModal) {
      // @ts-ignore
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
    }
  }, [showBaseSkillsModal, showSkillsPalette, showSkillParamsModal, showSkillEditorModal])

  const handleSelectSkillFromPalette = useCallback(
    async (skill: SkillDef) => {
      setShowSkillsPalette(false)
      if (skill.variables && skill.variables.length > 0) {
        setSelectedSkillForParams(skill)
        setShowSkillParamsModal(true)
      } else {
        restoreViewBounds()
        if (activeId) {
          setTimeout(async () => {
            // Explicitly set autoSend to false when injected from Ctrl+S directly without params modal
            const autoSend = false
            // @ts-ignore
            await window.electron?.skills?.injectPrompt(activeId, skill.content, autoSend)
            window.electron?.skills?.incrementUsage(skill.id).catch(()=>{})
          }, 100)
        }
      }
    },
    [activeId]
  )

  const handleInjectBaseSkills = useCallback(
    async (selectedSkills: SkillDef[]) => {
      setShowBaseSkillsModal(false)
      restoreViewBounds()
      const skillSections = selectedSkills
        .map(
          (s) =>
            `### ${s.name} (${s.id})\n**Description:** ${s.description}\n**Prompt Directives:**\n${s.content}`
        )
        .join('\n\n')

      const prompt = `You are operating with the following active SuperAntigravity specialist skills.
These skills define your core thinking protocols, checklists, and reasoning rules throughout this entire conversation.
=== ACTIVE SKILLS ===
${skillSections}
Acknowledge these skills with a concise confirmation in this exact format:
"⚡ SuperAntigravity Skills Activated: ${selectedSkills.map((s) => s.name).join(', ')}. Ready for your prompt."`

      if (activeId) {
        setTimeout(async () => {
          // @ts-ignore
          await window.electron?.skills?.injectPrompt(activeId, prompt, true)
          for (const s of selectedSkills) {
            window.electron?.skills?.incrementUsage(s.id).catch(()=>{})
          }
        }, 100)
      }
    },
    [activeId]
  )

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('vicinae.pinned')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vicinae.sidebarCollapsed') === 'true'
    } catch {
      return false
    }
  })

  const [loadingTabId, setLoadingTabId] = useState<string | null>(null)

  // Live per-tab title/URL/loading updates from the main process
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return

    
    const checkIsDefaultTitle = (t: string, m: string) => {
      if (!t) return true;
      const tl = t.toLowerCase().trim();
      const ml = m.toLowerCase().trim();
      return tl === 'new chat' || tl === 'untitled' || tl.startsWith('new chat') || 
             tl === ml || tl === ml + ' chat' || tl.startsWith(ml + ' -') || tl.startsWith(ml + ' |') ||
             tl === 'chatgpt' || tl.startsWith('chatgpt -') ||
             tl === 'qwen' || tl.startsWith('qwen -') || tl === 'tongyi qianwen' ||
             tl === 'claude' || tl.startsWith('claude -') ||
             tl === 'google gemini' || tl.startsWith('google gemini -') ||
             tl === 'kimi ai' || tl === 'kimi' || tl.startsWith('kimi -') ||
             tl === 'qwen studio' || tl.startsWith('qwen studio -') ||
             tl.startsWith('http://') || tl.startsWith('https://') || tl === 'loading' || tl === 'loading...';
    };

    const onTitle = (_e: unknown, tabId: string, title: string) => {
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.id === tabId)
        if (!existingTab) return prev;
        
        const incomingIsDefault = checkIsDefaultTitle(title, existingTab.model);
        const currentIsDefault = checkIsDefaultTitle(existingTab.title, existingTab.model);
        
        // Don't overwrite a good title with a trash/default title during loads!
        if (incomingIsDefault && !currentIsDefault) {
          return prev;
        }

        const nextTabs = prev.map((t) => (t.id === tabId && title ? { ...t, title } : t))
        const updatedTab = nextTabs.find((t) => t.id === tabId)

        if (
          updatedTab &&
          updatedTab.url &&
          updatedTab.url.length > 3 &&
          !updatedTab.url.endsWith('.com/') &&
          !updatedTab.url.endsWith('.ai/')
        ) {
          setHistory((prevHistory) => {
            if (incomingIsDefault) return prevHistory; // Never save trash to history, keep existing

            const existingItem = prevHistory.find(
              (h) => h.url === updatedTab.url || h.id === updatedTab.id
            )
            const updatedHistory = prevHistory.filter(
              (h) => h.url !== updatedTab.url && h.title !== title
            )

            const newHistoryItem = {
              id: updatedTab.id,
              title,
              url: updatedTab.url,
              model: updatedTab.model,
              thumbnail: existingItem?.thumbnail,
              timestamp: Date.now(),
              updatedAt: new Date().toISOString()
            }
            const finalHistory = [newHistoryItem, ...updatedHistory].slice(0, 100)
            window.electron?.ipcRenderer.invoke('save_history', JSON.stringify(finalHistory)).catch(() => {})
            return finalHistory
          })
        }
        return nextTabs
      })
    }

    const onUrl = (_e: unknown, tabId: string, url: string) => {
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId)
        if (
          existing &&
          isProviderHomeUrl(url) &&
          existing.url &&
          !isProviderHomeUrl(existing.url)
        ) {
          return prev
        }
        const nextTabs = prev.map((t) => (t.id === tabId && url ? { ...t, url } : t))
        const updatedTab = nextTabs.find((t) => t.id === tabId)

        if (
          updatedTab &&
          updatedTab.url &&
          updatedTab.url.length > 3 &&
          !updatedTab.url.endsWith('.com/') &&
          !updatedTab.url.endsWith('.ai/')
        ) {
          setHistory((prevHistory) => {
            const title = updatedTab.title || updatedTab.model.toUpperCase()
            const isDefaultTitle = checkIsDefaultTitle(title, updatedTab.model);

            if (isDefaultTitle) return prevHistory; // Do not corrupt history with trash!

            const existingItem = prevHistory.find(
              (h) => h.url === updatedTab.url || h.id === updatedTab.id
            )
            const updatedHistory = prevHistory.filter(
              (h) => h.url !== updatedTab.url && h.title !== title
            )

            const newHistoryItem = {
              id: updatedTab.id,
              title,
              url: updatedTab.url,
              model: updatedTab.model,
              thumbnail: existingItem?.thumbnail,
              timestamp: Date.now(),
              updatedAt: new Date().toISOString()
            }
            const finalHistory = [newHistoryItem, ...updatedHistory].slice(0, 100)
            window.electron?.ipcRenderer.invoke('save_history', JSON.stringify(finalHistory)).catch(() => {})
            return finalHistory
          })
        }
        return nextTabs
      })
    }
  const onLoading = (_e: unknown, tabId: string, loading: boolean) => {
      setLoadingTabId(loading ? tabId : null)
    }

    ipc.on('ai-title-updated', onTitle)
    ipc.on('ai-url-updated', onUrl)
    ipc.on('ai-loading', onLoading)
    return () => {
      ipc.removeListener('ai-title-updated', onTitle)
      ipc.removeListener('ai-url-updated', onUrl)
      ipc.removeListener('ai-loading', onLoading)
    }
  }, [])


  const closeTab = (idToClose: string) => {
    const targetTab = tabs.find(t => t.id === idToClose)
    if (targetTab) {
      const index = tabs.findIndex(t => t.id === idToClose)
      const isPinned = pinnedIds.includes(idToClose)
      setClosedTabsStack(prev => pushClosedTab(prev, targetTab, index, isPinned))
    }
    
    const updated = tabs.filter((t) => t.id !== idToClose)
    setTabs(updated)
    // @ts-ignore
    window.electron?.ipcRenderer.send('destroy_tab_view', idToClose)
    
    if (activeId === idToClose) {
      // Find MRU neighbor
      const remainingMru = mruTabIds.filter(id => id !== idToClose)
      let nextActiveId: string | null = null
      for (const mruId of remainingMru) {
        if (updated.some(t => t.id === mruId)) {
          nextActiveId = mruId
          break
        }
      }
      
      if (nextActiveId) {
        const nextTab = updated.find(t => t.id === nextActiveId)
        if (nextTab?.url) {
          switchToTab(nextTab.id, nextTab.url)
        }
      } else {
        const neighbor = updated.length > 0 ? updated[updated.length - 1] : null
        if (neighbor?.url) {
          switchToTab(neighbor.id, neighbor.url)
        } else {
          setActiveId(null)
        }
      }
    }
  }

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
      localStorage.setItem('vicinae.pinned', JSON.stringify(updated))
      return updated
    })
  }

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('vicinae.sidebarCollapsed', String(next))
      } catch (e) {
        console.error(e)
      }
      return next
    })
  }

  const containerRef = useRef<HTMLDivElement>(null)

  const containerBounds = () => {
    if (showBootSequence) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }

  const switchToTab = useCallback(
    (id: string, url: string) => {
      setActiveId(id)
      const bounds = containerBounds() || { x: 0, y: 0, width: 0, height: 0 }
      if (url) {
        const modelKey = tabs.find((t) => t.id === id)?.model
        // @ts-ignore
        window.electron?.ipcRenderer.send('activate_tab', id, url, bounds, modelKey)
      }
      scheduleSnapshotCapture(id)
    },
    [scheduleSnapshotCapture, tabs]
  )

  const loadTabUrl = useCallback(
    (id: string, url: string) => {
      setActiveId(id)
      const bounds = containerBounds() || { x: 0, y: 0, width: 0, height: 0 }
      if (url) {
        const modelKey = tabs.find((t) => t.id === id)?.model
        // @ts-ignore
        window.electron?.ipcRenderer.send('navigate_to_url', id, url, bounds, modelKey)
        // Ensure the newly loaded tab is visually targeted
        // @ts-ignore
        window.electron?.ipcRenderer.send('activate_tab', id, url, bounds, modelKey)
      }
    },
    [tabs]
  )

  const switchToTabRef = useRef(switchToTab)
  const togglePinRef = useRef(togglePin)
  useEffect(() => { switchToTabRef.current = switchToTab }, [switchToTab])
  useEffect(() => { togglePinRef.current = togglePin }, [togglePin])

  useEffect(() => {
    const handleTabCycleIPC = (_event: any, data: { shift: boolean }) => {
      const currentMru = mruRef.current.filter((id) => tabsRef.current.some((t) => t.id === id && t.url))
      const len = currentMru.length
      if (len <= 1) return

      const targetIdx = data.shift ? len - 1 : 1
      const targetId = currentMru[targetIdx]
      const targetTab = tabsRef.current.find((t) => t.id === targetId)

      if (targetTab && targetTab.url) {
        switchToTabRef.current(targetTab.id, targetTab.url)
      }
    }

    const handleTogglePinTab = (_event: any, tabId: string) => {
      togglePinRef.current(tabId)
    }

    // @ts-ignore
    const unsubCycle = window.electron?.ipcRenderer.on('trigger_tab_cycle', handleTabCycleIPC)
    // @ts-ignore
    const unsubPin = window.electron?.ipcRenderer.on('toggle_pin_tab', handleTogglePinTab)

    return () => {
      if (typeof unsubCycle === 'function') unsubCycle()
      if (typeof unsubPin === 'function') unsubPin()
    }
  }, [])

  const getActiveModel = (): ModelKey => {
    return tabs.find((t) => t.id === activeId)?.model || models[0]?.key || 'gemini'
  }

  const getModelUrl = (model: ModelKey): string => {
    return models.find((m) => m.key === model)?.url || 'https://gemini.google.com'
  }

  const handleNewChat = () => {
    const model = getActiveModel()
    const url = getModelUrl(model)
    const result = addNewChat(tabs, model, url)
    setTabs(result.tabs)
    loadTabUrl(result.activeId, url)
  }

  const handleDeployModel = (model: ModelKey) => {
    const url = getModelUrl(model)
    const existingUnused = tabs.find((t) => t.model === model && t.title === model.toUpperCase())
    if (existingUnused) {
      switchToTab(existingUnused.id, existingUnused.url)
    } else {
      const result = switchToModel(tabs, model, model.toUpperCase(), url)
      setTabs(result.tabs)
      loadTabUrl(result.activeId, url)
    }
  }

  const handleHistoryOverlaySelect = (item: HistoryItem) => {
    const result = openHistoryTab(tabs, item)
    setTabs(result.tabs)
    setShowHistory(false)
    const existing = tabs.find((t) => t.url === item.url)
    if (existing) {
      switchToTab(existing.id, existing.url)
    } else {
      loadTabUrl(result.activeId, item.url)
    }
  }

  // Restore the native webview bounds + focus (used when an overlay closes via Escape)
  const restoreViewBounds = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect && window.electron) {
      // @ts-ignore
      window.electron.ipcRenderer.send('resize_view', {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }
  }

  // Activate the persisted active tab on mount (creates its view)
  // Startup rehydrate: repair tab urls that regressed to provider home (Bug A)
  // using history chat entries, then activate the active tab.
  useEffect(() => {
    if (!historyLoaded) return
    if (!activeId) return

    setTabs((prev) => {
      let changed = false
      const next = prev.map((t) => {
        if (!isProviderHomeUrl(t.url)) return t
        const chat = history.find(
          (h) => (h.id === t.id || h.url === t.url) && h.url && !isProviderHomeUrl(h.url)
        )
        if (!chat) return t
        changed = true
        return { ...t, url: chat.url, title: chat.title || t.title }
      })
      return changed ? next : prev
    })

    const tab = tabs.find((t) => t.id === activeId)
    if (tab?.url) {
      const chat = isProviderHomeUrl(tab.url)
        ? history.find(
            (h) => (h.id === tab.id || h.url === tab.url) && h.url && !isProviderHomeUrl(h.url)
          )
        : undefined
      switchToTab(tab.id, chat?.url || tab.url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded])


  const handleUrlBarNavigate = useCallback(
    (newUrl: string, detectedModel?: string, inNewTab?: boolean) => {
      const modelToUse = (detectedModel) || 'gemini'
      if (inNewTab) {
        const result = addNewChat(tabs, modelToUse, newUrl)
        setTabs(result.tabs)
        loadTabUrl(result.activeId, newUrl)
        restoreViewBounds()
        return
      }
      if (!activeId) return
      const currentTab = tabs.find((t) => t.id === activeId)
      if (!currentTab) return
      const targetModel = (detectedModel) || currentTab.model
      const updated = tabs.map((t) =>
        t.id === activeId ? { ...t, url: newUrl, model: targetModel } : t
      )
      setTabs(updated)
      // @ts-ignore
      window.electron?.ipcRenderer?.send?.('navigate_tab', activeId, newUrl, targetModel)
      restoreViewBounds()
    },
    [activeId, tabs, handleNewChat, restoreViewBounds]
  )

  const handleUrlBarCommand = useCallback(
    (cmdId: string) => {
      setShowUrlBar(false)
      switch (cmdId) {
        case 'settings':
          setShowHistory(false)
          setShowNewTab(false)
          setShowExport(false)
          setShowSettings(true)
          // @ts-ignore
          window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
          break
        case 'skills':
          refreshSkills()
          setShowSkillsPalette(true)
          // @ts-ignore
          window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
          break
        case 'history':
          captureActiveSnapshot().then(() => {
            // @ts-ignore
            window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
            setShowHistory(true)
          })
          break
        case 'new_tab':
          captureActiveSnapshot().then(() => {
            // @ts-ignore
            window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
            setShowNewTab(true)
          })
          break
        case 'focus_mode':
          setFocusMode((f) => {
            const next = !f
            // @ts-ignore
            window.electron?.ipcRenderer.send('toggle_focus_mode', next)
            return next
          })
          restoreViewBounds()
          break
        case 'reload':
          if (activeId) {
            // @ts-ignore
            window.electron?.ipcRenderer.send('reload_active_tab')
          }
          restoreViewBounds()
          break
        default:
          restoreViewBounds()
          break
      }
    },
    [activeId, captureActiveSnapshot, refreshSkills, restoreViewBounds]
  )

  // Overlay state → main. While any fullscreen overlay is open the main
  // process stops intercepting shortcuts so the overlay keeps its own keys
  // (arrows, Ctrl+J/K navigation, Ctrl+H/L cycling, Escape) working.
  useEffect(() => {
    const anyOverlayOpen =
      showHistory ||
      showTabOverview ||
      showSettings ||
      showNewTab ||
      showExport ||
      showUrlBar ||
      showGuide ||
      showSkillsPalette ||
      showBaseSkillsModal ||
      showSkillParamsModal ||
      showSkillEditorModal ||
      showCategoryManagerModal ||
      showBootSequence ||
      Boolean(folderUploadData)
    // @ts-ignore
    window.electron?.ipcRenderer.send('set_overlays_open', Boolean(anyOverlayOpen))
  }, [
    showHistory,
    showTabOverview,
    showSettings,
    showNewTab,
    showExport,
    showUrlBar,
    showGuide,
    showSkillsPalette,
    showBaseSkillsModal,
    showSkillParamsModal,
    showSkillEditorModal,
    showCategoryManagerModal,
    showBootSequence,
    folderUploadData
  ])

  // Effective keymap → main, so its keyboard router honors user customizations
  // made in Settings → Shortcuts.
  useEffect(() => {
    const push = () => {
      // @ts-ignore
      window.electron?.ipcRenderer.send('set_shortcut_map', getShortcutMap())
    }
    push()
    return onShortcutsChanged(push)
  }, [])

  const handleExecuteGlobalActionRef = useRef<((event: any, data: any) => void) | null>(null)

  // Unified Global Shortcut Dispatcher: Receives direct IPC actions from main process
  // Bypasses DOM focus state, Chromium Views FocusManager bugs, and works 100% reliably everywhere.
  // Main only routes keys while NO fullscreen overlay is open, and this dispatcher keeps
  // overlays exclusive: opening one closes the others so they never stack.
  useEffect(() => {
    const hideNativeView = () => {
      // @ts-ignore
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
    }

    const openExclusive = (open: () => void, close: () => void, isOpenNow: boolean) => {
      if (isOpenNow) {
        close()
        restoreViewBounds()
        return
      }
      setShowHistory(false)
      setShowTabOverview(false)
      setShowSettings(false)
      setShowNewTab(false)
      setShowExport(false)
      setShowUrlBar(false)
      setShowGuide(false)
      setShowSkillsPalette(false)
      setShowBaseSkillsModal(false)
      setShowSkillParamsModal(false)
      setShowSkillEditorModal(false)
      setShowCategoryManagerModal(false)
      setFolderUploadData(null)
      open()
      hideNativeView()
    }

    const handleExecuteGlobalAction = (_event: any, data: any) => {
      if (!data || !data.action) return
      const action = data.action

      switch (action) {
        case 'toggle_settings':
          openExclusive(() => setShowSettings(true), () => setShowSettings(false), showSettings)
          break
        case 'close_overlay': {
          let closedAny = false
          if (showSettings) { setShowSettings(false); closedAny = true }
          if (showHistory) { setShowHistory(false); closedAny = true }
          if (showTabOverview) { setShowTabOverview(false); closedAny = true }
          if (showNewTab) { setShowNewTab(false); closedAny = true }
          if (showExport) { setShowExport(false); closedAny = true }
          if (showUrlBar) { setShowUrlBar(false); closedAny = true }
          if (showGuide) { setShowGuide(false); closedAny = true }
          if (showSkillsPalette) { setShowSkillsPalette(false); closedAny = true }
          if (showBaseSkillsModal) { setShowBaseSkillsModal(false); closedAny = true }
          if (showSkillParamsModal) { setShowSkillParamsModal(false); closedAny = true }
          if (showSkillEditorModal) { setShowSkillEditorModal(false); closedAny = true }
          if (showCategoryManagerModal) { setShowCategoryManagerModal(false); closedAny = true }
          if (folderUploadData) { setFolderUploadData(null); closedAny = true }
          if (closedAny) {
            restoreViewBounds()
          }
          break
        }
        case 'new_tab':
          openExclusive(
            () => {
              setShowNewTab(true)
              captureActiveSnapshot().catch(() => {})
            },
            () => setShowNewTab(false),
            showNewTab
          )
          break
        case 'reopen_tab': {
          setClosedTabsStack((currentStack) => {
            if (currentStack.length === 0) return currentStack
            const { tabs: nextTabs, activeId: nextId, restoredEntry, nextStack } = reopenClosedTab(tabs, currentStack)
            if (restoredEntry) {
              setTabs(nextTabs)
              if (restoredEntry.isPinned && !pinnedIds.includes(restoredEntry.tab.id)) {
                togglePin(restoredEntry.tab.id)
              }
              if (nextId && restoredEntry.tab.url) {
                // @ts-ignore
                window.electron?.ipcRenderer.send('restore_tab_view', restoredEntry.tab.id, restoredEntry.tab.url, containerBounds() || { x: 0, y: 0, width: 0, height: 0 })
                switchToTab(nextId, restoredEntry.tab.url)
              }
            }
            return nextStack
          })
          break
        }
        case 'close_tab': {
          if (activeId) {
            closeTab(activeId)
          }
          break
        }
        case 'toggle_history':
          openExclusive(
            () => {
              setShowHistory(true)
              captureActiveSnapshot().catch(() => {})
            },
            () => setShowHistory(false),
            showHistory
          )
          break
        case 'toggle_tab_overview':
          openExclusive(
            () => {
              setShowTabOverview(true)
              captureActiveSnapshot().catch(() => {})
            },
            () => setShowTabOverview(false),
            showTabOverview
          )
          break
        case 'toggle_sidebar': {
          setSidebarCollapsed((s) => {
            const next = !s
            localStorage.setItem('vicinae.sidebarCollapsed', String(next))
            return next
          })
          break
        }
        case 'toggle_url_bar':
          openExclusive(
            () => {
              setShowUrlBar(true)
              captureActiveSnapshot().catch(() => {})
            },
            () => setShowUrlBar(false),
            showUrlBar
          )
          break
        case 'toggle_skills':
          refreshSkills()
          openExclusive(
            () => setShowSkillsPalette(true),
            () => setShowSkillsPalette(false),
            showSkillsPalette
          )
          break
        case 'toggle_base_skills':
          refreshSkills()
          openExclusive(
            () => setShowBaseSkillsModal(true),
            () => setShowBaseSkillsModal(false),
            showBaseSkillsModal
          )
          break
        case 'guide_open':
          openExclusive(() => setShowGuide(true), () => setShowGuide(false), showGuide)
          break
        case 'toggle_export':
        case 'export_context':
          openExclusive(() => setShowExport(true), () => setShowExport(false), showExport)
          break
        case 'model_next':
        case 'model_prev': {
          if (models.length === 0) break
          const currentKey = tabs.find((t) => t.id === activeId)?.model || models[0].key
          const idx = models.findIndex((m) => m.key === currentKey)
          const dir = action === 'model_next' ? 1 : -1
          const next = models[(idx + dir + models.length) % models.length]
          if (next) handleDeployModel(next.key)
          break
        }
        case 'toggle_pin': {
          const targetId = data.tabId || activeId
          if (targetId) togglePin(targetId)
          break
        }
        case 'switch_tab_index': {
          const { index, isPinned } = data
          if (isPinned) {
            const pinned = tabs.filter((t) => pinnedIds.includes(t.id))
            const target = pinned[index]
            if (target?.url) switchToTab(target.id, target.url)
          } else {
            const regular = tabs.filter((t) => !pinnedIds.includes(t.id))
            const target = regular[index]
            if (target?.url) switchToTab(target.id, target.url)
          }
          break
        }
        case 'navigate_tab': {
          const overlaysOpen = showHistory || showTabOverview || showSettings || showNewTab || showExport || showUrlBar || showGuide || showSkillsPalette || showBaseSkillsModal || showSkillParamsModal || showSkillEditorModal
          if (!overlaysOpen) {
            const isPinned = pinnedIds.includes(activeId || '')
            const relevantTabs = tabs.filter((t) => pinnedIds.includes(t.id) === isPinned)
            const idx = relevantTabs.findIndex((t) => t.id === activeId)
            if (relevantTabs.length > 1 && idx >= 0) {
              if (data.direction === 'prev') {
                const prev = relevantTabs[(idx - 1 + relevantTabs.length) % relevantTabs.length]
                switchToTab(prev.id, prev.url)
              } else {
                const next = relevantTabs[(idx + 1) % relevantTabs.length]
                switchToTab(next.id, next.url)
              }
            }
          }
          break
        }
        case 'upload_file': {
          // @ts-ignore
          window.electron?.ipcRenderer.send('trigger_active_upload')
          break
        }
        case 'upload_folder': {
          // @ts-ignore
          window.electron?.ipcRenderer.send('trigger_active_upload_folder')
          break
        }
        case 'zoom': {
          const { code, shift } = data
          const isMinus = code === 'Minus' || code === 'NumpadSubtract'
          const isPlus = code === 'Equal' || code === 'NumpadAdd'
          const isZero = code === 'Digit0' || code === 'Numpad0'
          if (shift) {
            if (isZero) setUiZoom(1.0)
            else if (isMinus) setUiZoom((z) => (z > 0.5 ? parseFloat((z - 0.1).toFixed(1)) : z))
            else if (isPlus) setUiZoom((z) => (z < 2.0 ? parseFloat((z + 0.1).toFixed(1)) : z))
          } else {
            if (isZero) setWebviewZoom(1.0)
            else if (isMinus) setWebviewZoom((z) => (z > 0.5 ? parseFloat((z - 0.1).toFixed(1)) : z))
            else if (isPlus) setWebviewZoom((z) => (z < 2.0 ? parseFloat((z + 0.1).toFixed(1)) : z))
          }
          break
        }
      }
    }

    handleExecuteGlobalActionRef.current = handleExecuteGlobalAction
  }, [
    showSettings,
    showHistory,
    showTabOverview,
    showNewTab,
    showExport,
    showUrlBar,
    showGuide,
    showSkillsPalette,
    showBaseSkillsModal,
    showSkillParamsModal,
    showSkillEditorModal,
    showCategoryManagerModal,
    activeId,
    tabs,
    models,
    pinnedIds,
    switchToTab,
    togglePin,
    restoreViewBounds,
    captureActiveSnapshot,
    refreshSkills,
    setUiZoom,
    setWebviewZoom,
    closeTab
  ])

  useEffect(() => {
    // @ts-ignore
    const unsub = window.electron?.ipcRenderer.on('execute-global-action', (event: any, data: any) => {
      handleExecuteGlobalActionRef.current?.(event, data)
    })
    // @ts-ignore
    const unsubFolder = window.electron?.ipcRenderer.on('show_folder_upload_modal', (_event: any, scanResult: FolderScanResult) => {
      setShowHistory(false)
      setShowTabOverview(false)
      setShowSettings(false)
      setShowNewTab(false)
      setShowExport(false)
      setShowUrlBar(false)
      setShowGuide(false)
      setShowSkillsPalette(false)
      setShowBaseSkillsModal(false)
      setShowSkillParamsModal(false)
      setShowSkillEditorModal(false)
      setShowCategoryManagerModal(false)
      setFolderUploadData(scanResult)
      // @ts-ignore
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
    })
    return () => {
      if (typeof unsub === 'function') {
        unsub()
      }
      if (typeof unsubFolder === 'function') {
        unsubFolder()
      }
    }
  }, [])

  // Persist tabs whenever they change
  useEffect(() => {
    if (tabs.length > 0) {
      try {
        localStorage.setItem(TABS_STORAGE_KEY, serializeState(tabs, activeId))
      } catch (e) {
        console.error('Failed to persist tabs:', e)
      }
    }
  }, [tabs, activeId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let rafId: number | null = null
    let lastSent = ''

    const sendBounds = () => {
      rafId = null
      // Never re-show the native view while an overlay or boot sequence is open:
      // the observer fires on layout changes and would otherwise
      // override the 0x0 hide sent by overlay-open handlers.
      if (showBootSequence || showHistory || showTabOverview || showSettings || showNewTab || showExport || showUrlBar || showGuide || showSkillsPalette || showBaseSkillsModal || showSkillParamsModal || showSkillEditorModal) return
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const payload = JSON.stringify({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        })
        if (payload === lastSent) return
        lastSent = payload
        // @ts-ignore
        window.electron?.ipcRenderer.send('resize_view', JSON.parse(payload))
      }
    }

    const observer = new ResizeObserver(() => {
      if (rafId === null) {
        rafId = requestAnimationFrame(sendBounds)
      }
    })

    observer.observe(el)
    // Initial sync (fires once on observe with current size)
    sendBounds()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [showBootSequence, showHistory, showTabOverview, showSettings, showNewTab, showExport, showUrlBar, showGuide, showSkillsPalette, showBaseSkillsModal, showSkillParamsModal, showSkillEditorModal])

  return (
    <div
      className={`flex w-screen h-screen overflow-hidden bg-(--bg) ${focusMode ? 'focus-mode' : ''}`}
    >
      {/* 1. LEFT SIDEBAR (Pinned Chats) — visible when not in bottom mode */}
      {!focusMode && interfaceSettings.pinnedPosition !== 'bottom' && (
        <div
          className={`${sidebarCollapsed ? 'w-16' : 'w-52 md:w-64'} bg-(--surface) border-r border-(--border) flex flex-col shadow-lg z-20 shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden`}
        >
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand Pinned Chats' : 'Collapse Pinned Chats'}
            className={`p-4 border-b border-(--border) text-(--text2) text-xs font-bold uppercase tracking-widest flex items-center transition-colors hover:text-(--text) ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}
          >
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={sidebarCollapsed ? '' : 'text-(--accent)'}
              >
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {!sidebarCollapsed && <span>Pinned Chats</span>}
            </div>
            {!sidebarCollapsed && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform duration-300"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            )}
          </button>

          <div
            className={`flex flex-col p-2 gap-1 overflow-y-auto flex-1 sidebar-chat-tabs ${sidebarCollapsed ? 'items-center' : ''}`}
          >
            {tabs
              .filter((t) => pinnedIds.includes(t.id))
              .map((t) =>
                sidebarCollapsed ? (
                  <button
                    key={t.id}
                    className={`group relative flex items-center justify-center w-11 h-11 rounded-xl cursor-pointer transition-colors ${activeId === t.id ? 'bg-(--border) border border-(--accent)/30 shadow-sm' : 'hover:bg-(--border) border border-transparent'}`}
                    onClick={(e) => {
                      e.currentTarget.blur()
                      if (t.url) switchToTab(t.id, t.url)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      togglePin(t.id)
                    }}
                    title={`${t.title || 'Pinned Chat'} (${modelLabel(t.model)}) — right-click to unpin`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={
                        BRAND_IDS[t.model]
                          ? { boxShadow: `0 0 8px ${colorFor(t.model)}` }
                          : {
                              background: colorFor(t.model),
                              boxShadow: `0 0 8px ${colorFor(t.model)}`
                            }
                      }
                    >
                      {BRAND_IDS[t.model] && (
                        <BrandIcon id={t.model} size={20} className="text-(--text) drop-shadow" />
                      )}
                    </div>
                  </button>
                ) : (
                  <div
                    key={t.id}
                    className={`group relative flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${activeId === t.id ? 'bg-(--border) border border-(--accent)/30 shadow-sm' : 'hover:bg-(--border) border border-transparent'}`}
                    onClick={() => {
                      if (t.url) switchToTab(t.id, t.url)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      togglePin(t.id)
                    }}
                    title="Right-click to unpin"
                  >
                    <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center"
                        style={
                          BRAND_IDS[t.model]
                            ? { boxShadow: `0 0 8px ${colorFor(t.model)}` }
                            : {
                                background: colorFor(t.model),
                                boxShadow: `0 0 8px ${colorFor(t.model)}`
                              }
                        }
                      >
                        {BRAND_IDS[t.model] && (
                          <BrandIcon id={t.model} size={22} className="text-(--text) drop-shadow" />
                        )}
                      </div>
                      <span className="text-[10px] leading-none text-(--text2) truncate max-w-[48px]">
                        {modelLabel(t.model)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 pr-6">
                      <div className="text-base font-semibold text-(--text) truncate">
                        {t.title || 'Pinned Chat'}
                      </div>
                      <div className="text-xs text-(--text2) uppercase tracking-wider mt-0.5">
                        {modelLabel(t.model)}
                      </div>
                    </div>

                    <button
                      className="absolute right-2 opacity-0 group-hover:opacity-100 text-(--text2) hover:text-(--accent) transition-opacity p-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePin(t.id)
                      }}
                      title="Unpin"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m3 3 18 18" />
                        <path d="M15 9.5V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.5M10.14 10.14 6 13h12l-1.39 2.78M12 18v3" />
                      </svg>
                    </button>
                  </div>
                )
              )}
            {tabs.filter((t) => pinnedIds.includes(t.id)).length === 0 && !sidebarCollapsed && (
              <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-(--text2)/50"
                >
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <p className="text-[11px] text-(--text2)/70 leading-relaxed">No pinned chats</p>
                <p className="text-[10px] text-(--text2)/50 leading-relaxed">
                  Right-click a tab
                  <br />
                  to pin it here
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. MAIN WORKING AREA */}
      <div className="flex-1 flex flex-col min-w-0 bg-(--bg) relative z-10">
        {focusMode && (
          <button
            onClick={() => {
              setFocusMode(false)
              // @ts-ignore
              window.electron?.ipcRenderer.send('toggle_focus_mode', false)
            }}
            className="absolute top-2 left-2 z-50 bg-black/60 hover:bg-black p-2 rounded-full backdrop-blur text-white text-xs"
            title="Exit Focus Mode"
          >
            Exit Focus
          </button>
        )}

        {!focusMode && (
          <div
            className="top-navbar flex w-full justify-between items-center bg-(--surface) px-4 py-2 border-b border-(--border) relative z-20 shrink-0 drag-region"
            style={{ paddingRight: window.navigator.userAgent.includes('Win') ? '140px' : '16px' }}
          >
            {/* Left: Chat Tabs */}
            <div className="flex gap-2 items-center flex-1 min-w-0 overflow-hidden pr-4">
              <ChatTabs
                tabs={tabs.filter((t) => !pinnedIds.includes(t.id))}
                activeId={activeId}
                modelColors={modelColors}
                onSelect={(id: string) => {
                  const t = tabs.find((x) => x.id === id)
                  if (t && t.url) switchToTab(t.id, t.url)
                }}
                onClose={(id: string) => closeTab(id)}
                onTogglePin={togglePin}
              />
            </div>

            {/* Center: Models (Floating on md+, inline on small) */}
            <div className="flex items-center justify-center shrink-0 md:absolute md:left-1/2 md:-translate-x-1/2 md:pointer-events-none">
              <div className="md:pointer-events-auto">
                <ModelNotch
                  models={models}
                  activeModel={tabs.find((t) => t.id === activeId)?.model || 'gemini'}
                  onSelect={handleDeployModel}
                />
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex gap-2 shrink-0 justify-end items-center">
              {/* J.A.R.V.I.S. HUD Status & Audio Control */}
              <HudStatusHeader onTriggerBoot={() => setShowBootSequence(true)} />
              
              {/* Agent Handoff Export Button */}
              <button
                className={`history-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer ${
                  showExport
                    ? 'bg-amber-500/25 border-amber-500/50 text-amber-300'
                    : 'bg-(--surface2) hover:bg-(--border) border-white/10 text-(--text) hover:border-amber-500/40 hover:text-amber-200'
                }`}
                onClick={() => {
                  const nextState = !showExport
                  setShowExport(nextState)
                  if (nextState) {
                    setShowHistory(false)
                    setShowSettings(false)
                    setShowNewTab(false)
                    // @ts-ignore
                    window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
                  } else {
                    restoreViewBounds()
                  }
                }}
                title="Export Compressed Agent Handoff Context (Ctrl+Shift+E)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" x2="12" y1="15" y2="3"/>
                </svg>
                <span className="hidden md:inline text-xs font-semibold">Agent Handoff</span>
                <span className="hidden lg:inline text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Export
                </span>
              </button>

              <button
                className="bg-(--surface2) hover:bg-(--border) text-(--text) px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                onClick={async () => {
                  const nextState = !showTabOverview
                  if (nextState) {
                    await captureActiveSnapshot()
                  }
                  setShowTabOverview(nextState)
                  if (nextState) {
                    setShowHistory(false)
                    setShowSettings(false)
                    setShowNewTab(false)
                    // @ts-ignore
                    window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
                  } else {
                    restoreViewBounds()
                  }
                }}
                title={`Tab Overview (${getShortcutKeys('tab-overview').join('+')})`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" x2="22" y1="21" y2="21"/>
                  <line x1="12" x2="12" y1="17" y2="21"/>
                </svg>
                <span className="hidden md:inline text-xs">Tabs</span>
              </button>

              <button
                className="history-btn bg-(--surface2) hover:bg-(--border) text-(--text) px-3 py-1.5 rounded transition-colors"
                onClick={async () => {
                  const nextState = !showHistory

                  // @ts-ignore
                  if (nextState && activeId && window.electron && window.electron.ipcRenderer) {
                    try {
                      // @ts-ignore
                      const snap = await window.electron.ipcRenderer.invoke('capture_tab_snapshot')
                      if (snap) {
                        setTabs((prev) =>
                          prev.map((t) => (t.id === activeId ? { ...t, thumbnail: snap } : t))
                        )
                        setHistory((prev) => {
                          const updated = prev.map((h) =>
                            h.id === activeId || h.url === tabs.find((t) => t.id === activeId)?.url
                              ? { ...h, thumbnail: snap }
                              : h
                          )
                          // @ts-ignore
                          window.electron.ipcRenderer
                            .invoke('save_history', JSON.stringify(updated))
                            .catch(() => {})
                          return updated
                        })
                      }
                    } catch (e) {
                      console.error(e)
                    }
                  }

                  setShowHistory(nextState)
                  if (nextState) {
                    setShowSettings(false)
                    setShowNewTab(false)
                    // @ts-ignore
                    window.electron?.ipcRenderer.send('resize_view', {
                      x: 0,
                      y: 0,
                      width: 0,
                      height: 0
                    })
                  } else {
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (rect) {
                      // @ts-ignore
                      window.electron?.ipcRenderer.send('resize_view', {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                      })
                    }
                  }
                }}
              >
                History
              </button>
              <button
                className="history-btn bg-(--surface2) hover:bg-(--border) text-(--text) px-3 py-1.5 rounded transition-colors"
                onClick={() => {
                  const nextState = !showSettings
                  setShowSettings(nextState)
                  if (nextState) {
                    setShowHistory(false)
                    setShowNewTab(false)
                    // @ts-ignore
                    window.electron?.ipcRenderer.send('resize_view', {
                      x: 0,
                      y: 0,
                      width: 0,
                      height: 0
                    })
                  } else {
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (rect) {
                      // @ts-ignore
                      window.electron?.ipcRenderer.send('resize_view', {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                      })
                    }
                  }
                }}
                title="Manage AI Models"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {loadingTabId && <div className="ai-loading-bar" />}

        {/* The Native Box Content Bounds */}
        <div className="flex-1 w-full h-full relative">
          <div className="absolute inset-0" ref={containerRef} />
        </div>

        {/* BOTTOM PINNED CHATS DOCK (Full ChatTabs Parity) */}
        {!focusMode && interfaceSettings.pinnedPosition === 'bottom' && (
          <div className="h-14 border-t border-(--border) bg-(--bg) flex items-center px-3 gap-2 shrink-0 select-none z-20 shadow-md">
            <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-(--text2) shrink-0 pr-3 border-r border-(--border)/60">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-(--accent)"
              >
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              <span className="hidden sm:inline font-bold text-xs">PINNED</span>
              <span className="text-[10px] opacity-70 font-mono bg-(--surface2) px-1.5 py-0.5 rounded text-(--accent)">
                {tabs.filter((t) => pinnedIds.includes(t.id)).length}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              {tabs.filter((t) => pinnedIds.includes(t.id)).length > 0 ? (
                <ChatTabs
                  tabs={tabs.filter((t) => pinnedIds.includes(t.id))}
                  activeId={activeId}
                  pinnedIds={pinnedIds}
                  modelColors={modelColors}
                  onSelect={(id: string) => {
                    const t = tabs.find((x) => x.id === id)
                    if (t && t.url) switchToTab(t.id, t.url)
                  }}
                  onClose={(id: string) => closeTab(id)}
                  onTogglePin={togglePin}
                  alwaysShowTitles={true}
                />
              ) : (
                <span className="text-xs text-(--text2)/50 italic px-2">
                  No pinned chats (Right-click any tab in the top bar to pin it here)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* OVERLAYS */}
      {showExport && (
        <ExportOverlay
          activeModel={tabs.find((t) => t.id === activeId)?.model || 'gemini'}
          activeTabTitle={tabs.find((t) => t.id === activeId)?.title}
          models={models}
          onSwitchModel={(modelKey) => {
            handleDeployModel(modelKey)
            setShowExport(false)
            restoreViewBounds()
          }}
          onClose={() => {
            setShowExport(false)
            restoreViewBounds()
          }}
        />
      )}
      <UrlBarModal
        isOpen={showUrlBar}
        currentUrl={activeTab?.url || ''}
        currentModel={activeTab?.model || 'gemini'}
        models={models}
        onClose={() => {
          setShowUrlBar(false)
          restoreViewBounds()
        }}
        onNavigate={handleUrlBarNavigate}
        onExecuteCommand={handleUrlBarCommand}
      />

      {showSettings && (
        <SettingsOverlay tabDiscardMinutes={tabDiscardMinutes} setTabDiscardMinutes={setTabDiscardMinutes} maxActiveTabs={maxActiveTabs} setMaxActiveTabs={setMaxActiveTabs}
          uiZoom={uiZoom} setUiZoom={setUiZoom} webviewZoom={webviewZoom} setWebviewZoom={setWebviewZoom}
          models={models}
          setModels={setModels}
          themeState={themeState}
          setThemeState={setThemeState}
          webviewThemeOn={webviewThemeOn}
          setWebviewThemeOn={setWebviewThemeOn}
          providerConfig={providerConfig}
          setProviderConfig={setProviderConfig}
          interfaceSettings={interfaceSettings}
          onInterfaceSettingsChange={(newSettings) => {
            setInterfaceSettings(newSettings)
            saveInterfaceSettings(newSettings)
          }}
          onClose={() => {
            setShowSettings(false)
            restoreViewBounds()
          }}
        />
      )}

            {showTabOverview && (
        <div className="absolute inset-0 z-[99999] pointer-events-auto">
          <TabOverviewOverlay
            tabs={tabs}
            models={models}
            onOpen={(id, url) => {
              switchToTab(id, url)
              setShowTabOverview(false)
            }}
            onClose={() => {
              setShowTabOverview(false)
              restoreViewBounds()
            }}
            onDelete={(id) => closeTab(id)}
          />
        </div>
      )}

            {showHistory && (
        <div className="absolute inset-0 z-[99999] pointer-events-auto">
          <HistoryOverlay
            history={history}
            models={models}
            onOpen={handleHistoryOverlaySelect}
            onClose={() => {
              setShowHistory(false)
              restoreViewBounds()
            }}
            onDelete={(id, url) => {
              setHistory(prev => prev.filter(h => h.id !== id && h.url !== url))
            }}
          />
        </div>
      )}

      
      <BaseSkillsModal
        isOpen={showBaseSkillsModal}
        skills={skills}
        onClose={() => {
          setShowBaseSkillsModal(false)
          restoreViewBounds()
        }}
        onInject={handleInjectBaseSkills}
        onDelete={(id) => {
          window.electron?.skills?.delete(id).catch(()=>{})
        }}
        onTogglePin={(id) => {
          window.electron?.skills?.togglePin(id).catch(()=>{})
        }}
        onOpenEditor={(skill) => {
          setEditingSkill(skill)
          setShowBaseSkillsModal(false)
          setShowSkillEditorModal(true)
        }}
      />
      <SkillsPaletteModal
        isOpen={showSkillsPalette}
        skills={skills}
        onClose={() => {
          setShowSkillsPalette(false)
          restoreViewBounds()
        }}
        onSelectSkill={handleSelectSkillFromPalette}
        onOpenEditor={(sk) => {
          setEditingSkill(sk || null)
          setShowSkillEditorModal(true)
        }}
        onOpenBaseModal={() => {
          setShowSkillsPalette(false)
          setShowBaseSkillsModal(true)
        }}
        onDelete={(id) => {
          window.electron?.skills?.delete(id).catch(()=>{})
        }}
        onTogglePin={(id) => {
          window.electron?.skills?.togglePin(id).catch(()=>{})
        }}
        onOpenCategoryManager={() => {
          setShowSkillsPalette(false)
          setShowCategoryManagerModal(true)
        }}
      />
      <CategoryManagerModal
        isOpen={showCategoryManagerModal}
        skills={skills}
        onClose={() => {
          setShowCategoryManagerModal(false)
          restoreViewBounds()
          refreshSkills()
        }}
      />
      <SkillParameterModal
        isOpen={showSkillParamsModal}
        skill={selectedSkillForParams}
        projectDir={activeTab?.projectDir}
        onClose={() => {
          setShowSkillParamsModal(false)
          setSelectedSkillForParams(null)
          restoreViewBounds()
        }}
        onSubmit={async (compiledPrompt, autoSend) => {
          setShowSkillParamsModal(false)
          setSelectedSkillForParams(null)
          restoreViewBounds()
          if (activeId) {
            setTimeout(async () => {
              // @ts-ignore
              await window.electron?.skills?.injectPrompt(activeId, compiledPrompt, autoSend)
              if (selectedSkillForParams) window.electron?.skills?.incrementUsage(selectedSkillForParams.id).catch(()=>{})
            }, 100)
          }
        }}
      />
      <SkillEditorModal
        isOpen={showSkillEditorModal}
        editingSkill={editingSkill}
        onClose={() => {
          setShowSkillEditorModal(false)
          setEditingSkill(null)
          restoreViewBounds()
        }}
        onSave={async (skill) => {
          // @ts-ignore
          await window.electron?.skills?.save(skill)
          refreshSkills()
        }}
        onDelete={async (skillId) => {
          // @ts-ignore
          await window.electron?.skills?.delete(skillId)
          refreshSkills()
        }}
      />
      <FolderUploadModal
        isOpen={Boolean(folderUploadData)}
        data={folderUploadData}
        onClose={() => {
          setFolderUploadData(null)
          restoreViewBounds()
        }}
        onConfirm={(selectedPaths) => {
          if (folderUploadData) {
            // @ts-ignore
            window.electron?.ipcRenderer.send('confirm_folder_upload', {
              folderPath: folderUploadData.folderPath,
              selectedPaths
            })
          }
          setFolderUploadData(null)
          restoreViewBounds()
        }}
      />
      {showNewTab && (
        <div className="absolute inset-0 z-[99999] pointer-events-auto">
          <NewTabOverlay
            models={models}
            usageCounts={usageCounts}
            history={history}
            onOpenNew={(provider) => {
              const tab = tabs.find((t) => t.id === activeId)
              const isEmpty = !!tab && tab.title === 'New Chat' && !tab.patternId
              if (isEmpty) {
                const updated = tabs.map((t) =>
                  t.id === tab.id
                    ? { ...t, model: provider.id, url: provider.url, title: provider.name }
                    : t
                )
                setTabs(updated)
                loadTabUrl(tab.id, provider.url)
              } else {
                const result = addNewChat(tabs, provider.id, provider.url)
                setTabs(result.tabs)
                loadTabUrl(result.activeId, provider.url)
              }
              setShowNewTab(false)
            }}
            onOpenHistory={(item) => {
              const result = openHistoryTab(tabs, item)
              setTabs(result.tabs)
              const existing = tabs.find((t) => t.url === item.url)
              if (existing) {
                switchToTab(existing.id, existing.url)
              } else {
                loadTabUrl(result.activeId, item.url)
              }
              setShowNewTab(false)
            }}
            onDeleteHistory={deleteHistoryItem}
            onClose={() => {
              setShowNewTab(false)
              restoreViewBounds()
            }}
          />
        </div>
      )}

      {/* Nexus Helper Guide (F1) */}
      <ZenGuideModal
        isOpen={showGuide}
        onClose={() => {
          setShowGuide(false)
          restoreViewBounds()
        }}
        models={models}
        interfaceSettings={interfaceSettings}
        onUpdateInterfaceSettings={(next) => {
          setInterfaceSettings(next)
          saveInterfaceSettings(next)
        }}
        onOpenFullSettings={() => {
          setShowGuide(false)
          setShowSettings(true)
          // @ts-ignore
          window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
        }}
      />

      {/* J.A.R.V.I.S. Iron Man HUD Startup Sequence */}
      {showBootSequence && (
        <JarvisBootOverlay
          isReady={!loadingTabId}
          onComplete={() => {
            setShowBootSequence(false)
            restoreViewBounds()
          }}
        />
      )}
    </div>
  )
}

export default App
