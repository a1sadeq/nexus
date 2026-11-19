import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildExtractArgs, locateMediaTools, parseFfprobeJson, probeVideo } from './videoProbe'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-probe-test-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** A stand-in for ffprobe: prints whatever JSON we hand it, then exits. */
function fakeFfprobe(json: string | ((args: string[]) => string), dir = tempDir()): string {
  const file = path.join(dir, 'ffprobe')
  const body =
    typeof json === 'string'
      ? `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`
      : `#!/bin/sh\ncat <<'EOF'\n${json(process.argv.slice(2))}\nEOF\n`
  fs.writeFileSync(file, body, { mode: 0o755 })
  return file
}

/** A stand-in that never finishes, to prove the timeout actually kills it. */
function hangingFfprobe(dir = tempDir()): string {
  const file = path.join(dir, 'ffprobe-hang')
  fs.writeFileSync(file, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  return file
}

const SAMPLE = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      start_time: '0.000000',
      duration: '12.345',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }]
    },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
    { index: 2, codec_type: 'subtitle', codec_name: 'mov_text', tags: { language: 'ara' } },
    { index: 3, codec_type: 'audio', codec_name: 'aac', channels: 1 }
  ],
  format: { duration: '12.345000', start_time: '0.000000', format_name: 'mov,mp4,m4a' }
})

describe('ffprobe JSON parsing', () => {
  it('extracts duration, dimensions, tracks and rotation', () => {
    const result = parseFfprobeJson(SAMPLE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.info.durationSec).toBeCloseTo(12.345, 3)
    expect(result.info.width).toBe(1920)
    expect(result.info.height).toBe(1080)
    expect(result.info.rotationDeg).toBe(270) // -90 normalised to 270
    expect(result.info.hasAudio).toBe(true)
    expect(result.info.audioTracks).toBe(2)
    expect(result.info.subtitleTracks).toBe(1)
    expect(result.info.isVariableFrameRate).toBe(false)
  })

  it('detects a variable frame rate from r_frame_rate vs avg_frame_rate', () => {
    const vfr = JSON.stringify({
      streams: [{ codec_type: 'video', width: 640, height: 480, r_frame_rate: '30/1', avg_frame_rate: '24/1' }],
      format: { duration: '5.0' }
    })
    const result = parseFfprobeJson(vfr)
    expect(result.ok && result.info.isVariableFrameRate).toBe(true)
  })

  it('keeps a non-zero start time visible instead of zeroing it', () => {
    const offset = JSON.stringify({
      streams: [{ codec_type: 'video', width: 1, height: 1, start_time: '4.200000' }],
      format: { duration: '10.0', start_time: '4.200000' }
    })
    const result = parseFfprobeJson(offset)
    expect(result.ok && result.info.startTimeSec).toBeCloseTo(4.2, 3)
  })

  it('reports audio-less files honestly', () => {
    const silent = JSON.stringify({
      streams: [{ codec_type: 'video', width: 2, height: 2 }],
      format: { duration: '3.0' }
    })
    const result = parseFfprobeJson(silent)
    expect(result.ok && result.info.hasAudio).toBe(false)
    expect(result.ok && result.info.audioTracks).toBe(0)
  })

  it('refuses a container with no video stream', () => {
    const audioOnly = JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
      format: { duration: '100.0' }
    })
    const result = parseFfprobeJson(audioOnly)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-video')
  })

  it('fails closed on malformed JSON', () => {
    const result = parseFfprobeJson('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('probe-failed')
  })

  it('falls back to the supplied duration when format metadata is missing', () => {
    const result = parseFfprobeJson(
      JSON.stringify({ streams: [{ codec_type: 'video', width: 1, height: 1 }] }),
      42
    )
    expect(result.ok && result.info.durationSec).toBe(42)
  })
})

