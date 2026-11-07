import { app, type ProcessMetric, type WebContents } from 'electron'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import { getCacheStats, type CacheStats } from './cachePruningManager'

export interface ProcessDiagnostic {
  pid: number
  type: string
  name: string
  tabId?: string
  modelKey?: string
  domain?: string
  cpuPercent: number
  idleWakeupsPerSecond: number
  memoryMB: number
  peakMemoryMB: number
  privateMemoryMB: number
  sharedMemoryMB: number
  isThrottled?: boolean
  isMuted?: boolean
}

export interface TabDiagnostic {
  id: string
  modelKey: string
  title: string
  domain: string
  isActive: boolean
  isPinned: boolean
  isEvicted: boolean
  isThrottled: boolean
  isMuted: boolean
}

export interface DiagnosticReport {
  timestamp: string
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  v8Version: string
  os: {
    platform: string
    arch: string
    release: string
    totalMemoryGB: number
    freeMemoryGB: number
    cpuModel: string
    cpuCores: number
    loadAvg1m: number
  }
  summary: {
    totalProcesses: number
    totalCpuPercent: number
    totalMemoryMB: number
    mainMemoryMB: number
    gpuMemoryMB: number
    rendererMemoryMB: number
    activeTabsCount: number
    discardedTabsCount: number
    diskCacheMB: number
  }
  cache: CacheStats
  tabDiscardPolicy: {
    tabDiscardMinutes: number
    maxActiveTabs: number
  }
  tabs: TabDiagnostic[]
  processes: ProcessDiagnostic[]
}

/**
 * Sanitizes URLs to origin/protocol/host only.
 * Strips all paths, query parameters, auth tokens, and fragments.
 */
export function sanitizeDomain(rawUrl: string): string {
  if (!rawUrl) return 'about:blank'
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return 'unknown'
  }
}

export interface ViewContextInfo {
  tabId: string
  modelKey?: string
  title?: string
  url?: string
  webContents?: WebContents
}

export interface DiagnosticsContext {
  userDataDir: string
  mainWindowWebContents?: WebContents | null
  activeViewId?: string | null
  views?: Map<string, ViewContextInfo>
  isPinned?: (tabId: string) => boolean
  isEvicted?: (tabId: string) => boolean
  tabDiscardPolicy?: { tabDiscardMinutes: number; maxActiveTabs: number }
}

/**
 * Captures comprehensive performance metrics sampled over samplingMs (default 2000ms).
 */
