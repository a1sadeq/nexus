import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { BundleChunk } from '../shared/folderUpload'
import {
  ATTACHMENT_PROBE_SCRIPT,
  attachCountWarning,
  buildPartFilePlan,
  cleanupStaleUploadTempDirs,
  createUploadTempDir,
  describeAttachOutcome,
  parseAttachmentProbeResult,
  scheduleUploadTempCleanup,
  writePartFile
} from './uploadAttachAll'

vi.mock('electron', () => ({ dialog: {} }))

const { bundleAndInjectSelectedFiles, partitionCodebaseFiles, uploadChunksSequentially } =
  await import('./uploadManager')

function chunk(index: number, total: number, content = 'x'): BundleChunk {
  return {
    index,
    totalChunks: total,
    byteSize: Buffer.byteLength(content),
    fileCount: 1,
    files: [{ relativePath: `f${index}.ts`, size: content.length }],
    content
  }
}

describe('buildPartFilePlan', () => {
  it('names every part in order and keeps content intact', () => {
    const plan = buildPartFilePlan('nexus electron', [chunk(1, 3, 'a'), chunk(2, 3, 'b'), chunk(3, 3, 'c')])
    expect(plan.map((p) => p.fileName)).toEqual([
      'nexus_electron_part1_of_3_codebase.txt',
      'nexus_electron_part2_of_3_codebase.txt',
      'nexus_electron_part3_of_3_codebase.txt'
    ])
    expect(plan.map((p) => p.content)).toEqual(['a', 'b', 'c'])
  })

  it('never emits path separators or empty names', () => {
    const plan = buildPartFilePlan('../../etc/passwd', [chunk(1, 1)])
    expect(plan[0].fileName).toBe('etc_passwd_part1_of_1_codebase.txt')
    expect(plan[0].fileName).not.toContain('/')
    expect(plan[0].fileName).not.toContain('..')
    expect(buildPartFilePlan('///', [chunk(1, 1)])[0].fileName).toBe('bundle_part1_of_1_codebase.txt')
  })

  it('falls back to positional indices when a chunk reports none', () => {
    const plan = buildPartFilePlan('f', [{ ...chunk(1, 2), index: 0, totalChunks: 0 }])
    expect(plan[0]).toMatchObject({ index: 1, totalChunks: 1 })
  })
})

describe('describeAttachOutcome', () => {
  it('reports a verified full attach without asking the user to check', () => {
    const outcome = describeAttachOutcome(3, 0, 3)
    expect(outcome).toMatchObject({ requested: 3, attached: 3, verified: true, needsUserCheck: false })
    expect(outcome.message).toBe('All 3 parts attached. Review and press Send.')
  })

  it('never claims success when the provider could not be read', () => {
    const outcome = describeAttachOutcome(2, null, null)
    expect(outcome).toMatchObject({ attached: null, verified: false, needsUserCheck: true })
    expect(outcome.message).toContain('Check they are listed before pressing Send.')
  })

  it('flags partial attaches and zero attaches honestly', () => {
    expect(describeAttachOutcome(4, 1, 3)).toMatchObject({ attached: 2, needsUserCheck: true })
    expect(describeAttachOutcome(4, 1, 3).message).toBe(
      'Only 2 of 4 parts are attached. Add the rest before pressing Send.'
    )
    expect(describeAttachOutcome(2, 5, 5).message).toBe(
      'None of the 2 parts appear in the composer. Retry, or use Download per part.'
    )
  })

  it('treats a single part as a singular message', () => {
    expect(describeAttachOutcome(1, 0, 1).message).toBe('Part 1 attached. Review and press Send.')
  })

  it('caps the verified count at the number requested', () => {
    // A provider refreshing unrelated chips must not inflate the report.
    expect(describeAttachOutcome(2, 0, 9).attached).toBe(2)
  })
})

