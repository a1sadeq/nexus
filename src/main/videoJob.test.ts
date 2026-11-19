import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const attachMock = vi.hoisted(() => vi.fn())

vi.mock('./uploadManager', () => ({
  attachChunksAsOneMessage: attachMock
}))

const { VideoJobManager, describeVideoJob } = await import('./videoJob')
type PreparedVideo = import('./videoPrepare').PreparedVideo

const NOW = Date.parse('2026-11-19T10:00:00.000Z')

function fakePrepared(frameCount = 3, overrides: Partial<PreparedVideo> = {}): PreparedVideo {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-test-'))
  const frames = Array.from({ length: frameCount }, (_, i) => {
    const p = path.join(jobDir, `frame_${String(i + 1).padStart(4, '0')}.jpg`)
    fs.writeFileSync(p, Buffer.alloc(2048, 1))
    return { path: p, timestampSec: i * 10, bytes: 2048 }
  })
  return {
    jobDir,
    frames,
    source: {
      durationSec: 120,
      width: 1280,
      height: 720,
      rotationDeg: 0,
      frameRate: 25,
      isVariableFrameRate: false,
      hasAudio: true,
      audioTracks: 1,
      subtitleTracks: 0,
      startTimeSec: 0
    },
    plan: {
      pace: 'quick',
      budget: {
        pace: 'quick',
        label: 'Quick',
        maxFrames: 12,
        intervalSec: 20,
        maxFrameEdgePx: 768,
        sceneThreshold: 0.4,
        maxBytes: 6 * 1024 * 1024
      },
      selection: {
        timestamps: frames.map((f) => f.timestampSec),
        coverage: [{ startSec: 0, endSec: 30 }],
        coveredSec: 30,
        largestGapSec: 0,
        droppedSceneCandidates: 0,
        thinned: false
      },
      estimatedBytes: frames.length * 2048,
      estimatedImages: frames.length,
      sampledNotExhaustive: true,
      coverageSummary: `Quick: ${frames.length} stills over 00:02:00.000`,
      limitations: ['Stills are sampled, not exhaustive: events between two samples can be missed.']
    },
    warnings: [],
    totalBytes: frames.length * 2048,
    ...overrides
  }
}

function inputFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-src-'))
  const file = path.join(dir, 'demo clip.mp4')
  fs.writeFileSync(file, 'ORIGINAL')
  return file
}

function managerWith(prepared = fakePrepared(), options: Record<string, unknown> = {}) {
  const cleanups: string[] = []
  const manager = new VideoJobManager({
    prepare: vi.fn(async () => ({ ok: true as const, prepared })),
    cleanup: (dir: string) => cleanups.push(dir),
    now: () => NOW,
    ...options
  })
  return { manager, cleanups, prepared }
}

beforeEach(() => {
  attachMock.mockReset()
  attachMock.mockResolvedValue({
    success: true,
    totalParts: 4,
    attachedParts: 4,
    verified: true,
    message: '4 of 4 files attached'
  })
})

