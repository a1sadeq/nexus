import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const listenerRegistry = new Map<string, Map<unknown, (event: IpcRendererEvent, ...args: unknown[]) => void>>()

// Minimal IPC bridge: sandboxed preloads cannot require npm modules, so the
// full @electron-toolkit/preload electronAPI is not usable with sandbox:true.
// The renderer only uses ipcRenderer invoke/send/on/removeListener.
const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: unknown[]): void => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void): (() => void) => {
      let channelMap = listenerRegistry.get(channel)
      if (!channelMap) {
        channelMap = new Map()
        listenerRegistry.set(channel, channelMap)
      }
      const actualHandler = (event: IpcRendererEvent, ...args: unknown[]): void => {
        listener(event, ...args)
      }
      channelMap.set(listener, actualHandler)
      ipcRenderer.on(channel, actualHandler)
      return (): void => {
        ipcRenderer.removeListener(channel, actualHandler)
        channelMap?.delete(listener)
      }
    },
    removeListener: (
      channel: string,
      listener: (event: IpcRendererEvent, ...args: unknown[]) => void
    ): void => {
      const channelMap = listenerRegistry.get(channel)
      const actualHandler = channelMap?.get(listener)
      if (actualHandler) {
        ipcRenderer.removeListener(channel, actualHandler)
        channelMap?.delete(listener)
      } else {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    removeAllListeners: (channel: string): void => {
      const channelMap = listenerRegistry.get(channel)
      if (channelMap) {
        for (const handler of channelMap.values()) {
          ipcRenderer.removeListener(channel, handler)
        }
        channelMap.clear()
      }
      ipcRenderer.removeAllListeners(channel)
    }
  },
  googleSignIn: {
    start: (): Promise<unknown> => ipcRenderer.invoke('google_signin_start'),
    pickProfile: (profileId: string): Promise<unknown> =>
      ipcRenderer.invoke('google_signin_pick_profile', profileId),
    getProfiles: (): Promise<unknown> => ipcRenderer.invoke('google_signin_profiles'),
    cancel: (): void => ipcRenderer.send('google_signin_cancel'),
    syncAll: (): Promise<unknown> => ipcRenderer.invoke('sessions_sync_all'),
    syncProfile: (profileId: string): Promise<unknown> =>
      ipcRenderer.invoke('sessions_sync_profile', profileId),
    importJson: (json: string): Promise<unknown> =>
      ipcRenderer.invoke('cookies_import_json', json),
    onEvent: (listener: (event: IpcRendererEvent, ev: unknown) => void): void => {
      ipcRenderer.on('google-signin-event', listener)
    }
  },
  sessions: {
    syncAll: (): Promise<unknown> => ipcRenderer.invoke('sessions_sync_all'),
    syncProfile: (profileId: string): Promise<unknown> =>
      ipcRenderer.invoke('sessions_sync_profile', profileId),
    importJson: (json: string): Promise<unknown> =>
      ipcRenderer.invoke('cookies_import_json', json),
    getProfiles: (): Promise<unknown> => ipcRenderer.invoke('google_signin_profiles'),
    pickProfile: (profileId: string): Promise<unknown> =>
      ipcRenderer.invoke('google_signin_pick_profile', profileId),
    startGoogleSignIn: (): Promise<unknown> => ipcRenderer.invoke('google_signin_start'),
    cancelGoogleSignIn: (): void => ipcRenderer.send('google_signin_cancel'),
    onEvent: (listener: (event: IpcRendererEvent, ev: unknown) => void): void => {
      ipcRenderer.on('google-signin-event', listener)
    }
  },
  platform: process.platform,
  zoom: {
    setUiZoom: (zoom: number): void => ipcRenderer.send('set_ui_zoom', zoom),
    setWebviewZoom: (zoom: number): void => ipcRenderer.send('set_webview_zoom', zoom)
  },
  windowControls: {
    minimize: (): void => ipcRenderer.send('window_minimize'),
    maximizeToggle: (): void => ipcRenderer.send('window_maximize_toggle'),
    close: (): void => ipcRenderer.send('window_close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window_is_maximized')
  },
  skills: {
    list: (): Promise<unknown> => ipcRenderer.invoke('skills_list'),
    save: (skill: unknown): Promise<unknown> => ipcRenderer.invoke('skills_save', skill),
    delete: (skillId: string): Promise<unknown> => ipcRenderer.invoke('skills_delete', skillId),
    togglePin: (skillId: string): Promise<unknown> => ipcRenderer.invoke('skills_toggle_pin', skillId),
    incrementUsage: (skillId: string): Promise<unknown> => ipcRenderer.invoke('skills_increment_usage', skillId),
    readFile: (filePath: string, projectDir?: string): Promise<unknown> =>
      ipcRenderer.invoke('skills_read_file', filePath, projectDir),
    executeCommand: (command: string, projectDir?: string, requireSecurityCheck?: boolean): Promise<unknown> =>
      ipcRenderer.invoke('skills_execute_command', command, projectDir, requireSecurityCheck),
    scanProjectFiles: (projectDir: string): Promise<unknown> =>
      ipcRenderer.invoke('skills_scan_project_files', projectDir),
    chooseProjectDir: (): Promise<unknown> => ipcRenderer.invoke('skills_choose_project_dir'),
    getSkillsDir: (): Promise<unknown> => ipcRenderer.invoke('skills_get_skills_dir'),
    openSkillsDir: (): Promise<unknown> => ipcRenderer.invoke('skills_open_skills_dir'),
    getSafeCommands: (): Promise<unknown> => ipcRenderer.invoke('skills_get_safe_commands'),
    addSafeCommand: (cmd: string): Promise<unknown> => ipcRenderer.invoke('skills_add_safe_command', cmd),
    injectPrompt: (tabId: string, promptText: string, autoSend?: boolean): Promise<unknown> =>
      ipcRenderer.invoke('skills_inject_prompt', tabId, promptText, autoSend),
    onUpdated: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('skills_updated', handler)
      return (): void => {
        ipcRenderer.removeListener('skills_updated', handler)
      }
    }
  },
  clipboard: {
    writeText: (text: string): Promise<unknown> => ipcRenderer.invoke('clipboard_write', text)
  },
  downloads: {
    showItemInFolder: (fullPath: string): Promise<void> =>
      ipcRenderer.invoke('downloads_show_item_in_folder', fullPath) as Promise<void>,
    openPath: (fullPath: string): Promise<string> =>
      ipcRenderer.invoke('downloads_open_path', fullPath) as Promise<string>,
    setActiveProjectDir: (dir: string | null): void =>
      ipcRenderer.send('downloads_set_active_project_dir', dir),
    getDefaultDownloadDir: (): Promise<string> =>
      ipcRenderer.invoke('downloads_get_default_dir') as Promise<string>,
    copyPath: (fullPath: string): void => {
      ipcRenderer.send('downloads_copy_path', fullPath)
    },
    onCompleted: (callback: (info: any) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, info: any): void => callback(info)
      ipcRenderer.on('download_completed', handler)
      return (): void => {
        ipcRenderer.removeListener('download_completed', handler)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
}
