import { readFileSync } from 'node:fs'

/**
 * Who is burning the CPU — answered, instead of assumed.
 *
 * The build-49 diagnostics are the reason this module exists. Ten electron processes, five AI tabs, a
 * GPU process and the UI shell, and every single `cpuPercent` in the report was `0`. The number came
 * from Electron's `ProcessMetric.cpu.percentCPUUsage`, which is a Windows/macOS measurement and is
 * documented to be empty on Linux — so the one report a user sends when they say "huge CPU usage" was
 * structurally incapable of naming the process responsible.
 *
 * On Linux the truth is right there in `/proc/<pid>/stat`: `utime + stime`, in clock ticks, since the
 * process started. Two samples a known interval apart give a percentage. This module is the arithmetic
 * only — parsing, differencing and ranking — so it can be tested without a `/proc` and without timing.
 *
 * Everything returns a number that means something: a process that used no CPU reports 0, a process we
 * could not read reports `null` rather than a fake 0, and the ranking never invents an offender.
 */

/** The fields of `/proc/<pid>/stat` this needs: 14 = utime, 15 = stime, in USER_HZ ticks. */
export interface ProcStatSample {
  utime: number
  stime: number
}

/** Linux reports times in hundredths of a second; a different value would change every percentage. */
export const USER_HZ = 100

/**
 * Parse the two fields we need.
 *
 * `comm` (field 2) is in parentheses and may itself contain spaces and parentheses, so the parse starts
 * after the *last* `)` rather than splitting on whitespace: `(electron --type=renderer)` would otherwise
 * shift every field by one and produce a plausible, wrong answer.
 */
export function parseProcStat(content: string): ProcStatSample | null {
  if (!content) return null
  const close = content.lastIndexOf(')')
  if (close < 0) return null
  const rest = content.slice(close + 1).trim()
  if (!rest) return null
  const fields = rest.split(/\s+/)
  // `rest` starts at field 3 (state). utime is field 14, stime field 15.
  const utime = Number(fields[14 - 3])
  const stime = Number(fields[15 - 3])
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
  return { utime, stime }
}

/**
 * Percent of one core, from two samples.
 *
 * A process pegging a single core reads 100. The number is deliberately per-core rather than divided by
 * the machine's core count: when one webview is spinning, "100" says what is happening and "6" does not.
 */
export function cpuPercentBetween(
  before: ProcStatSample | null,
  after: ProcStatSample | null,
  elapsedMs: number,
  userHz: number = USER_HZ
): number | null {
  if (!before || !after || elapsedMs <= 0) return null
  const ticks = after.utime + after.stime - (before.utime + before.stime)
  if (!Number.isFinite(ticks)) return null
  if (ticks < 0) return null
  const seconds = elapsedMs / 1000
  const percent = (ticks / userHz) / seconds * 100
  return Math.round(percent * 10) / 10
}

/** Read one sample. Unreadable (or vanished) processes are `null`, never zero. */
export function readProcStat(pid: number, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): ProcStatSample | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    return parseProcStat(readFile(`/proc/${pid}/stat`))
  } catch {
    return null
  }
}

export interface CpuSample {
  pid: number
  before: ProcStatSample
}

/** Take the "before" side for a set of pids, skipping the ones that cannot be read. */
export function takeProcSamples(
  pids: number[],
  readFile?: (path: string) => string
): CpuSample[] {
  const out: CpuSample[] = []
  for (const pid of pids) {
    const stat = readProcStat(pid, readFile)
    if (stat) out.push({ pid, before: stat })
  }
  return out
}

/** The "after" side: percentage per pid, for the pids we could read both times. */
export function completeProcSamples(
  samples: CpuSample[],
  elapsedMs: number,
  readFile?: (path: string) => string,
  userHz: number = USER_HZ
): Map<number, number> {
  const out = new Map<number, number>()
  for (const sample of samples) {
    const after = readProcStat(sample.pid, readFile)
    const percent = cpuPercentBetween(sample.before, after, elapsedMs, userHz)
    if (percent !== null) out.set(sample.pid, percent)
  }
  return out
}

/**
 * Name the offenders, in order.
 *
 * This is what the report shows when the total is high: not "the app uses CPU", but "these two
 * webviews used this much of a core each, and the one on screen was not one of them".
 */
export function rankCpuUsage<T extends { pid: number; cpuPercent: number | null }>(
  rows: T[],
  limit = 3
): T[] {
  return [...rows]
    .filter((row) => typeof row.cpuPercent === 'number' && row.cpuPercent > 0)
    .sort((a, b) => (b.cpuPercent as number) - (a.cpuPercent as number))
    .slice(0, Math.max(0, limit))
}
