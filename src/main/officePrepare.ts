import * as fs from 'fs'
import * as path from 'path'
import {
  detectOfficeFile,
  type OfficeContainer,
  type OfficeKind
} from '../shared/officeFormat'
import {
  NO_CONSENT,
  UNTRUSTED_CONTENT_NOTICE,
  consentExclusionNote,
  consentNeeded,
  formatInventoryLine,
  normalizeConsent,
  summarizeParts,
  type OfficeConsent,
  type OfficeConsentKey,
  type OfficeInventoryLine,
  type OfficePreviewPayload,
  type PdfStatus
} from '../shared/officePreview'
import {
  buildWorkbookParts,
  readWorkbook,
  type WorkbookInventory
} from './xlsxWorkbook'
import {
  buildPresentationParts,
  buildWordParts,
  readPresentation,
  readWordDocument,
  type DocumentSection,
  type PresentationInventory,
  type SlideInfo,
  type WordInventory
} from './ooxmlDocument'
import { cleanupConversionDir, convertToPdf, locateOfficeConverter } from './officeConvert'

/**
 * One Office file → something an AI can actually read (plan 02, stage 3).
 *
 * The classification comes from `officeFormat.detectOfficeFile` (magic bytes first), the same
 * one plan 03's upload path uses, so a file cannot be a workbook in one place and "text" in
 * another. Nothing here ever decodes an Office binary as UTF-8 or renames it `.txt`.
 *
 * Order of preference, per the plan:
 *   1. read the OOXML container directly (Excel, Word, PowerPoint) — exact, local, no tools;
 *   2. otherwise, if a local LibreOffice exists, render a validated PDF (Word/PowerPoint);
 *   3. otherwise say plainly what is missing. Never a fake PDF, never an external service.
 */

const HEAD_BYTES = 64

export interface PrepareOfficeOptions {
  filePath: string
  /** Anything other than a literal `true` counts as no consent. */
  consent?: Partial<OfficeConsent> | unknown
  /** Render a PDF for Word/PowerPoint when a local converter exists. */
  wantPdf?: boolean
  signal?: AbortSignal
  maxCharsPerPart?: number
  converterPath?: string
  /** Kept by the caller so it can be cleaned up on cancel or crash. */
  onJobCreated?: (jobDir: string) => void
}

export type OfficePreparedPart = { index: number; label: string; covers: string; content: string }

export type PrepareOfficeResult =
  | {
      ok: true
      preview: OfficePreviewPayload
      parts: OfficePreparedPart[]
      jobDir?: string
      pdfPath?: string
    }
  | {
      ok: false
      reason: OfficePrepareReason
      message: string
      pdfPath?: string
      jobDir?: string
    }

export type OfficePrepareReason =
  | 'missing-file'
  | 'not-office'
  | 'unknown-kind'
  | 'encrypted-or-legacy'
  | 'needs-resave'
  | 'unreadable'
  | 'empty-document'
  | 'cancelled'
  | 'no-content'

const readHead = (filePath: string): Uint8Array | null => {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(HEAD_BYTES)
    const read = fs.readSync(fd, buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, read)
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* nothing to close */
      }
    }
  }
}

const kindLabel = (kind: OfficeKind): 'word' | 'spreadsheet' | 'presentation' => kind

function workbookLines(inventory: WorkbookInventory): OfficeInventoryLine[] {
  const lines: OfficeInventoryLine[] = [
    formatInventoryLine('Worksheets', inventory.sheets.length),
    formatInventoryLine('Visible', inventory.visibleSheets),
    formatInventoryLine('Hidden', inventory.hiddenSheets + inventory.veryHiddenSheets),
    formatInventoryLine('Cells', inventory.totalCells),
    formatInventoryLine('Rows', inventory.totalRows),
    formatInventoryLine('1904 date system', inventory.date1904)
  ]
  for (const feature of inventory.features) {
    if (!feature.present) continue
    lines.push({
      label: feature.label,
      value: feature.representable ? 'present' : `present — not represented (${feature.note})`
    })
  }
  if (inventory.truncatedSheets.length > 0) {
    lines.push({ label: 'Incomplete sheets', value: inventory.truncatedSheets.join(', ') })
  }
  return lines
}

function wordLines(inventory: WordInventory): OfficeInventoryLine[] {
  return [
    formatInventoryLine('Paragraphs', inventory.paragraphs),
    formatInventoryLine('Headings', inventory.headings),
    formatInventoryLine('Tables', inventory.tables),
    formatInventoryLine('Images', inventory.images),
    formatInventoryLine('Headers/footers', inventory.headersFooters),
    formatInventoryLine('Comments', inventory.comments),
    formatInventoryLine('Footnotes', inventory.footnotes),
    formatInventoryLine('Tracked changes', inventory.hasTrackedChanges),
    formatInventoryLine('Characters', inventory.textChars)
  ]
}

