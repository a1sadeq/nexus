/**
 * Video preparation planning (plan 01).
 *
 * This module decides *what will be sampled* and *what the user is promised*, before any
 * frame is extracted. It is deliberately pure: no fs, no child_process, no clocks.
 *
 * The plan's honesty rules encoded here:
 *  - every plan states that sampling is not exhaustive ("not detected" != "not present");
 *  - gaps and covered ranges are computed, not assumed;
 *  - quick/balanced/detailed expose real budgets (frames, bytes, interval) before commitment;
 *  - scene-change candidates are combined with periodic sampling, because scene cuts alone
 *    miss static screen recordings, scrolling and subtle UI changes;
 *  - text readability limits and audio limits are stated rather than glossed over.
 */

export type VideoPace = 'quick' | 'balanced' | 'detailed'

export interface VideoPaceBudget {
  pace: VideoPace
  label: string
  /** Hard cap on extracted stills. */
  maxFrames: number
  /** Periodic sampling interval in seconds (scene changes are added on top). */
  intervalSec: number
  /** Longest edge of an extracted still, in pixels. */
  maxFrameEdgePx: number
  /** ffmpeg scene score threshold (0–1); lower = more sensitive. */
  sceneThreshold: number
  /** Budget for the delivered images of one video. */
  maxBytes: number
}

export const VIDEO_PACE_BUDGETS: Record<VideoPace, VideoPaceBudget> = {
  quick: {
    pace: 'quick',
    label: 'Quick',
    maxFrames: 12,
    intervalSec: 20,
    maxFrameEdgePx: 768,
    sceneThreshold: 0.4,
    maxBytes: 6 * 1024 * 1024
  },
  balanced: {
    pace: 'balanced',
    label: 'Balanced',
    maxFrames: 40,
    intervalSec: 10,
    maxFrameEdgePx: 1024,
    sceneThreshold: 0.3,
    maxBytes: 20 * 1024 * 1024
  },
  detailed: {
    pace: 'detailed',
    label: 'Detailed',
    maxFrames: 120,
    intervalSec: 4,
    maxFrameEdgePx: 1280,
    sceneThreshold: 0.22,
    maxBytes: 60 * 1024 * 1024
  }
}

export interface VideoSourceInfo {
  /** Total duration in seconds. */
  durationSec: number
  width: number
  height: number
  /** Display rotation applied by the container (0/90/180/270). */
  rotationDeg: number
  /** Nominal frames per second; see isVariableFrameRate before trusting it. */
  frameRate: number
  isVariableFrameRate: boolean
  hasAudio: boolean
  audioTracks: number
  subtitleTracks: number
  /** Non-zero start timestamps shift every timestamp we present. */
  startTimeSec: number
}

export interface FrameSelection {
  /** Presentation timestamps, ascending, in seconds. */
  timestamps: number[]
  /** Time ranges the chosen stills actually represent. */
  coverage: { startSec: number; endSec: number }[]
  /** Seconds of the timeline covered by at least one still. */
  coveredSec: number
  /** Largest uncovered stretch inside the timeline. */
  largestGapSec: number
  /** Scene candidates the budget forced us to drop — surfaced, never hidden. */
  droppedSceneCandidates: number
  /** True when the periodic grid itself had to be thinned to respect maxFrames. */
  thinned: boolean
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

/** Rough delivered size of one JPEG still at full quality for a given longest edge. */
export function estimateFrameBytes(edgePx: number): number {
  // ~0.34 bytes per pixel for a q≈4 JPEG; deliberately pessimistic so budgets hold.
  return Math.round(edgePx * edgePx * 0.34)
}

/**
 * Choose which timestamps to extract.
 *
 * @param durationSec source duration (must be > 0)
 * @param pace requested budget
 * @param sceneCandidates timestamps reported by local scene detection (unsorted, may be noisy)
 */
export function selectFrameTimestamps(
  durationSec: number,
  pace: VideoPace,
  sceneCandidates: number[] = []
): FrameSelection {
  const budget = VIDEO_PACE_BUDGETS[pace]
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return {
      timestamps: [],
      coverage: [],
      coveredSec: 0,
      largestGapSec: 0,
      droppedSceneCandidates: 0,
      thinned: false
    }
  }

  // Periodic grid, offset by half an interval so we never sample the very first black frame
  // or the final fade. Always include 0 for the opening state.
  const grid: number[] = [0]
  for (let t = budget.intervalSec / 2; t < durationSec; t += budget.intervalSec) {
    grid.push(round3(t))
  }
  // The end of the clip matters (final state of a UI walkthrough); sample just inside it.
  const tail = round3(Math.max(0, durationSec - Math.min(1, durationSec * 0.02)))
  if (tail > 0) grid.push(tail)

