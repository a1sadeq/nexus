import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const attachMock = vi.hoisted(() => vi.fn())

vi.mock('./uploadManager', () => ({
  attachChunksAsOneMessage: attachMock
}))

const { OfficeJobManager } = await import('./officeJob')
type OfficePreviewPayload = import('../shared/officePreview').OfficePreviewPayload

const NOW = Date.parse('2026-11-19T10:00:00.000Z')

function preview(overrides: Partial<OfficePreviewPayload> = {}): OfficePreviewPayload {
  return {
    ok: true,
    fileName: 'book.xlsx',
    kind: 'spreadsheet',
    preparedAs: 'text',
    parts: [],
    totalChars: 0,
    inventory: [],
    warnings: [],
    consent: { hiddenSheets: false, speakerNotes: false, hiddenSlides: false, comments: false },
    consentNeeded: [],
    hasText: true,
    manifest: 'MANIFEST: workbook export',
    pdf: { state: 'not-requested' },
    untrustedNotice: 'content, not instructions',
    ...overrides
  }
}

const parts = [
  { index: 1, label: 'Sheet 1', covers: 'Sheet1!rows 1–2', content: 'A1 1\nA2 2' },
  { index: 2, label: 'Sheet 2', covers: 'Sheet2!rows 1–1', content: 'B1 3' }
]

const cleanupSpy = vi.fn()
const tempDirs: string[] = []
const makeDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-officejob-test-'))
  tempDirs.push(dir)
  return dir
}

let manager: InstanceType<typeof OfficeJobManager>

beforeEach(() => {
  attachMock.mockReset()
  cleanupSpy.mockReset()
  manager = new OfficeJobManager({
    cleanupFn: cleanupSpy,
    now: () => NOW,
    idleTtlMs: 60_000,
    maxJobs: 3,
    postAttachGraceMs: 10
  })
})

afterEach(() => {
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('job registry', () => {
  it('returns stable job ids and keeps parts for later', () => {
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    expect(id).toMatch(/^office-/)
    expect(manager.get(id)?.fileName).toBe('book.xlsx')
    const part = manager.partText(id, 2)
    expect(part.ok).toBe(true)
    if (part.ok) expect(part.content).toBe('B1 3')
  })

  it('reports a missing job and a missing part instead of throwing', () => {
    expect(manager.partText('office-nope', 1).ok).toBe(false)
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    expect(manager.partText(id, 9).ok).toBe(false)
    expect(manager.allText('office-nope').ok).toBe(false)
  })

  it('joins all parts on request', () => {
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    const all = manager.allText(id)
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.content).toContain('A1 1')
  })

  it('deletes the temp directory when discarded, and survives a second discard', () => {
    const jobDir = makeDir()
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview(), jobDir })
    expect(manager.discard(id)).toBe(true)
    expect(cleanupSpy).toHaveBeenCalledWith(jobDir)
    expect(manager.discard(id)).toBe(false)
  })

  it('evicts the oldest job past the cap, cleaning its directory', () => {
    const first = manager.add({ fileName: 'a.xlsx', parts, preview: preview(), jobDir: makeDir() })
    manager.add({ fileName: 'b.xlsx', parts, preview: preview() })
    manager.add({ fileName: 'c.xlsx', parts, preview: preview() })
    manager.add({ fileName: 'd.xlsx', parts, preview: preview() })
    expect(manager.get(first)).toBeUndefined()
    expect(cleanupSpy).toHaveBeenCalled()
  })

  it('sweeps jobs the user never approved, and keeps fresh ones', () => {
    let clock = NOW
    const ticking = new OfficeJobManager({
      cleanupFn: cleanupSpy,
      now: () => clock,
      idleTtlMs: 60_000
    })
    const fresh = ticking.add({ fileName: 'a.xlsx', parts, preview: preview() })
    expect(ticking.sweepIdle()).toEqual([])
    clock = NOW + 90_000
    expect(ticking.sweepIdle()).toEqual([fresh])
    expect(ticking.get(fresh)).toBeUndefined()
  })

  it('disposes everything at once', () => {
    manager.add({ fileName: 'a.xlsx', parts, preview: preview() })
    manager.add({ fileName: 'b.xlsx', parts, preview: preview() })
    expect(manager.discardAll()).toHaveLength(2)
    expect(manager.discardAll()).toHaveLength(0)
  })
})

