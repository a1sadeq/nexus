import { describe, it, expect } from 'vitest'
import {
  VIDEO_PACE_BUDGETS,
  estimateFrameBytes,
  formatTimestamp,
  planVideoCoverage,
  selectFrameTimestamps,
  splitFrameBatches,
  type VideoSourceInfo
} from './videoPlan'

const source = (over: Partial<VideoSourceInfo> = {}): VideoSourceInfo => ({
  durationSec: 600,
  width: 1920,
  height: 1080,
  rotationDeg: 0,
  frameRate: 30,
  isVariableFrameRate: false,
  hasAudio: true,
  audioTracks: 1,
  subtitleTracks: 0,
  startTimeSec: 0,
  ...over
})

describe('timestamp formatting', () => {
  it('formats hours/minutes/seconds/millis zero-padded', () => {
    expect(formatTimestamp(0)).toBe('00:00:00.000')
    expect(formatTimestamp(83.4)).toBe('00:01:23.400')
    expect(formatTimestamp(3725.001)).toBe('01:02:05.001')
  })

  it('never emits NaN for hostile input', () => {
    expect(formatTimestamp(Number.NaN)).toBe('00:00:00.000')
    expect(formatTimestamp(-5)).toBe('00:00:00.000')
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe('00:00:00.000')
  })
})

describe('frame selection respects budgets', () => {
  it('never exceeds maxFrames, for any pace or duration', () => {
    for (const pace of ['quick', 'balanced', 'detailed'] as const) {
      for (const duration of [1, 5, 60, 600, 7200]) {
        const selection = selectFrameTimestamps(duration, pace, [])
        expect(selection.timestamps.length).toBeLessThanOrEqual(VIDEO_PACE_BUDGETS[pace].maxFrames)
      }
    }
  })

  it('keeps the end of a long video instead of truncating the timeline', () => {
    const selection = selectFrameTimestamps(7200, 'detailed', [])
    const last = selection.timestamps[selection.timestamps.length - 1]
    expect(last).toBeGreaterThan(7200 - 10)
    expect(selection.timestamps[0]).toBe(0)
  })

  it('returns ascending, de-duplicated timestamps inside the timeline', () => {
    const selection = selectFrameTimestamps(600, 'balanced', [12, 12.05, 12.1, 300])
    const ts = selection.timestamps
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
    expect(new Set(ts).size).toBe(ts.length)
    for (const t of ts) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(600)
    }
  })

  it('drops out-of-range scene candidates rather than trusting ffmpeg output', () => {
    const selection = selectFrameTimestamps(60, 'balanced', [-3, 60, 75, Number.NaN, 30])
    expect(selection.timestamps).toContain(30)
    for (const t of selection.timestamps) expect(t).toBeLessThan(60)
  })

  it('reports scene candidates it had to drop instead of silently losing them', () => {
    const manyScenes = Array.from({ length: 200 }, (_, i) => 1 + i)
    const selection = selectFrameTimestamps(600, 'quick', manyScenes)
    expect(selection.timestamps.length).toBeLessThanOrEqual(VIDEO_PACE_BUDGETS.quick.maxFrames)
    expect(selection.droppedSceneCandidates).toBeGreaterThan(0)
  })

  it('computes gaps from real coverage, not from the nominal interval', () => {
    const selection = selectFrameTimestamps(100, 'balanced', [])
    expect(selection.coverage.length).toBeGreaterThan(0)
    expect(selection.coveredSec).toBeGreaterThan(0)
    expect(selection.coveredSec).toBeLessThanOrEqual(100)
    expect(selection.largestGapSec).toBeLessThanOrEqual(VIDEO_PACE_BUDGETS.balanced.intervalSec + 0.001)
  })

  it('handles a zero/negative duration without inventing frames', () => {
    expect(selectFrameTimestamps(0, 'quick', []).timestamps).toEqual([])
    expect(selectFrameTimestamps(-10, 'quick', [1, 2]).timestamps).toEqual([])
  })

  it('keeps estimated bytes within the budget', () => {
    const selection = selectFrameTimestamps(3600, 'detailed', [])
    const bytes = selection.timestamps.length * estimateFrameBytes(VIDEO_PACE_BUDGETS.detailed.maxFrameEdgePx)
    expect(bytes).toBeLessThanOrEqual(VIDEO_PACE_BUDGETS.detailed.maxBytes)
  })
})

describe('plan honesty', () => {
  it('always states that sampling is not exhaustive', () => {
    const plan = planVideoCoverage(source(), 'balanced', [])
    expect(plan.sampledNotExhaustive).toBe(true)
    expect(plan.limitations[0]).toContain('sampled, not exhaustive')
  })

  it('says speech is not covered when no transcript exists', () => {
    const plan = planVideoCoverage(source(), 'balanced', [], { transcript: { available: false } })
    expect(plan.limitations.join(' ')).toContain('speech is not covered at all')
  })

  it('does not promise audio understanding when a transcript exists', () => {
    const plan = planVideoCoverage(source(), 'quick', [], { transcript: { available: true, language: 'ar' } })
    const joined = plan.limitations.join(' ')
    expect(joined).toContain('non-speech sounds')
  })

  it('flags a silent file instead of implying silence was transcribed', () => {
    const plan = planVideoCoverage(source({ hasAudio: false, audioTracks: 0 }), 'quick', [])
    expect(plan.limitations.join(' ')).toContain('no audio track')
  })

  it('discloses low-resolution text risk at the quick setting', () => {
    const plan = planVideoCoverage(source(), 'quick', [])
    expect(plan.limitations.join(' ')).toContain('small on-screen text may be unreadable')
  })

  it('discloses variable frame rate, rotation, offset start and multiple tracks', () => {
    const plan = planVideoCoverage(
      source({ isVariableFrameRate: true, rotationDeg: 90, startTimeSec: 4.2, audioTracks: 3, subtitleTracks: 2 }),
      'balanced',
      []
    )
    const joined = plan.limitations.join(' ')
    expect(joined).toContain('variable frame rate')
    expect(joined).toContain('90° rotation')
    expect(joined).toContain('starts at 4.200s')
    expect(joined).toContain('3 audio tracks')
    expect(joined).toContain('2 subtitle track(s)')
  })

  it('summary names the pace, stills, gap and size', () => {
    const plan = planVideoCoverage(source(), 'balanced', [])
    expect(plan.coverageSummary).toMatch(/^Balanced: \d+ stills over 00:10:00\.000/)
    expect(plan.coverageSummary).toContain('largest unsampled gap')
    expect(plan.coverageSummary).toContain('MB')
  })
})

describe('batch splitting', () => {
  it('splits ordered stills into size-bounded batches and preserves order', () => {
    const ts = [0, 10, 20, 30, 40, 50]
    const batches = splitFrameBatches(ts, 1024 * 1024, 2 * 1024 * 1024)
    expect(batches).toHaveLength(3)
    expect(batches.flat()).toEqual(ts)
  })

  it('always makes progress even when one frame exceeds the batch budget', () => {
    const batches = splitFrameBatches([1, 2, 3], 10 * 1024 * 1024, 1024)
    expect(batches.flat()).toEqual([1, 2, 3])
    expect(batches).toHaveLength(3)
  })

  it('returns no batches for no stills', () => {
    expect(splitFrameBatches([], 1024, 2048)).toEqual([])
  })
})