export async function captureDiagnosticReport(
  context: DiagnosticsContext,
  samplingMs: number = 2000
): Promise<DiagnosticReport> {
  // Sample initial metrics
  if (samplingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, samplingMs))
  }

  const rawMetrics: ProcessMetric[] = typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : []
  const mainPid = process.pid
  const uiPid = context.mainWindowWebContents && !context.mainWindowWebContents.isDestroyed()
    ? context.mainWindowWebContents.getOSProcessId()
    : null

  // Build PID-to-view mapping
  const pidToView = new Map<number, ViewContextInfo>()
  const tabDiagnostics: TabDiagnostic[] = []

  if (context.views) {
    for (const [tabId, info] of context.views.entries()) {
      const wc = info.webContents
      const isDestroyed = !wc || wc.isDestroyed()
      const isEvicted = context.isEvicted ? context.isEvicted(tabId) : false
      const isActive = tabId === context.activeViewId
      const isPinned = context.isPinned ? context.isPinned(tabId) : false

      let isThrottled = false
      let isMuted = false
      let pid: number | null = null

      if (!isDestroyed && wc) {
        try {
          pid = wc.getOSProcessId()
          isThrottled = (wc as any).isBackgroundThrottled ? (wc as any).isBackgroundThrottled() : !isActive
          isMuted = wc.isAudioMuted()
          if (pid) {
            pidToView.set(pid, info)
          }
        } catch {
          // View may have closed during diagnostic snapshot
        }
      }

      tabDiagnostics.push({
        id: tabId,
        modelKey: info.modelKey || 'unknown',
        title: info.title || 'Untitled',
        domain: sanitizeDomain(info.url || ''),
        isActive,
        isPinned,
        isEvicted,
        isThrottled,
        isMuted
      })
    }
  }

  let totalCpu = 0
  let totalMemKB = 0
  let mainMemKB = 0
  let gpuMemKB = 0
  let rendererMemKB = 0

  const processes: ProcessDiagnostic[] = rawMetrics.map((m) => {
    const memMB = Math.round((m.memory.workingSetSize / 1024) * 10) / 10
    const peakMB = Math.round((m.memory.peakWorkingSetSize / 1024) * 10) / 10
    const privMB = Math.round(((m.memory.privateBytes || 0) / 1024) * 10) / 10
    const sharedMB = Math.round((((m.memory as any).sharedBytes || 0) / 1024) * 10) / 10
    const cpu = Math.round(m.cpu.percentCPUUsage * 10) / 10

    totalCpu += cpu
    totalMemKB += m.memory.workingSetSize

    let type: string = m.type
    let name = m.name || `${m.type} Process`
    let tabId: string | undefined
    let modelKey: string | undefined
    let domain: string | undefined
    let isThrottled: boolean | undefined
    let isMuted: boolean | undefined

    if (m.pid === mainPid) {
      type = 'Browser'
      name = 'Main Process (Electron Host)'
      mainMemKB += m.memory.workingSetSize
    } else if (m.type === 'GPU') {
      type = 'GPU'
      name = 'GPU Compositor & Hardware Acceleration'
      gpuMemKB += m.memory.workingSetSize
    } else if (uiPid !== null && m.pid === uiPid) {
      type = 'Renderer'
      name = 'Nexus UI Shell (React Window)'
      rendererMemKB += m.memory.workingSetSize
    } else if (pidToView.has(m.pid)) {
      const v = pidToView.get(m.pid)!
      type = 'Tab'
      name = `AI Webview (${v.modelKey || 'Tab'})`
      tabId = v.tabId
      modelKey = v.modelKey
      domain = sanitizeDomain(v.url || '')
      if (v.webContents && !v.webContents.isDestroyed()) {
        try {
          isThrottled = (v.webContents as any).isBackgroundThrottled ? (v.webContents as any).isBackgroundThrottled() : false
          isMuted = v.webContents.isAudioMuted()
        } catch {}
      }
      rendererMemKB += m.memory.workingSetSize
    } else {
      if (m.type === 'Tab' || (m.type as string) === 'Renderer') {
        rendererMemKB += m.memory.workingSetSize
      }
    }

    return {
      pid: m.pid,
      type,
      name,
      tabId,
      modelKey,
      domain,
      cpuPercent: cpu,
      idleWakeupsPerSecond: m.cpu.idleWakeupsPerSecond,
      memoryMB: memMB,
      peakMemoryMB: peakMB,
      privateMemoryMB: privMB,
      sharedMemoryMB: sharedMB,
      isThrottled,
      isMuted
    }
  })

  // Sort processes by CPU descending, then by Memory descending
  processes.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryMB - a.memoryMB)

  const cache = getCacheStats(context.userDataDir)
  const activeTabsCount = tabDiagnostics.filter((t) => !t.isEvicted).length
  const discardedTabsCount = tabDiagnostics.filter((t) => t.isEvicted).length

  return {
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion ? app.getVersion() : '1.0.4',
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8,
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      totalMemoryGB: Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100,
      freeMemoryGB: Math.round((os.freemem() / (1024 ** 3)) * 100) / 100,
      cpuModel: os.cpus()?.[0]?.model || 'Standard CPU',
      cpuCores: os.cpus()?.length || 1,
      loadAvg1m: Math.round((os.loadavg()?.[0] || 0) * 100) / 100
    },
    summary: {
      totalProcesses: processes.length,
      totalCpuPercent: Math.round(totalCpu * 10) / 10,
      totalMemoryMB: Math.round((totalMemKB / 1024) * 10) / 10,
      mainMemoryMB: Math.round((mainMemKB / 1024) * 10) / 10,
      gpuMemoryMB: Math.round((gpuMemKB / 1024) * 10) / 10,
      rendererMemoryMB: Math.round((rendererMemKB / 1024) * 10) / 10,
      activeTabsCount,
      discardedTabsCount,
      diskCacheMB: cache.totalCacheMB
    },
    cache,
    tabDiscardPolicy: context.tabDiscardPolicy || {
      tabDiscardMinutes: 10,
      maxActiveTabs: 3
    },
    tabs: tabDiagnostics,
    processes
  }
}

/**
 * Saves the diagnostic report as a formatted JSON file in Downloads or designated folder.
 */
export function saveDiagnosticsToFile(
  report: DiagnosticReport,
  targetDir?: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    let dir = targetDir
    if (!dir) {
      try {
        dir = app.getPath('downloads')
      } catch {
        dir = app.getPath('userData')
      }
    }
    mkdirSync(dir, { recursive: true })

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `nexus-diagnostics-${dateStr}.json`
    const filePath = join(dir, fileName)

    const json = JSON.stringify(report, null, 2)
    writeFileSync(filePath, json, 'utf-8')

    return { success: true, filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}
