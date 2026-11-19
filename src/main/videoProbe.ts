import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { VideoSourceInfo } from '../shared/videoPlan'

/**
 * Local media probing for plan 01 — metadata only, no network, no shell.
 *
 * Deliberate properties:
 *  - `spawn` with an argument array and `shell: false`: a filename with spaces, quotes or
 *    `; rm -rf /` is just a filename, never a command.
 *  - bounded stdout (a hostile or broken file cannot make us buffer gigabytes) and a hard
 *    timeout, because ffprobe on a malformed container can hang.
 *  - missing tooling is a first-class result (`tool-missing`), not an exception: the UI can
 *    then honestly offer the original-file route instead of pretending to prepare anything.
 *  - read-only: we never write next to the user's media.
 */

export interface MediaToolPaths {
  ffprobe?: string
  ffmpeg?: string
  /** How the tools were found, for the honesty line in the UI. */
  source?: 'env' | 'path' | 'bundled' | 'none'
}

export type ProbeFailureReason =
  | 'tool-missing'
  | 'not-a-video'
  | 'probe-failed'
  | 'timeout'
  | 'file-missing'

export type ProbeResult =
  | { ok: true; info: VideoSourceInfo; tool: string }
  | { ok: false; reason: ProbeFailureReason; message: string }

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

const CANDIDATE_BINARIES = {
  ffprobe: process.platform === 'win32' ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe'],
  ffmpeg: process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) return false
    // Windows has no execute bit; existence is the best we can check there.
    if (process.platform === 'win32') return true
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Locate ffprobe/ffmpeg.
 * Order: explicit env override (NEXUS_FFPROBE_PATH / NEXUS_FFMPEG_PATH), a bundled
 * `vendor/media` or `resources/media` directory, then PATH.
 */
export function locateMediaTools(
  env: NodeJS.ProcessEnv = process.env,
  options: { appRoot?: string } = {}
): MediaToolPaths {
  const found: MediaToolPaths = {}

  const fromPath = (name: 'ffprobe' | 'ffmpeg'): string | undefined => {
    const overrideKey = name === 'ffprobe' ? 'NEXUS_FFPROBE_PATH' : 'NEXUS_FFMPEG_PATH'
    const override = env[overrideKey]
    if (override && isExecutableFile(override)) {
      found.source = found.source ?? 'env'
      return override
    }
    const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
    for (const dirCandidate of CANDIDATE_BINARIES[name]) {
      for (const dir of dirs) {
        const full = path.join(dir, dirCandidate)
        if (isExecutableFile(full)) {
          if (!found.source) found.source = 'path'
          return full
        }
      }
    }
    if (options.appRoot) {
      for (const bundled of [
        path.join(options.appRoot, 'vendor', 'media'),
        path.join(options.appRoot, 'resources', 'media')
      ]) {
        for (const bin of CANDIDATE_BINARIES[name]) {
          const full = path.join(bundled, bin)
          if (isExecutableFile(full)) {
            found.source = 'bundled'
            return full
          }
        }
      }
    }
    return undefined
  }

  found.ffprobe = fromPath('ffprobe')
  found.ffmpeg = fromPath('ffmpeg')
  if (!found.source) found.source = 'none'
  return found
}

interface SpawnCaptureResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  overflowed: boolean
}

function runBounded(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        // Own process group so a timeout kills ffprobe *and* anything it spawned.
        detached: process.platform !== 'win32'
      })
    } catch {
      resolve({ code: null, stdout: '', stderr: 'spawn failed', timedOut: false, overflowed: false })
      return
    }

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    let size = 0
    let overflowed = false
    let timedOut = false
    let settled = false
    let fallbackTimer: NodeJS.Timeout | undefined

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      try {
        child.stdout?.destroy()
        child.stderr?.destroy()
      } catch {
        /* streams already closed */
      }
      resolve({
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        timedOut,
        overflowed
      })
    }

    const killTree = (): void => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL')
          return
        }
      } catch {
        /* group already gone — fall through to the direct kill */
      }
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      // A grandchild can keep the inherited pipes open; do not wait on 'close' forever.
      fallbackTimer = setTimeout(() => finish(null), 500)
    }, timeoutMs)

    child.stdout?.on('data', (buf: Buffer) => {
      size += buf.length
      if (size > MAX_OUTPUT_BYTES) {
        overflowed = true
        killTree()
        return
      }
      chunks.push(buf)
    })
    child.stderr?.on('data', (buf: Buffer) => {
      if (errChunks.length < 64) errChunks.push(buf)
    })
    child.on('error', () => finish(null))
    child.on('close', (code: number | null) => finish(code))
  })
}

interface FfprobeStream {
  index?: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  start_time?: string
  duration?: string
  nb_frames?: string
  channels?: number
  tags?: Record<string, string>
  side_data_list?: Array<Record<string, unknown>>
}

interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
    start_time?: string
    format_name?: string
  }
}

function ratio(value: string | undefined): number {
  if (!value) return 0
  const [n, d] = value.split('/')
  const num = Number(n)
  const den = d === undefined ? 1 : Number(d)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0
  return num / den
}

function normalizeRotation(stream: FfprobeStream): number {
  let degrees = 0
  if (stream.side_data_list) {
    for (const side of stream.side_data_list) {
      const rotation = side.rotation
      if (typeof rotation === 'number' && Number.isFinite(rotation)) degrees = rotation
    }
  }
  if (degrees === 0 && stream.tags?.rotate) {
    const parsed = Number(stream.tags.rotate)
    if (Number.isFinite(parsed)) degrees = parsed
  }
  const wrapped = ((Math.round(degrees) % 360) + 360) % 360
  // Only the four display rotations matter for rendering.
  return [0, 90, 180, 270].reduce((best, candidate) =>
    Math.abs(candidate - wrapped) < Math.abs(best - wrapped) ? candidate : best
  )
}

