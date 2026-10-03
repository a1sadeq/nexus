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

export interface GoogleSignInProfile {
  id: string
  browser: string
  name: string
  hasGoogleAuth: boolean
}

export type GoogleSignInStage =
  | 'opening-browser'
  | 'waiting'
  | 'success'
  | 'error'
  | 'keyring-error'
  | 'no-auth'

export interface GoogleSignInEvent {
  stage: GoogleSignInStage
  email?: string
  message?: string
  profiles?: GoogleSignInProfile[]
}

export interface SessionImportResult {
  success: boolean
  count?: number
  profilesCount?: number
  message?: string
  error?: string
}

export interface NexusGoogleSignIn {
  start: () => Promise<unknown>
  pickProfile: (profileId: string) => Promise<unknown>
  getProfiles: () => Promise<GoogleSignInProfile[]>
  cancel: () => void
  syncAll: () => Promise<SessionImportResult>
  syncProfile: (profileId: string) => Promise<SessionImportResult>
  importJson: (json: string) => Promise<SessionImportResult>
  onEvent: (listener: (event: IpcRendererEvent, ev: GoogleSignInEvent) => void) => void
}

export interface NexusSessions {
  syncAll: () => Promise<SessionImportResult>
  syncProfile: (profileId: string) => Promise<SessionImportResult>
  importJson: (json: string) => Promise<SessionImportResult>
  getProfiles: () => Promise<GoogleSignInProfile[]>
  pickProfile: (profileId: string) => Promise<unknown>
  startGoogleSignIn: () => Promise<unknown>
  cancelGoogleSignIn: () => void
  onEvent: (listener: (event: IpcRendererEvent, ev: GoogleSignInEvent) => void) => void
}

export interface NexusWindowControls {
  minimize: () => void
  maximizeToggle: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
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
}

export interface NexusSkills {
  list: () => Promise<SkillDef[]>
  save: (skill: SkillDef) => Promise<{ success: boolean; filePath?: string; error?: string }>
  delete: (skillId: string) => Promise<{ success: boolean; error?: string }>
  getPinnedCategories: () => Promise<string[]>
  toggleCategoryPin: (cat: string) => Promise<void>
  renameCategory: (oldName: string, newName: string) => Promise<void>
  deleteCategory: (cat: string) => Promise<void>
  assignSkillsToCategory: (cat: string, ids: string[]) => Promise<void>
  readFile: (
    filePath: string,
    projectDir?: string
  ) => Promise<{ success: boolean; content?: string; error?: string }>
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
  onUpdated?: (callback: () => void) => () => void
  incrementUsage: (skillId: string) => Promise<boolean>
  togglePin: (skillId: string) => Promise<boolean>
}

export interface DownloadItemInfo {
  id: string
  filename: string
  fullPath: string
  directory: string
  fileSize: number
  mimeType?: string
  isProjectDir: boolean
  timestamp: number
}

export interface NexusDownloads {
  showItemInFolder: (fullPath: string) => Promise<void>
  openPath: (fullPath: string) => Promise<string>
  copyPath?: (fullPath: string) => void
  setActiveProjectDir: (dir: string | null) => void
  getDefaultDownloadDir: () => Promise<string>
  onCompleted: (callback: (info: DownloadItemInfo) => void) => () => void
}

declare global {
  interface Window {
    electron: {
      ipcRenderer: NexusIpcRenderer
      googleSignIn: NexusGoogleSignIn
      sessions?: NexusSessions
      platform?: string
      windowControls?: NexusWindowControls
      skills?: NexusSkills
      downloads?: NexusDownloads
    }
  }
}

