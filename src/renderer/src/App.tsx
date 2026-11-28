import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import {
  serializeState,
  deserializeState,
  getRecentActiveTabIds,
  getVisibleActiveTabs,
  getOrderedVisualTabs,
  getNextVisualTab,
  moveActiveTabInList,
  switchToModel,
  addNewChat,
  openHistoryTab,
  createTab,
  countModelUsage,
  isProviderHomeUrl,
  shouldAcceptReportedUrl,
  reorderTabs
} from './lib/tabs'
import { partitionTabSections } from './lib/tabSections'
import { sfx } from './lib/soundFx'
import { getShortcutKeys, getShortcutMap, onShortcutsChanged } from './lib/shortcuts'
import {
  describeOverlays,
  dismissibleOverlayKeys,
  isAnyOverlayOpen,
  openOverlayKeys,
  type OverlayKey
} from './lib/overlays'
import {
  MAX_TAB_SHORTCUT_NUMBER,
  shortcutLabelForTab,
  tabForShortcutNumberInOrder,
  tabNumbersForOrder,
  pinnedTabForShortcutNumber
} from './lib/tabNumbering'
import type { Tab, HistoryItem, ModelKey } from './lib/tabs'
import ChatTabs from './components/ChatTabs'
import ContainerMenu from './components/ContainerMenu'
import ContainerModal from './components/ContainerModal'
import ContainerManager from './components/ContainerManager'
import VerticalTabs from './components/VerticalTabs'
import type { TabAiStatus } from './lib/tabStatus'
import { BRAND_IDS, modelLabel } from './lib/modelVisuals'
import { providerColorFor, providerColorMap, providerIconFor, providerLabelFor } from './lib/providerVisuals'
import { BrandIcon, IconPanelLeft, IconPanelLeftClose, IconSearch, IconPlus } from './components/BrandIcons'
import { pushClosedTab, reopenClosedTab, type ClosedTabEntry } from './lib/tabs'
import type { SkillDef } from '../../shared/skills'
import type { AiLifecycleStatusUpdate } from '../../shared/aiLifecycle'
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
import { GuideTour } from './components/GuideTour'
import { WindowTitleBar } from './components/WindowTitleBar'
import TabColorModal from './components/TabColorModal'
import TabColorButton from './components/TabColorButton'
import ShortcutKeys from './components/ShortcutKeys'
import { applyTabColors, sanitiseTabColors, tabAccentColor, type TabColors } from './lib/tabColors'
import { adoptTabMemory, applyRememberedPinnedPosition, applyRememberedPosition, readTabMemory, rememberTabs, serializeTabMemory, TAB_MEMORY_STORAGE_KEY, type TabMemory } from './lib/tabMemory'
import {
  containerColorOf,
  containerForShortcutIndex,
  containerIdOf,
  defaultContainerInfo,
  findContainer,
  moveContainerInList,
  auraRingStyle,
  DEFAULT_CONTAINER_AURA_STRENGTH,
  insetRectForAura,
  tabCountsByContainer,
  type ContainerInfo
} from './lib/containers'
import { FolderUploadModal } from './components/FolderUploadModal'
import { DiagnosticsModal } from './components/DiagnosticsModal'
import type { FolderScanResult } from '../../shared/folderUpload'
import { shouldCaptureAutomaticSnapshot } from './lib/snapshotThrottle'
import './App.css'

/** Bumped whenever this file's UI changes, so a stale bundle is obvious at a glance
 *  (`document.querySelector('[data-nexus-build]')` in devtools). */
const NEXUS_UI_BUILD = '26'

/** Where the "the guide has been seen" state lives. Set on close, cleared by "Tour again". */
/**
 * The remembered tabs, parsed once per run.
 *
 * A module-level cache rather than a `useRef` initialiser body: the ref pattern needs a `.current` read
 * during render, and calling this from the initialiser keeps the render pure while still parsing the
 * stored JSON a single time instead of on every render of a component that re-renders constantly.
 */
let cachedTabMemory: TabMemory | null = null
function loadTabMemoryFromStorage(): TabMemory {
  if (cachedTabMemory) return cachedTabMemory
  try {
    cachedTabMemory = readTabMemory(localStorage.getItem(TAB_MEMORY_STORAGE_KEY))
  } catch {
    cachedTabMemory = {}
  }
  return cachedTabMemory
}

const GUIDE_SEEN_KEY = 'vicinae.guide.seen.v1'

import {
  DEFAULT_MODELS,
  loadAndMigrateModels,
  sanitizeModelDef,
  STORAGE_KEY,
  type ModelDef
} from './lib/models'
import { resolveActiveProviderKey } from './lib/providerResolution'
import { cleanConversationTitle, isDefaultConversationTitle } from '../../shared/titleUtils'

export type { ModelDef }

const TABS_STORAGE_KEY = 'vicinae.tabs'