describe('probing through a real subprocess', () => {
  it('passes the file path as an argument, never through a shell', async () => {
    const dir = tempDir()
    const marker = path.join(dir, 'PWNED')
    // A filename that would execute if the path were interpolated into a shell string.
    const hostile = path.join(dir, 'clip; touch PWNED; #.mp4')
    fs.writeFileSync(hostile, 'not really a video')
    const tool = fakeFfprobe(SAMPLE, dir)

    const result = await probeVideo(hostile, { toolPath: tool })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('returns tool-missing (not an exception) when ffprobe is absent', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'clip.mp4')
    fs.writeFileSync(file, 'x')
    const result = await probeVideo(file, { toolPath: path.join(dir, 'does-not-exist') })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('tool-missing')
  })

  it('returns file-missing before spawning anything', async () => {
    const result = await probeVideo('/definitely/not/here.mp4', { toolPath: '/bin/true' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('file-missing')
  })

  it('kills a hanging ffprobe and reports a timeout', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'clip.mp4')
    fs.writeFileSync(file, 'x')
    const started = Date.now()
    const result = await probeVideo(file, { toolPath: hangingFfprobe(dir), timeoutMs: 400 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('reports a clear failure for a non-video file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'notes.txt')
    fs.writeFileSync(file, 'hello')
    const tool = fakeFfprobe(
      JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '1' } }),
      dir
    )
    const result = await probeVideo(file, { toolPath: tool })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-video')
  })
})

describe('tool discovery', () => {
  it('prefers an explicit env override and records where it came from', () => {
    const dir = tempDir()
    const bin = path.join(dir, 'my-ffprobe')
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    const found = locateMediaTools({ NEXUS_FFPROBE_PATH: bin } as NodeJS.ProcessEnv)
    expect(found.ffprobe).toBe(bin)
    expect(found.source).toBe('env')
  })

  it('ignores an override that is not executable, and reports none when nothing is found', () => {
    const dir = tempDir()
    const bin = path.join(dir, 'not-executable')
    fs.writeFileSync(bin, 'x', { mode: 0o644 })
    const found = locateMediaTools(
      { NEXUS_FFPROBE_PATH: bin, PATH: dir } as NodeJS.ProcessEnv,
      { appRoot: path.join(dir, 'app') }
    )
    expect(found.ffprobe).toBeUndefined()
    expect(found.source).toBe('none')
  })

  it('finds a bundled binary when one is shipped in vendor/media', () => {
    const dir = tempDir()
    const vendor = path.join(dir, 'app', 'vendor', 'media')
    fs.mkdirSync(vendor, { recursive: true })
    const bin = path.join(vendor, 'ffmpeg')
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    const found = locateMediaTools({ PATH: '' } as NodeJS.ProcessEnv, { appRoot: path.join(dir, 'app') })
    expect(found.ffmpeg).toBe(bin)
    expect(found.source).toBe('bundled')
  })
})

describe('ffmpeg argument construction', () => {
  it('combines scene detection with periodic sampling in one bounded invocation', () => {
    const args = buildExtractArgs({
      inputPath: '/tmp/my clip.mp4',
      sceneDir: '/tmp/job/scene',
      gridDir: '/tmp/job/grid',
      edgePx: 1024,
      sceneThreshold: 0.3,
      intervalSec: 10,
      maxFramesPerPass: 40
    })
    expect(args.join(' ')).toContain("select='gt(scene,0.3)'")
    // Periodic sampling present alongside scene sampling.
    expect(args.join(' ')).toContain('fps=1/10')
    // Bounded in both passes.
    expect(args.filter((a) => a === '40')).toHaveLength(2)
    // Never a shell string: the path is one discrete argument.
    expect(args).toContain('/tmp/my clip.mp4')
    expect(args.some((a) => a.includes(';'))).toBe(false)
  })

  it('caps the longest edge so stills stay readable but bounded', () => {
    const args = buildExtractArgs({
      inputPath: '/tmp/a.mp4',
      sceneDir: '/s',
      gridDir: '/g',
      edgePx: 768,
      sceneThreshold: 0.4,
      intervalSec: 20,
      maxFramesPerPass: 12
    })
    expect(args.join(' ')).toContain('min(768,iw)')
  })
})
