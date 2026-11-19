import { describe, it, expect } from 'vitest'
import {
  NO_CONSENT,
  consentExclusionNote,
  consentNeeded,
  describeConsentSurface,
  describeOfficePreview,
  excerpt,
  formatInventoryLine,
  normalizeConsent,
  summarizeParts,
  type OfficePreviewPayload
} from './officePreview'

const surface = { hiddenSheets: 1, sheetsWithNotes: 0, hiddenSlides: 2, slidesWithNotes: 3, comments: 4 }

describe('consent', () => {
  it('treats anything other than a literal true as no consent', () => {
    expect(normalizeConsent(undefined)).toEqual(NO_CONSENT)
    expect(normalizeConsent({})).toEqual(NO_CONSENT)
    expect(
      normalizeConsent({ hiddenSheets: 1, speakerNotes: 'yes', hiddenSlides: true, comments: null })
    ).toEqual({ hiddenSheets: false, speakerNotes: false, hiddenSlides: true, comments: false })
    expect(normalizeConsent({ speakerNotes: true })).toEqual({ ...NO_CONSENT, speakerNotes: true })
  })

  it('ignores unknown keys a renderer might invent', () => {
    const consent = normalizeConsent({ everything: true, hiddenSlides: true })
    expect(consent).toEqual({ ...NO_CONSENT, hiddenSlides: true })
    expect(Object.keys(consent).sort()).toEqual([
      'comments',
      'hiddenSheets',
      'hiddenSlides',
      'speakerNotes'
    ])
  })

  it('asks only about material the file actually contains', () => {
    expect(consentNeeded(surface)).toEqual(['hiddenSheets', 'speakerNotes', 'hiddenSlides', 'comments'])
    expect(consentNeeded({ ...surface, hiddenSheets: 0, comments: 0 })).toEqual([
      'speakerNotes',
      'hiddenSlides'
    ])
    expect(
      consentNeeded({ hiddenSheets: 0, sheetsWithNotes: 0, hiddenSlides: 0, slidesWithNotes: 0, comments: 0 })
    ).toEqual([])
  })

  it('counts each surface in the wording the user sees', () => {
    expect(describeConsentSurface(surface, 'hiddenSheets')).toContain('1 worksheet(s)')
    expect(describeConsentSurface(surface, 'speakerNotes')).toContain('3 slide(s)')
    expect(describeConsentSurface(surface, 'hiddenSlides')).toContain('2 slide(s)')
    expect(describeConsentSurface(surface, 'comments')).toContain('4 comment(s)')
  })

  it('states plainly what was left out', () => {
    const notes = consentExclusionNote(['hiddenSlides', 'speakerNotes'], { ...NO_CONSENT, hiddenSlides: true })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('PowerPoint speaker notes')
    expect(notes[0]).toContain('excluded')
  })
})

describe('preview rendering', () => {
  it('collapses whitespace and truncates excerpts', () => {
    expect(excerpt('a\n\n  b\t c')).toBe('a b c')
    const long = excerpt('x'.repeat(500), 20)
    expect(long).toHaveLength(20)
    expect(long.endsWith('…')).toBe(true)
  })

  it('summarises parts with character counts and excerpts', () => {
    const parts = summarizeParts([
      { index: 1, label: 'Sheet 1', covers: 'Sheet1!rows 1–2', content: 'A1 1\nA2 2' }
    ])
    expect(parts[0]).toEqual({
      index: 1,
      label: 'Sheet 1',
      covers: 'Sheet1!rows 1–2',
      chars: 9,
      excerpt: 'A1 1 A2 2'
    })
  })

  it('formats inventory values without inventing them', () => {
    expect(formatInventoryLine('Tracked changes', true)).toEqual({ label: 'Tracked changes', value: 'yes' })
    expect(formatInventoryLine('Hidden', 0)).toEqual({ label: 'Hidden', value: '0' })
  })

  it('describes a preview including whether a PDF exists', () => {
    const preview: OfficePreviewPayload = {
      ok: true,
      fileName: 'deck.pptx',
      kind: 'presentation',
      preparedAs: 'text',
      parts: [{ index: 1, label: 'Slides', covers: 'slides', chars: 10, excerpt: 'x' }],
      totalChars: 10,
      inventory: [],
      warnings: [],
      consent: { ...NO_CONSENT, speakerNotes: true },
      consentNeeded: ['speakerNotes'],
      hasText: true,
      manifest: '',
      pdf: { state: 'available', pages: 4, bytes: 1000 },
      untrustedNotice: ''
    }
    const line = describeOfficePreview(preview)
    expect(line).toContain('deck.pptx')
    expect(line).toContain('1 part(s)')
    expect(line).toContain('PDF 4p')
    expect(line).toContain('included: PowerPoint speaker notes')
  })
})