function App() {
  const [modelsHydrated, setModelsHydrated] = useState(false)
  const [models, setModels] = useState<ModelDef[]>(() => loadAndMigrateModels(DEFAULT_MODELS))

  // Dual persistence: save to localStorage and to disk models.json (gated on modelsHydrated)
  useEffect(() => {
    if (!modelsHydrated) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models))
    window.electron?.ipcRenderer?.invoke?.('save_models', JSON.stringify(models)).catch(() => {})
  }, [models, modelsHydrated])

  // Hydrate configured models from disk models.json on mount
  useEffect(() => {
    let active = true
    const hydrateModelsFromDisk = async () => {
      try {
        const raw = await window.electron?.ipcRenderer?.invoke?.('get_models')
        const parsed = typeof raw === 'string' ? (raw.trim().length > 0 ? JSON.parse(raw) : null) : raw
        if (Array.isArray(parsed) && parsed.length > 0 && active) {
          const sanitized = parsed.map(sanitizeModelDef)
          setModels(sanitized)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
          setModelsHydrated(true)
          return
        }
        setModelsHydrated(true)
        // If disk models.json is not yet created, persist current default models to disk
        window.electron?.ipcRenderer?.invoke?.('save_models', JSON.stringify(models)).catch(() => {})
      } catch (err) {
        console.warn('[models] Failed to hydrate models from disk:', err)
      }
    }
    hydrateModelsFromDisk()
    return () => {
      active = false
    }
  }, [])

  const [tabsHydrated, setTabsHydrated] = useState(false)
  const [initialTabs] = useState(() => {
    try {
      const disk = window.nexusState?.getTabsSync?.()
      const parsed = typeof disk === 'string' ? JSON.parse(disk) : disk
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).tabs) && (parsed as any).tabs.length > 0) {
        // Colours come off disk and end up inside injected CSS — re-validate them here too.
        const loadedTabs = ((parsed as any).tabs as Tab[]).map((t) =>
          applyTabColors(t, sanitiseTabColors(t))
        )
        const loadedActiveId = (parsed as any).activeId || loadedTabs[0]?.id || null
        const loadedMru = Array.isArray((parsed as any).mruTabIds) ? ((parsed as any).mruTabIds as string[]) : undefined
        return { tabs: loadedTabs, activeId: loadedActiveId, mruTabIds: loadedMru, residentTabIds: (parsed as any).residentTabIds, discardedTabIds: (parsed as any).discardedTabIds }
      }
    } catch {}
    const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
    if (restored && restored.tabs.length > 0) return restored
    const initial = createTab('gemini', 'New Chat', 'https://gemini.google.com')
    return { tabs: [initial], activeId: initial.id, mruTabIds: [initial.id] }
  })
  const [tabs, setTabs] = useState<Tab[]>(initialTabs.tabs)
  /**
   * The last URL the user asked for from the address bar, so a page reporting its own URL back can be
   * told apart from the page wandering off on its own. Without it, the "a provider bouncing to its home
   * page must not overwrite a deep chat link" rule also swallowed the user's own navigation — see onUrl.
   */
  const userNavigationRef = useRef<{ tabId: string; host: string; at: number } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(initialTabs.activeId)
  const [residentTabIds, setResidentTabIds] = useState<string[]>(() =>
    Array.isArray((initialTabs as any).residentTabIds) ? (initialTabs as any).residentTabIds : getRecentActiveTabIds(initialTabs.tabs, initialTabs.activeId, initialTabs.mruTabIds, 7)
  )
  const [discardedTabIds, setDiscardedTabIds] = useState<string[]>(() => Array.isArray((initialTabs as any).discardedTabIds) ? (initialTabs as any).discardedTabIds : [])
  const discardedTabIdsRef = useRef<string[]>([])
  useEffect(() => { discardedTabIdsRef.current = discardedTabIds }, [discardedTabIds])

  // Listen for real-time tab discard status from main process
  useEffect(() => {
    // @ts-ignore
    const cleanup = window.electron?.ipcRenderer?.on?.(
      'tab_discard_status_updated',
      (_event: unknown, data: { residentTabIds?: string[]; discardedTabIds?: string[] }) => {
        const residentFromMain = Array.isArray(data?.residentTabIds) ? data.residentTabIds : []
        const discardedFromMain = Array.isArray(data?.discardedTabIds) ? data.discardedTabIds : []
        const discardedSet = new Set(discardedFromMain)
        setResidentTabIds((prev) => {
          const preserved = prev.filter((id) => !discardedSet.has(id))
          return Array.from(new Set([...residentFromMain, ...preserved]))
        })
        setDiscardedTabIds((prev) => [...prev.filter((id) => !residentFromMain.includes(id)), ...discardedFromMain.filter((id) => !prev.includes(id))])
      }
    )
    // Initial fetch of discard status
    // @ts-ignore
    window.electron?.ipcRenderer?.invoke?.('get_tab_discard_status').then((res: any) => {
      if (res?.success) {
        const residentFromMain = Array.isArray(res.status?.residentTabIds) ? res.status.residentTabIds : []
        const discardedFromMain = Array.isArray(res.status?.discardedTabIds) ? res.status.discardedTabIds : []
        const discardedSet = new Set(discardedFromMain)
        setResidentTabIds((prev) => {
          const preserved = prev.filter((id) => !discardedSet.has(id))
          return Array.from(new Set([...residentFromMain, ...preserved]))
        })
        setDiscardedTabIds((prev) => [...prev.filter((id) => !residentFromMain.includes(id)), ...discardedFromMain.filter((id) => !prev.includes(id))])
      }
    }).catch(() => {})

    return () => {
      // @ts-ignore
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  // Asynchronous universal hydration from disk tabs.json
  useEffect(() => {
    let active = true
    let hydrated = false

    const handleDiskResult = (result: any) => {
      if (!active || hydrated) return
      let diskState = result
      if (typeof diskState === 'string' && diskState.trim()) {
        try {
          diskState = JSON.parse(diskState)
        } catch {}
      }

      if (
        diskState &&
        typeof diskState === 'object' &&
        Array.isArray((diskState as any).tabs) &&
        (diskState as any).tabs.length > 0
      ) {
        // Disk wins: hydrate live tabs
        hydrated = true
        const loadedTabs = ((diskState as any).tabs as Tab[]).map((t) =>
          applyTabColors(t, sanitiseTabColors(t))
        )
        const loadedActiveId = (diskState as any).activeId || loadedTabs[0]?.id || null
        const loadedResidentTabIds = Array.isArray((diskState as any)?.residentTabIds) ? ((diskState as any).residentTabIds as string[]) : undefined
        const loadedDiscardedTabIds = Array.isArray((diskState as any)?.discardedTabIds) ? ((diskState as any).discardedTabIds as string[]) : undefined
        setTabs(loadedTabs)
        setActiveId(loadedActiveId)
        setMruTabIds(loadedTabs.map((t) => t.id))
        setResidentTabIds((prev) => {
          const preserved = prev.filter((id) => !loadedDiscardedTabIds?.includes(id))
          return Array.from(new Set([...(loadedResidentTabIds || []), ...preserved]))
        })
        setDiscardedTabIds(loadedDiscardedTabIds || [])
        try {
          localStorage.setItem(TABS_STORAGE_KEY, serializeState(loadedTabs, loadedActiveId, loadedTabs.map((t) => t.id), (loadedResidentTabIds || []), (loadedDiscardedTabIds || [])))
        } catch {}
        setTabsHydrated(true)
        const activeTabToActivate = loadedTabs.find((t) => t.id === loadedActiveId) || loadedTabs[0]
        if (activeTabToActivate?.url) {
          switchToTabRef.current?.(activeTabToActivate.id, activeTabToActivate.url)
        }
      } else {
        // Fresh install / empty disk: initialize default or local storage tab
        hydrated = true
        const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
        if (restored && restored.tabs.length > 0) {
          setTabs(restored.tabs)
          setActiveId(restored.activeId)
          setResidentTabIds(restored.residentTabIds || [])
          setDiscardedTabIds(restored.discardedTabIds || [])
        } else {
          const initial = createTab('gemini', 'New Chat', 'https://gemini.google.com')
          setTabs([initial])
          setActiveId(initial.id)
        }
        setTabsHydrated(true)
      }
    }

    const diskPromise = window.nexusState?.get('tabs')
    if (diskPromise && typeof diskPromise.then === 'function') {
      diskPromise.then(handleDiskResult).catch((err) => {
        console.warn('[state] Disk tabs read error:', err)
        if (active && !hydrated) {
          hydrated = true
          setTabsHydrated(true)
        }
      })
    }

    // Grace period timer: if disk is slow, render local storage in read-only mode until disk arrives
    const timer = setTimeout(() => {
      if (!active || hydrated) return
      console.warn('[state] Tabs hydration took >1.5s; rendering temporary read-only local state')
      const restored = deserializeState(localStorage.getItem(TABS_STORAGE_KEY))
      if (restored && restored.tabs.length > 0) {
        setTabs(restored.tabs)
        setActiveId(restored.activeId)
        setResidentTabIds(restored.residentTabIds || [])
        setDiscardedTabIds(restored.discardedTabIds || [])
      }
    }, 1500)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  // MRU State
  const [mruTabIds, setMruTabIds] = useState<string[]>(() => {
    return initialTabs.mruTabIds && initialTabs.mruTabIds.length > 0
      ? initialTabs.mruTabIds
      : initialTabs.tabs.map((t) => t.id)
  })
  useEffect(() => {
    if (activeId) {
      setMruTabIds(prev => {
        const filtered = prev.filter(id => id !== activeId)
        return [activeId, ...filtered]
      })
    }
  }, [activeId])

  const switchToTabRef = useRef<((id: string, url: string) => void) | null>(null)
  const mruRef = useRef(mruTabIds)
  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)
  const pinnedIdsRef = useRef<string[]>([])
  const residentTabIdsRef = useRef<string[]>([])

  useEffect(() => { mruRef.current = mruTabIds }, [mruTabIds])
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { residentTabIdsRef.current = residentTabIds }, [residentTabIds])

  const activeTab = tabs.find((t) => t.id === activeId)
  const resolvedActiveModelKey = useMemo(() => {
    return resolveActiveProviderKey(activeTab, models)
  }, [activeTab?.url, activeTab?.model, models])

  const [showHistory, setShowHistory] = useState(false)
  const [showTabOverview, setShowTabOverview] = useState(false)
  const showTabOverviewRef = useRef(false)
  // Per-tab accent & aura picker. One dialog, two entry points (title bar + quick actions).
  const [showTabColors, setShowTabColors] = useState(false)
  const activeTabColors = useMemo(
    () => sanitiseTabColors({ accentColor: activeTab?.accentColor, auraColor: activeTab?.auraColor }),
    [activeTab?.accentColor, activeTab?.auraColor]
  )
  // The tab record is the durable copy — it is what serializeState writes to disk — so the picker
  // only has to update state. Main gets a copy purely to rebuild that view's aura.
  const applyColorsToActiveTab = useCallback((colors: TabColors) => {
    const id = activeIdRef.current
    if (!id) return
    setTabs((prev) => prev.map((t) => (t.id === id ? applyTabColors(t, colors) : t)))
  }, [])
  // Pushed only when this tab's colours actually change. Re-sending on every activation would
  // rebuild that view's stylesheet on every tab switch, which is needless churn on a surface that
  // already has to be repainted when it is brought forward.
  const sentTabColorsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    if (!activeId) return
    const key = `${activeTabColors.accentColor ?? ''}|${activeTabColors.auraColor ?? ''}`
    if (sentTabColorsRef.current[activeId] === key) return
    sentTabColorsRef.current[activeId] = key
    window.electron?.ipcRenderer.send('set_tab_colors', activeId, {
      accentColor: activeTabColors.accentColor,
      auraColor: activeTabColors.auraColor
    })
  }, [activeId, activeTabColors.accentColor, activeTabColors.auraColor])

  // ---- Containers -------------------------------------------------------------------------
  const [containers, setContainers] = useState<ContainerInfo[]>([defaultContainerInfo()])
  const [showContainerMenu, setShowContainerMenu] = useState(false)
  // The containers section: adding, editing and deleting them in one place.
  const [showContainerManager, setShowContainerManager] = useState(false)
  // A one-line explanation for a keypress that had nothing to open.
  const [containerHint, setContainerHint] = useState<string | null>(null)
  const [editingContainer, setEditingContainer] = useState<ContainerInfo | null>(null)
  const [showContainerModal, setShowContainerModal] = useState(false)
  const [containerAccounts, setContainerAccounts] = useState<Array<{ id: string; label: string }>>([
    { id: 'default', label: 'Default' }
  ])
  // Synchronous mirror of tab -> container, so a tab can be activated in the same tick it is created
  // (React state would still be one render behind, and main picks the partition at view creation).
  const tabContainersRef = useRef<Record<string, string>>({})
  const containersRef = useRef<ContainerInfo[]>([defaultContainerInfo()])

  const loadContainers = useCallback(async () => {
    try {
      const list = (await window.electron?.containers?.list?.()) as ContainerInfo[] | undefined
      if (Array.isArray(list) && list.length > 0) {
        setContainers(list)
        containersRef.current = list
      }
      const accounts = (await window.electron?.googleSignIn?.getAccounts?.()) as
        | Array<{ id: string; label: string }>
        | undefined
      if (Array.isArray(accounts) && accounts.length > 0) setContainerAccounts(accounts)
    } catch (err) {
      console.warn('[containers] Failed to load containers:', err)
    }
  }, [])

  useEffect(() => {
    void loadContainers()
  }, [loadContainers])

  useEffect(() => {
    if (!containerHint) return
    const timer = window.setTimeout(() => setContainerHint(null), 4200)
    return () => window.clearTimeout(timer)
  }, [containerHint])

  const activeContainerId = containerIdOf(tabs.find((t) => t.id === activeId))
  const activeContainer = useMemo(
    () => findContainer(containers, activeContainerId),
    [containers, activeContainerId]
  )
  const activeContainerColor = containerColorOf(activeContainer)
  const containerTabCounts = useMemo(() => tabCountsByContainer(tabs), [tabs])
  const containerMarks = useMemo(() => {
    const marks: Record<string, { color?: string; name: string; isDefault: boolean }> = {}
    for (const tab of tabs) {
      const container = findContainer(containers, containerIdOf(tab))
      marks[tab.id] = {
        color: containerColorOf(container),
        name: container.name,
        isDefault: containerIdOf(tab) === 'default'
      }
    }
    return marks
  }, [tabs, containers])

  const [showNewTab, setShowNewTab] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showUrlBar, setShowUrlBar] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  /**
   * The guide opens itself once, on first run, and never again unless F1 asks for it. The key records
   * how it ended (`done` / `skipped` / `escape`) so a person who walked away from it is not greeted by
   * it on the next launch either.
   */
  const guideOpenedOnce = useRef(false)
  /** Which Settings section the guide asked for, so the panel opens where the step is. */
  const [settingsRequestedTab, setSettingsRequestedTab] = useState<string | null>(null)
  /** Bumped whenever interface styling changes — the guide's palette step waits for this. */
  const [settingsRevision, setSettingsRevision] = useState(0)
  /** True while the settings panel on screen was opened by the guide rather than by the user. */
  const guideOwnsSettings = useRef(false)
  /** Bumped on every open, and used as the guide's key: each visit starts at step one with no reset code. */
  const [guideRun, setGuideRun] = useState(0)
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

  useEffect(() => {
    let mounted = true
    // @ts-ignore
    window.electron?.ipcRenderer?.invoke?.('get_tab_discard_policy').then((res: any) => {
      if (mounted && res?.success && res.policy) {
        setTabDiscardMinutes(res.policy.tabDiscardMinutes)
        setMaxActiveTabs(res.policy.maxActiveTabs)
      }
    }).catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  const handleUpdateTabDiscardMinutes = async (minutes: number) => {
    setTabDiscardMinutes(minutes)
    try {
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke?.('set_tab_discard_policy', { tabDiscardMinutes: minutes })
      if (res?.success && res.policy) {
        setTabDiscardMinutes(res.policy.tabDiscardMinutes)
      } else if (res?.reason) {
        console.error('Failed to update tab discard policy:', res.reason)
      }
    } catch (e) {
      console.error('Failed to update tab discard policy:', e)
    }
  }

  const handleUpdateMaxActiveTabs = async (max: number) => {
    setMaxActiveTabs(max)
    try {
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke?.('set_tab_discard_policy', { maxActiveTabs: max })
      if (res?.success && res.policy) {
        setMaxActiveTabs(res.policy.maxActiveTabs)
      } else if (res?.reason) {
        console.error('Failed to update max active tabs policy:', res.reason)
      }
    } catch (e) {
      console.error('Failed to update max active tabs policy:', e)
    }
  }
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(loadInterfaceSettings)

  // One-time promotion and hydration of interface settings
  useEffect(() => {
    if (!tabsHydrated) return
    window.nexusState?.get('interface_settings').then((diskData: unknown) => {
      let parsed = diskData
      if (typeof parsed === 'string' && parsed.trim()) {
        try {
          parsed = JSON.parse(parsed)
        } catch {}
      }
      if (parsed == null) {
        const local =
          localStorage.getItem('nexus.interfaceSettings') || localStorage.getItem('vicinae.interfaceSettings')
        if (local) {
          try {
            const localObj = JSON.parse(local)
            window.nexusState?.save('interface_settings', localObj).catch(() => {})
          } catch {}
        }
      } else if (typeof parsed === 'object') {
        setInterfaceSettings((prev) => ({ ...prev, ...(parsed as Partial<InterfaceSettings>) }))
      }
    }).catch(() => {})
  }, [tabsHydrated])

  const [themeState, setThemeState] = useState(loadThemeState)

  // Apply unified theme and interface CSS variables in coordinated pipeline
  useEffect(() => {
    const activeTheme = findTheme(themeState)
    applyTheme(activeTheme)
    applyInterfaceCssVariables(interfaceSettings, activeTheme)
    if (window.electron?.platform === 'win32') {
      window.electron?.ipcRenderer.invoke('set_titlebar_overlay_theme', {
        color: activeTheme.colors.bg,
        symbolColor: activeTheme.colors.text
      }).catch(() => {})
    }
  }, [themeState.activeId, themeState.customs, interfaceSettings])

  useEffect(() => {
    if (tabsHydrated) {
      window.nexusState?.save('interface_settings', interfaceSettings).catch(() => {})
    }
  }, [interfaceSettings, tabsHydrated])

  useEffect(() => {
    saveThemeState(themeState)
  }, [themeState])

  // Webview theme: persisted toggle; re-sent to main whenever theme or interface settings change
  const [webviewThemeOn, setWebviewThemeOn] = useState(
    () => localStorage.getItem('vicinae.webviewThemeOn') !== '0'
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
      ambientAuraLive: interfaceSettings.ambientAuraLive !== false,
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
  // pushed back only on intentional mutations.
  const [providerConfig, setProviderConfig] = useState<ProviderConfigMap>({})
  const [providerConfigLoaded, setProviderConfigLoaded] = useState(false)
  const lastSavedProviderConfigRef = useRef<string>('')

  useEffect(() => {
    let cancelled = false
    window.electron?.ipcRenderer.invoke('get_provider_config').then((map: ProviderConfigMap) => {
      if (!cancelled && map && typeof map === 'object') {
        setProviderConfig(map)
        lastSavedProviderConfigRef.current = JSON.stringify(map)
        setProviderConfigLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!providerConfigLoaded) return
    const serialized = JSON.stringify(providerConfig)
    if (serialized === lastSavedProviderConfigRef.current) return
    if (Object.keys(providerConfig).length === 0 && lastSavedProviderConfigRef.current !== '' && lastSavedProviderConfigRef.current !== '{}') {
      return
    }
    lastSavedProviderConfigRef.current = serialized
    window.electron?.ipcRenderer.send('set_provider_config', providerConfig)
  }, [providerConfig, providerConfigLoaded])

  const usageCounts = useMemo(() => countModelUsage(tabs, history), [tabs, history])

  // Provider colour and icon come from one resolver (lib/providerVisuals), so the tab list, the title
  // bar pillar and this shell cannot disagree about what a provider looks like.
  const modelColors = useMemo(() => providerColorMap(models), [models])

  // The per-provider "Custom SVG Icon Markup" from Settings → AI Providers, handed to the tab
  // surfaces so a configured icon actually appears on them and not just in settings.
  const modelIcons = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of models) {
      const icon = providerIconFor(m.key, models)
      if (icon) map[m.key] = icon
    }
    return map
  }, [models])
  // Provider names for the tab rows: the configured icon comes from `modelIcons`, the brand icon from
  // the key, and the initial (the last resort before the neutral mark) from the provider's label.
  const modelNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of models) map[m.key] = providerLabelFor(m.key, models)
    return map
  }, [models])
  const colorFor = (key: string) => providerColorFor(key, models)

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id))
  }

  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutomaticSnapshotRef = useRef(new Map<string, number>())
  useEffect(() => () => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
    lastAutomaticSnapshotRef.current.clear()
  }, [])

  // Pause CPU animations and background compositor work when window is hidden or minimized
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        document.documentElement.classList.add('document-hidden')
      } else {
        document.documentElement.classList.remove('document-hidden')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    handleVisibility()
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

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

  useEffect(() => {
    const currentIds = new Set(tabs.map((tab) => tab.id))
    for (const id of lastAutomaticSnapshotRef.current.keys()) {
      if (!currentIds.has(id)) lastAutomaticSnapshotRef.current.delete(id)
    }
  }, [tabs])

  const scheduleSnapshotCapture = useCallback(
    (id: string, delay = 1500) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = setTimeout(() => {
        const now = Date.now()
        const previous = lastAutomaticSnapshotRef.current.get(id)
        if (!shouldCaptureAutomaticSnapshot(previous, now, document.visibilityState === 'hidden')) return
        lastAutomaticSnapshotRef.current.set(id, now)
        captureActiveSnapshot(id).then((snapshot) => {
          if (!snapshot && lastAutomaticSnapshotRef.current.get(id) === now) {
            lastAutomaticSnapshotRef.current.delete(id)
          }
        })
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
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false)

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
  useEffect(() => { pinnedIdsRef.current = pinnedIds }, [pinnedIds])

  /**
   * Tell the stylesheet whether this window is in the foreground.
   *
   * The sidebar is full of loops that never end on purpose — a breathing arc on the active tab, a
   * ripple on the container ring, a slow shimmer across the label. Each one is cheap; together, on five
   * rows, they keep the compositor awake at 60 frames a second for a window that is behind an editor.
   * `App.css` pauses every animation and transition under
   * `html[data-window-focus='blurred']`, and this is what sets it.
   *
   * Both signals are used: the DOM's own focus/blur (which follows what the compositor thinks) and the
   * main process's verdict (which follows the real OS window, and is the only one that is right when
   * the window is covered rather than unfocused).
   */
  useEffect(() => {
    const apply = (focused: boolean): void => {
      document.documentElement.dataset.windowFocus = focused ? 'focused' : 'blurred'
    }
    const onFocus = (): void => apply(true)
    const onBlur = (): void => apply(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    apply(typeof document.hasFocus === 'function' ? document.hasFocus() : true)
    const off = window.electron?.ipcRenderer?.on(
      'window-focus-changed',
      (_event: unknown, focused: boolean): void => apply(Boolean(focused))
    )
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      if (typeof off === 'function') off()
    }
  }, [])

  /**
   * Tell the stylesheet whether anyone is *doing* anything, not just whether the window is in front.
   *
   * Build 50 stopped the sidebar's endless loops while the window was behind another one. That left the
   * case the user actually reports: Nexus in front, nobody touching it, an AI answer streaming in a
   * tab — and the shell still animating a breathing arc, a ripple and a shimmer sixty times a second,
   * with `backdrop-filter` layers on top of them. Fifteen seconds without a pointer, key or wheel event
   * is long enough to be sure, and the first event of any kind brings it back instantly, so this costs
   * nothing the user can see. Measured on the shell process of the report that led here: 26.9 % of a
   * core and 161 idle wakeups a second, for a window whose owner was reading, not clicking.
   */
  useEffect(() => {
    const IDLE_AFTER_MS = 15000
    let timer: ReturnType<typeof setTimeout> | null = null
    const setIdle = (idle: boolean): void => {
      document.documentElement.dataset.activity = idle ? 'idle' : 'active'
    }
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS)
    }
    const onActivity = (): void => {
      setIdle(false)
      arm()
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'focus']
    for (const event of events) window.addEventListener(event, onActivity, { passive: true })
    setIdle(false)
    arm()
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // What each address was the last time it was open: pinned or not, its two colours, its place in the
  // list. Kept here rather than on the tab because the tab row is the wrong lifetime — closing a tab and
  // opening the same conversation again must not produce a stranger.
  // A ref, not state: nothing renders from the memory, it is read when a tab appears and written when
  // a tab changes. Keeping it out of state also keeps the effects below from re-rendering the sidebar
  // every time a tab's colour or place is re-recorded.
  const tabMemoryRef = useRef<TabMemory>(loadTabMemoryFromStorage())
  // Tabs whose memory has already been applied. A tab is adopted once, when it first appears, so the
  // memory can never fight the user: re-pinning a tab by hand does not get undone by the stored value.
  const memoryAdoptedRef = useRef<Set<string>>(new Set())
  const memoryBootstrappedRef = useRef(false)


  // Reconcile pinned tabs on mount. A one-time non-destructive migration merges legacy
  // localStorage with backend pinned.json; subsequent boots treat the backend as authoritative.
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return

    const isMigrated = localStorage.getItem('vicinae.pinned.migrated_v1') === 'true'

    ipc
      .invoke('get_pinned')
      .then((rawDiskPinned: unknown) => {
        try {
          let diskList: string[] = []
          if (typeof rawDiskPinned === 'string' && rawDiskPinned.trim()) {
            const parsed = JSON.parse(rawDiskPinned)
            if (Array.isArray(parsed)) diskList = parsed.filter((id) => typeof id === 'string')
          } else if (Array.isArray(rawDiskPinned)) {
            diskList = (rawDiskPinned as unknown[]).filter((id) => typeof id === 'string') as string[]
          }

          if (!isMigrated) {
            // One-time non-destructive initial migration: union localStorage and disk
            const localRaw = localStorage.getItem('vicinae.pinned')
            const localList: string[] = localRaw ? JSON.parse(localRaw) : []
            const merged = Array.from(new Set([...localList, ...diskList]))
            setPinnedIds(merged)
            localStorage.setItem('vicinae.pinned', JSON.stringify(merged))
            localStorage.setItem('vicinae.pinned.migrated_v1', 'true')
            ipc.invoke('save_pinned', JSON.stringify(merged)).catch(() => {})
          } else {
            // Already migrated: backend is the authoritative single source of truth
            setPinnedIds(diskList)
            localStorage.setItem('vicinae.pinned', JSON.stringify(diskList))
          }
        } catch (e) {
          console.warn('[pin-sync] Reconciliation warning:', e)
        }
      })
      .catch(() => {})
  }, [])

  /**
   * Expanded unless the user says otherwise.
   *
   * The key is v2 on purpose. v1 remembered "collapsed" from a build where collapsing also switched the
   * footer to single-column rows; a window that started up with v1 set looked like the new layout had
   * failed to apply. Starting from v2 means everyone sees the sidebar the way it is designed once, and
   * whatever they choose after that is remembered.
   */
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      localStorage.removeItem('vicinae.sidebarCollapsed')
      return localStorage.getItem('vicinae.sidebarCollapsed.v2') === 'true'
    } catch {
      return false
    }
  })

  // Collapsed tiles keep the expanded arrangement — a label row, then the keys — with the label row
  // reduced to its icon. That only looks deliberate if the icon is centred, so every tile row shares
  // this class instead of each button deciding for itself.
  const tileLabelRow = `flex items-center gap-1.5 min-w-0${sidebarCollapsed ? ' justify-center' : ''}`

  const [loadingTabId, setLoadingTabId] = useState<string | null>(null)
  const [tabStatuses, setTabStatuses] = useState<Record<string, TabAiStatus>>({})

  // The number printed on each tab is the digit that opens it, counted down the list as it is drawn:
  // pinned, then active sessions, then the sleeping/discarded ones at the bottom. Numbering off the raw
  // tab array froze the badges once a tab was discarded (the list read 1, 2, 3, 5, 7, 8, 4, 6), so the
  // numbers are re-sorted whenever the grouping changes. One order feeds both the badges and the
  // Ctrl+1…9 handler, so a badge cannot point at the wrong tab.
  const pinnedSectionOrder = interfaceSettings.pinnedPosition === 'section'
  const visualTabOrder = useMemo(
    () =>
      partitionTabSections({
        tabs,
        activeId,
        pinnedIds,
        tabStatuses,
        residentTabIds,
        discardedTabIds,
        pinnedSection: pinnedSectionOrder
      }).order,
    [tabs, activeId, pinnedIds, tabStatuses, residentTabIds, discardedTabIds, pinnedSectionOrder]
  )
  const tabNumbers = useMemo(() => tabNumbersForOrder(visualTabOrder), [visualTabOrder])

  /**
   * Give a tab that has just appeared the state it had the last time its address was open.
   *
   * Runs when the tab *appears*, which is why it is driven by the tab list rather than by the four or
   * five places that create tabs: a tab arrives from a new chat, from history, from a container, from
   * Ctrl+T, from a restored session, and every one of them has to behave the same. The first render is
   * skipped on purpose — a restored list already carries its own colours and pinned ids, and re-applying
   * memory over it could only move things the user had arranged since.
   */
  useEffect(() => {
    const adopted = memoryAdoptedRef.current
    const firstPass = !memoryBootstrappedRef.current
    memoryBootstrappedRef.current = true
    let nextTabs = tabs
    const toPin: string[] = []
    const placements: { id: string; position: number | null; pinnedPosition: number | null }[] = []
    for (const tab of tabs) {
      if (adopted.has(tab.id)) continue
      adopted.add(tab.id)
      if (firstPass) continue
      const inherited = adoptTabMemory(tab, tabMemoryRef.current ?? {})
      if (inherited.tab !== tab) {
        nextTabs = nextTabs.map((candidate) => (candidate.id === tab.id ? inherited.tab : candidate))
      }
      if (inherited.pinned) toPin.push(tab.id)
      placements.push({
        id: tab.id,
        position: inherited.position,
        pinnedPosition: inherited.pinnedPosition
      })
    }
    // Pinned tabs are drawn in their own group, so their place there is a different index from their
    // place in the flat list. Both are restored, and the pinned one is applied against the pin list as
    // it will be once this pass has added to it.
    const pinnedAfter = Array.from(new Set([...pinnedIdsRef.current, ...toPin]))
    for (const placement of placements) {
      if (placement.pinnedPosition !== null) {
        nextTabs = applyRememberedPinnedPosition(
          nextTabs,
          placement.id,
          placement.pinnedPosition,
          pinnedAfter
        )
      } else if (placement.position !== null) {
        nextTabs = applyRememberedPosition(nextTabs, placement.id, placement.position)
      }
    }
    if (nextTabs !== tabs) setTabs(nextTabs)
    if (toPin.length > 0) {
      const merged = Array.from(new Set([...pinnedIdsRef.current, ...toPin]))
      pinnedIdsRef.current = merged
      setPinnedIds(merged)
      try {
        localStorage.setItem('vicinae.pinned', JSON.stringify(merged))
        const bridge = window.electron as
          | { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }
          | undefined
        void bridge?.ipcRenderer?.invoke('save_pinned', JSON.stringify(merged))?.catch(() => {})
      } catch {
        /* pinning is already applied in this session */
      }
    }
  }, [tabs])

  /**
   * A tab that leaves the sidebar must be a stranger again.
   *
   * Ctrl+Shift+T re-inserts the tab object it stored when the tab was closed — the same id, not a new
   * one — so "have I adopted this tab already?" answered yes and the reopened tab kept neither its pin
   * nor its colours. The same cold-start applies to the colours sent to a tab's view: main drops them
   * with the view, and a renderer that thinks it has already sent them sends nothing.
   */
  useEffect(() => {
    const live = new Set(tabs.map((tab) => tab.id))
    for (const id of Array.from(memoryAdoptedRef.current)) {
      if (!live.has(id)) memoryAdoptedRef.current.delete(id)
    }
    for (const id of Object.keys(sentTabColorsRef.current)) {
      if (!live.has(id)) delete sentTabColorsRef.current[id]
    }
  }, [tabs])

  /** Keep the memory in step with the tabs that are open now, and persist it. */
  useEffect(() => {
    const current = tabMemoryRef.current ?? {}
    const next = rememberTabs(current, tabs, pinnedIds)
    if (serializeTabMemory(next) === serializeTabMemory(current)) return
    tabMemoryRef.current = next
    try {
      localStorage.setItem(TAB_MEMORY_STORAGE_KEY, serializeTabMemory(next))
    } catch {
      /* storage full or unavailable: this run just will not remember */
    }
  }, [tabs, pinnedIds])
  const tabStatusesRef = useRef<Record<string, TabAiStatus>>({})
  useEffect(() => {
    tabStatusesRef.current = tabStatuses
  }, [tabStatuses])
  const isWindowFocusedRef = useRef(true)

  useEffect(() => {
    // Initial check from main process
    // @ts-ignore
    window.electron?.ipcRenderer?.invoke('is_app_focused').then((focused: boolean) => {
      if (typeof focused === 'boolean') isWindowFocusedRef.current = focused
    }).catch(() => {})

    const handleMainFocus = (_e: any, focused: boolean) => {
      isWindowFocusedRef.current = Boolean(focused)
    }
    // @ts-ignore
    window.electron?.ipcRenderer?.on('window-focus-changed', handleMainFocus)

    const handleSwitchToTabFromNotif = (_e: any, targetTabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === targetTabId)
      if (tab && tab.url) {
        switchToTabRef.current?.(targetTabId, tab.url)
      }
    }
    // @ts-ignore
    window.electron?.ipcRenderer?.on('notification_switch_to_tab', handleSwitchToTabFromNotif)

    // Main asks again when an overlay has been open for a while: a panel that unmounted without
    // clearing its flag would otherwise leave every native view hidden until the app was restarted.
    const handleOverlayStateRequest = () => {
      // @ts-ignore
      window.electron?.ipcRenderer?.send(
        'set_overlays_open',
        isAnyOverlayOpen(overlayFlagsRef.current),
        openOverlayKeys(overlayFlagsRef.current)
      )
    }
    // @ts-ignore
    window.electron?.ipcRenderer?.on('overlays_state_requested', handleOverlayStateRequest)

    return () => {
      // @ts-ignore
      window.electron?.ipcRenderer?.removeListener('overlays_state_requested', handleOverlayStateRequest)
      // @ts-ignore
      window.electron?.ipcRenderer?.removeListener('window-focus-changed', handleMainFocus)
      // @ts-ignore
      window.electron?.ipcRenderer?.removeListener('notification_switch_to_tab', handleSwitchToTabFromNotif)
    }
  }, [])

  // Live per-tab title/URL/loading updates from the main process
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return

    const checkIsDefaultTitle = (t: string, m: string) => {
      return isDefaultConversationTitle(t, m);
    };

    const onTitle = (_e: unknown, tabId: string, rawTitle: string) => {
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.id === tabId)
        if (!existingTab) return prev;

        const effectiveTitle = cleanConversationTitle(rawTitle, existingTab.model) || (rawTitle || '').trim()
        if (!effectiveTitle || existingTab.title === effectiveTitle) return prev;

        const incomingIsDefault = checkIsDefaultTitle(effectiveTitle, existingTab.model);
        const currentIsDefault = checkIsDefaultTitle(existingTab.title, existingTab.model);

        // Don't overwrite a good title with a trash/default title during loads!
        if (incomingIsDefault && !currentIsDefault) {
          return prev;
        }

        const nextTabs = prev.map((t) => (t.id === tabId ? { ...t, title: effectiveTitle } : t))
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
              (h) => h.url !== updatedTab.url && h.title !== effectiveTitle
            )

            const newHistoryItem = {
              id: updatedTab.id,
              title: effectiveTitle,
              url: updatedTab.url,
              model: updatedTab.model,
              thumbnail: existingItem?.thumbnail,
              // The colour is how this project is recognised in a list of forty conversations.
              ...(updatedTab.accentColor ? { accentColor: updatedTab.accentColor } : {}),
              ...(updatedTab.auraColor ? { auraColor: updatedTab.auraColor } : {}),
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

    /**
     * A tab told us its URL changed.
     *
     * This used to do all of its work — including the trace note and the history write — inside a
     * `setTabs` updater. React is allowed to call an updater more than once (StrictMode always does),
     * so every URL change produced four identical "URL report accepted" lines in the trace and four
     * history writes. The decision is now made once against `tabsRef`, then written once.
     */
    const onUrl = (_e: unknown, tabId: string, url: string) => {
      // A provider that bounces itself back to its home page must not overwrite the deep chat link the
      // tab is on — but the *user* asking for that page is a different matter. This used to be one
      // rule, which is why a restored tab (sitting on a chat URL, not a home URL) ignored every
      // navigation from the address bar: the URL never reached the tab, so the next activation put the
      // old page back. "Ctrl+L only works on new tabs" was exactly this.
      const pending = userNavigationRef.current
      let isUserNavigation = false
      if (pending && pending.tabId === tabId && Date.now() - pending.at < 30_000) {
        try {
          const host = new URL(url).host.toLowerCase()
          isUserNavigation = host === pending.host || host.endsWith(`.${pending.host}`)
        } catch {
          isUserNavigation = false
        }
      }
      if (isUserNavigation) userNavigationRef.current = null

      const existing = tabsRef.current.find((t) => t.id === tabId)
      if (!existing) return

      if (
        !shouldAcceptReportedUrl({
          reportedUrl: url,
          currentUrl: existing.url,
          isUserNavigation
        })
      ) {
        traceNote(tabId, 'URL report dropped (provider bounced to its home page)', {
          reported: url,
          current: existing.url,
          userNavigation: isUserNavigation
        })
        return
      }

      if (!url) return

      const resolvedModel = resolveActiveProviderKey({ ...existing, url }, models)
      const nextTabs = tabsRef.current.map((t) =>
        t.id === tabId ? { ...t, url, model: resolvedModel || t.model } : t
      )
      // Keep the mirror in step so a burst of reports in one tick is not applied against stale tabs.
      tabsRef.current = nextTabs
      setTabs(nextTabs)

      const updatedTab = nextTabs.find((t) => t.id === tabId)
      const isConversationUrl = Boolean(
        updatedTab?.url &&
          updatedTab.url.length > 3 &&
          !updatedTab.url.endsWith('.com/') &&
          !updatedTab.url.endsWith('.ai/')
      )

      traceNote(tabId, 'URL report accepted', {
        reported: url,
        userNavigation: isUserNavigation,
        ...(isConversationUrl ? {} : { history: 'home page, not saved' })
      })

      if (!updatedTab || !isConversationUrl) return

      setHistory((prevHistory) => {
        const rawTitle = updatedTab.title || updatedTab.model.toUpperCase()
        const title = cleanConversationTitle(rawTitle, updatedTab.model) || rawTitle
        const isDefaultTitle = checkIsDefaultTitle(title, updatedTab.model)

        if (isDefaultTitle) return prevHistory // Do not corrupt history with trash!

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
          // The colour is how this project is recognised in a list of forty conversations.
          ...(updatedTab.accentColor ? { accentColor: updatedTab.accentColor } : {}),
          ...(updatedTab.auraColor ? { auraColor: updatedTab.auraColor } : {}),
          timestamp: Date.now(),
          updatedAt: new Date().toISOString()
        }
        const finalHistory = [newHistoryItem, ...updatedHistory].slice(0, 100)
        // Writing inside a `setHistory` updater is the same impure-updater bug; do it on the next tick.
        queueMicrotask(() => {
          window.electron?.ipcRenderer
            .invoke('save_history', JSON.stringify(finalHistory))
            .catch(() => {})
        })
        return finalHistory
      })
    }

  const onLoading = (_e: unknown, tabId: string, loading: boolean) => {
      setLoadingTabId(loading ? tabId : null)
      // NOTE: Chromium page navigation loading (did-start/stop-loading)
      // must NOT alter AI generation status. Only live DOM observer (onLiveStatus) sets AI status.
    }

    const onLiveStatus = (
      _e: unknown,
      tabId: string,
      isGenerating: boolean
    ) => {
      // Legacy compatibility: loading spinner indicator only;
      // Authoritative lifecycle badges and notifications are owned by onLifecycleStatus.
      if (isGenerating) {
        setLoadingTabId(tabId)
      } else {
        setLoadingTabId((prev) => (prev === tabId ? null : prev))
      }
    }

    const onLifecycleStatus = (_e: unknown, update: AiLifecycleStatusUpdate) => {
      if (!update || !update.tabId) return
      const { tabId, status } = update
      if (status === 'working') {
        setLoadingTabId(tabId)
      } else {
        setLoadingTabId((prev) => (prev === tabId ? null : prev))
      }

      setTabStatuses((prev) => {
        let badgeStatus: TabAiStatus = 'idle'
        if (status === 'working') badgeStatus = 'working'
        else if (status === 'waiting-input') badgeStatus = 'waiting-input'
        else if (status === 'done') badgeStatus = 'done'
        else if (status === 'error') badgeStatus = 'error'
        else badgeStatus = 'idle'

        const prevStatus = prev[tabId]
        if (prevStatus === badgeStatus) return prev

        // Sound effect on genuine completion transition:
        if (prevStatus === 'working' && (status === 'done' || status === 'waiting-input')) {
          const isActive = tabId === activeIdRef.current
          if (!isActive || !isWindowFocusedRef.current) {
            if (status === 'waiting-input') {
              sfx.aiPromptAlert()
            } else {
              sfx.chime()
            }
          }
        }

        return {
          ...prev,
          [tabId]: badgeStatus
        }
      })
    }

    ipc.on('ai-title-updated', onTitle)
    ipc.on('ai-url-updated', onUrl)
    ipc.on('ai-loading', onLoading)
    ipc.on('ai-live-status', onLiveStatus)
    ipc.on('ai-lifecycle-status', onLifecycleStatus)
    return () => {
      ipc.removeListener('ai-title-updated', onTitle)
      ipc.removeListener('ai-url-updated', onUrl)
      ipc.removeListener('ai-loading', onLoading)
      ipc.removeListener('ai-live-status', onLiveStatus)
      ipc.removeListener('ai-lifecycle-status', onLifecycleStatus)
    }
  }, [])

  const closeTab = (idToClose: string) => {
    setResidentTabIds((prev) => prev.filter((id) => id !== idToClose))
    setTabStatuses((prev) => {
      if (!(idToClose in prev)) return prev
      const next = { ...prev }
      delete next[idToClose]
      return next
    })
    const targetTab = tabs.find(t => t.id === idToClose)
    if (targetTab) {
      const index = tabs.findIndex(t => t.id === idToClose)
      const isPinned = pinnedIds.includes(idToClose)
      setClosedTabsStack(prev => pushClosedTab(prev, targetTab, index, isPinned))
    }

    const updated = tabs.filter((t) => t.id !== idToClose)
    setTabs(updated)
    if (pinnedIds.includes(idToClose)) {
      setPinnedIds((prev) => {
        const next = prev.filter((p) => p !== idToClose)
        localStorage.setItem('vicinae.pinned', JSON.stringify(next))
        window.electron?.ipcRenderer?.invoke('save_pinned', JSON.stringify(next)).catch(() => {})
        return next
      })
    }
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
      window.electron?.ipcRenderer?.invoke('save_pinned', JSON.stringify(updated)).catch(() => {})
      return updated
    })
  }

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('vicinae.sidebarCollapsed.v2', String(next))
      } catch (e) {
        console.error(e)
      }
      return next
    })
  }

  const containerRef = useRef<HTMLDivElement>(null)
  // Read by containerBounds(), which is also called from observers: a ref keeps the geometry
  // functions free of the render cycle.
  const auraRingColorRef = useRef<string | undefined>(undefined)
  const auraRingStrengthRef = useRef<number>(DEFAULT_CONTAINER_AURA_STRENGTH)

  const containerBounds = () => {
    if (showBootSequence) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const base = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    }
    // A coloured container draws its aura in the space the native view leaves free — and how much space
    // that is belongs to the user (Settings → Style → Container aura). Strength 0 means no ring, so the
    // page goes flush to the edge and the inset has to be zero too, not a hidden 6px gap.
    if (!auraRingColorRef.current) return base
    const inset = insetRectForAura(base, true, auraRingStrengthRef.current)
    return { x: inset.x, y: inset.y, width: inset.width, height: inset.height }
  }

  const switchToTab = useCallback(
    (id: string, url: string) => {
      // Keyboard events can arrive before React commits. Keep the navigation
      // source of truth synchronous so repeated Ctrl+Tab cannot reuse stale state.
      activeIdRef.current = id
      setActiveId(id)
      const nextResident = residentTabIdsRef.current.includes(id)
        ? residentTabIdsRef.current
        : [...residentTabIdsRef.current, id]
      residentTabIdsRef.current = nextResident
      setResidentTabIds(nextResident)
      const nextDiscarded = discardedTabIdsRef.current.filter((tabId) => tabId !== id)
      discardedTabIdsRef.current = nextDiscarded
      setDiscardedTabIds(nextDiscarded)
      // The in-app toast is *not* dismissed here. This used to fire on every single tab switch, which is
      // why notifications vanished the moment the user moved between tabs. It now lives out its timer
      // (clicking it opens the tab, the X closes it), and main hides it only while a panel is up.

      const bounds = containerBounds() || { x: 0, y: 0, width: 0, height: 0 }
      if (url) {
        const modelKey = tabs.find((t) => t.id === id)?.model
        // The container decides the partition, and main fixes that when it creates the view. The
        // ref, not state, because a container tab is opened and activated in the same tick.
        const containerId = tabContainersRef.current[id] || containerIdOf(tabs.find((t) => t.id === id))
        // @ts-ignore
        window.electron?.ipcRenderer.send('activate_tab', id, url, bounds, modelKey, containerId)
      }
      scheduleSnapshotCapture(id)
    },
    [scheduleSnapshotCapture, tabs]
  )

  const loadTabUrl = useCallback(
    (id: string, url: string) => {
      switchToTab(id, url)
    },
    [switchToTab]
  )

  const togglePinRef = useRef(togglePin)
  useEffect(() => { switchToTabRef.current = switchToTab }, [switchToTab])
  useEffect(() => { togglePinRef.current = togglePin }, [togglePin])

  useEffect(() => {
    const handleTabCycleIPC = (_event: any, data: { shift: boolean }) => {
      const visualTabs = getOrderedVisualTabs(
        tabsRef.current,
        activeIdRef.current,
        pinnedIdsRef.current,
        tabStatusesRef.current,
        residentTabIdsRef.current,
        discardedTabIdsRef.current
      )
      if (visualTabs.length <= 1) return

      const nextTab = getNextVisualTab(visualTabs, activeIdRef.current, Boolean(data?.shift))
      if (nextTab && nextTab.url) {
        setShowUrlBar(false)
        setShowTabOverview(false)
        setShowNewTab(false)
        sfx.pop()
        switchToTabRef.current?.(nextTab.id, nextTab.url)
      }
    }

    const handleTogglePinTab = (_event: any, tabId: string) => {
      togglePinRef.current(tabId)
    }

    // @ts-ignore
    // A tab's view was rebuilt — by the menu's "Restart tab", by "Discard from memory", or by the
    // surface probe finding flat pixels on a page that has content. The tab keeps its id, so the
    // sidebar needs nothing; the *view* is gone, and the only thing that brings it back is activating
    // the tab again, which is what a person does by clicking it.
    const handleTabRestarted = (_event: unknown, tabId: string, outcome: string): void => {
      if (typeof tabId !== 'string' || !tabId) return
      if (outcome !== 'ok') return
      if (tabId !== activeIdRef.current) return
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
      if (!tab || !tab.url) return
      switchToTabRef.current?.(tab.id, tab.url)
    }

    const unsubCycle = window.electron?.ipcRenderer.on('trigger_tab_cycle', handleTabCycleIPC)
    // @ts-ignore
    const unsubPin = window.electron?.ipcRenderer.on('toggle_pin_tab', handleTogglePinTab)
    const unsubRestarted = window.electron?.ipcRenderer.on('tab_restarted', handleTabRestarted)

    // Main has just built a view for this tab and wants to know what it should look like. Answering
    // here rather than only on activation is what colours a *rebuilt* view: discard, restart, the
    // blank-surface rebuild and Ctrl+Shift+T all land in this handler.
    const handleRequestTabColors = (_event: unknown, tabId: string): void => {
      if (typeof tabId !== 'string' || !tabId) return
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
      const colors = sanitiseTabColors(tab ?? {})
      const key = `${colors.accentColor ?? ''}|${colors.auraColor ?? ''}`
      sentTabColorsRef.current[tabId] = key
      window.electron?.ipcRenderer.send('set_tab_colors', tabId, {
        accentColor: colors.accentColor,
        auraColor: colors.auraColor
      })
    }
    const unsubColors = window.electron?.ipcRenderer.on('request_tab_colors', handleRequestTabColors)

    return () => {
      if (typeof unsubCycle === 'function') unsubCycle()
      if (typeof unsubPin === 'function') unsubPin()
      if (typeof unsubRestarted === 'function') unsubRestarted()
      if (typeof unsubColors === 'function') unsubColors()
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

  /**
   * Opens a tab in a container. The container is recorded before activation so main creates the view
   * on that container's partition — the one determined by view creation, not by a later switch.
   */
  const openContainerTab = useCallback(
    (containerId: string) => {
      const container = findContainer(containersRef.current, containerId)
      const model = (resolvedActiveModelKey || 'gemini') as ModelKey
      const url = getModelUrl(model)
      const label = container.name && container.id !== 'default' ? container.name : modelLabel(model)
      const created = createTab(model, label, url, undefined, container.id)
      tabContainersRef.current[created.id] = container.id
      setTabs((prev) => [...prev, created])
      loadTabUrl(created.id, url)
      setShowContainerMenu(false)
    },
    [resolvedActiveModelKey, loadTabUrl]
  )

  const saveContainer = useCallback(
    async (input: { id?: string; name: string; color?: string | null; accountId: string }) => {
      const result = (await window.electron?.containers?.save?.(input)) as
        | { container?: ContainerInfo; error?: string }
        | undefined
      if (result?.error) return { error: result.error }
      await loadContainers()
      return {}
    },
    [loadContainers]
  )

  const deleteContainer = useCallback(
    async (containerId: string) => {
      const result = (await window.electron?.containers?.remove?.(containerId)) as
        | { removed?: boolean; error?: string }
        | undefined
      if (result?.error) return { error: result.error }
      // Tabs that lived there return to the default container. The store they were created with
      // cannot move with them — Electron fixes a partition at view creation — so the tab is relabelled
      // and keeps working, and its next navigation is what would move it.
      setTabs((prev) =>
        prev.map((tab) =>
          tab.containerId === containerId ? { ...tab, containerId: undefined } : tab
        )
      )
      for (const [tabId, id] of Object.entries(tabContainersRef.current)) {
        if (id === containerId) delete tabContainersRef.current[tabId]
      }
      await loadContainers()
      return {}
    },
    [loadContainers]
  )

  /**
   * Reordering is optimistic: the row moves under the pointer, then main writes the order down.
   *
   * The list *is* the numbering — the switcher lists it and `Ctrl+Alt+N` opens the Nth — so a failed
   * write has to put the old order back rather than leave the panel disagreeing with main.
   */
  const reorderContainer = useCallback((containerId: string, delta: number) => {
    const before = containersRef.current
    const next = moveContainerInList(before, containerId, delta)
    if (next === before) return
    setContainers(next)
    containersRef.current = next
    const restore = (): void => {
      setContainers(before)
      containersRef.current = before
    }
    void (async () => {
      try {
        const result = (await window.electron?.containers?.reorder?.(next.map((c) => c.id))) as
          | { containers?: ContainerInfo[]; error?: string }
          | undefined
        if (result?.error) {
          setContainerHint(result.error)
          restore()
          return
        }
        if (Array.isArray(result?.containers)) {
          setContainers(result.containers)
          containersRef.current = result.containers
        }
      } catch (err) {
        console.warn('[containers] Reorder failed:', err)
        setContainerHint('Could not save the new order.')
        restore()
      }
    })()
  }, [])

  /**
   * Signing a profile in again: main clears that account's store and opens Google's account chooser,
   * so the account can be changed or a second one added. The panel closes first — the sign-in window
   * is its own window, and leaving the panel open underneath it would put the two in each other's way.
   */
  const reconnectContainer = useCallback(async (containerId: string) => {
    const container = findContainer(containersRef.current, containerId)
    const result = (await window.electron?.containers?.reconnect?.(containerId)) as
      | { ok?: boolean; error?: string }
      | undefined
    if (!result?.ok) {
      return { ok: false, error: result?.error ?? 'Could not start the sign-in again.' }
    }
    setShowContainerManager(false)
    requestAnimationFrame(() => restoreViewBoundsRef.current?.())
    setContainerHint(
      `Signing ${container.name} in again — pick the account in the window that just opened.`
    )
    return { ok: true }
  }, [])

  // What happened after the sign-in window closed. A separate channel from `google-signin-event`,
  // which the settings panel owns and clears on unmount.
  useEffect(() => {
    // @ts-ignore
    const cleanup = window.electron?.ipcRenderer?.on?.(
      'container-reconnect-event',
      (
        _event: unknown,
        payload: { containerName?: string; stage?: string; message?: string }
      ) => {
        if (payload?.stage === 'success') {
          setContainerHint(
            `${payload.containerName ?? 'The profile'} is signed in again — its tabs were reloaded. ` +
              'If you chose a different account, rename it from Edit.'
          )
          return
        }
        if (payload?.stage === 'failed' || payload?.stage === 'blocked') {
          setContainerHint(payload.message ?? 'The sign-in did not finish.')
        }
      }
    )
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  useEffect(() => {
    openContainerTabRef.current = openContainerTab
  }, [openContainerTab])

  useEffect(() => {
    // Main broadcasts after a save/delete so every window and every live view agrees.
    // @ts-ignore
    const unsub = window.electron?.ipcRenderer.on('containers-changed', (_event: any, list: ContainerInfo[]) => {
      if (!Array.isArray(list) || list.length === 0) return
      setContainers(list)
      containersRef.current = list
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const handleDeployModel = (model: ModelKey) => {
    const url = getModelUrl(model)
    const existingProviderTab = tabs.find(
      (t) => resolveActiveProviderKey(t, models) === model || t.model === model
    )
    if (existingProviderTab) {
      switchToTab(existingProviderTab.id, existingProviderTab.url)
    } else {
      const result = switchToModel(tabs, model, modelLabel(model), url)
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

  // One list decides both "is the workspace covered?" and "what does Escape close" — see
  // lib/overlays.ts. The container switcher and its manager are overlays like any other: they overlap
  // the native AI view, and a native view is always painted above the DOM, so being an overlay is
  // what puts them in front instead of under a blank rectangle.
  const overlayFlags = useMemo(
    () => ({
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
      showDiagnosticsModal,
      showTabColors,
      showContainerMenu,
      showContainerModal,
      showContainerManager,
      folderUploadData: Boolean(folderUploadData)
    }),
    [
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
      showDiagnosticsModal,
      showTabColors,
      showContainerMenu,
      showContainerModal,
      showContainerManager,
      folderUploadData
    ]
  )
  const anyOverlayOpen = useMemo(() => isAnyOverlayOpen(overlayFlags), [overlayFlags])
  const anyOverlayOpenRef = useRef(anyOverlayOpen)
  anyOverlayOpenRef.current = anyOverlayOpen
  const overlayFlagsRef = useRef(overlayFlags)
  overlayFlagsRef.current = overlayFlags

  // Restore the native webview bounds + focus (used when an overlay closes via Escape)
  useEffect(() => {
    const changed = auraRingColorRef.current !== activeContainerColor
    auraRingColorRef.current = activeContainerColor
    // The view has to be inset by the ring's width, and only a new bounds message makes main move it.
    if (changed) restoreViewBoundsRef.current?.()
  }, [activeContainerColor])

  // The ring's *width* is a setting too: moving the slider has to move the native view with it, or the
  // ring would grow under the page instead of around it.
  const containerAuraStrength = interfaceSettings.containerAuraStrength ?? DEFAULT_CONTAINER_AURA_STRENGTH
  useEffect(() => {
    const changed = auraRingStrengthRef.current !== containerAuraStrength
    auraRingStrengthRef.current = containerAuraStrength
    if (changed) restoreViewBoundsRef.current?.()
  }, [containerAuraStrength])

  /**
   * A paste that lands on the shell lands in the prompt.
   *
   * The composer is in the tab's native view, not in this renderer, so Ctrl+V with the sidebar (or a
   * footer button, or the tab strip) focused was delivered to a document with nothing editable in it
   * and simply vanished — the user had to click the page first. This listener catches the paste before
   * any of that, refuses to touch it when it *is* going somewhere editable (an overlay's input, a
   * settings field), and otherwise hands it to main, which gives the keyboard to the active tab, puts
   * the caret back where it was and pastes for real.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA') return
      if (anyOverlayOpenRef.current) return
      event.preventDefault()
      // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
      window.electron?.ipcRenderer?.send?.('paste_to_active_view')
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [])

  const restoreViewBounds = useCallback(() => {
    if (anyOverlayOpenRef.current) {
      return
    }
    const bounds = containerBounds()
    if (bounds && bounds.width > 0 && bounds.height > 0 && window.electron) {
      // @ts-ignore
      window.electron.ipcRenderer.send('resize_view', bounds)
    }
  }, [])

  const restoreViewBoundsRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    restoreViewBoundsRef.current = restoreViewBounds
  }, [restoreViewBounds])

  // Every overlay's setter, keyed by the same names as lib/overlays.ts. One map, so "close everything"
  // is a loop over the panel list instead of a second list that can fall out of date.
  const overlaySetters = useMemo<Record<OverlayKey, (open: boolean) => void>>(
    () => ({
      showHistory: setShowHistory,
      showTabOverview: setShowTabOverview,
      showSettings: setShowSettings,
      showNewTab: setShowNewTab,
      showExport: setShowExport,
      showUrlBar: setShowUrlBar,
      showGuide: setShowGuide,
      showSkillsPalette: setShowSkillsPalette,
      showBaseSkillsModal: setShowBaseSkillsModal,
      showSkillParamsModal: setShowSkillParamsModal,
      showSkillEditorModal: setShowSkillEditorModal,
      showCategoryManagerModal: setShowCategoryManagerModal,
      showBootSequence: setShowBootSequence,
      showDiagnosticsModal: setShowDiagnosticsModal,
      showTabColors: setShowTabColors,
      showContainerMenu: setShowContainerMenu,
      showContainerModal: setShowContainerModal,
      showContainerManager: setShowContainerManager,
      folderUploadData: (open: boolean) => {
        if (!open) setFolderUploadData(null)
      }
    }),
    []
  )

  /**
   * Closes whatever is open and reports what it closed.
   *
   * Escape, the scrim, the close buttons and main's watchdog all end up here. It cannot forget a
   * panel, because the panel list lives in lib/overlays.ts and is the same list that decides whether
   * the native view is hidden — the two used to disagree, which is how a panel could be open with the
   * AI view hidden behind it and nobody able to close it.
   */
  const closeAllOverlays = useCallback((): OverlayKey[] => {
    const open = dismissibleOverlayKeys(overlayFlagsRef.current)
    if (open.length > 0) console.log('[overlay] closing', open.join(', '))
    for (const key of open) overlaySetters[key]?.(false)
    return open
  }, [overlaySetters])

  // The colour picker is an overlay like any other, and the native webview is a separate surface
  // painted *above* the DOM. Opening the dialog without hiding that surface puts the dialog behind
  // the page — which looks exactly like "the button did nothing".
  const openTabColors = useCallback(() => {
    if (!activeIdRef.current) return
    setShowHistory(false)
    setShowTabOverview(false)
    setShowSettings(false)
    setShowNewTab(false)
    setShowExport(false)
    setShowUrlBar(false)
    setShowGuide(false)
    setShowSkillsPalette(false)
    setShowBaseSkillsModal(false)
    setShowTabColors(true)
    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
    window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
  }, [])

  // One owner for the Tab Overview panel. It was duplicated in both footers; the sidebar now has
  // three entry points (button beside Agent Handoff, the key, and the title-bar button), so the
  // "capture first, then close everything else" rule lives here instead of in three places.
  const toggleTabOverviewPanel = useCallback(async () => {
    const nextState = !showTabOverviewRef.current
    // Recorded now, not in the mirror effect below: two clicks in one tick would otherwise both read
    // "closed" and both ask to open, and the second would win while the first's capture is in flight.
    showTabOverviewRef.current = nextState
    if (nextState) {
      await captureActiveSnapshot()
    }
    setShowTabOverview(nextState)
    if (nextState) {
      setShowHistory(false)
      setShowSettings(false)
      setShowNewTab(false)
      // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
    } else {
      restoreViewBounds()
    }
  }, [captureActiveSnapshot, restoreViewBounds])

  // Everything else that closes the panel goes through setShowTabOverview, so the mirror is exact.
  useEffect(() => {
    showTabOverviewRef.current = showTabOverview
  }, [showTabOverview])

  const closeTabColors = useCallback(() => {
    setShowTabColors(false)
    // anyOverlayOpenRef still reads true during this render, so restoring has to wait for the next
    // frame, otherwise restoreViewBounds() sees an overlay that is on its way out and does nothing.
    requestAnimationFrame(() => restoreViewBounds())
  }, [restoreViewBounds])

  // Recalculate webview bounds whenever chrome layout toggles (titlebar, sidebar, focus mode, orientation)
  useEffect(() => {
    restoreViewBounds()
    const timer = setTimeout(restoreViewBounds, 250)
    return () => clearTimeout(timer)
  }, [interfaceSettings.showTitlebar, interfaceSettings.tabOrientation, sidebarCollapsed, focusMode])

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

    if (!tabsHydrated) return

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
  }, [historyLoaded, tabsHydrated])

  /**
   * Say what the renderer decided, in the main process's navigation trace.
   *
   * The two decisions that used to be invisible — "the address bar asked for this URL" and "the page
   * reported a URL and we dropped it" — are the whole story of the Ctrl+L bug. They now sit in the same
   * list as the loads and the aborts, so the Diagnostics panel reads end to end, and in development
   * they also print next to the main-process lines.
   */
  const traceNote = useCallback((tabId: string, message: string, data?: Record<string, unknown>) => {
    try {
      if (window.electron?.navigationTrace?.note) {
        window.electron.navigationTrace.note(tabId, message, data)
      } else {
        window.electron?.ipcRenderer?.send?.('nav_trace_note', tabId, message, data)
      }
    } catch {
      /* the trace must never break a navigation */
    }
    if (import.meta.env.DEV) console.debug('[nav]', message, tabId, data ?? '')
  }, [])

  /** Remember what the user asked the address bar for, so onUrl can let it through. */
  const rememberUserNavigation = useCallback((tabId: string, url: string) => {
    let host = ''
    try {
      host = new URL(url).host.toLowerCase()
    } catch {
      host = ''
    }
    userNavigationRef.current = { tabId, host, at: Date.now() }
  }, [])

  /** A tab the user navigated is loaded, not sleeping. Keeps the sidebar truthful. */
  const markTabResident = useCallback((tabId: string) => {
    const nextResident = residentTabIdsRef.current.includes(tabId)
      ? residentTabIdsRef.current
      : [...residentTabIdsRef.current, tabId]
    residentTabIdsRef.current = nextResident
    setResidentTabIds(nextResident)
    const nextDiscarded = discardedTabIdsRef.current.filter((id) => id !== tabId)
    discardedTabIdsRef.current = nextDiscarded
    setDiscardedTabIds(nextDiscarded)
  }, [])

  const handleUrlBarNavigate = useCallback(
    (newUrl: string, detectedModel?: string, inNewTab?: boolean) => {
      const modelToUse = (detectedModel) || 'gemini'
      if (inNewTab) {
        const result = addNewChat(tabs, modelToUse, newUrl)
        setTabs(result.tabs)
        rememberUserNavigation(result.activeId, newUrl)
        markTabResident(result.activeId)
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
      rememberUserNavigation(activeId, newUrl)
      traceNote(activeId, 'address bar → navigate_tab', { url: newUrl, model: targetModel })
      // Navigating a tab loads it, so it is not a sleeping tab any more.
      markTabResident(activeId)
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
        case 'repair_view':
          // Rebuild the native surface without reloading the page: the chat, its scroll position and
          // its session survive. This is what closing and reopening the tab used to be for.
          // @ts-ignore
          window.electron?.ipcRenderer.invoke('repair_view', activeId || undefined)
          restoreViewBounds()
          break
        default:
          restoreViewBounds()
          break
      }
    },
    [activeId, captureActiveSnapshot, refreshSkills, restoreViewBounds]
  )

  // Tell main when the switcher itself is the open overlay: it is the one panel that Ctrl+. has to be
  // able to close, while every other overlay keeps the key for its own shortcut recorder.
  useEffect(() => {
    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
    window.electron?.ipcRenderer.send('set_container_menu_open', Boolean(showContainerMenu))
  }, [showContainerMenu])

  // Overlay state → main. While any fullscreen overlay is open the main
  // process stops intercepting shortcuts so the overlay keeps its own keys
  // (arrows, Ctrl+J/K navigation, Ctrl+H/L cycling, Escape) working.
  useEffect(() => {
    // The flag *and* the names of the panels that are up. Main hides every native view while an overlay
    // is open, and a build-50 trace that ends on "overlay open — AI view hidden" with no panel named is
    // impossible to read: the page was gone and nothing said why. With the names in the trace (and an
    // unnamed report refused outright), that sentence can never be the whole story again.
    // @ts-ignore
    window.electron?.ipcRenderer.send(
      'set_overlays_open',
      Boolean(anyOverlayOpen),
      openOverlayKeys(overlayFlagsRef.current)
    )
    if (anyOverlayOpen) {
      // @ts-ignore
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
      return undefined
    } else {
      restoreViewBounds()
      const t = setTimeout(restoreViewBounds, 80)
      return () => clearTimeout(t)
    }
  }, [anyOverlayOpen, restoreViewBounds])

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
  const openContainerTabRef = useRef<((containerId: string) => void) | null>(null)

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
      // Same list as Escape uses, so opening one panel can never leave another hidden behind it.
      closeAllOverlays()
      open()
      hideNativeView()
    }

    const handleExecuteGlobalAction = (_event: any, data: any) => {
      if (!data || !data.action) return
      const action = data.action

      switch (action) {
        case 'open_container': {
          // Main resolves the digit against the container store and sends the id, so the shortcut
          // cannot depend on this window's copy of the list. The index is kept as a fallback for an
          // older main process.
          const fromMain = typeof data.containerId === 'string' ? data.containerId : null
          const container = fromMain
            ? findContainer(containersRef.current, fromMain)
            : containerForShortcutIndex(containersRef.current, Number(data.index))
          if (fromMain || data.containerId === undefined) {
            if (container && (fromMain || container.id)) openContainerTabRef.current?.(container.id)
            break
          }
          // containerId === null: there is no such container yet. Say it once, briefly, instead of
          // leaving the keypress looking broken.
          setContainerHint(
            `No container ${data.index} yet — open the coloured button next to Search to make one.`
          )
          break
        }
        case 'toggle_settings':
          openExclusive(() => setShowSettings(true), () => setShowSettings(false), showSettings)
          break
        case 'close_overlay': {
          const closed = closeAllOverlays()
          if (closed.length > 0) {
            // anyOverlayOpenRef still reads true in this tick, so restore on the next frame.
            requestAnimationFrame(() => restoreViewBounds())
          }
          break
        }
        case 'force_close_overlays': {
          // Main's watchdog: Escape did not lead to a `set_overlays_open false`, so the renderer's idea
          // of what is open is not trusted any more. Close everything and name what it was.
          console.warn(
            '[overlay] force-closing after a stuck overlay:',
            describeOverlays(overlayFlagsRef.current)
          )
          closeAllOverlays()
          requestAnimationFrame(() => restoreViewBounds())
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
              // Pinned on reopen, without the toggle. `togglePin` decides from whatever the closure
              // last saw, and a toggle that guesses wrong *unpins* the tab the user just got back.
              if (restoredEntry.isPinned && !pinnedIdsRef.current.includes(restoredEntry.tab.id)) {
                const merged = Array.from(new Set([...pinnedIdsRef.current, restoredEntry.tab.id]))
                pinnedIdsRef.current = merged
                setPinnedIds(merged)
                try {
                  localStorage.setItem('vicinae.pinned', JSON.stringify(merged))
                  void window.electron?.ipcRenderer?.invoke('save_pinned', JSON.stringify(merged))?.catch(() => {})
                } catch {
                  /* the pin is already applied for this session */
                }
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
            localStorage.setItem('vicinae.sidebarCollapsed.v2', String(next))
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
          openExclusive(
            () => {
              setGuideRun((n) => n + 1)
              setShowGuide(true)
            },
            () => setShowGuide(false),
            showGuide
          )
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
          // One numbering for the whole window: pinned tabs take 1…n, the normal tabs continue from
          // there, and the badge on a tab prints exactly this number. Alt+N keeps its old meaning
          // (pinned tabs only) for muscle memory built on it.
          const rawNumber =
            typeof data.number === 'number' ? data.number : Number(data.index) + 1
          if (!Number.isFinite(rawNumber) || rawNumber < 1) break
          const pinnedOnly = Boolean(data.pinnedOnly ?? data.isPinned)
          const target = pinnedOnly
            ? pinnedTabForShortcutNumber(tabs, pinnedIds, rawNumber)
            : tabForShortcutNumberInOrder(visualTabOrder, rawNumber)
          if (target?.url) {
            setShowUrlBar(false)
            setShowTabOverview(false)
            setShowNewTab(false)
            sfx.pop()
            switchToTab(target.id, target.url)
          } else if (!pinnedOnly) {
            // Say it instead of doing nothing: a digit that lands on no tab used to look broken.
            const reachable = Math.min(visualTabOrder.length, MAX_TAB_SHORTCUT_NUMBER)
            const lastNumber = Math.min(reachable, MAX_TAB_SHORTCUT_NUMBER)
            setContainerHint(
              reachable === 0
                ? 'No tabs to jump to yet.'
                : `No tab ${rawNumber} — you have ${reachable} numbered tab${reachable === 1 ? '' : 's'} (${shortcutLabelForTab(1)}–${lastNumber}).`
            )
          }
          break
        }
        case 'toggle_tab_colours': {
          // Ctrl+Shift+C — the same colours the Tab Colours tile opens, so the button and the key are
          // the same feature rather than two.
          if (showTabColors) {
            closeTabColors()
            break
          }
          openTabColors()
          break
        }
        case 'toggle_container_menu': {
          // Ctrl+. — deliberately a toggle: the same key that opens the switcher closes it.
          if (showContainerMenu) {
            setShowContainerMenu(false)
            restoreViewBounds()
            break
          }
          openExclusive(
            () => setShowContainerMenu(true),
            () => setShowContainerMenu(false),
            false
          )
          break
        }
        case 'navigate_tab': {
          const overlaysOpen = showHistory || showTabOverview || showSettings || showNewTab || showExport || showUrlBar || showGuide || showSkillsPalette || showBaseSkillsModal || showSkillParamsModal || showSkillEditorModal || showDiagnosticsModal || showTabColors
          if (!overlaysOpen) {
            const visualActive = getVisibleActiveTabs(tabs, residentTabIds, pinnedIds, tabStatuses, activeId)
            if (visualActive.length > 1) {
              const idx = visualActive.findIndex((t) => t.id === activeId)
              if (idx !== -1) {
                const target =
                  data.direction === 'prev'
                    ? visualActive[(idx - 1 + visualActive.length) % visualActive.length]
                    : visualActive[(idx + 1) % visualActive.length]
                if (target?.url) {
                  switchToTab(target.id, target.url)
                }
              }
            }
          }
          break
        }
        case 'move_tab': {
          if (!anyOverlayOpen && activeId) {
            const visualActive = getVisibleActiveTabs(tabs, residentTabIds, pinnedIds, tabStatuses, activeId)
            setTabs((prev) => moveActiveTabInList(prev, activeId, data.direction, visualActive))
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
        case 'stop_generation': {
          // @ts-ignore
          window.electron?.ipcRenderer.invoke('ai_stop_generation').catch(() => {})
          break
        }
        case 'site_new_chat': {
          // @ts-ignore
          window.electron?.ipcRenderer.invoke('ai_site_new_chat').catch(() => {})
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
    closeAllOverlays,
    restoreViewBounds,
    showSettings,
    showContainerMenu,
    showContainerModal,
    showContainerManager,
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

  // Persist tabs whenever they change, safely gated on successful hydration
  useEffect(() => {
    if (!tabsHydrated || tabs.length === 0) return
    try {
      localStorage.setItem(TABS_STORAGE_KEY, serializeState(tabs, activeId, mruTabIds, residentTabIds, discardedTabIds))
    } catch (e) {
      console.error('Failed to persist tabs:', e)
    }
    window.nexusState?.save('tabs', { tabs, activeId, mruTabIds, residentTabIds, discardedTabIds }).catch((err: Error) => {
      console.error('Failed to save tabs to disk:', err)
    })
    // Main needs to know which container each tab belongs to before it creates that tab's view.
    const map: Record<string, string> = {}
    for (const tab of tabs) {
      const containerId = containerIdOf(tab)
      map[tab.id] = containerId
      tabContainersRef.current[tab.id] = containerId
    }
    tabContainersRef.current = map
    // @ts-ignore
    window.electron?.ipcRenderer.send('set_tab_containers', map)
  }, [tabs, activeId, mruTabIds, residentTabIds, discardedTabIds, tabsHydrated])

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
      // Use the unified anyOverlayOpenRef to include all overlays including folder upload and category manager
      if (anyOverlayOpenRef.current) return
      const bounds = containerBounds()
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const payload = JSON.stringify(bounds)
        if (payload === lastSent) return
        lastSent = payload
        // @ts-ignore
        window.electron?.ipcRenderer.send('resize_view', bounds)
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
  }, [showBootSequence, showHistory, showTabOverview, showSettings, showNewTab, showExport, showUrlBar, showGuide, showSkillsPalette, showBaseSkillsModal, showSkillParamsModal, showSkillEditorModal, showDiagnosticsModal, showTabColors])

  /**
   * First run: the guide introduces itself once the boot sequence has settled. `GUIDE_SEEN_KEY` is
   * written when it closes, however it closes, so this can only ever fire for a profile that has not
   * seen it. F1 opens it at any time after that.
   */
  useEffect(() => {
    if (showBootSequence) return
    let seen: string | null = null
    try {
      seen = localStorage.getItem(GUIDE_SEEN_KEY)
    } catch {
      seen = 'done'
    }
    if (seen) return
    const timer = setTimeout(() => {
      setGuideRun((n) => n + 1)
      setShowGuide(true)
      // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
      window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
    }, 900)
    return () => clearTimeout(timer)
  }, [showBootSequence])

  const closeGuide = useCallback(
    (reason: 'done' | 'skipped' | 'escape') => {
      setShowGuide(false)
      if (guideOwnsSettings.current) {
        guideOwnsSettings.current = false
        setSettingsRequestedTab(null)
        setShowSettings(false)
      }
      try {
        localStorage.setItem(GUIDE_SEEN_KEY, reason)
      } catch {
        /* a locked-down profile still gets the guide; it just may not remember that it did */
      }
      restoreViewBounds()
    },
    [restoreViewBounds]
  )

  /**
   * However the guide closes — its own buttons, F1 pressed again, Escape handled in main — the fact that
   * it has been seen gets written down. `closeGuide` records the reason; this catches the routes that
   * only flip the flag, so a first-run guide cannot reappear on the next launch.
   */
  useEffect(() => {
    if (showGuide) {
      guideOpenedOnce.current = true
      return
    }
    if (!guideOpenedOnce.current) return
    guideOpenedOnce.current = false
    try {
      if (!localStorage.getItem(GUIDE_SEEN_KEY)) localStorage.setItem(GUIDE_SEEN_KEY, 'closed')
    } catch {
      /* a locked-down profile simply gets the guide again */
    }
  }, [showGuide])

  return (
    <div
      data-nexus-build={NEXUS_UI_BUILD}
      className={`flex flex-col w-screen h-screen overflow-hidden bg-(--bg) ${focusMode ? 'focus-mode' : ''}`}
    >
      {!focusMode && (
        <WindowTitleBar
          activeTabTitle={tabs.find((t) => t.id === activeId)?.title}
          activeModelName={models.find((m) => m.key === resolvedActiveModelKey)?.label || modelLabel(resolvedActiveModelKey)}
          modelColor={colorFor(resolvedActiveModelKey)}
          maskTitle={interfaceSettings.maskTitlebarTitle}
          models={models}
          activeModelKey={resolvedActiveModelKey}
          onSelectModel={handleDeployModel}
          autoHideMode={interfaceSettings.showTitlebar === false}
          onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
          onOpenTabColors={activeTab ? openTabColors : undefined}
          tabAccent={activeTab ? tabAccentColor(activeTab, colorFor(resolvedActiveModelKey)) : undefined}
          hasCustomTabColors={Boolean(activeTabColors.accentColor || activeTabColors.auraColor)}
        />
      )}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* 1. LEFT SIDEBAR: Modern Workspace Navigation Sidebar */}
      {!focusMode &&
        // Horizontal layout keeps its tab strip in the top bar, so the left sidebar only
        // belongs there when the pinned rail was explicitly asked for.
        (interfaceSettings.tabOrientation !== 'horizontal' ||
          interfaceSettings.pinnedPosition === 'sidebar') && (
        <div
          className={`${sidebarCollapsed ? 'w-44' : 'w-64'} bg-(--surface) border-r border-(--border) flex flex-col shadow-lg z-20 shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden select-none`}
        >
          {/* Header: Toggle Collapse, Title, Search, New Tab */}
          <div className="flex items-center justify-between p-2 border-b border-(--border)/80 shrink-0 gap-1 bg-(--surface)">
            <button
              onClick={toggleSidebar}
              data-collapse-toggle="true"
              title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--surface2) transition-colors cursor-pointer"
              aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {sidebarCollapsed ? <IconPanelLeft size={16} /> : <IconPanelLeftClose size={16} />}
            </button>

            {!sidebarCollapsed && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-(--text2) truncate flex-1 min-w-0 pl-1">
                Chats ({tabs.length})
              </span>
            )}

            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setShowUrlBar(true)
                  captureActiveSnapshot().catch(() => {})
                }}
                title="Search / Omnibox (Ctrl+L)"
                className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--surface2) transition-colors cursor-pointer"
                aria-label="Search"
              >
                <IconSearch size={14} />
              </button>

              <button
                onClick={() => setShowNewTab(true)}
                title="New Chat (Ctrl+T)"
                className="p-1.5 rounded-lg bg-(--surface2) text-(--text) hover:bg-(--accent) hover:text-white transition-colors cursor-pointer"
                aria-label="New Chat"
              >
                <IconPlus size={14} />
              </button>
            </div>
          </div>

          {/* Vertical Tabs Body */}
          {interfaceSettings.tabOrientation !== 'horizontal' ? (
            <VerticalTabs
              data-guide="tabs"
              containerMarks={containerMarks}
              tabNumbers={tabNumbers}
              tabs={tabs}
              activeId={activeId}
              pinnedIds={pinnedIds}
              tabStatuses={tabStatuses}
              residentTabIds={residentTabIds}
              discardedTabIds={discardedTabIds}
              sidebarCollapsed={sidebarCollapsed}
              onSelect={(id: string) => {
                const t = tabs.find((x) => x.id === id)
                if (t && t.url) switchToTab(t.id, t.url)
              }}
              onClose={(id: string) => closeTab(id)}
              onTogglePin={togglePin}
              onReorder={(sourceId: string, targetId: string) => {
                setTabs((prev) => reorderTabs(prev, sourceId, targetId))
              }}
              modelColors={modelColors}
              modelIcons={modelIcons}
              modelNames={modelNames}
              pinnedSection={interfaceSettings.pinnedPosition === 'section'}
            />
          ) : (
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
          )}

          {/* Sidebar Footer: HUD Status, Agent Handoff, Tools */}
          {interfaceSettings.tabOrientation !== 'horizontal' && (
            <div className="p-2 border-t border-(--border)/80 flex flex-col gap-2 shrink-0 bg-(--surface)">
              {/* Agent Handoff and Tabs share a row: both are one-press tools that open a panel, and
                  they were on different rows for no reason the user could see. The Tabs button used to
                  live in the navigation row below; it moved up here beside Export, the same pairing the
                  horizontal title bar already uses. */}
              <div
                className={`grid gap-1.5 ${sidebarCollapsed ? 'grid-cols-2' : 'grid-cols-[1.55fr_1fr]'}`}
                data-agent-tabs="true"
                data-guide="navigation"
              >
                <button
                  className={`history-btn min-w-0 px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-2 border shadow-xs cursor-pointer ${
                    showExport
                      ? 'bg-amber-500/25 border-amber-500/50 text-amber-300'
                      : 'bg-(--surface2) hover:bg-(--border) border-white/10 text-(--text) hover:border-amber-500/40 hover:text-amber-200'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" x2="12" y1="15" y2="3"/>
                  </svg>
                  {!sidebarCollapsed && (
                    <>
                      <span className="text-xs font-semibold flex-1 text-left truncate">Agent Handoff</span>
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                        Export
                      </span>
                    </>
                  )}
                </button>

                  <button
                    type="button"
                    onClick={() => void toggleTabOverviewPanel()}
                    data-nav-tab-overview="sidebar-top"
                    aria-expanded={showTabOverview}
                    title={`Tab Overview (${getShortcutKeys('tab-overview').join('+')})`}
                    className={`min-w-0 px-2 py-1.5 rounded-lg transition-colors border cursor-pointer flex flex-col items-stretch gap-1 justify-center ${
                      showTabOverview
                        ? 'bg-(--accent)/20 border-(--accent)/50 text-(--text)'
                        : 'bg-(--surface2) hover:bg-(--border) text-(--text) border-white/10'
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 min-w-0 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                        aria-hidden="true"
                      >
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" x2="22" y1="21" y2="21" />
                        <line x1="12" x2="12" y1="17" y2="21" />
                      </svg>
                      {!sidebarCollapsed && (
                        <span className="text-xs font-semibold truncate min-w-0">Tabs</span>
                      )}
                    </span>
                    <ShortcutKeys action="tab-overview" className="is-block" />
                  </button>
              </div>

              {/* Quick Actions: the four things people reach for but only discover by
                  remembering a shortcut. Same handlers as Ctrl+O, Ctrl+Shift+O, Ctrl+S and
                  Ctrl+Shift+S — the keys remain, the buttons just make them findable. */}
              <div className="grid grid-cols-2 gap-1.5" data-quick-actions="true">
                <button
                  type="button"
                  onClick={() => {
                    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
                    window.electron?.ipcRenderer.send('trigger_active_upload')
                  }}
                  title={`Attach files (${getShortcutKeys('upload-file').join('+')})`}
                  className={`px-2 py-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer bg-(--surface2) hover:bg-(--border) text-(--text) border border-white/10 hover:border-(--accent)/40 `}
                >
                  <span className={tileLabelRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                    {!sidebarCollapsed && <span className="text-[11px] font-semibold truncate min-w-0">Files</span>}
                  </span>
                  <ShortcutKeys action="upload-file" className="is-block" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
                    window.electron?.ipcRenderer.send('trigger_active_upload_folder')
                  }}
                  title={`Attach an entire folder as a codebase (${getShortcutKeys('upload-folder').join('+')})`}
                  className={`px-2 py-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer bg-(--surface2) hover:bg-(--border) text-(--text) border border-white/10 hover:border-(--accent)/40 `}
                >
                  <span className={tileLabelRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                    {!sidebarCollapsed && <span className="text-[11px] font-semibold truncate min-w-0">Folder</span>}
                  </span>
                  <ShortcutKeys action="upload-folder" className="is-block" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    refreshSkills()
                    setShowSkillsPalette(true)
                    setShowHistory(false)
                    setShowSettings(false)
                    setShowNewTab(false)
                    setShowExport(false)
                    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
                    window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
                  }}
                  title={`Skills & Tools palette (${getShortcutKeys('skills-palette').join('+')})`}
                  className={`px-2 py-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer bg-(--surface2) hover:bg-(--border) text-(--text) border border-white/10 hover:border-amber-500/40 `}
                >
                  <span className={tileLabelRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                  </svg>
                    {!sidebarCollapsed && <span className="text-[11px] font-semibold truncate min-w-0">Skills</span>}
                  </span>
                  <ShortcutKeys action="skills-palette" className="is-block" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    refreshSkills()
                    setShowBaseSkillsModal(true)
                    setShowHistory(false)
                    setShowSettings(false)
                    setShowNewTab(false)
                    setShowExport(false)
                    // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
                    window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
                  }}
                  title={`Base skills framework rules (${getShortcutKeys('skills-base-modal').join('+')})`}
                  className={`px-2 py-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer bg-(--surface2) hover:bg-(--border) text-(--text) border border-white/10 hover:border-amber-500/40 `}
                >
                  <span className={tileLabelRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
                    <path d="M9 7h7" />
                  </svg>
                    {!sidebarCollapsed && <span className="text-[11px] font-semibold truncate min-w-0">Base</span>}
                  </span>
                  <ShortcutKeys action="skills-base-modal" className="is-block" />
                </button>

                {/* Containers and the tab's own colours, one cell each in this same grid rather than
                    two full-width rows: both answer the same question ("what is this tab, visually?")
                    and the footer is the tightest space in the app. Nothing else about the footer
                    moves — same grid, same order, two rows shorter. */}
                <button
                  type="button"
                  onClick={() => {
                    setShowContainerMenu((open) => {
                      if (open) {
                        restoreViewBounds()
                        return false
                      }
                      // One panel at a time, like every other tool button in this footer.
                      setShowHistory(false)
                      setShowTabOverview(false)
                      setShowSettings(false)
                      setShowNewTab(false)
                      setShowExport(false)
                      setShowUrlBar(false)
                      setShowGuide(false)
                      setShowSkillsPalette(false)
                      setShowBaseSkillsModal(false)
                      return true
                    })
                  }}
                  onContextMenu={(event) => {
                    // Right-click is the short path to the containers section, where they can be
                    // added, edited and deleted — left-click stays the switcher.
                    event.preventDefault()
                    setShowContainerMenu(false)
                    setShowContainerManager(true)
                  }}
                  title={`Containers — ${activeContainer.name} (Ctrl+. · right-click to manage)`}
                  aria-label={`Containers, current: ${activeContainer.name}`}
                  aria-expanded={showContainerMenu}
                  data-guide="containers"
                  className={`containers-btn col-span-2 min-w-0 px-2 py-1.5 rounded-lg flex flex-col items-stretch justify-center gap-1 cursor-pointer border ${
                    showContainerMenu ? 'is-open' : ''
                  } ${
                    activeContainerColor ? 'is-tinted' : 'bg-(--surface2) hover:bg-(--border) text-(--text) border-white/10 hover:border-(--accent)/40'
                  }`}
                  style={
                    activeContainerColor
                      ? ({ '--container-color': activeContainerColor } as CSSProperties)
                      : undefined
                  }
                >
                  <span className={tileLabelRow}>
                  <span
                    className="containers-btn-swatch"
                    style={{
                      background: activeContainerColor ?? 'transparent',
                      border: `1.5px solid ${activeContainerColor ?? 'currentColor'}`,
                      boxShadow: activeContainerColor ? `0 0 9px ${activeContainerColor}99` : undefined
                    }}
                  />
                  {!sidebarCollapsed && (
                    <span className="text-[11px] font-semibold truncate flex-1 text-left min-w-0">
                      {activeContainer.name}
                    </span>
                  )}
                  <span className="containers-btn-digit">
                    {containers.findIndex((c) => c.id === activeContainer.id) + 1 || 1}
                  </span>
                  </span>
                  <ShortcutKeys action="containers-picker" className="is-block" />
                  {!sidebarCollapsed && (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 opacity-60"
                      style={{
                        transform: showContainerMenu ? 'rotate(180deg)' : 'none',
                        transition: 'transform 160ms ease'
                      }}
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  )}
                </button>

                {/* Same picker as the title bar button: the colour belongs to the tab, and this
                    is where the other per-tab tools (upload, skills) live. */}
                <TabColorButton
                  variant="half"
                  collapsed={sidebarCollapsed}
                  className="col-span-2"
                  accent={activeTabColors.accentColor ?? colorFor(resolvedActiveModelKey)}
                  hasCustomColors={Boolean(activeTabColors.accentColor || activeTabColors.auraColor)}
                  disabled={!activeTab}
                  onClick={openTabColors}
                />
              </div>

              {/* Navigation Tools Row — two half-width tiles. Tabs used to sit here spanning both
                  columns; it now lives beside Agent Handoff, so History and Settings get the row to
                  themselves and every button in it keeps its keys. */}
              <div className="grid grid-cols-2 gap-1.5" data-nav-tools="true">
                <button
                  className="bg-(--surface2) hover:bg-(--border) text-(--text) p-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer"
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
                      restoreViewBounds()
                    }
                  }}
                  title={`History (${getShortcutKeys('history-open').join('+')})`}
                >
                  <span className={tileLabelRow}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {!sidebarCollapsed && <span className="text-xs truncate min-w-0">History</span>}
                  </span>
                  <ShortcutKeys action="history-open" className="is-block" />
                </button>

                <button
                  data-guide="settings"
                  className="bg-(--surface2) hover:bg-(--border) text-(--text) p-1.5 rounded-lg transition-colors flex flex-col items-stretch gap-1 cursor-pointer"
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
                      restoreViewBounds()
                    }
                  }}
                  title={`Settings & Model Manager (${getShortcutKeys('settings-open').join('+')})`}
                >
                  <span className={tileLabelRow}>
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
                      className="shrink-0"
                    >
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {!sidebarCollapsed && <span className="text-xs truncate min-w-0">Settings</span>}
                  </span>
                  <ShortcutKeys action="settings-open" className="is-block" />
                </button>
              </div>
            </div>
          )}
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

        {/* Top Navbar ONLY rendered when tabOrientation is explicitly 'horizontal' */}
        {!focusMode && interfaceSettings.tabOrientation === 'horizontal' && (
          <div
            className="top-navbar flex w-full justify-between items-center bg-(--surface) px-4 py-2 border-b border-(--border) relative z-20 shrink-0 drag-region"
            style={{
              paddingRight:
                window.electron?.platform === 'win32' && interfaceSettings.showTitlebar === false
                  ? '150px'
                  : '16px'
            }}
          >
            {/* Left: Chat Tabs (Full width unshared strip) */}
            <div className="flex gap-2 items-center flex-1 min-w-0 overflow-hidden pr-4">
              <ChatTabs
                tabs={tabs.filter((t) => !pinnedIds.includes(t.id))}
                activeId={activeId}
                tabNumbers={tabNumbers}
                containerMarks={containerMarks}
                modelColors={modelColors}
                modelIcons={modelIcons}
                modelNames={modelNames}
                onSelect={(id: string) => {
                  const t = tabs.find((x) => x.id === id)
                  if (t && t.url) switchToTab(t.id, t.url)
                }}
                onClose={(id: string) => closeTab(id)}
                onTogglePin={togglePin}
              />
            </div>

            {/* Right: Actions */}
            <div className="flex gap-2 shrink-0 justify-end items-center">
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

              {/* Accent & aura for the active tab — beside Agent Handoff, matching the sidebar. */}
              <TabColorButton
                variant="compact"
                accent={activeTabColors.accentColor ?? colorFor(resolvedActiveModelKey)}
                hasCustomColors={Boolean(activeTabColors.accentColor || activeTabColors.auraColor)}
                disabled={!activeTab}
                onClick={openTabColors}
              />

              <button
                className="bg-(--surface2) hover:bg-(--border) text-(--text) px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                onClick={() => void toggleTabOverviewPanel()}
                data-nav-tab-overview="titlebar"
                aria-expanded={showTabOverview}
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
                    restoreViewBounds()
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
                    restoreViewBounds()
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

        {/* The Native Box Content Bounds: flush against bottom pinned dock */}
        <div className="flex-1 w-full h-full relative">
          {activeContainerColor && containerAuraStrength > 0 && (
            <div
              className="absolute inset-0 pointer-events-none nexus-container-aura"
              style={{
                // The same function the ring maths uses, so what is painted and what is inset agree.
                ...auraRingStyle(activeContainerColor, containerAuraStrength),
                transition: 'box-shadow 220ms ease'
              }}
              data-aura-strength={containerAuraStrength}
              aria-hidden
            />
          )}
          <div className="absolute inset-0" ref={containerRef} />
        </div>
      </div>
      </div>

      {/* BOTTOM PINNED CHATS DOCK (Full Window Width, Undercutting Sidebar) */}
      {!focusMode && interfaceSettings.pinnedPosition === 'bottom' && (
        <div className="w-full h-14 border-t border-(--border) bg-(--bg) flex items-center px-3 gap-2 shrink-0 select-none z-20 shadow-md">
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
                containerMarks={containerMarks}
                tabNumbers={tabNumbers}
                tabs={tabs.filter((t) => pinnedIds.includes(t.id))}
                activeId={activeId}
                pinnedIds={pinnedIds}
                modelColors={modelColors}
                modelIcons={modelIcons}
                modelNames={modelNames}
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

      {containerHint && (
        <div
          className="fixed z-70 px-3 py-2 rounded-xl text-[11.5px] shadow-lg pointer-events-none"
          style={{
            left: 16,
            bottom: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            maxWidth: 320
          }}
          role="status"
        >
          {containerHint}
        </div>
      )}

      {showContainerMenu && (
        <ContainerMenu
          containers={containers}
          tabCounts={containerTabCounts}
          activeContainerId={activeContainerId}
          accounts={containerAccounts}
          onOpenContainer={(containerId) => openContainerTab(containerId)}
          onEditContainer={(containerId) => {
            setEditingContainer(findContainer(containers, containerId))
            setShowContainerModal(true)
            setShowContainerMenu(false)
          }}
          onNewContainer={() => {
            setEditingContainer(null)
            setShowContainerModal(true)
            setShowContainerMenu(false)
          }}
          onManageContainers={() => {
            setShowContainerManager(true)
            setShowContainerMenu(false)
          }}
          onClose={() => setShowContainerMenu(false)}
        />
      )}

      {showContainerManager && (
        <ContainerManager
          containers={containers}
          tabCounts={containerTabCounts}
          activeContainerId={activeContainerId}
          accounts={containerAccounts}
          onAdd={() => {
            setEditingContainer(null)
            setShowContainerModal(true)
            setShowContainerManager(false)
          }}
          onEdit={(containerId) => {
            setEditingContainer(findContainer(containers, containerId))
            setShowContainerModal(true)
            setShowContainerManager(false)
          }}
          onDelete={(containerId) => deleteContainer(containerId)}
          onReorder={reorderContainer}
          onReconnect={reconnectContainer}
          onClose={() => {
            setShowContainerManager(false)
            requestAnimationFrame(() => restoreViewBounds())
          }}
        />
      )}

      {showContainerModal && (
        <ContainerModal
          editing={editingContainer}
          accounts={containerAccounts}
          tabCount={editingContainer ? containerTabCounts[editingContainer.id] ?? 0 : 0}
          onSave={saveContainer}
          onDelete={deleteContainer}
          onClose={() => setShowContainerModal(false)}
        />
      )}

      {showSettings && (
        <SettingsOverlay tabDiscardMinutes={tabDiscardMinutes} setTabDiscardMinutes={handleUpdateTabDiscardMinutes} maxActiveTabs={maxActiveTabs} setMaxActiveTabs={handleUpdateMaxActiveTabs}
          uiZoom={uiZoom} setUiZoom={setUiZoom} webviewZoom={webviewZoom} setWebviewZoom={setWebviewZoom}
          models={models}
          setModels={setModels}
          themeState={themeState}
          setThemeState={setThemeState}
          webviewThemeOn={webviewThemeOn}
          setWebviewThemeOn={setWebviewThemeOn}
          providerConfig={providerConfig}
          setProviderConfig={setProviderConfig}
          activeModelKey={tabs.find((t) => t.id === activeId)?.model}
          onSelectModel={(modelKey) => {
            handleDeployModel(modelKey)
            setShowSettings(false)
            restoreViewBounds()
          }}
          interfaceSettings={interfaceSettings}
          initialSection={settingsRequestedTab as any}
          onInterfaceSettingsChange={(newSettings) => {
            setInterfaceSettings(newSettings)
            saveInterfaceSettings(newSettings)
            // Any styling change counts: the guide's palette step only needs to know one landed.
            setSettingsRevision((n) => n + 1)
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
        onConfirm={(selectedPaths, partSizeBytes) => {
          if (folderUploadData) {
            // @ts-ignore
            window.electron?.ipcRenderer.send('confirm_folder_upload', {
              folderPath: folderUploadData.folderPath,
              selectedPaths,
              // The size chosen in the popup. Without it the upload path used a hard-coded 8 MB and the
              // control only ever affected the drawer's preview — the choice had no effect on the upload.
              partSizeBytes
            })
          }
          setFolderUploadData(null)
          restoreViewBounds()
        }}
      />
      <TabColorModal
        open={showTabColors && Boolean(activeTab)}
        tabTitle={activeTab?.title}
        colors={activeTabColors}
        fallbackAccent={colorFor(resolvedActiveModelKey)}
        onChange={applyColorsToActiveTab}
        onClose={closeTabColors}
      />
      <DiagnosticsModal
        isOpen={showDiagnosticsModal}
        onClose={() => {
          setShowDiagnosticsModal(false)
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

      {/* The guide: F1, or once on first run. A spotlight tour over the real controls. */}
      <GuideTour
        key={guideRun}
        isOpen={showGuide}
        onClose={closeGuide}
        providers={models.map((m) => ({
          key: m.key,
          label: m.label,
          icon: modelIcons[m.key],
          color: colorFor(m.key)
        }))}
        containers={containers.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        tabCount={tabs.length}
        settingsRevision={settingsRevision}
        themeId={themeState.activeId}
        onOpenSettingsSection={(section) => {
          guideOwnsSettings.current = true
          setSettingsRequestedTab(section)
          setShowSettings(true)
          // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
          window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
        }}
        onCloseSettingsSection={() => {
          if (!guideOwnsSettings.current) return
          guideOwnsSettings.current = false
          setSettingsRequestedTab(null)
          setShowSettings(false)
        }}
        onOpenSettings={() => {
          setShowGuide(false)
          setShowSettings(true)
          // @ts-ignore -- the preload bridge is untyped here, as everywhere else in this file
          window.electron?.ipcRenderer.send('resize_view', { x: 0, y: 0, width: 0, height: 0 })
        }}
        onReplayRequested={() => {
          try {
            localStorage.removeItem(GUIDE_SEEN_KEY)
          } catch {
            /* nothing to clear */
          }
        }}
      />

      {/* J.A.R.V.I.S. Iron Man HUD Startup Sequence */}
      {showBootSequence && (
        <JarvisBootOverlay
          isReady={!loadingTabId}
          onComplete={() => {
            setShowBootSequence(false)
          }}
        />
      )}

      {/* Downloads native toast notification */}
    </div>
  )
}

export default App
