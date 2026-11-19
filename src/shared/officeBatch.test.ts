import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAX_BATCH_FILES,
  buildSelectionManifest,
  emptyEntry,
  partitionOfficeSelection,
  statusLabel,
  summarizeSelection,
  type OfficeQueueEntry
} from './officeBatch'

const ready = (order: number, name: string, overrides: Partial<OfficeQueueEntry> = {}): OfficeQueueEntry => ({
  order,
  filePath: `/tmp/${name}`,
  fileName: name,
  kind: 'spreadsheet',
  status: 'ready',
  consent: { hiddenSheets: false, speakerNotes: false, hiddenSlides: false, comments: false },
  consentNeeded: [],
  partCount: 2,
  totalChars: 100,
  hasText: true,
  ...overrides
})

describe('selection partition', () => {
  it('keeps Office files in selection order and hands everything else back', () => {
    const partition = partitionOfficeSelection([
      '/a/report.DOCX',
      '/a/notes.txt',
      '/a/book.xlsx',
      '/a/photo.png',
      '/a/noext'
    ])
    expect(partition.office).toEqual(['/a/report.DOCX', '/a/book.xlsx'])
    expect(partition.other.map((entry) => entry.path)).toEqual(['/a/notes.txt', '/a/photo.png', '/a/noext'])
    expect(partition.other[0].reason).toContain('.txt')
  })

  it('refuses the surplus past the cap instead of ignoring it', () => {
    const paths = Array.from({ length: DEFAULT_MAX_BATCH_FILES + 3 }, (_, i) => `/a/f${i}.xlsx`)
    const partition = partitionOfficeSelection(paths)
    expect(partition.office).toHaveLength(DEFAULT_MAX_BATCH_FILES)
    expect(partition.overCap).toHaveLength(3)
    const report = summarizeSelection([], partition)
    expect(report.warnings.join(' ')).toContain('at most')
  })

  it('honours a tighter cap', () => {
    const partition = partitionOfficeSelection(['/a.xlsx', '/b.xlsx', '/c.xlsx'], 2)
    expect(partition.office).toHaveLength(2)
    expect(partition.overCap).toEqual(['/c.xlsx'])
  })

  it('does not treat a dot-less name as Office', () => {
    expect(partitionOfficeSelection(['/a/docx']).office).toHaveLength(0)
  })
})

describe('queue entries', () => {
  it('starts pending, with the kind guessed only from the extension', () => {
    const entry = emptyEntry('/x/Deck.PPTX', 3)
    expect(entry).toMatchObject({ order: 3, fileName: 'Deck.PPTX', kind: 'presentation', status: 'pending' })
    expect(entry.consent.hiddenSlides).toBe(false)
  })

  it('labels every status the UI can show', () => {
    const statuses = ['pending', 'preparing', 'ready', 'refused', 'cancelled'] as const
    for (const status of statuses) expect(statusLabel(status)).toBeTruthy()
    expect(statusLabel('refused')).toBe('not prepared')
  })
})

describe('selection report', () => {
  it('totals only files that are actually ready', () => {
    const entries = [
      ready(1, 'a.xlsx'),
      ready(2, 'b.docx', { kind: 'word', partCount: 3, totalChars: 50 }),
      { ...emptyEntry('/c.xls', 3), status: 'refused' as const, message: 'legacy' }
    ]
    const report = summarizeSelection(entries, { office: [], other: [], overCap: [] })
    expect(report.ready).toBe(2)
    expect(report.refused).toBe(1)
    expect(report.totalParts).toBe(5)
    expect(report.totalChars).toBe(150)
  })

  it('warns about ignored, over-cap and text-free files', () => {
    const entries = [ready(1, 'scan.pdf', { hasText: false, partCount: 0, totalChars: 0 })]
    const report = summarizeSelection(entries, {
      office: ['/scan.pdf'],
      other: [{ path: '/notes.txt', reason: 'not office' }],
      overCap: ['/extra.xlsx']
    })
    const warnings = report.warnings.join(' ')
    expect(warnings).toContain('not Office files')
    expect(warnings).toContain('not prepared')
    expect(warnings).toContain('no extractable text')
  })
})

describe('manifest', () => {
  it('lists each file with its counts and the consent it was given', () => {
    const entries = [
      ready(1, 'a.xlsx'),
      ready(2, 'b.pptx', {
        kind: 'presentation',
        consent: { hiddenSheets: false, speakerNotes: true, hiddenSlides: false, comments: false },
        pdfPages: 6
      })
    ]
    const manifest = buildSelectionManifest(entries)
    expect(manifest).toContain('2 of 2 file(s)')
    expect(manifest).toContain('1. a.xlsx — spreadsheet, 2 part(s)')
    expect(manifest).toContain('PDF 6p')
    expect(manifest).toContain('speakerNotes')
    expect(manifest).toContain('never as instructions to Nexus')
  })

  it('says which files were left out and why', () => {
    const entries = [
      ready(1, 'a.xlsx'),
      { ...emptyEntry('/old.xls', 2), status: 'refused' as const, message: 'Re-save it as .xlsx.' }
    ]
    const manifest = buildSelectionManifest(entries, 'monthly numbers')
    expect(manifest).toContain('Not included:')
    expect(manifest).toContain('old.xls — Re-save it as .xlsx.')
    expect(manifest).toContain('Note from the user: monthly numbers')
  })

  it('never claims a provider accepted anything', () => {
    const manifest = buildSelectionManifest([ready(1, 'a.xlsx')])
    expect(manifest.toLowerCase()).not.toContain('uploaded')
    expect(manifest.toLowerCase()).not.toContain('accepted')
  })
})