describe('preparing a job', () => {
  it('returns a summary built from the frames that exist', async () => {
    const { manager } = managerWith(fakePrepared(3))
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.frameCount).toBe(3)
    expect(result.summary.fileName).toBe('demo clip.mp4')
    expect(result.summary.coverageSummary).toContain('3 stills')
    expect(manager.activeCount).toBe(1)
  })

  it('defaults to an unverified provider verdict — never a claim of support', async () => {
    const { manager } = managerWith()
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick', provider: 'chatgpt' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.capability.status).toBe('unknown')
    expect(result.summary.capability.nativeAllowed).toBe(false)
    expect(describeVideoJob(result.summary)).toContain('native upload unverified')
  })

  it('reflects real evidence when it is supplied', async () => {
    const { manager } = managerWith()
    const result = await manager.prepareJob({
      filePath: inputFile(),
      pace: 'quick',
      provider: 'chatgpt',
      observations: [
        {
          provider: 'chatgpt',
          kind: 'video',
          status: 'supported',
          fact: 'attachment-confirmed',
          observedAt: '2026-11-15T00:00:00.000Z',
          source: 'live-dom'
        }
      ]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.capability.status).toBe('supported')
    expect(describeVideoJob(result.summary)).toContain('native upload verified')
  })

  it('rejects a missing file before spending any time', async () => {
    const { manager } = managerWith()
    const result = await manager.prepareJob({ filePath: '/nope/gone.mp4', pace: 'quick' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('file-missing')
  })

  it('propagates a preparation failure honestly', async () => {
    const manager = new VideoJobManager({
      prepare: vi.fn(async () => ({
        ok: false as const,
        reason: 'ffmpeg-missing' as const,
        message: 'ffmpeg is not available'
      })),
      now: () => NOW
    })
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ffmpeg-missing')
      expect(result.message).toContain('ffmpeg')
    }
    expect(manager.activeCount).toBe(0)
  })

  it('evicts the oldest job when the concurrency cap is reached, deleting its frames', async () => {
    const first = fakePrepared(1)
    const second = fakePrepared(1)
    const prepared = [first, second, fakePrepared(1)]
    let index = 0
    const cleanups: string[] = []
    const manager = new VideoJobManager({
      prepare: vi.fn(async () => ({ ok: true as const, prepared: prepared[index++] })),
      cleanup: (dir: string) => cleanups.push(dir),
      now: () => NOW,
      maxJobs: 2
    })
    await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    expect(manager.activeCount).toBe(2)
    expect(cleanups).toContain(first.jobDir)
  })
})

describe('the manifest', () => {
  it('is honest and counts the stills that actually exist', async () => {
    const { manager } = managerWith(fakePrepared(2))
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.manifest).toContain('not the original recording')
    expect(result.summary.manifest).toContain('2 still image(s)')
    expect(result.summary.manifest).toContain('Speech in this video is NOT covered')
    expect(result.summary.manifest).toContain('untrusted content')
  })

  it('carries the user note when provided', async () => {
    const { manager } = managerWith()
    const result = await manager.prepareJob({
      filePath: inputFile(),
      pace: 'quick',
      userNote: 'Look at the popup at 00:00:10.'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.manifest).toContain('Look at the popup at 00:00:10.')
  })
})

describe('attaching prepared material', () => {
  it('sends manifest + stills in ONE injection, in timestamp order', async () => {
    const prepared = fakePrepared(3)
    const { manager } = managerWith(prepared)
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')

    const view = { webContents: {} }
    const attach = await manager.attachPreparedVideo({
      jobId: result.summary.jobId,
      view: view as never,
      customSelector: 'input[type=file]'
    })

    expect(attachMock).toHaveBeenCalledTimes(1)
    const [passedView, chunks, folderName, selector, originals] = attachMock.mock.calls[0]
    expect(passedView).toBe(view)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('not the original recording')
    expect(folderName).toContain('demo clip.mp4')
    expect(selector).toBe('input[type=file]')
    expect(originals).toEqual(prepared.frames.map((f) => f.path))
    expect(attach.success).toBe(true)
  })

  it('can attach stills only, when the user declines the manifest', async () => {
    const prepared = fakePrepared(2)
    const { manager } = managerWith(prepared)
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')
    await manager.attachPreparedVideo({
      jobId: result.summary.jobId,
      view: {} as never,
      includeManifest: false
    })
    const [, chunks, , , originals] = attachMock.mock.calls[0]
    expect(chunks).toHaveLength(0)
    expect(originals).toHaveLength(2)
  })

  it('fails clearly for an unknown or already-discarded job', async () => {
    const { manager } = managerWith()
    const attach = await manager.attachPreparedVideo({ jobId: 'vid-nope', view: {} as never })
    expect(attach.success).toBe(false)
    expect(attach.message).toContain('prepare it again')
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('keeps the frames after a successful attach, then cleans them up after the grace period', async () => {
    vi.useFakeTimers()
    try {
      const prepared = fakePrepared(2)
      const cleanups: string[] = []
      const manager = new VideoJobManager({
        prepare: vi.fn(async () => ({ ok: true as const, prepared })),
        cleanup: (dir: string) => cleanups.push(dir),
        now: () => NOW,
        postAttachGraceMs: 1000
      })
      const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
      if (!result.ok) throw new Error('prepare failed')
      await manager.attachPreparedVideo({ jobId: result.summary.jobId, view: {} as never })

      // Frames must still exist right after dispatch: the provider reads them lazily.
      expect(cleanups).toHaveLength(0)
      expect(fs.existsSync(prepared.frames[0].path)).toBe(true)

      await vi.advanceTimersByTimeAsync(1200)
      expect(cleanups).toEqual([prepared.jobDir])
      expect(manager.activeCount).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not clean up when the attach failed', async () => {
    attachMock.mockResolvedValue({
      success: false,
      totalParts: 4,
      attachedParts: 1,
      verified: false,
      message: 'Only 1 of 4 attached'
    })
    const { manager, cleanups } = managerWith()
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')
    await manager.attachPreparedVideo({ jobId: result.summary.jobId, view: {} as never })
    expect(cleanups).toHaveLength(0)
    expect(manager.activeCount).toBe(1)
  })
})

describe('cleanup', () => {
  it('discards on demand and is safe twice', async () => {
    const { manager, cleanups, prepared } = managerWith()
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')
    expect(manager.discard(result.summary.jobId)).toBe(true)
    expect(cleanups).toEqual([prepared.jobDir])
    expect(manager.discard(result.summary.jobId)).toBe(false)
  })

  it('sweeps jobs left behind by a forgotten dialog', async () => {
    const prepared = fakePrepared(1)
    const cleanups: string[] = []
    let clock = NOW
    const manager = new VideoJobManager({
      prepare: vi.fn(async () => ({ ok: true as const, prepared })),
      cleanup: (dir: string) => cleanups.push(dir),
      now: () => clock,
      idleTtlMs: 60_000
    })
    await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    expect(manager.sweepIdle()).toHaveLength(0)
    clock += 120_000
    const swept = manager.sweepIdle()
    expect(swept).toHaveLength(1)
    expect(cleanups).toEqual([prepared.jobDir])
  })

  it('disposes everything at once', async () => {
    const { manager, cleanups } = managerWith()
    await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    manager.disposeAll()
    expect(cleanups).toHaveLength(1)
    expect(manager.activeCount).toBe(0)
  })
})

describe('user-edited manifest', () => {
  it('sends the edited text verbatim instead of the generated manifest', async () => {
    const { manager } = managerWith(fakePrepared(2))
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')

    await manager.attachPreparedVideo({
      jobId: result.summary.jobId,
      view: {} as never,
      manifestText: '# my own manifest\nDo not claim coverage you do not have.'
    })
    const [, chunks] = attachMock.mock.calls[0]
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('my own manifest')
    expect(chunks[0].content).not.toContain('not the original recording')
  })

  it('falls back to the generated manifest when the edit is only whitespace', async () => {
    const { manager } = managerWith(fakePrepared(1))
    const result = await manager.prepareJob({ filePath: inputFile(), pace: 'quick' })
    if (!result.ok) throw new Error('prepare failed')
    await manager.attachPreparedVideo({
      jobId: result.summary.jobId,
      view: {} as never,
      manifestText: '   \n  '
    })
    const [, chunks] = attachMock.mock.calls[0]
    expect(chunks[0].content).toContain('not the original recording')
  })
})
