import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeDomain,
  captureDiagnosticReport,
  saveDiagnosticsToFile,
  type DiagnosticsContext
} from './diagnosticsManager'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), 'nexus-diag-test-' + Date.now())

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.4'),
    getPath: vi.fn(() => testDir),
    getAppMetrics: vi.fn(() => [
      {
        pid: process.pid,
        type: 'Browser',
        cpu: { percentCPUUsage: 3.5, idleWakeupsPerSecond: 10 },
        memory: {
          workingSetSize: 102400, // 100MB
          peakWorkingSetSize: 120000,
          privateBytes: 80000,
          sharedBytes: 22400
        }
      },
      {
        pid: 9999,
        type: 'GPU',
        cpu: { percentCPUUsage: 1.2, idleWakeupsPerSecond: 5 },
        memory: {
          workingSetSize: 51200, // 50MB
          peakWorkingSetSize: 60000,
          privateBytes: 40000,
          sharedBytes: 11200
        }
      },
      {
        pid: 8888,
        type: 'Renderer',
        cpu: { percentCPUUsage: 15.0, idleWakeupsPerSecond: 30 },
        memory: {
          workingSetSize: 204800, // 200MB
          peakWorkingSetSize: 250000,
          privateBytes: 180000,
          sharedBytes: 24800
        }
      }
    ])
  }
}))

vi.mock('./cachePruningManager', () => ({
  getCacheStats: vi.fn(() => ({
    rootCacheBytes: 10485760,
    partitionCacheBytes: 20971520,
    totalCacheBytes: 31457280,
    totalCacheMB: 30.0,
    processMemoryMB: 350.0,
    heapUsedMB: 120.0
  }))
}))

describe('DiagnosticsManager', () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  it('sanitizeDomain strips queries, auth tokens, paths, and fragments', () => {
    expect(sanitizeDomain('https://chatgpt.com/c/672728?token=secret123#bottom')).toBe('https://chatgpt.com')
    expect(sanitizeDomain('https://claude.ai/chat/abc-def-123')).toBe('https://claude.ai')
    expect(sanitizeDomain('http://localhost:5173/?session=xyz')).toBe('http://localhost:5173')
    expect(sanitizeDomain('')).toBe('about:blank')
    expect(sanitizeDomain('not-a-url')).toBe('unknown')
  })

  it('captureDiagnosticReport builds complete telemetry report and correlates tab views', async () => {
    const mockWc = {
      isDestroyed: () => false,
      getOSProcessId: () => 8888,
      isBackgroundThrottled: () => false,
      isAudioMuted: () => false
    }

    const views = new Map<string, any>([
      [
        'tab-1',
        {
          tabId: 'tab-1',
          modelKey: 'claude',
          title: 'Claude Chat',
          url: 'https://claude.ai/chat/secret-session-id',
          webContents: mockWc
        }
      ]
    ])

    const context: DiagnosticsContext = {
      userDataDir: testDir,
      mainWindowWebContents: null,
      activeViewId: 'tab-1',
      views,
      isPinned: () => true,
      isEvicted: () => false,
      tabDiscardPolicy: { tabDiscardMinutes: 10, maxActiveTabs: 3 }
    }

    // Call with 0ms sampling in tests for speed
    const report = await captureDiagnosticReport(context, 0)

    expect(report.appVersion).toBe('1.0.4')
    expect(report.os.platform).toBe(process.platform)
    expect(report.summary.totalProcesses).toBe(3)
    expect(report.summary.totalCpuPercent).toBe(19.7) // 15.0 + 3.5 + 1.2
    expect(report.summary.diskCacheMB).toBe(30.0)

    // Check tab correlation
    const claudeTab = report.tabs.find((t) => t.id === 'tab-1')
    expect(claudeTab).toBeDefined()
    expect(claudeTab?.domain).toBe('https://claude.ai')
    expect(claudeTab?.isActive).toBe(true)
    expect(claudeTab?.isPinned).toBe(true)

    // Check process correlation
    const tabProcess = report.processes.find((p) => p.pid === 8888)
    expect(tabProcess).toBeDefined()
    expect(tabProcess?.name).toBe('AI Webview (claude)')
    expect(tabProcess?.domain).toBe('https://claude.ai')
  })

  it('saveDiagnosticsToFile writes formatted json to target directory', () => {
    const report: any = {
      timestamp: '2026-11-07T18:00:00.000Z',
      summary: { totalProcesses: 3 }
    }

    const result = saveDiagnosticsToFile(report, testDir)
    expect(result.success).toBe(true)
    expect(result.filePath).toBeDefined()
    expect(existsSync(result.filePath!)).toBe(true)

    const parsed = JSON.parse(readFileSync(result.filePath!, 'utf-8'))
    expect(parsed.summary.totalProcesses).toBe(3)
  })
})