describe('parseAttachmentProbeResult', () => {
  it('accepts only finite non-negative counts', () => {
    expect(parseAttachmentProbeResult({ ok: true, count: 3 })).toBe(3)
    expect(parseAttachmentProbeResult({ ok: true, count: 0 })).toBe(0)
    expect(parseAttachmentProbeResult({ ok: true, count: 2.7 })).toBe(2)
    expect(parseAttachmentProbeResult({ ok: false, count: null })).toBeNull()
    expect(parseAttachmentProbeResult({ ok: true, count: Number.NaN })).toBeNull()
    expect(parseAttachmentProbeResult({ ok: true, count: -1 })).toBeNull()
    expect(parseAttachmentProbeResult({ ok: true, count: '3' })).toBeNull()
    expect(parseAttachmentProbeResult(null)).toBeNull()
    expect(parseAttachmentProbeResult(undefined)).toBeNull()
  })

  it('ships a probe script that cannot throw out of the page', () => {
    expect(ATTACHMENT_PROBE_SCRIPT).toContain('try {')
    expect(ATTACHMENT_PROBE_SCRIPT).toContain('catch')
  })
})

describe('attachCountWarning', () => {
  it('warns only above the provider attachment threshold', () => {
    expect(attachCountWarning(1)).toBeNull()
    expect(attachCountWarning(10)).toBeNull()
    expect(attachCountWarning(11)).toContain('cap attachments')
  })
})

describe('temp part files', () => {
  it('writes owner-only part files and cleans them up on request', () => {
    const dir = createUploadTempDir()
    const target = writePartFile(dir, buildPartFilePlan('repo', [chunk(1, 1, 'hello')])[0])
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello')
    if (process.platform !== 'win32') {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600)
    }
    expect(path.basename(dir).startsWith('nexus-upload-')).toBe(true)
    scheduleUploadTempCleanup(dir, 0)
  })

  it('sweeps stale upload directories but leaves fresh ones alone', async () => {
    const fresh = createUploadTempDir()
    const stale = createUploadTempDir()
    const old = Date.now() - 5 * 60 * 60 * 1000
    fs.utimesSync(stale, new Date(old), new Date(old))
    const removed = cleanupStaleUploadTempDirs(60 * 60 * 1000)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    fs.rmSync(fresh, { recursive: true, force: true })
  })
})

interface FakeViewOptions {
  probeCounts?: number[]
  /** Simulates a provider page whose attachment chip cannot be read. */
  probeFails?: boolean
  injectionFails?: boolean
  acceptAttribute?: string | null
}

/** Minimal WebContentsView stand-in that records toasts and CDP traffic. */
function makeFakeView(options: FakeViewOptions = {}): {
  view: never
  toasts: string[]
  injections: string[][]
} {
  const counts = [...(options.probeCounts ?? [])]
  const toasts: string[] = []
  const injections: string[][] = []
  const attached = { value: false }

  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async (script: string) => {
      if (script.includes('__nexusTabToast')) {
        const match = /t\.textContent = (".*?");/.exec(script)
        if (match) toasts.push(JSON.parse(match[1]))
        return undefined
      }
      if (script.includes('targetInputIndex')) {
        return { w: 1200, h: 800, dropX: 600, dropY: 650, targetInputIndex: 0 }
      }
      if (script.includes('attachment-chip')) {
        if (options.probeFails) throw new Error('page unavailable')
        const next = counts.length > 1 ? counts.shift()! : (counts[0] ?? 0)
        return { ok: true, count: next }
      }
      return undefined
    },
    debugger: {
      isAttached: () => attached.value,
      attach: () => {
        attached.value = true
      },
      detach: () => {
        attached.value = false
      },
      sendCommand: async (command: string, params: Record<string, unknown>) => {
        if (command === 'DOM.getDocument') return { root: { nodeId: 1 } }
        if (command === 'DOM.querySelectorAll') {
          return { nodeIds: options.acceptAttribute === null ? [] : [1] }
        }
        if (command === 'DOM.setFileInputFiles') {
          if (options.injectionFails) throw new Error('no input available')
          injections.push(params.files as string[])
          return {}
        }
        if (command === 'Input.dispatchDragEvent') {
          if (options.injectionFails && params.type === 'drop') throw new Error('drop failed')
          if (params.type === 'drop') {
            const data = params.data as { files: string[] }
            injections.push(data.files)
          }
          return {}
        }
        return {}
      }
    }
  }

  return { view: { webContents } as never, toasts, injections }
}