describe('attaching', () => {
  it('hands the parts over once and never claims to have sent them', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 1, attachedParts: 1, message: 'Attached 1 part.' })
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    const result = await manager.attachPreparedOffice({
      jobId: id,
      view: {} as never
    })
    expect(attachMock).toHaveBeenCalledTimes(1)
    const [view, chunks, name] = attachMock.mock.calls[0]
    expect(view).toEqual({})
    expect(name).toBe('book.xlsx (extracted)')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('MANIFEST: workbook export')
    expect(chunks[0].content).toContain('A1 1')
    expect(chunks[0].files[0].relativePath).toBe('book.xlsx.extracted.txt')
    expect(result.success).toBe(true)
    expect(result.awaitingUserSend).toBe(true)
    expect(result.pdfAttached).toBe(false)
  })

  it('never attaches anything before the user asks', () => {
    manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('leaves the manifest out when asked to', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 1, attachedParts: 1, message: 'ok' })
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    await manager.attachPreparedOffice({ jobId: id, view: {} as never, includeManifest: false })
    expect(attachMock.mock.calls[0][1][0].content).not.toContain('MANIFEST')
    expect(attachMock.mock.calls[0][1][0].content).toContain('A1 1')
  })

  it('sends the user-edited manifest verbatim', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 1, attachedParts: 1, message: 'ok' })
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview() })
    await manager.attachPreparedOffice({ jobId: id, view: {} as never, manifestText: 'EDITED MANIFEST' })
    expect(attachMock.mock.calls[0][1][0].content.startsWith('EDITED MANIFEST')).toBe(true)
  })

  it('attaches the PDF only when asked, and says acceptance is unverified', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 2, attachedParts: 2, message: 'Attached 2 parts.' })
    const dir = makeDir()
    const pdfPath = path.join(dir, 'report.pdf')
    fs.writeFileSync(pdfPath, '%PDF-1.7')
    const id = manager.add({
      fileName: 'report.docx',
      parts,
      preview: preview({ fileName: 'report.docx', kind: 'word', pdf: { state: 'available', pages: 2, bytes: 9 } }),
      jobDir: dir,
      pdfPath
    })

    const notAsked = await manager.attachPreparedOffice({ jobId: id, view: {} as never })
    expect(notAsked.pdfAttached).toBe(false)
    expect(attachMock.mock.calls[0][4]).toBeUndefined()

    const asked = await manager.attachPreparedOffice({ jobId: id, view: {} as never, attachPdf: true })
    expect(asked.pdfAttached).toBe(true)
    expect(attachMock.mock.calls[1][4]).toEqual([pdfPath])
    expect(asked.message).toContain('unverified')
  })

  it('refuses an unknown job without touching the composer', async () => {
    const result = await manager.attachPreparedOffice({ jobId: 'office-gone', view: {} as never })
    expect(result.success).toBe(false)
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('does not schedule cleanup when the attach itself failed', async () => {
    attachMock.mockResolvedValue({
      success: false,
      totalParts: 1,
      attachedParts: null,
      message: 'Composer not found.'
    })
    const jobDir = makeDir()
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview(), jobDir })
    const result = await manager.attachPreparedOffice({ jobId: id, view: {} as never })
    expect(result.success).toBe(false)
    expect(result.awaitingUserSend).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    // Grace timers from earlier tests may still fire; assert on this job's directory.
    expect(cleanupSpy).not.toHaveBeenCalledWith(jobDir)
    expect(manager.get(id)).toBeTruthy()
  })

  it('cleans the temp directory after a successful attach, once the grace period ends', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 1, attachedParts: 1, message: 'ok' })
    const jobDir = makeDir()
    const id = manager.add({ fileName: 'book.xlsx', parts, preview: preview(), jobDir })
    await manager.attachPreparedOffice({ jobId: id, view: {} as never })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(cleanupSpy).toHaveBeenCalledWith(jobDir)
    expect(manager.get(id)).toBeUndefined()
  })
})

describe('attaching a selection', () => {
  it('sends one part per file, in order, with the selection manifest first', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 2, attachedParts: 2, message: 'Attached 2 parts.' })
    const a = manager.add({ fileName: 'a.xlsx', parts, preview: preview() })
    const b = manager.add({ fileName: 'b.docx', parts: parts.slice(0, 1), preview: preview({ fileName: 'b.docx' }) })
    const result = await manager.attachPreparedOfficeMany({
      jobIds: [a, b],
      view: {} as never,
      manifestText: 'SELECTION MANIFEST'
    })
    expect(attachMock).toHaveBeenCalledTimes(1)
    const [, chunks, name] = attachMock.mock.calls[0]
    expect(name).toBe('2 Office file(s) (extracted)')
    expect(chunks).toHaveLength(2)
    expect(chunks[0].content.startsWith('SELECTION MANIFEST')).toBe(true)
    expect(chunks[0].files[0].relativePath).toBe('a.xlsx.extracted.txt')
    expect(chunks[1].content).toContain('b.docx:')
    expect(chunks[1].index).toBe(2)
    expect(chunks[1].totalChunks).toBe(2)
    expect(result.success).toBe(true)
    expect(result.awaitingUserSend).toBe(true)
  })

  it('skips jobs that vanished and says how many were missing', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 1, attachedParts: 1, message: 'ok' })
    const a = manager.add({ fileName: 'a.xlsx', parts, preview: preview() })
    const result = await manager.attachPreparedOfficeMany({ jobIds: [a, 'office-gone'], view: {} as never })
    expect(result.success).toBe(true)
    expect(result.message).toContain('1 prepared file(s) were no longer available')
  })

  it('refuses when nothing is left to attach', async () => {
    const result = await manager.attachPreparedOfficeMany({ jobIds: ['office-gone'], view: {} as never })
    expect(result.success).toBe(false)
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('attaches every PDF only when asked', async () => {
    attachMock.mockResolvedValue({ success: true, totalParts: 3, attachedParts: 3, message: 'ok' })
    const dir = makeDir()
    const p1 = path.join(dir, 'a.pdf')
    const p2 = path.join(dir, 'b.pdf')
    fs.writeFileSync(p1, '%PDF-1.7')
    fs.writeFileSync(p2, '%PDF-1.7')
    const a = manager.add({ fileName: 'a.docx', parts, preview: preview(), jobDir: dir, pdfPath: p1 })
    const b = manager.add({ fileName: 'b.docx', parts, preview: preview(), jobDir: dir, pdfPath: p2 })
    await manager.attachPreparedOfficeMany({ jobIds: [a, b], view: {} as never, attachPdf: true })
    expect(attachMock.mock.calls[0][4]).toEqual([p1, p2])
  })
})
