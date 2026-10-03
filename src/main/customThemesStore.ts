import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs'

export interface CustomProviderThemeEntry {
  modelKey: string
  hosts: string[]
  css: string
  enabled: boolean
  updatedAt: string
}

export interface CustomThemesFile {
  version: 1
  themes: Record<string, CustomProviderThemeEntry>
}

let inMemoryThemes: Map<string, CustomProviderThemeEntry> | null = null

function getStorePath(): string {
  return join(app.getPath('userData'), 'customthemes.conf')
}

export function loadCustomThemesConfig(): CustomThemesFile {
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    const defaultData: CustomThemesFile = { version: 1, themes: {} }
    inMemoryThemes = new Map()
    return defaultData
  }

  try {
    const data = readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(data) as CustomThemesFile
    inMemoryThemes = new Map(Object.entries(parsed.themes || {}))
    return parsed
  } catch (e) {
    console.error('[CustomThemesStore] Failed to parse customthemes.conf, backing up and resetting', e)
    try {
      const corruptPath = `${storePath}.corrupt.${Date.now()}`
      copyFileSync(storePath, corruptPath)
    } catch {}
    const defaultData: CustomThemesFile = { version: 1, themes: {} }
    inMemoryThemes = new Map()
    return defaultData
  }
}

export function saveCustomThemesConfig(data: CustomThemesFile): boolean {
  const storePath = getStorePath()
  const tmpPath = `${storePath}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmpPath, storePath)
    inMemoryThemes = new Map(Object.entries(data.themes || {}))
    return true
  } catch (e) {
    console.error('[CustomThemesStore] Failed to write customthemes.conf', e)
    return false
  }
}

export function getCustomThemeEntry(modelKey: string, host?: string): CustomProviderThemeEntry | undefined {
  if (!inMemoryThemes) {
    loadCustomThemesConfig()
  }
  
  if (inMemoryThemes!.has(modelKey)) {
    return inMemoryThemes!.get(modelKey)
  }
  
  if (host) {
    for (const entry of inMemoryThemes!.values()) {
      if (entry.hosts.some(h => host === h || host.endsWith('.' + h))) {
        return entry
      }
    }
  }
  
  return undefined
}

export function saveCustomThemeEntry(modelKey: string, css: string, url?: string): boolean {
  const config = loadCustomThemesConfig()
  let hosts: string[] = []
  
  if (url) {
    try {
      const parsedHost = new URL(url).host
      hosts.push(parsedHost)
      const parts = parsedHost.split('.')
      if (parts.length > 2) {
        hosts.push(parts.slice(-2).join('.')) // root domain
      }
    } catch {}
  }
  
  // Deduplicate and filter empty hosts
  hosts = [...new Set(hosts)].filter(Boolean)
  
  // If entry already exists, merge hosts
  const existing = config.themes[modelKey]
  if (existing) {
    hosts = [...new Set([...existing.hosts, ...hosts])]
  }

  config.themes[modelKey] = {
    modelKey,
    hosts,
    css,
    enabled: true,
    updatedAt: new Date().toISOString()
  }
  
  return saveCustomThemesConfig(config)
}

export function removeCustomThemeEntry(modelKey: string): boolean {
  const config = loadCustomThemesConfig()
  if (config.themes[modelKey]) {
    delete config.themes[modelKey]
    return saveCustomThemesConfig(config)
  }
  return true
}

export function getAllCustomThemes(): Record<string, CustomProviderThemeEntry> {
  const config = loadCustomThemesConfig()
  return config.themes
}
