import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  cleanupJobDir,
  parseSceneTimestamps,
  prepareVideo,
  sweepStaleJobDirs
} from './videoPrepare'

const tempDirs: string[] = []
const jobDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prep-test-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of [...tempDirs, ...jobDirs]) fs.rmSync(dir, { recursive: true, force: true })
})

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: 'video', width: 1280, height: 720, r_frame_rate: '25/1', avg_frame_rate: '25/1', duration: '120.0' },
    { codec_type: 'audio', codec_name: 'aac', channels: 2 }
  ],
  format: { duration: '120.0', start_time: '0.0' }
})

/**
 * A fake ffmpeg that does the two things the extractor depends on:
 *  - the scene pass logs `pts_time:` lines (like showinfo) and writes nothing;
 *  - the still pass writes a JPEG-ish file to the last argument.
 * Behaviour knobs let tests make it hang, fail, or produce nothing.
 */
function fakeFfmpeg(
  dir: string,
  options: { sceneTimes?: number[]; failEvery?: number; emptyEvery?: number; hang?: boolean } = {}
): string {
  const file = path.join(dir, 'ffmpeg')
  const sceneTimes = options.sceneTimes ?? [5, 40, 90]
  const sceneLines = sceneTimes
    .map((t, i) => `[Parsed_showinfo_1 @ 0x1] n:${i} pts:${t} pts_time:${t} pos:1 fmt:yuv420p`)
    .join('\\n')
  const script = `#!/bin/sh
${options.hang ? 'sleep 30\n' : ''}
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-ss" ]; then SS="$a"; fi
  prev="$a"
  out="$a"
done
case "$*" in
  *showinfo*)
    printf '${sceneLines}\\n' >&2
    exit 0
    ;;
esac
N=$(basename "$out" | sed 's/[^0-9]//g')
${options.failEvery ? `if [ $((N % ${options.failEvery})) -eq 0 ]; then echo "decode error" >&2; exit 1; fi` : ''}
${options.emptyEvery ? `if [ $((N % ${options.emptyEvery})) -eq 0 ]; then : > "$out"; exit 0; fi` : ''}
printf 'JPEGDATA-%s' "\${SS:-0}" > "$out"
exit 0
`
  fs.writeFileSync(file, script, { mode: 0o755 })
  return file
}

function fakeFfprobe(dir: string, json = PROBE_JSON): string {
  const file = path.join(dir, 'ffprobe')
  fs.writeFileSync(file, `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`, { mode: 0o755 })
  return file
}

function inputFile(dir: string): string {
  const file = path.join(dir, 'clip.mp4')
  fs.writeFileSync(file, 'ORIGINAL-VIDEO-BYTES')
  return file
}

describe('scene log parsing', () => {
  it('reads pts_time values in order', () => {
    const log = '[showinfo @ 1] n:0 pts_time:3.5 x\n[showinfo @ 1] n:1 pts_time:12.25 y'
    expect(parseSceneTimestamps(log)).toEqual([3.5, 12.25])
  })

  it('ignores negatives, junk and non-numeric noise', () => {
    expect(parseSceneTimestamps('pts_time:-1 pts_time:abc pts_time:4')).toEqual([4])
    expect(parseSceneTimestamps('')).toEqual([])
  })
})