  const valid = (t: number): boolean => Number.isFinite(t) && t >= 0 && t < durationSec

  // Two candidates closer than half the interval are the same moment for our purposes.
  const minSeparation = Math.max(0.5, budget.intervalSec / 2)
  const dedupe = (values: number[]): number[] => {
    const sorted = [...values].sort((a, b) => a - b)
    const out: number[] = []
    for (const value of sorted) {
      if (out.length === 0 || value - out[out.length - 1] >= minSeparation) out.push(value)
    }
    return out
  }

  const sceneList = dedupe(
    sceneCandidates.filter(valid).map(round3)
  )

  /**
   * Thin a sorted list to `target` entries while always keeping the first and the last.
   * Truncating instead would silently drop the end of the video — the exact failure the
   * plan calls out ("does not drop", "complete set of parts").
   */
  const thinEvenly = (values: number[], target: number): number[] => {
    if (values.length <= target) return values
    if (target <= 1) return [values[0]]
    const out: number[] = []
    for (let i = 0; i < target; i++) {
      out.push(values[Math.round((i * (values.length - 1)) / (target - 1))])
    }
    return out
  }

  // Scene changes earn their place first: they are the moments something changed.
  let chosen = dedupe([...sceneList, ...grid])
  let droppedSceneCandidates = 0
  let thinned = false

  if (chosen.length > budget.maxFrames) {
    const sceneSet = new Set(sceneList)
    const keptScenes = sceneList.slice(0, budget.maxFrames)
    droppedSceneCandidates = Math.max(0, sceneList.length - keptScenes.length)

    // Fill the remaining slots with an even spread across the timeline rather than
    // truncating (truncation would silently drop the end of the video — the exact
    // failure mode the plan calls out).
    const remaining = Math.max(0, budget.maxFrames - keptScenes.length)
    const fillers = grid.filter((t) => !sceneSet.has(t))
    const spread = remaining > 0 ? thinEvenly(fillers, remaining) : []
    const next = dedupe([...keptScenes, ...spread])
    thinned = next.length < grid.length + sceneList.length
    chosen = thinEvenly(next, budget.maxFrames)
  }

  // Respect the byte budget by thinning further, never by lowering resolution silently.
  const perFrame = estimateFrameBytes(budget.maxFrameEdgePx)
  const maxByBytes = Math.max(1, Math.floor(budget.maxBytes / perFrame))
  if (chosen.length > maxByBytes) {
    thinned = true
    chosen = dedupe(thinEvenly(chosen, maxByBytes))
  }

  const timestamps = chosen.sort((a, b) => a - b)

  // Coverage: each still represents half an interval either side of its timestamp.
  const half = budget.intervalSec / 2
  const rawRanges = timestamps.map((t) => ({
    startSec: round3(Math.max(0, t - half)),
    endSec: round3(Math.min(durationSec, t + half))
  }))
  const coverage: { startSec: number; endSec: number }[] = []
  for (const range of rawRanges) {
    const last = coverage[coverage.length - 1]
    if (last && range.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, range.endSec)
    } else {
      coverage.push({ ...range })
    }
  }
  const coveredSec = round3(coverage.reduce((n, r) => n + (r.endSec - r.startSec), 0))
  const largestGapSec = round3(
    coverage.reduce((max, range, index) => {
      if (index === 0) return Math.max(max, range.startSec)
      return Math.max(max, range.startSec - coverage[index - 1].endSec)
    }, 0)
  )

  return {
    timestamps: timestamps.map(round3),
    coverage,
    coveredSec,
    largestGapSec,
    droppedSceneCandidates,
    thinned
  }
}

/** `HH:MM:SS.mmm` — stable, sortable, unambiguous about the unit. */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00.000'
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

export interface VideoPlan {
  pace: VideoPace
  budget: VideoPaceBudget
  selection: FrameSelection
  /** Estimated delivered image bytes; enforced against budget.maxBytes. */
  estimatedBytes: number
  estimatedImages: number
  /** Always true. Present so no caller can forget it. */
  sampledNotExhaustive: true
  /** One line, safe to show verbatim in the UI. */
  coverageSummary: string
  /** Everything this plan cannot promise. Rendered in the approval dialog. */
  limitations: string[]
}