function presentationLines(inventory: PresentationInventory): OfficeInventoryLine[] {
  return [
    formatInventoryLine('Slides', inventory.slides),
    formatInventoryLine('Hidden slides', inventory.hiddenSlides),
    formatInventoryLine('Slides with notes', inventory.slidesWithNotes),
    formatInventoryLine('Images', inventory.images),
    formatInventoryLine('Embedded media', inventory.embeddedMedia),
    formatInventoryLine('Charts', inventory.charts),
    formatInventoryLine('Macros', inventory.hasMacros),
    formatInventoryLine('Characters', inventory.textChars)
  ]
}

/** Word comments are included only on consent: they are their own section. */
function splitWordSections(sections: DocumentSection[], consent: OfficeConsent): DocumentSection[] {
  if (consent.comments) return sections
  return sections.filter((section) => section.label !== 'Comments')
}

interface PdfStage {
  status: PdfStatus
  pdfPath?: string
  jobDir?: string
  warnings: string[]
}

async function renderPdf(
  options: PrepareOfficeOptions,
  expectedKind: 'word' | 'presentation'
): Promise<PdfStage> {
  if (!options.wantPdf) return { status: { state: 'not-requested' }, warnings: [] }

  const converter = options.converterPath ?? locateOfficeConverter().soffice
  if (!converter) {
    return {
      status: {
        state: 'unavailable',
        reason:
          'LibreOffice is not installed on this machine, so no PDF of the original layout can be made. The extracted text is still available.'
      },
      warnings: []
    }
  }

  const converted = await convertToPdf({
    inputPath: options.filePath,
    expectedKind,
    converterPath: converter,
    signal: options.signal,
    onJobCreated: options.onJobCreated
  })
  if (!converted.ok) {
    return {
      status: { state: 'unavailable', reason: converted.message },
      jobDir: converted.jobDir,
      warnings: []
    }
  }
  return {
    status: { state: 'available', pages: converted.pageCount, bytes: converted.bytes },
    pdfPath: converted.pdfPath,
    jobDir: converted.jobDir,
    warnings: converted.warnings
  }
}

