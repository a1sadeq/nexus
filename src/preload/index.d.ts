/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IpcRendererEvent } from 'electron'

// IPC bridge typing mirrors the original @electron-toolkit/preload contract:
// invoke resolves Promise<any> and listeners receive untyped args, so the
// renderer's typed .then() callbacks and event handlers keep typechecking.
// any is intentional here; real types live in main's IPC handlers.
export interface NexusIpcRenderer {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  send: (channel: string, ...args: any[]) => void
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => (() => void)
  removeListener: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: any[]) => void
  ) => void
  removeAllListeners?: (channel: string) => void
}

export interface SessionProfile {
  id: string
  browser: string
  name: string
  hasGoogleAuth: boolean
  detectedAiSessions: string[]
  lastAccessed?: number
  isLatest?: boolean
  isLocked?: boolean
}

export interface GoogleSignInEvent {
  stage:
    | 'opening-browser'
    | 'waiting'
    | 'success'
    | 'error'
    | 'keyring-error'
    | 'no-auth'
  message?: string
  email?: string
  profiles?: Array<{
    id: string
    browser: string
    name: string
    hasGoogleAuth: boolean
  }>
}

export interface NexusSessions {
  syncAll: () => Promise<{ success: boolean; count: number; message: string }>
  syncProfile: (profileId: string) => Promise<{ success: boolean; profileName?: string; message?: string; count?: number }>
  getProfiles: () => Promise<Array<SessionProfile>>
  importJson: (json: string) => Promise<{ success: boolean; count: number; errorCount: number; message: string }>
  pickCustomFolder: () => Promise<{ canceled?: boolean; success?: boolean; count?: number; profileName?: string; detectedProviders?: string[]; message?: string }>
  clearSession: (providerKey: string, providerUrl?: string) => Promise<{ success: boolean; message?: string }>
}

export interface NexusGoogleSignIn {
  start: (accountId?: string) => Promise<unknown>
  pickProfile: (profileId: string) => Promise<unknown>
  getProfiles: () => Promise<Array<SessionProfile>>
  /** Whether Nexus itself already holds a usable Google session for this account. */
  status: (accountId?: string) => Promise<{ signedIn: boolean }>
  getAccounts: () => Promise<Array<{ id: string; label: string; partition: string; createdAt: number }>>
  addAccount: (label: string) => Promise<{ account?: { id: string; label: string; partition: string }; error?: string }>
  removeAccount: (accountId: string) => Promise<{ removed: boolean; error?: string }>
  cancel: () => void
  syncAll: () => Promise<{ success: boolean; count: number; message: string }>
  syncProfile: (profileId: string) => Promise<{ success: boolean; profileName?: string; message?: string; count?: number }>
  importJson: (json: string) => Promise<{ success: boolean; count: number; errorCount: number; message: string }>
  onEvent: (listener: (event: IpcRendererEvent, ev: unknown) => void) => void
}

export interface SkillVariable {
  name: string
  label?: string
  type: 'input' | 'file' | 'clipboard' | 'command'
  defaultValue?: string
  placeholder?: string
}

export interface SkillDef {
  id: string
  name: string
  description: string
  category: string
  type: 'base' | 'action'
  command: string
  autoSend?: boolean
  variables?: SkillVariable[]
  content: string
  filePath?: string
  isBuiltIn?: boolean
  usageCount?: number
  isPinned?: boolean
}

export interface NexusSkills {
  list: () => Promise<SkillDef[]>
  save: (skill: SkillDef) => Promise<{ success: boolean; filePath?: string; error?: string }>
  delete: (skillId: string) => Promise<{ success: boolean; error?: string }>
  togglePin: (skillId: string) => Promise<boolean>
  incrementUsage: (skillId: string) => Promise<boolean>
  readFile: (filePath: string, projectDir?: string) => Promise<{ success: boolean; content?: string; error?: string }>
  executeCommand: (
    command: string,
    projectDir?: string,
    requireSecurityCheck?: boolean
  ) => Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string; needsApproval?: boolean }>
  scanProjectFiles: (projectDir: string) => Promise<string[]>
  chooseProjectDir: () => Promise<string | null>
  getSkillsDir: () => Promise<string>
  openSkillsDir: () => Promise<boolean>
  getSafeCommands: () => Promise<string[]>
  addSafeCommand: (cmd: string) => Promise<boolean>
  removeSafeCommand: (cmd: string) => Promise<boolean>
  injectPrompt: (tabId: string, promptText: string, autoSend?: boolean) => Promise<boolean>
  getPinnedCategories: () => Promise<string[]>
  toggleCategoryPin: (category: string) => Promise<boolean>
  deleteCategory: (category: string) => Promise<boolean>
  assignSkillsToCategory: (category: string, ids: string[]) => Promise<boolean>
  onUpdated: (callback: () => void) => (() => void)
}