export interface PlanOptions {
  /** Transcript availability, so the summary does not imply audio was understood. */
  transcript?: { available: boolean; language?: string } | null
  /** Whether on-screen text extraction ran at all. */
  ocr?: { available: boolean } | null
}

export function planVideoCoverage(
  source: VideoSourceInfo,
  pace: VideoPace,
  sceneCandidates: number[] = [],
  options: PlanOptions = {}
): VideoPlan {
  const budget = VIDEO_PACE_BUDGETS[pace]
  const selection = selectFrameTimestamps(source.durationSec, pace, sceneCandidates)
  const estimatedImages = selection.timestamps.length
  const estimatedBytes = estimatedImages * estimateFrameBytes(budget.maxFrameEdgePx)

  const pct = source.durationSec > 0 ? (selection.coveredSec / source.durationSec) * 100 : 0
  const coverageSummary =
    `${budget.label}: ${estimatedImages} stills over ${formatTimestamp(source.durationSec)} ` +
    `(~${pct.toFixed(0)}% of the timeline, largest unsampled gap ${selection.largestGapSec.toFixed(1)}s, ` +
    `≈${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB)`

  const limitations: string[] = [
    'Stills are sampled, not exhaustive: events between two samples can be missed entirely, and "not seen in a still" does not mean "did not happen".',
    `Each still stands for roughly ${(budget.intervalSec / 2).toFixed(1)}s either side of its timestamp; timestamps are approximate, not frame-exact.`
  ]

  if (source.isVariableFrameRate) {
    limitations.push(
      'This file has a variable frame rate; frame counts derived from the nominal rate are approximate.'
    )
  }
  if (source.startTimeSec > 0) {
    limitations.push(
      `The container starts at ${source.startTimeSec.toFixed(3)}s, so every timestamp shown is offset from the first frame and not from wall-clock zero.`
    )
  }
  if (source.rotationDeg !== 0) {
    limitations.push(
      `The video carries a ${source.rotationDeg}° rotation flag; stills are assumed to be extracted upright.`
    )
  }
  if (budget.maxFrameEdgePx < 1280) {
    limitations.push(
      `Stills are capped at ${budget.maxFrameEdgePx}px on the longest edge — small on-screen text may be unreadable at this setting.`
    )
  }
  if (!source.hasAudio) {
    limitations.push('The file has no audio track: there is no speech or sound to transcribe.')
  } else if (options.transcript && !options.transcript.available) {
    limitations.push(
      'No transcript was produced for the audio track, so speech is not covered at all — only visuals are.'
    )
  } else if (options.transcript?.available) {
    limitations.push(
      'The transcript covers speech only. Important non-speech sounds (alarms, impacts, music cues, tone of voice) are not represented and may be missed.'
    )
  } else {
    limitations.push(
      'Audio is not analysed by this plan unless a local transcript step is enabled; non-speech sounds (alarms, music cues, impacts) may be missed even then.'
    )
  }
  if (source.audioTracks > 1) {
    limitations.push(
      `The file has ${source.audioTracks} audio tracks; only one will be transcribed unless you pick a track explicitly.`
    )
  }
  if (source.subtitleTracks > 0) {
    limitations.push(
      `The file embeds ${source.subtitleTracks} subtitle track(s); these are shown as-is and are not the same as transcribed speech.`
    )
  }
  if (options.ocr && !options.ocr.available) {
    limitations.push('On-screen text was not extracted (OCR unavailable): visible text is only what a still happens to show legibly.')
  }
  if (selection.droppedSceneCandidates > 0) {
    limitations.push(
      `${selection.droppedSceneCandidates} detected scene change(s) were dropped to stay within the ${budget.maxFrames}-still budget — raise the setting for denser coverage.`
    )
  }
  if (selection.thinned) {
    limitations.push('The sampling grid was thinned to respect the frame/size budget.')
  }

  return {
    pace,
    budget,
    selection,
    estimatedBytes,
    estimatedImages,
    sampledNotExhaustive: true,
    coverageSummary,
    limitations
  }
}

/**
 * Split ordered stills into delivery batches that respect a per-message byte budget.
 * Order is preserved; batch index is 1-based for display.
 */
export function splitFrameBatches(
  timestamps: number[],
  bytesPerFrame: number,
  maxBytesPerBatch: number
): number[][] {
  if (timestamps.length === 0) return []
  const limit = Math.max(1, Math.floor(maxBytesPerBatch / Math.max(1, bytesPerFrame)))
  const batches: number[][] = []
  for (let i = 0; i < timestamps.length; i += limit) {
    batches.push(timestamps.slice(i, i + limit))
  }
  return batches
}
