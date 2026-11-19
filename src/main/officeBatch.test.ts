import { describe, it, expect, vi } from 'vitest'
import { prepareOfficeSelection } from './officeBatch'
import type { PrepareOfficeOptions, PrepareOfficeResult } from './officePrepare'
import { NO_CONSENT, type OfficePreviewPayload } from '../shared/officePreview'

const previewFor = (fileName: string): OfficePreviewPayload => ({
  ok: true,
  fileName,
  kind: 'spreadsheet',
  preparedAs: 'text',
  parts: [],
  totalChars: 100,
  inventory: [],
  warnings: [],
  consent: NO_CONSENT,
  consentNeeded: ['hiddenSheets'],
  hasText: true,
  manifest: `manifest for ${fileName}`,
  pdf: { state: 'not-requested' },
  untrustedNotice: ''
})

const okResult = (fileName: string, partCount = 1): PrepareOfficeResult => ({
  ok: true,
  preview: { ...previewFor(fileName), parts: Array.from({ length: partCount }, (_, i) => ({
    index: i + 1,
    label: `part ${i + 1}`,
    covers: 'sheet',
    chars: 10,
    excerpt: ''
  })) },
  parts: Array.from({ length: partCount }, (_, i) => ({
    index: i + 1,
    label: `part ${i + 1}`,
    covers: 'sheet',
    content: `content ${i + 1}`
  }))
})

const fakePrepare =
  (handlers: Record<string, PrepareOfficeResult | (() => PrepareOfficeResult | Promise<PrepareOfficeResult>)>) =>
  async (options: PrepareOfficeOptions): Promise<PrepareOfficeResult> => {
    const handler = handlers[options.filePath]
    if (!handler) return { ok: false, reason: 'missing-file', message: 'no handler' }
    return typeof handler === 'function' ? handler() : handler
  }

describe('batch preparation', () => {
  it('prepares every Office file in selection order', async () => {
    const prepare = fakePrepare({
      '/a/one.xlsx': okResult('one.xlsx', 2),
      '/a/two.docx': okResult('two.docx', 1)
    })
    const result = await prepareOfficeSelection({
      filePaths: ['/a/one.xlsx', '/a/two.docx'],
      prepare
    })
    expect(result.prepared.map((file) => file.fileName)).toEqual(['one.xlsx', 'two.docx'])
    expect(result.report.ready).toBe(2)
    expect(result.report.totalParts).toBe(3)
    expect(result.cancelled).toBe(false)
  })

  it('keeps going when one file fails and reports why', async () => {
    const prepare = fakePrepare({
      '/a/one.xlsx': okResult('one.xlsx'),
      '/a/old.xls': { ok: false, reason: 'needs-resave', message: 'Re-save it as .xlsx.' },
      '/a/two.docx': okResult('two.docx')
    })
    const result = await prepareOfficeSelection({
      filePaths: ['/a/one.xlsx', '/a/old.xls', '/a/two.docx'],
      prepare
    })
    expect(result.report.ready).toBe(2)
    expect(result.report.refused).toBe(1)
    const refused = result.report.entries[1]
    expect(refused.status).toBe('refused')
    expect(refused.message).toBe('Re-save it as .xlsx.')
    expect(result.manifest).toContain('Not included:')
  })

  it('never prepares a non-Office file, and says what happened to it', async () => {
    const prepare = vi.fn(async () => okResult('x.xlsx'))
    const result = await prepareOfficeSelection({
      filePaths: ['/a/notes.txt', '/a/one.xlsx'],
      prepare
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(result.report.ignored).toHaveLength(1)
    expect(result.report.warnings.join(' ')).toContain('normal upload route')
  })

  it('passes each file its own consent, never a global one', async () => {
    const seen: Record<string, unknown> = {}
    const prepare = async (options: PrepareOfficeOptions): Promise<PrepareOfficeResult> => {
      seen[options.filePath] = options.consent
      return okResult('x')
    }
    await prepareOfficeSelection({
      filePaths: ['/a/one.xlsx', '/a/two.pptx'],
      consentByPath: { '/a/two.pptx': { speakerNotes: true } },
      prepare
    })
    expect(seen['/a/one.xlsx']).toEqual({})
    expect(seen['/a/two.pptx']).toEqual({ speakerNotes: true })
  })

  it('stops at the cap instead of reading everything the folder contains', async () => {
    const prepare = vi.fn(async () => okResult('x'))
    const result = await prepareOfficeSelection({
      filePaths: Array.from({ length: 30 }, (_, i) => `/a/f${i}.xlsx`),
      maxFiles: 3,
      prepare
    })
    expect(prepare).toHaveBeenCalledTimes(3)
    expect(result.report.overCap).toHaveLength(27)
  })

  it('marks the remaining files cancelled when the user aborts mid-run', async () => {
    const controller = new AbortController()
    const prepare = async (options: PrepareOfficeOptions): Promise<PrepareOfficeResult> => {
      controller.abort()
      return okResult(options.filePath)
    }
    const result = await prepareOfficeSelection({
      filePaths: ['/a/one.xlsx', '/a/two.xlsx', '/a/three.xlsx'],
      signal: controller.signal,
      prepare
    })
    expect(result.cancelled).toBe(true)
    expect(result.report.entries[0].status).toBe('ready')
    expect(result.report.entries[1].status).toBe('cancelled')
    expect(result.report.entries[2].message).toContain('Cancelled before')
  })

  it('reports progress once per file, before and after reading', async () => {
    const seen: string[] = []
    const prepare = fakePrepare({ '/a/one.xlsx': okResult('one.xlsx'), '/a/two.xlsx': okResult('two.xlsx') })
    await prepareOfficeSelection({
      filePaths: ['/a/one.xlsx', '/a/two.xlsx'],
      prepare,
      onProgress: (entry, index) => seen.push(`${index}:${entry.status}`)
    })
    expect(seen).toEqual(['1:preparing', '1:ready', '2:preparing', '2:ready'])
  })

  it('carries the PDF page count into the entry without inventing one', async () => {
    const prepare = async (): Promise<PrepareOfficeResult> => ({
      ok: true,
      preview: { ...previewFor('deck.pptx'), pdf: { state: 'available', pages: 9, bytes: 1000 } },
      parts: [{ index: 1, label: 'Slides', covers: 'slides', content: 'hello' }],
      pdfPath: '/tmp/deck.pdf'
    })
    const result = await prepareOfficeSelection({ filePaths: ['/a/deck.pptx'], prepare })
    expect(result.report.entries[0].pdfPages).toBe(9)
    expect(result.prepared[0].pdfPath).toBe('/tmp/deck.pdf')
  })
})