/**
 * Parse ffprobe JSON into our source model. Pure: exported for tests.
 * Anything ambiguous stays flagged rather than silently normalised.
 */
export function parseFfprobeJson(json: string, fallbackDurationSec = 0): ProbeResult {
  let parsed: FfprobeJson
  try {
    parsed = JSON.parse(json) as FfprobeJson
  } catch {
    return { ok: false, reason: 'probe-failed', message: 'ffprobe did not return valid JSON' }
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const videoStream = streams.find((s) => s.codec_type === 'video')
  if (!videoStream) {
    return {
      ok: false,
      reason: 'not-a-video',
      message: 'No video stream in this file — it is not a video container.'
    }
  }

  const audioStreams = streams.filter((s) => s.codec_type === 'audio')
  const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle')

  const durationCandidates = [
    Number(parsed.format?.duration),
    Number(videoStream.duration),
    Number(audioStreams[0]?.duration),
    fallbackDurationSec
  ].filter((n) => Number.isFinite(n) && n > 0)
  const durationSec = durationCandidates[0] ?? 0

  const nominalRate = ratio(videoStream.r_frame_rate)
  const averageRate = ratio(videoStream.avg_frame_rate)
  const isVariableFrameRate =
    nominalRate > 0 && averageRate > 0 && Math.abs(nominalRate - averageRate) / nominalRate > 0.01

  const startTimeCandidates = [Number(parsed.format?.start_time), Number(videoStream.start_time)].filter(
    (n) => Number.isFinite(n)
  )
  const startTimeSec = startTimeCandidates.find((n) => n !== 0) ?? 0

  const width = Number(videoStream.width) || 0
  const height = Number(videoStream.height) || 0
  const rotationDeg = normalizeRotation(videoStream)

  return {
    ok: true,
    tool: 'ffprobe',
    info: {
      durationSec,
      width,
      height,
      rotationDeg,
      frameRate: averageRate > 0 ? averageRate : nominalRate,
      isVariableFrameRate,
      hasAudio: audioStreams.length > 0,
      audioTracks: audioStreams.length,
      subtitleTracks: subtitleStreams.length,
      startTimeSec
    }
  }
}

/** Read duration from ffprobe's JSON output; exported so the extractor can reuse one probe. */
export async function probeVideo(
  filePath: string,
  options: { toolPath?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ProbeResult> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'file-missing', message: `File not found: ${filePath}` }
  }
  const tool = options.toolPath ?? locateMediaTools(options.env).ffprobe
  if (tool && !isExecutableFile(tool)) {
    return {
      ok: false,
      reason: 'tool-missing',
      message: `The configured ffprobe (${tool}) is missing or not executable. Nexus can still attach the original file.`
    }
  }
  if (!tool) {
    return {
      ok: false,
      reason: 'tool-missing',
      message:
        'ffprobe is not available, so this video cannot be inspected locally. Nexus can still attach the original file, or you can point NEXUS_FFPROBE_PATH at an ffprobe binary.'
    }
  }

  const result = await runBounded(
    tool,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-i',
      filePath
    ],
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  if (result.timedOut) {
    return {
      ok: false,
      reason: 'timeout',
      message: 'ffprobe did not finish in time; the file may be damaged or unusually large.'
    }
  }
  if (result.overflowed) {
    return {
      ok: false,
      reason: 'probe-failed',
      message: 'ffprobe produced more metadata than Nexus will read; refusing to continue.'
    }
  }
  if (!result.stdout.trim()) {
    return {
      ok: false,
      reason: 'probe-failed',
      message: result.stderr.trim() || `ffprobe exited with code ${result.code} and no output.`
    }
  }

  const parsed = parseFfprobeJson(result.stdout)
  if (parsed.ok) return { ...parsed, tool }
  return parsed
}

/**
 * Build the ffmpeg argument vector for still extraction. Kept pure and separate from
 * execution so the exact command the user's machine will run can be asserted in tests.
 *
 * Two passes over one input, single process: scene-filtered stills, and a periodic
 * fps filter filling the gaps — because scene cuts alone miss static screens.
 */
export function buildExtractArgs(opts: {
  inputPath: string
  sceneDir: string
  gridDir: string
  edgePx: number
  sceneThreshold: number
  intervalSec: number
  maxFramesPerPass: number
  ffmpegThreads?: number
}): string[] {
  const scale = `scale='if(gt(iw,ih),min(${opts.edgePx},iw),-2)':'if(gt(iw,ih),-2,min(${opts.edgePx},ih))'`
  const sceneFilter = `select='gt(scene,${opts.sceneThreshold})',${scale}`
  const gridFilter = `fps=1/${opts.intervalSec},${scale}`
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-threads',
    String(opts.ffmpegThreads ?? 2),
    '-i',
    opts.inputPath,
    '-map',
    '0:v:0',
    '-vf',
    sceneFilter,
    '-frames:v',
    String(opts.maxFramesPerPass),
    '-q:v',
    '4',
    path.join(opts.sceneDir, 'scene_%04d.jpg'),
    '-map',
    '0:v:0',
    '-vf',
    gridFilter,
    '-frames:v',
    String(opts.maxFramesPerPass),
    '-q:v',
    '4',
    path.join(opts.gridDir, 'grid_%04d.jpg')
  ]
}