describe('bundleAndInjectSelectedFiles (multi-part)', () => {
  it('attaches every part in ONE injection instead of refusing the upload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-attach-test-'))
    try {
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(dir, `file${i}.ts`), `export const v${i} = ${i}\n`.repeat(20))
      }
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const expectedParts = partitionCodebaseFiles(dir, selected, 600, false).chunks.length
      expect(expectedParts).toBeGreaterThan(1)

      const { view, toasts, injections } = makeFakeView({ probeCounts: [0, expectedParts] })
      const result = await bundleAndInjectSelectedFiles(view, dir, selected, undefined, {
        maxChunkBytes: 600
      })

      expect(result?.success).toBe(true)
      expect(injections).toHaveLength(1)
      expect(injections[0]).toHaveLength(expectedParts)
      expect(injections[0].every((file) => file.endsWith('.txt'))).toBe(true)
      expect(toasts.join(' ')).not.toMatch(/multiple parts detected/i)
      expect(toasts.join(' ')).not.toMatch(/one at a time/i)
      expect(toasts.at(-1)).toBe(`All ${expectedParts} parts attached. Review and press Send.`)
      // Staged part files are readable and contain the bundle header.
      const firstPart = fs.readFileSync(injections[0][0], 'utf-8')
      expect(firstPart).toContain('Codebase Bundle Part 1')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still reports honestly when the composer cannot be read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-attach-test-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), 'x'.repeat(900))
      fs.writeFileSync(path.join(dir, 'b.ts'), 'y'.repeat(900))
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const { view, toasts } = makeFakeView({ probeFails: true })
      const result = await bundleAndInjectSelectedFiles(view, dir, selected, undefined, {
        maxChunkBytes: 600
      })
      expect(result?.success).toBe(true)
      expect(result?.verified).toBe(false)
      expect(result?.attachedParts).toBeNull()
      expect(toasts.at(-1)).toMatch(/Check they are listed before pressing Send\.$/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a failed injection without claiming the parts were attached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-attach-test-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), 'x'.repeat(900))
      const { view, toasts, injections } = makeFakeView({
        injectionFails: true,
        acceptAttribute: null
      })
      const result = await bundleAndInjectSelectedFiles(view, dir, [path.join(dir, 'a.ts')])
      expect(injections).toHaveLength(0)
      expect(result?.success).toBe(false)
      expect(result?.attachedParts).toBeNull()
      expect(toasts.at(-1)).toBe('Could not attach the part. Use Download to attach manually.')
      expect(toasts.join(' ')).not.toMatch(/attached\./i)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('uploadChunksSequentially (single part)', () => {
  it('attaches one part and reports verification state', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } }
    const { view, injections, toasts } = makeFakeView({ probeCounts: [0, 1] })
    await uploadChunksSequentially(view, window as never, [chunk(1, 1)], 'repo')
    expect(injections).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(toasts.at(-1)).toBe('Part 1 attached. Review and press Send.')
  })

  it('keeps multi-part sequential delivery blocked in favour of attach-all', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } }
    const { view } = makeFakeView({ probeCounts: [0, 1] })
    await expect(
      uploadChunksSequentially(view, window as never, [chunk(1, 2), chunk(2, 2)], 'repo')
    ).rejects.toThrow(/Multiple batches require manual/)
  })
})
