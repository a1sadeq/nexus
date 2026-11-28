import { describe, it, expect } from 'vitest'
import {
  completeProcSamples,
  cpuPercentBetween,
  parseProcStat,
  rankCpuUsage,
  readProcStat,
  takeProcSamples,
  USER_HZ
} from './cpuSampler'

/**
 * Build 50 — the report could not name the process, so the report was fixed first.
 *
 * The build-49 diagnostics list ten electron processes and put `cpuPercent: 0` on every one of them,
 * including the two webviews that were demonstrably busy. That number came from Electron's
 * `percentCPUUsage`, which is empty on Linux. Everything here is the arithmetic that replaces it, with
 * the awkward cases pinned down: a process name containing spaces and parentheses, a process that
 * vanishes between the two samples, and a counter that goes backwards.
 */

// A real line, with the comm field deliberately full of the things that break naive parsers.
const statLine = (utime: number, stime: number, comm = '(electron --type=renderer)'): string =>
  `2631 ${comm} S 1 2631 2631 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 22 0 1234 567 89 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${utime + stime}`

describe('reading /proc/<pid>/stat', () => {
  it('takes utime and stime, not the fields next to them', () => {
    expect(parseProcStat(statLine(700, 300))).toEqual({ utime: 700, stime: 300 })
  })

  it('survives a process name with spaces and parentheses in it', () => {
    const line = statLine(12, 34, '(weird (name) here)')
    expect(parseProcStat(line)).toEqual({ utime: 12, stime: 34 })
  })

  it('says nothing for content it cannot read', () => {
    expect(parseProcStat('')).toBeNull()
    expect(parseProcStat('no parentheses here')).toBeNull()
    expect(parseProcStat('1234 (x) S 1 2')).toBeNull() // too short to contain the fields
  })

  it('is null, never zero, for a pid that is gone', () => {
    const read = (path: string): string => {
      throw new Error(`ENOENT ${path}`)
    }
    expect(readProcStat(999999, read)).toBeNull()
    expect(readProcStat(0, read)).toBeNull()
    expect(readProcStat(-5, read)).toBeNull()
  })
})

describe('turning two samples into a percentage', () => {
  it('reads one core fully used as 100', () => {
    // 100 ticks over one second at USER_HZ=100 is one full second of CPU.
    expect(cpuPercentBetween({ utime: 0, stime: 0 }, { utime: 80, stime: 20 }, 1000)).toBe(100)
  })

  it('scales with the sampling window', () => {
    expect(cpuPercentBetween({ utime: 0, stime: 0 }, { utime: 100, stime: 0 }, 2000)).toBe(50)
  })

  it('reports a genuinely idle process as 0 — and says so distinctly from unknown', () => {
    expect(cpuPercentBetween({ utime: 5, stime: 5 }, { utime: 5, stime: 5 }, 1000)).toBe(0)
    expect(cpuPercentBetween(null, { utime: 1, stime: 1 }, 1000)).toBeNull()
    expect(cpuPercentBetween({ utime: 1, stime: 1 }, null, 1000)).toBeNull()
    expect(cpuPercentBetween({ utime: 0, stime: 0 }, { utime: 1, stime: 0 }, 0)).toBeNull()
  })

  it('refuses a counter that went backwards instead of printing a negative', () => {
    expect(cpuPercentBetween({ utime: 100, stime: 0 }, { utime: 10, stime: 0 }, 1000)).toBeNull()
  })

  it('honours a different USER_HZ', () => {
    expect(cpuPercentBetween({ utime: 0, stime: 0 }, { utime: 100, stime: 0 }, 1000, 200)).toBe(50)
    expect(USER_HZ).toBe(100)
  })
})

describe('sampling a set of processes', () => {
  // Two readings of the same `/proc`, taken `samplingMs` apart: pid 11 idle, pid 22 busy, pid 33 gone.
  const first = (path: string): string => {
    const table: Record<string, string> = {
      '/proc/11/stat': statLine(0, 0),
      '/proc/22/stat': statLine(1000, 0)
    }
    const value = table[path]
    if (!value) throw new Error(`ENOENT ${path}`)
    return value
  }
  const second = (path: string): string => {
    const table: Record<string, string> = {
      '/proc/11/stat': statLine(0, 0),
      '/proc/22/stat': statLine(1100, 0)
    }
    const value = table[path]
    if (!value) throw new Error(`ENOENT ${path}`)
    return value
  }

  it('skips the pids it cannot read and completes the rest', () => {
    const samples = takeProcSamples([11, 22, 33], first)
    expect(samples.map((s) => s.pid)).toEqual([11, 22])
    const measured = completeProcSamples(samples, 1000, second)
    expect(measured.get(11)).toBe(0)
    expect(measured.get(22)).toBe(100)
    expect(measured.has(33)).toBe(false)
  })

  it('a process that dies between the two readings is left out, not counted as idle', () => {
    const samples = takeProcSamples([11], first)
    const measured = completeProcSamples(samples, 1000, () => {
      throw new Error('ENOENT')
    })
    expect(measured.size).toBe(0)
  })
})

describe('naming the offender', () => {
  it('orders by CPU and leaves out anything unmeasured or idle', () => {
    const ranked = rankCpuUsage([
      { pid: 1, cpuPercent: 0, name: 'idle' },
      { pid: 2, cpuPercent: 42.5, name: 'busy' },
      { pid: 3, cpuPercent: null, name: 'unknown' },
      { pid: 4, cpuPercent: 91, name: 'busiest' }
    ])
    expect(ranked.map((r) => r.name)).toEqual(['busiest', 'busy'])
  })

  it('respects the limit, and an empty list is an empty list', () => {
    expect(rankCpuUsage([{ pid: 1, cpuPercent: 5 }], 0)).toEqual([])
    expect(rankCpuUsage([])).toEqual([])
  })
})
