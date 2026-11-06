// src/main/stateIpc.ts
import { app, ipcMain, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, scheduleWrite, STATE_FILES, type StateKey } from './atomicWrite'

export const trustedSenders = new Set<number>()
export function trustWindow(win: BrowserWindow): void {
  const id = win.webContents.id
  trustedSenders.add(id)
  win.on('closed', () => trustedSenders.delete(id))
}

// Session Write Barrier: tracks completed reads per session and state key
export const hydratedSessions = new Set<string>()

// Electron version marker: warns if profile is run under an older Chromium major
export function checkElectronVersionMarker(): void {
  const markerPath = join(app.getPath('userData'), '.electron-version')
  try {
    const recorded = readFileSync(markerPath, 'utf-8').trim()
    const running = `electron ${process.versions.electron}`
    if (recorded && recorded !== running) {
      console.warn(`[nexus] Profile was last opened by ${recorded}, now running ${running} - version regression risks store incompatibility`)
    }
  } catch {}
  try {
    writeFileSync(markerPath, `electron ${process.versions.electron}\n`, 'utf-8')
  } catch {}
}

const SAFE_URL_REGEX = /^https?:\/\//i

export function validatePayload(key: StateKey, rawPayload: unknown): unknown {
  let payload = rawPayload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      throw new Error(`Invalid JSON string payload for ${key}`)
    }
  }
  if (payload == null || typeof payload !== 'object') {
    throw new Error(`Invalid payload for ${key}: expected object or array`)
  }
  if (key === 'tabs') {
    const tabs = (payload as any).tabs
    if (!Array.isArray(tabs) || tabs.length === 0) {
      throw new Error('tabs[] required and must not be empty')
    }
    if (tabs.length > 64) {
      throw new Error('Exceeded maximum tab cap (64)')
    }
    for (const t of tabs) {
      if (typeof t?.id !== 'string' || typeof t?.url !== 'string') {
        throw new Error('Tab item invalid shape')
      }
      if (!SAFE_URL_REGEX.test(t.url)) {
        throw new Error(`Blocked unsafe tab URL scheme: ${t.url.slice(0, 32)}`)
      }
    }
  }
  if (key === 'pinned') {
    if (!Array.isArray(payload) || !payload.every((id) => typeof id === 'string')) {
      throw new Error('pinned payload must be an array of string IDs')
    }
  }
  return payload
}

export type StateSaveCallback = (key: StateKey, data: unknown) => void

export function registerStateIpc(onStateSaved?: StateSaveCallback): void {
  checkElectronVersionMarker()

  // One-shot synchronous theme read for pre-paint styling (eliminates FOUC)
  ipcMain.on('get_theme_sync', (event) => {
    if (!trustedSenders.has(event.sender.id)) {
      event.returnValue = null
      return
    }
    hydratedSessions.add(`${event.sender.id}:theme`)
    const themePath = join(app.getPath('userData'), STATE_FILES.theme)
    event.returnValue = readJson(themePath)
  })

  // Synchronous tabs read for instantaneous initial state restoration (eliminates dummy tab flash)
  ipcMain.on('get_tabs_sync', (event) => {
    if (!trustedSenders.has(event.sender.id)) {
      event.returnValue = null
      return
    }
    hydratedSessions.add(`${event.sender.id}:tabs`)
    const tabsPath = join(app.getPath('userData'), STATE_FILES.tabs)
    event.returnValue = readJson(tabsPath)
  })

  for (const key of Object.keys(STATE_FILES) as StateKey[]) {
    // Read Handler: get_<key>
    ipcMain.handle(`get_${key}`, (event) => {
      if (!trustedSenders.has(event.sender.id)) {
        throw new Error(`Untrusted sender for get_${key}`)
      }
      const filePath = join(app.getPath('userData'), STATE_FILES[key])
      const data = readJson(filePath)
      // Open the barrier for this session & key
      hydratedSessions.add(`${event.sender.id}:${key}`)
      return data
    })

    // Write Handler: save_<key>
    ipcMain.handle(`save_${key}`, (event, payload) => {
      if (!trustedSenders.has(event.sender.id)) {
        throw new Error(`Untrusted sender for save_${key}`)
      }
      // Enforce the Session Write Barrier
      if (!hydratedSessions.has(`${event.sender.id}:${key}`)) {
        throw new Error(`Write Barrier: save_${key} rejected because session never completed get_${key}`)
      }
      const cleanPayload = validatePayload(key, payload)
      scheduleWrite(key, cleanPayload)
      onStateSaved?.(key, cleanPayload)
      return true
    })
  }
}