export async function prepareOfficeDocument(
  options: PrepareOfficeOptions
): Promise<PrepareOfficeResult> {
  const { filePath } = options
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing-file', message: 'That file is no longer on disk.' }
  }

  const head = readHead(filePath)
  if (!head || head.length === 0) {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'The file could not be opened for reading (permission or zero-length file).'
    }
  }

  const fileName = path.basename(filePath)
  const info = detectOfficeFile(fileName, head)
  const consent = normalizeConsent(options.consent ?? NO_CONSENT)
  const maxCharsPerPart = options.maxCharsPerPart

  if (options.signal?.aborted) {
    return { ok: false, reason: 'cancelled', message: 'Preparation cancelled.' }
  }

  // A file whose extension claims Office but whose bytes are not Office must never be
  // "prepared" — it would be a renamed text/binary file and belongs on a different route.
  if (info.container === 'unknown' || info.container === 'pdf') {
    return {
      ok: false,
      reason: 'not-office',
      message: info.reason
    }
  }

  if (!info.kind) {
    return {
      ok: false,
      reason: 'unknown-kind',
      message:
        'This OOXML file does not say whether it is a document, workbook or presentation. Name it with the right extension and try again.'
    }
  }

  if (info.container === 'ole') {
    // Legacy binary or password-protected OOXML. Text extraction is impossible without a
    // parser Nexus does not have; a PDF is possible if LibreOffice is installed.
    const pdf = await renderPdf(options, info.kind === 'spreadsheet' ? 'word' : info.kind)
    if (info.kind === 'spreadsheet') {
      return {
        ok: false,
        reason: 'needs-resave',
        message:
          'This is a legacy .xls workbook (or a password-protected one). Nexus reads .xlsx locally; re-save it as .xlsx — the coordinates, formulas and hidden sheets are all preserved by that save.',
        jobDir: pdf.jobDir
      }
    }
    if (pdf.pdfPath) {
      return {
        ok: false,
        reason: 'needs-resave',
        message:
          'This is a legacy .doc/.ppt file or a password-protected Office file. Nexus cannot read its text locally, but a PDF of the original layout was rendered. Remove the password or re-save as .docx/.pptx to get the text too.',
        pdfPath: pdf.pdfPath,
        jobDir: pdf.jobDir
      }
    }
    return {
      ok: false,
      reason: 'encrypted-or-legacy',
      message: `${info.reason} Re-save it as .docx/.pptx/.xlsx (removing any password) so Nexus can read it offline.`
    }
  }

  // ---- OOXML from here on ----------------------------------------------------------------
  const warnings: string[] = []
  let inventoryLines: OfficeInventoryLine[] = []
  let surface = { hiddenSheets: 0, sheetsWithNotes: 0, hiddenSlides: 0, slidesWithNotes: 0, comments: 0 }
  let parts: OfficePreparedPart[] = []
  let manifest = ''

  if (info.kind === 'spreadsheet') {
    const result = readWorkbook(filePath)
    if (!result.ok) {
      return { ok: false, reason: 'unreadable', message: result.message }
    }
    const inventory = result.inventory
    inventoryLines = workbookLines(inventory)
    const hiddenSheets = inventory.hiddenSheets + inventory.veryHiddenSheets
    surface = { ...surface, hiddenSheets }
    warnings.push(...inventory.warnings)
    if (hiddenSheets > 0) {
      warnings.push(...consentExclusionNote(['hiddenSheets'], consent))
      warnings.push(
        'Every worksheet is listed above, including the hidden ones, so nothing disappears silently. Their cell contents are only exported when you include them.'
      )
    }
    // Hidden sheets are named in the inventory but their cells are exported only on consent.
    const exportedFrom = consent.hiddenSheets
      ? inventory
      : {
          ...inventory,
          sheets: inventory.sheets.filter((sheet) => sheet.state === 'visible')
        }
    const exported = buildWorkbookParts(exportedFrom, { maxCharsPerPart })
    parts = exported.parts
    manifest = exported.manifest
  } else if (info.kind === 'word') {
    const result = readWordDocument(filePath)
    if (!result.ok) {
      return { ok: false, reason: 'unreadable', message: result.message }
    }
    inventoryLines = wordLines(result.inventory)
    surface = { ...surface, comments: result.inventory.comments }
    warnings.push(...result.warnings)
    const sections = splitWordSections(result.sections, consent)
    if (!consent.comments) {
      warnings.push(...consentExclusionNote(['comments'], consent))
    }
    const exported = buildWordParts(sections, result.inventory, { maxCharsPerPart })
    parts = exported.parts
    manifest = exported.manifest
  } else {
    const result = readPresentation(filePath)
    if (!result.ok) {
      return { ok: false, reason: 'unreadable', message: result.message }
    }
    const inventory = result.inventory
    inventoryLines = presentationLines(inventory)
    surface = { ...surface, hiddenSlides: inventory.hiddenSlides, slidesWithNotes: inventory.slidesWithNotes }
    warnings.push(...result.warnings)
    const exported = buildPresentationParts(result.slides as SlideInfo[], inventory, {
      includeNotes: consent.speakerNotes,
      includeHidden: consent.hiddenSlides,
      maxCharsPerPart
    })
    parts = exported.parts
    manifest = exported.manifest
    warnings.push(
      ...consentExclusionNote(['speakerNotes', 'hiddenSlides'], consent)
    )
  }

  const needed: OfficeConsentKey[] = consentNeeded(surface)
  const totalChars = parts.reduce((sum, part) => sum + part.content.length, 0)

  const pdf: PdfStage =
    info.kind === 'spreadsheet'
      ? { status: { state: 'not-requested' }, warnings: [] }
      : await renderPdf(options, info.kind)

  if (pdf.warnings.length) warnings.push(...pdf.warnings)

  const hasText = totalChars > 0
  if (!hasText && !pdf.pdfPath) {
    return {
      ok: false,
      reason: 'empty-document',
      message:
        'No extractable text was found (the file may contain only images or scanned pages), and no PDF was rendered.'
    }
  }

  if (!hasText && pdf.pdfPath) {
    warnings.push(
      'There is no extractable text in this file, so only the PDF was produced. Read it in the preview rather than assuming the AI can search it.'
    )
  }

  const preview: OfficePreviewPayload = {
    ok: true,
    fileName,
    kind: kindLabel(info.kind),
    preparedAs: hasText ? 'text' : 'pdf-only',
    parts: summarizeParts(parts),
    totalChars,
    inventory: inventoryLines,
    warnings: [...new Set(warnings)],
    consent,
    consentNeeded: needed,
    hasText,
    manifest,
    pdf: pdf.status,
    untrustedNotice: UNTRUSTED_CONTENT_NOTICE
  }

  return { ok: true, preview, parts, jobDir: pdf.jobDir, pdfPath: pdf.pdfPath }
}

export { cleanupConversionDir as cleanupOfficeJobDir }

/** Explain, without trying anything, what Nexus could do with this file. */
export function describeOfficeCapability(filePath: string): {
  kind: OfficeKind | null
  container: OfficeContainer
  localText: boolean
  localPdf: boolean
  reason: string
} {
  if (!fs.existsSync(filePath)) {
    return { kind: null, container: 'unknown', localText: false, localPdf: false, reason: 'File not found.' }
  }
  const head = readHead(filePath) ?? new Uint8Array()
  const info = detectOfficeFile(path.basename(filePath), head)
  const converter = locateOfficeConverter().soffice
  const localText = info.container === 'ooxml' && info.locallyReadable && info.kind !== null
  return {
    kind: info.kind,
    container: info.container,
    localText,
    localPdf: Boolean(converter) && info.container !== 'unknown',
    reason: info.reason
  }
}