describe('preparing a video locally', () => {
  it('extracts stills into a private job dir and leaves the original untouched', async () => {
    const dir = tempDir()
    const input = inputFile(dir)
    const before = fs.readFileSync(input)
    const tools = { ffmpeg: fakeFfmpeg(dir), ffprobe: fakeFfprobe(dir) }

    const result = await prepareVideo({ inputPath: input, pace: 'quick', tools })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    jobDirs.push(result.prepared.jobDir)

    expect(result.prepared.frames.length).toBeGreaterThan(0)
    for (const frame of result.prepared.frames) {
      expect(frame.path.startsWith(result.prepared.jobDir)).toBe(true)
      expect(fs.existsSync(frame.path)).toBe(true)
      expect(frame.bytes).toBeGreaterThan(0)
    }
    // Original is byte-identical and still in place.
    expect(fs.existsSync(input)).toBe(true)
    expect(fs.readFileSync(input).equals(before)).toBe(true)
    // Temp dir is not world-readable where the platform supports modes.
    if (process.platform !== 'win32') {
      expect(fs.statSync(result.prepared.jobDir).mode & 0o777).toBe(0o700)
    }
  })

  it('respects the pace frame budget', async () => {
    const dir = tempDir()
    const tools = { ffmpeg: fakeFfmpeg(dir), ffprobe: fakeFfprobe(dir) }
    const result = await prepareVideo({ inputPath: inputFile(dir), pace: 'quick', tools })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    jobDirs.push(result.prepared.jobDir)
    expect(result.prepared.frames.length).toBeLessThanOrEqual(12)
  })

  it('reports the plan that was actually produced, not the one requested', async () => {
    const dir = tempDir()
    const tools = { ffmpeg: fakeFfmpeg(dir, { emptyEvery: 2 }), ffprobe: fakeFfprobe(dir) }
    const result = await prepareVideo({ inputPath: inputFile(dir), pace: 'quick', tools })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    jobDirs.push(result.prepared.jobDir)
    const { prepared } = result
    expect(prepared.plan.estimatedImages).toBe(prepared.frames.length)
    expect(prepared.totalBytes).toBe(prepared.frames.reduce((n, f) => n + f.bytes, 0))
    // Missing stills are disclosed rather than silently absent.
    expect(prepared.warnings.join(' ')).toMatch(/could not be extracted|were not extracted/)
  })

  it('keeps going when some frames fail, and discloses it', async () => {
    const dir = tempDir()
    const tools = { ffmpeg: fakeFfmpeg(dir, { failEvery: 3 }), ffprobe: fakeFfprobe(dir) }
    const result = await prepareVideo({ inputPath: inputFile(dir), pace: 'quick', tools })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    jobDirs.push(result.prepared.jobDir)
    expect(result.prepared.frames.length).toBeGreaterThan(0)
    expect(result.prepared.warnings.length).toBeGreaterThan(0)
  })

  it('fails honestly when ffmpeg is absent', async () => {
    const dir = tempDir()
    const result = await prepareVideo({
      inputPath: inputFile(dir),
      pace: 'quick',
      tools: { ffprobe: fakeFfprobe(dir), ffmpeg: path.join(dir, 'nope') }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('ffmpeg-missing')
  })

  it('fails honestly when the file is not a video', async () => {
    const dir = tempDir()
    const probe = fakeFfprobe(dir, JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '9' } }))
    const result = await prepareVideo({
      inputPath: inputFile(dir),
      pace: 'quick',
      tools: { ffmpeg: fakeFfmpeg(dir), ffprobe: probe }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-video')
  })

  it('stops cleanly when cancelled and removes its temp dir', async () => {
    const dir = tempDir()
    const controller = new AbortController()
    const tools = { ffmpeg: fakeFfmpeg(dir), ffprobe: fakeFfprobe(dir) }
    let jobDir: string | null = null

    const result = await prepareVideo({
      inputPath: inputFile(dir),
      pace: 'detailed',
      tools,
      signal: controller.signal,
      onJobCreated: (created) => {
        jobDir = created
      },
      onProgress: (done) => {
        if (done === 2) controller.abort()
      }
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('cancelled')
    expect(jobDir).not.toBeNull()
    // The cancelled job's directory is gone; the original file is untouched.
    expect(fs.existsSync(jobDir as unknown as string)).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'clip.mp4'), 'utf8')).toBe('ORIGINAL-VIDEO-BYTES')
  })

  it('aborts before doing any work when the signal is already aborted', async () => {
    const dir = tempDir()
    const controller = new AbortController()
    controller.abort()
    const result = await prepareVideo({
      inputPath: inputFile(dir),
      pace: 'quick',
      tools: { ffmpeg: fakeFfmpeg(dir), ffprobe: fakeFfprobe(dir) },
      signal: controller.signal
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('cancelled')
  })
})

describe('cleanup', () => {
  it('removes a job directory and is safe to call twice', () => {
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-'))
    fs.writeFileSync(path.join(jobDir, 'frame_0001.jpg'), 'x')
    cleanupJobDir(jobDir)
    expect(fs.existsSync(jobDir)).toBe(false)
    expect(() => cleanupJobDir(jobDir)).not.toThrow()
  })

  it('sweeps stale job dirs after a crash but leaves fresh ones alone', () => {
    const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-'))
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-'))
    jobDirs.push(fresh)
    const old = Date.now() - 48 * 60 * 60 * 1000
    fs.utimesSync(stale, old / 1000, old / 1000)

    const removed = sweepStaleJobDirs(6 * 60 * 60 * 1000)
    expect(removed).toContain(stale)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
  })

  it('never touches the original media file', () => {
    const dir = tempDir()
    const input = path.join(dir, 'clip.mp4')
    fs.writeFileSync(input, 'bytes')
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-'))
    cleanupJobDir(jobDir)
    expect(fs.readFileSync(input, 'utf8')).toBe('bytes')
  })
})