export interface NexusDownloads {
  showItemInFolder: (fullPath: string) => Promise<void>
  openPath: (fullPath: string) => Promise<string>
  setActiveProjectDir: (dir: string | null) => void
  getDefaultDownloadDir: () => Promise<string>
  copyPath: (fullPath: string) => void
  onCompleted: (callback: (info: any) => void) => (() => void)
}

export interface NexusAiFeatures {
  stopGeneration: () => Promise<unknown>
  siteNewChat: () => Promise<unknown>
  testLiveHooks: (modelKey: string) => Promise<unknown>
}

export interface NexusWindowControls {
  minimize: () => void
  maximizeToggle: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => (() => void)
}

export interface NexusStateBridge {
  get: (key: string) => Promise<any>
  save: (key: string, data: unknown) => Promise<any>
  getThemeSync: () => any
  getTabsSync: () => any
}

export interface NexusCacheBridge {
  getStats: () => Promise<any>
  purge: () => Promise<any>
}

export interface NexusContainerRecord {
  id: string
  name: string
  color?: string
  accountId: string
  createdAt: number
}

export interface NexusContainers {
  list: () => Promise<NexusContainerRecord[]>
  save: (input: {
    id?: string
    name?: string
    color?: string | null
    accountId?: string
  }) => Promise<{ container?: NexusContainerRecord; error?: string }>
  remove: (containerId: string) => Promise<{ removed: boolean; error?: string }>
  reorder: (orderedIds: string[]) => Promise<{ containers?: NexusContainerRecord[]; error?: string }>
  reconnect: (containerId: string) => Promise<{ ok: boolean; error?: string }>
}

export interface NexusDiagnosticsBridge {
  capture: (samplingMs?: number) => Promise<any>
  exportToFile: (report: any) => Promise<any>
}

/** One line of the navigation trace — a request, a load, an abort, a view operation, in order. */
export interface NexusNavTraceEvent {
  seq: number
  at: number
  t: number
  tabId: string
  kind: 'request' | 'load' | 'abort' | 'settle' | 'event' | 'intent' | 'view' | 'repair' | 'overlay' | 'note'
  message: string
  data?: Record<string, unknown>
}

export interface NexusNavTraceTab {
  tabId: string
  url: string
  modelKey: string
  title: string
  active: boolean
  loading: boolean
  evicted: boolean
  pendingNavigation: string
  listeners: { stopLoading: number; failLoad: number; startNavigation: number } | null
  lastEvent: { seq: number; kind: string; message: string; t: number } | null
}

export interface NexusNavTraceResult {
  success: boolean
  verbose?: boolean
  lastSeq?: number
  tabId?: string
  events?: NexusNavTraceEvent[]
  tabs?: NexusNavTraceTab[]
  text?: string
  reason?: string
}

export interface NexusNavTraceBridge {
  get: (options?: { tabId?: string; limit?: number; includeText?: boolean }) => Promise<NexusNavTraceResult>
  setVerbose: (verbose: boolean) => Promise<{ success: boolean; verbose?: boolean }>
  clear: () => Promise<{ success: boolean }>
  note: (tabId: string, message: string, data?: Record<string, unknown>) => void
}

declare global {
  interface Window {
    nexusState?: NexusStateBridge
    electron: {
      ipcRenderer: NexusIpcRenderer
      sessions?: NexusSessions
      googleSignIn?: NexusGoogleSignIn
      containers?: NexusContainers
      platform?: string
      windowControls?: NexusWindowControls
      skills?: NexusSkills
      downloads?: NexusDownloads
      aiFeatures?: NexusAiFeatures
      appearance?: {
        get: () => Promise<string>
        set: (mode: 'dark' | 'light' | 'system') => Promise<string>
      }
      nexusState?: NexusStateBridge
      cache?: NexusCacheBridge
      diagnostics?: NexusDiagnosticsBridge
      navigationTrace?: NexusNavTraceBridge
    }
  }
}
