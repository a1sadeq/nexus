import * as fs from 'fs'
import { openZip, ZipError, type ZipEntryReader } from './safeZip'

/**
 * Excel workbook extraction (plan 02).
 *
 * Plan 02 is explicit that Excel is *not* a PDF problem: the required output is an
 * AI-readable representation that keeps sheet/cell references, distinguishes formulas from
 * their cached results, and inventories what could not be represented. This module produces
 * exactly that, from the OOXML parts, with no recalculation and no external service.
 *
 * Honesty rules encoded here:
 *  - a formula's cached value is reported as cached, and "missing" is a distinct state;
 *  - hidden sheets / rows / columns / very-hidden state are inventoried before export;
 *  - features that cannot survive (charts, media, VBA, pivot tables, connections, external
 *    links) are listed as unsupported, never silently dropped;
 *  - nothing is executed: macros are never run, external links are never fetched, and no
 *    formula is evaluated;
 *  - overflow is labelled. A sheet that hits the cap says so with counts, and splitting
 *    happens at row boundaries so no data vanishes silently.
 */

export type SheetVisibility = 'visible' | 'hidden' | 'veryHidden'

export type CellType = 'string' | 'number' | 'boolean' | 'error' | 'date' | 'empty'

export interface WorkbookCell {
  /** A1-style coordinate, always present. */
  ref: string
  row: number
  col: number
  type: CellType
  /** Extracted value as text. Numbers stay exactly as stored (no rounding/reformatting). */
  value: string | null
  /** Formula text without the leading "=". */
  formula?: string
  /** Whether a cached result was stored, and therefore whether it can be trusted as "as saved". */
  cached?: 'present' | 'missing'
  /** True when the number is formatted as a date/time — we do NOT convert it. */
  dateSerial?: boolean
  comment?: string
}

export interface WorkbookRow {
  index: number
  hidden: boolean
  cells: WorkbookCell[]
}

export interface WorkbookSheet {
  name: string
  index: number
  /** 1-based position in the workbook, as the user sees it. */
  position: number
  state: SheetVisibility
  dimension: string | null
  rows: WorkbookRow[]
  hiddenColumnRanges: string[]
  mergedRanges: string[]
  comments: { ref: string; text: string }[]
  cellCount: number
  rowCount: number
  /** True when a cap stopped parsing this sheet; `truncationNote` says where. */
  truncated: boolean
  truncationNote?: string
}

export interface WorkbookFeature {
  key: string
  label: string
  present: boolean
  /** Whether the exported text can represent it at all. */
  representable: boolean
  note: string
}

export interface WorkbookInventory {
  sheets: WorkbookSheet[]
  visibleSheets: number
  hiddenSheets: number
  veryHiddenSheets: number
  totalCells: number
  totalRows: number
  features: WorkbookFeature[]
  warnings: string[]
  /** Excel's 1904 date system shifts every date serial. Reported, never silently applied. */
  date1904: boolean
  truncatedSheets: string[]
}

export type WorkbookFailureReason =
  | 'not-a-zip'
  | 'unsupported-container'
  | 'not-a-workbook'
  | 'too-large'
  | 'corrupt'
  | 'read-failed'

export type WorkbookResult =
  | { ok: true; inventory: WorkbookInventory }
  | { ok: false; reason: WorkbookFailureReason; message: string }

export interface WorkbookOptions {
  /** Hard cap on parsed cells across the workbook. */
  maxCells?: number
  /** Cap on rows per sheet. */
  maxRowsPerSheet?: number
  maxXmlBytes?: number
}

const DEFAULT_MAX_CELLS = 400_000
const DEFAULT_MAX_ROWS = 100_000

const decodeXmlEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')

export function columnToIndex(letters: string): number {
  let index = 0
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) continue
    index = index * 26 + (code - 64)
  }
  return index
}

export function indexToColumn(index: number): string {
  let remaining = index
  let out = ''
  while (remaining > 0) {
    const rem = (remaining - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    remaining = Math.floor((remaining - 1) / 26)
  }
  return out
}

export function splitCellRef(ref: string): { col: number; row: number } | null {
  const match = /^([A-Za-z]{1,3})(\d+)$/.exec(ref.trim())
  if (!match) return null
  return { col: columnToIndex(match[1]), row: Number(match[2]) }
}

const attr = (attributes: string, name: string): string | null => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attributes)
  return match ? match[1] : null
}

const isTruthyXmlFlag = (value: string | null): boolean =>
  value === '1' || value === 'true' || value === 'on'

/** Text of a shared/inline string, including rich-text runs but excluding phonetic hints. */
export function richTextToPlain(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  const parts: string[] = []
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(withoutPhonetic)) !== null) {
    parts.push(decodeXmlEntities(match[1]))
  }
  return parts.join('')
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const out: string[] = []
  const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    out.push(richTextToPlain(match[1]))
  }
  // Self-closing <si/> means an empty string entry — keep the index alignment.
  const selfClosing = (xml.match(/<si\s*\/>/g) ?? []).length
  for (let i = 0; i < selfClosing; i++) out.push('')
  return out
}

/** styleIndex → isDateLike, from styles.xml. Heuristic and documented as such. */
export function parseDateFormatStyles(xml: string | null): Set<number> {
  const dateStyles = new Set<number>()
  if (!xml) return dateStyles

  const customFormats = new Map<number, string>()
  const numFmtPattern = /<numFmt\b([^>]*)\/?>/g
  let numFmtMatch: RegExpExecArray | null
  while ((numFmtMatch = numFmtPattern.exec(xml)) !== null) {
    const id = Number(attr(numFmtMatch[1], 'numFmtId'))
    const code = attr(numFmtMatch[1], 'formatCode')
    if (Number.isFinite(id) && code) customFormats.set(id, code)
  }

  // Built-in date/time formatIds (ECMA-376 §18.8.30).
  const builtinDateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

  const cellXfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)
  if (!cellXfsMatch) return dateStyles
  const xfPattern = /<xf\b([^>]*)\/?>/g
  let xfMatch: RegExpExecArray | null
  let styleIndex = 0
  while ((xfMatch = xfPattern.exec(cellXfsMatch[1])) !== null) {
    const numFmtId = Number(attr(xfMatch[1], 'numFmtId') ?? '0')
    if (builtinDateIds.has(numFmtId)) {
      dateStyles.add(styleIndex)
    } else if (customFormats.has(numFmtId)) {
      const code = (customFormats.get(numFmtId) ?? '')
        .replace(/"[^"]*"/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\\./g, '')
      if (/[ymdhs]/i.test(code)) dateStyles.add(styleIndex)
    }
    styleIndex++
  }
  return dateStyles
}

interface SheetRef {
  name: string
  state: SheetVisibility
  relId: string | null
  sheetId: string | null
}

function parseWorkbookSheets(xml: string | null): { sheets: SheetRef[]; date1904: boolean } {
  const sheets: SheetRef[] = []
  if (!xml) return { sheets, date1904: false }

  const date1904 = isTruthyXmlFlag(attr((/<workbookPr\b([^>]*)\/?>/.exec(xml) ?? [])[1] ?? '', 'date1904'))

  const pattern = /<sheet\b([^>]*)\/?>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const attributes = match[1]
    const rawState = attr(attributes, 'state')
    const state: SheetVisibility =
      rawState === 'veryHidden' ? 'veryHidden' : rawState === 'hidden' ? 'hidden' : 'visible'
    sheets.push({
      name: attr(attributes, 'name') ?? '(unnamed)',
      state,
      relId: attr(attributes, 'r:id') ?? attr(attributes, 'relationshipId'),
      sheetId: attr(attributes, 'sheetId')
    })
  }
  return { sheets, date1904 }
}

function parseRels(xml: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  const pattern = /<Relationship\b([^>]*)\/?>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const id = attr(match[1], 'Id')
    const target = attr(match[1], 'Target')
    if (id && target) map.set(id, target)
  }
  return map
}

/**
 * Resolve an OPC relationship target against the part that declared it.
 * Targets are relative to the *source part's directory* (or absolute when they start with
 * "/"), so `../comments1.xml` from `xl/worksheets/sheet1.xml` means `xl/comments1.xml`.
 * Traversal segments are collapsed at the archive root: we only ever look names up in a
 * Map, so nothing can escape, but the key has to be right or the part is missed.
 */
export function resolvePartPath(baseDir: string, target: string): string {
  const segments = target.startsWith('/')
    ? target.slice(1).split('/')
    : `${baseDir}/${target.replace(/^\.\//, '')}`.split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

interface SheetParseResult {
  rows: WorkbookRow[]
  hiddenColumnRanges: string[]
  mergedRanges: string[]
  dimension: string | null
  cellCount: number
  truncated: boolean
  truncationNote?: string
  hasConditionalFormatting: boolean
  hasProtection: boolean
}

function parseSheetXml(
  xml: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
  comments: Map<string, string>,
  limits: { maxCells: number; maxRows: number; cellBudgetLeft: number }
): SheetParseResult {
  const rows: WorkbookRow[] = []
  const hiddenColumnRanges: string[] = []
  const mergedRanges: string[] = []
  let cellCount = 0
  let truncated = false
  let truncationNote: string | undefined

  const dimension = (() => {
    const match = /<dimension\b([^>]*)\/?>/.exec(xml)
    return match ? attr(match[1], 'ref') : null
  })()

  const colPattern = /<col\b([^>]*)\/?>/g
  let colMatch: RegExpExecArray | null
  while ((colMatch = colPattern.exec(xml)) !== null) {
    if (!isTruthyXmlFlag(attr(colMatch[1], 'hidden'))) continue
    const min = Number(attr(colMatch[1], 'min') ?? '0')
    const max = Number(attr(colMatch[1], 'max') ?? String(min))
    if (min > 0) hiddenColumnRanges.push(`${indexToColumn(min)}:${indexToColumn(max)}`)
  }

  const mergePattern = /<mergeCell\b([^>]*)\/?>/g
  let mergeMatch: RegExpExecArray | null
  while ((mergeMatch = mergePattern.exec(xml)) !== null) {
    const ref = attr(mergeMatch[1], 'ref')
    if (ref) mergedRanges.push(ref)
  }

  const rowPattern = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g
  let rowMatch: RegExpExecArray | null
  let syntheticRowIndex = 0

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    if (rows.length >= limits.maxRows) {
      truncated = true
      truncationNote = `stopped after ${limits.maxRows} rows (row cap)`
      break
    }
    if (cellCount >= limits.maxCells || cellCount >= limits.cellBudgetLeft) {
      truncated = true
      truncationNote = `stopped after ${cellCount} cells (workbook cell cap)`
      break
    }

    const attributes = rowMatch[1]
    const body = rowMatch[2] ?? ''
    syntheticRowIndex++
    const rowNumber = Number(attr(attributes, 'r') ?? String(syntheticRowIndex))
    const hidden = isTruthyXmlFlag(attr(attributes, 'hidden'))
    const cells: WorkbookCell[] = []

    const cellPattern = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null
    let lastCol = 0
    while ((cellMatch = cellPattern.exec(body)) !== null) {
      const cellAttributes = cellMatch[1]
      const cellBody = cellMatch[2] ?? ''
      const ref = attr(cellAttributes, 'r')
      const parts = ref ? splitCellRef(ref) : null
      const col = parts?.col ?? lastCol + 1
      const rowIdx = parts?.row ?? rowNumber
      lastCol = col
      const coordinate = ref ?? `${indexToColumn(col)}${rowIdx}`
      const type = attr(cellAttributes, 't')
      const styleIndex = Number(attr(cellAttributes, 's') ?? '0')

      const formulaMatch = /<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cellBody)
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody)
      const inlineMatch = /<is>([\s\S]*?)<\/is>/.exec(cellBody)

      let formula: string | undefined
      if (formulaMatch) {
        const formulaAttributes = formulaMatch[1] ?? ''
        const text = formulaMatch[2] !== undefined ? decodeXmlEntities(formulaMatch[2]) : ''
        if (text) formula = text
        else if (isTruthyXmlFlag(attr(formulaAttributes, 't')) || attr(formulaAttributes, 't') === 'shared') {
          // Shared/array formula: the text lives in another cell. Say so instead of inventing it.
          formula = '[shared formula — definition stored in another cell]'
        } else {
          formula = '[formula text unavailable]'
        }
      }

      const rawValue = valueMatch ? decodeXmlEntities(valueMatch[1]) : null
      let cellType: CellType = 'number'
      let value: string | null = rawValue

      if (inlineMatch) {
        cellType = 'string'
        value = richTextToPlain(inlineMatch[1])
      } else if (type === 's') {
        cellType = 'string'
        const sharedIndex = rawValue === null ? Number.NaN : Number(rawValue)
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? '') : ''
      } else if (type === 'str') {
        cellType = 'string'
        value = rawValue ?? ''
      } else if (type === 'b') {
        cellType = 'boolean'
        value = rawValue === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        cellType = 'error'
        value = rawValue ?? '#ERROR'
      } else if (type === 'd') {
        cellType = 'date'
        value = rawValue
      } else if (rawValue === null && !formula) {
        cellType = 'empty'
        value = null
      }

      const dateSerial = cellType === 'number' && dateStyles.has(styleIndex)
      const cell: WorkbookCell = {
        ref: coordinate,
        row: rowIdx,
        col,
        type: cellType === 'number' && dateSerial ? 'number' : cellType,
        value,
        ...(formula ? { formula } : {}),
        ...(formula ? { cached: rawValue === null ? ('missing' as const) : ('present' as const) } : {}),
        ...(dateSerial ? { dateSerial: true } : {})
      }
      const comment = comments.get(coordinate)
      if (comment) cell.comment = comment

      cells.push(cell)
      cellCount++
      if (cellCount >= limits.maxCells || cellCount >= limits.cellBudgetLeft) {
        truncated = true
        truncationNote = `stopped after ${cellCount} cells (workbook cell cap)`
        break
      }
    }

    rows.push({ index: rowNumber, hidden, cells })
    if (truncated) break
  }

  return {
    rows,
    hiddenColumnRanges,
    mergedRanges,
    dimension,
    cellCount,
    truncated,
    truncationNote,
    hasConditionalFormatting: /<conditionalFormatting\b/.test(xml),
    hasProtection: /<sheetProtection\b/.test(xml)
  }
}

function parseComments(xml: string | null): Map<string, string> {
  const comments = new Map<string, string>()
  if (!xml) return comments
  const pattern = /<comment\b([^>]*)(?:\/>|>([\s\S]*?)<\/comment>)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const ref = attr(match[1], 'ref')
    if (!ref) continue
    const textMatch = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(match[2] ?? '')
    comments.set(ref, richTextToPlain(textMatch ? textMatch[1] : (match[2] ?? '')))
  }
  return comments
}

const FEATURE_DEFINITIONS: Array<{
  key: string
  label: string
  test: (names: string[], hasConditionalFormatting: boolean) => boolean
  representable: boolean
  note: string
}> = [
  {
    key: 'charts',
    label: 'Charts',
    test: (names) => names.some((name) => name.startsWith('xl/charts/')),
    representable: false,
    note: 'Charts are not rendered or described. The underlying cell data is still exported.'
  },
  {
    key: 'drawings',
    label: 'Shapes and drawings',
    test: (names) => names.some((name) => name.startsWith('xl/drawings/')),
    representable: false,
    note: 'Shapes, text boxes and drawing layout are not represented.'
  },
  {
    key: 'media',
    label: 'Embedded images and media',
    test: (names) => names.some((name) => name.startsWith('xl/media/')),
    representable: false,
    note: 'Embedded images are not extracted; only cell content is exported.'
  },
  {
    key: 'vba',
    label: 'VBA macros',
    test: (names) => names.includes('xl/vbaProject.bin'),
    representable: false,
    note: 'Macros are never executed and are not exported. The workbook runs as data only.'
  },
  {
    key: 'pivot',
    label: 'Pivot tables and caches',
    test: (names) => names.some((name) => name.startsWith('xl/pivotCache/') || name.startsWith('xl/pivotTables/')),
    representable: false,
    note: 'Pivot definitions are not expanded; only the values stored in cells are exported.'
  },
  {
    key: 'externalLinks',
    label: 'External workbook links',
    test: (names) => names.some((name) => name.startsWith('xl/externalLinks/')),
    representable: false,
    note: 'External links are never fetched. Linked values are exported only as the cached values stored here.'
  },
  {
    key: 'connections',
    label: 'Data connections',
    test: (names) => names.includes('xl/connections.xml') || names.some((name) => name.startsWith('customXml/')),
    representable: false,
    note: 'Data connections are not used; nothing is queried.'
  },
  {
    key: 'tables',
    label: 'Structured tables',
    test: (names) => names.some((name) => name.startsWith('xl/tables/')),
    representable: true,
    note: 'Table regions appear as ordinary rows and columns.'
  },
  {
    key: 'conditionalFormatting',
    label: 'Conditional formatting',
    test: (_names, hasCf) => hasCf,
    representable: false,
    note: 'Conditional formatting rules are not evaluated; cells show their stored values.'
  },
  {
    key: 'comments',
    label: 'Cell comments',
    test: (names) => names.some((name) => /^xl\/comments[^/]*\.xml$/.test(name)),
    representable: true,
    note: 'Comments are attached to the cells they belong to.'
  }
]

export function readWorkbook(filePath: string, options: WorkbookOptions = {}): WorkbookResult {
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS
  const maxRows = options.maxRowsPerSheet ?? DEFAULT_MAX_ROWS
  const maxXmlBytes = options.maxXmlBytes ?? 32 * 1024 * 1024

  let data: Buffer
  try {
    data = fs.readFileSync(filePath)
  } catch (error) {
    return { ok: false, reason: 'read-failed', message: `Could not read the file: ${(error as Error).message}` }
  }

  let zip: ZipEntryReader
  try {
    zip = openZip(data)
  } catch (error) {
    if (error instanceof ZipError) {
      const reason: WorkbookFailureReason =
        error.code === 'not-a-zip' ? 'not-a-zip' : error.code === 'entry-too-large' || error.code === 'archive-too-large' || error.code === 'ratio-bomb' || error.code === 'too-many-entries' ? 'too-large' : 'corrupt'
      return { ok: false, reason, message: error.message }
    }
    return { ok: false, reason: 'corrupt', message: (error as Error).message }
  }

  try {
    const names = zip.names()
    if (!names.includes('xl/workbook.xml')) {
      return {
        ok: false,
        reason: 'not-a-workbook',
        message:
          'This ZIP-based file has no xl/workbook.xml, so it is not an Excel workbook (it may be a Word or PowerPoint file, or a renamed archive).'
      }
    }

    const workbookXml = zip.readText('xl/workbook.xml', { maxBytes: maxXmlBytes })
    const { sheets: sheetRefs, date1904 } = parseWorkbookSheets(workbookXml)
    const rels = parseRels(zip.readText('xl/_rels/workbook.xml.rels', { maxBytes: maxXmlBytes }))
    const sharedStrings = parseSharedStrings(zip.readText('xl/sharedStrings.xml', { maxBytes: maxXmlBytes }))
    const dateStyles = parseDateFormatStyles(zip.readText('xl/styles.xml', { maxBytes: maxXmlBytes }))

    const sheets: WorkbookSheet[] = []
    let cellBudgetLeft = maxCells
    let hasConditionalFormatting = false

    sheetRefs.forEach((ref, index) => {
      const target = ref.relId ? rels.get(ref.relId) : undefined
      const path = target ? resolvePartPath('xl', target) : `xl/worksheets/sheet${index + 1}.xml`
      const xml = zip.has(path) ? zip.readText(path, { maxBytes: maxXmlBytes }) : null

      const sheetName = path.split('/').pop() ?? ''
      const relPath = `xl/worksheets/_rels/${sheetName}.rels`
      const sheetRels = parseRels(zip.has(relPath) ? zip.readText(relPath, { maxBytes: maxXmlBytes }) : null)
      let comments = new Map<string, string>()
      for (const relTarget of sheetRels.values()) {
        if (!/comments/i.test(relTarget)) continue
        const commentsPart = resolvePartPath('xl/worksheets', relTarget)
        if (zip.has(commentsPart)) {
          comments = parseComments(zip.readText(commentsPart, { maxBytes: maxXmlBytes }))
        }
      }

      if (!xml) {
        sheets.push({
          name: ref.name,
          index,
          position: index + 1,
          state: ref.state,
          dimension: null,
          rows: [],
          hiddenColumnRanges: [],
          mergedRanges: [],
          comments: [...comments.entries()].map(([coordinate, text]) => ({ ref: coordinate, text })),
          cellCount: 0,
          rowCount: 0,
          truncated: false
        })
        return
      }

      const parsed = parseSheetXml(xml, sharedStrings, dateStyles, comments, {
        maxCells,
        maxRows,
        cellBudgetLeft
      })
      cellBudgetLeft = Math.max(0, cellBudgetLeft - parsed.cellCount)
      if (parsed.hasConditionalFormatting) hasConditionalFormatting = true

      sheets.push({
        name: ref.name,
        index,
        position: index + 1,
        state: ref.state,
        dimension: parsed.dimension,
        rows: parsed.rows,
        hiddenColumnRanges: parsed.hiddenColumnRanges,
        mergedRanges: parsed.mergedRanges,
        comments: [...comments.entries()].map(([coordinate, text]) => ({ ref: coordinate, text })),
        cellCount: parsed.cellCount,
        rowCount: parsed.rows.length,
        truncated: parsed.truncated,
        ...(parsed.truncationNote ? { truncationNote: parsed.truncationNote } : {})
      })
    })

    const features: WorkbookFeature[] = FEATURE_DEFINITIONS.filter((definition) =>
      definition.test(names, hasConditionalFormatting)
    ).map((definition) => ({
      key: definition.key,
      label: definition.label,
      present: true,
      representable: definition.representable,
      note: definition.note
    }))

    const warnings: string[] = []
    const hidden = sheets.filter((sheet) => sheet.state !== 'visible')
    if (hidden.length > 0) {
      warnings.push(
        `${hidden.length} sheet(s) are hidden in the original workbook: ${hidden
          .map((sheet) => `"${sheet.name}" (${sheet.state})`)
          .join(', ')}. Their content is included in the export.`
      )
    }
    const hiddenRows = sheets.reduce(
      (total, sheet) => total + sheet.rows.filter((row) => row.hidden).length,
      0
    )
    if (hiddenRows > 0) warnings.push(`${hiddenRows} row(s) are hidden in the original workbook.`)
    const hiddenCols = sheets.reduce((total, sheet) => total + sheet.hiddenColumnRanges.length, 0)
    if (hiddenCols > 0) warnings.push(`${hiddenCols} hidden column range(s) are included.`)
    if (date1904) {
      warnings.push(
        'This workbook uses the 1904 date system. Date serial numbers are shifted by 1462 days compared with the 1900 system; values are exported exactly as stored and are not converted.'
      )
    }
    const withFormulas = sheets.reduce(
      (total, sheet) =>
        total + sheet.rows.reduce((rowTotal, row) => rowTotal + row.cells.filter((cell) => cell.formula).length, 0),
      0
    )
    if (withFormulas > 0) {
      warnings.push(
        `${withFormulas} cell(s) contain formulas. Their text is exported, and the value shown is the value saved in the file — Nexus never recalculates, so a stale cached value stays stale.`
      )
    }
    const unprotected = features.filter((feature) => !feature.representable)
    if (unprotected.length > 0) {
      warnings.push(
        `Not represented in the export: ${unprotected.map((feature) => feature.label.toLowerCase()).join(', ')}.`
      )
    }

    const inventory: WorkbookInventory = {
      sheets,
      visibleSheets: sheets.filter((sheet) => sheet.state === 'visible').length,
      hiddenSheets: sheets.filter((sheet) => sheet.state === 'hidden').length,
      veryHiddenSheets: sheets.filter((sheet) => sheet.state === 'veryHidden').length,
      totalCells: sheets.reduce((total, sheet) => total + sheet.cellCount, 0),
      totalRows: sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
      features,
      warnings,
      date1904,
      truncatedSheets: sheets.filter((sheet) => sheet.truncated).map((sheet) => sheet.name)
    }

    return { ok: true, inventory }
  } catch (error) {
    if (error instanceof ZipError) {
      return { ok: false, reason: 'corrupt', message: error.message }
    }
    return { ok: false, reason: 'corrupt', message: `Could not read the workbook: ${(error as Error).message}` }
  }
}

// ---------------------------------------------------------------------------
// Text artifacts
// ---------------------------------------------------------------------------

export interface WorkbookPart {
  index: number
  label: string
  /** Stable source identifiers this part covers, for reassembly. */
  covers: string
  content: string
}

export interface WorkbookExport {
  parts: WorkbookPart[]
  manifest: string
  totalChars: number
}

const renderCell = (cell: WorkbookCell): string => {
  if (cell.formula) {
    const cached =
      cell.cached === 'present'
        ? ` → cached value ${cell.value ?? ''}`
        : ' → no cached value (result unknown without recalculation)'
    return `${cell.ref} =\u00a0${cell.formula}${cached}`
  }
  if (cell.value === null) return `${cell.ref} (empty)`
  const annotation = cell.dateSerial ? ' [date/time serial as stored]' : ''
  const comment = cell.comment ? ` [comment: ${cell.comment}]` : ''
  return `${cell.ref} ${cell.value}${annotation}${comment}`
}

/**
 * Render the workbook as labelled, ordered text parts.
 * Splitting happens at row boundaries; a split sheet says exactly which rows each part holds.
 */
export function buildWorkbookParts(
  inventory: WorkbookInventory,
  options: { maxCharsPerPart?: number } = {}
): WorkbookExport {
  const maxChars = options.maxCharsPerPart ?? 120_000
  const parts: WorkbookPart[] = []
  let index = 1

  for (const sheet of inventory.sheets) {
    const header = [
      `### Sheet ${sheet.position}: "${sheet.name}" (${sheet.state})`,
      `cells: ${sheet.cellCount} · rows: ${sheet.rowCount}${
        sheet.dimension ? ` · dimension ${sheet.dimension}` : ''
      }`,
      sheet.hiddenColumnRanges.length ? `hidden columns: ${sheet.hiddenColumnRanges.join(', ')}` : '',
      sheet.mergedRanges.length ? `merged ranges: ${sheet.mergedRanges.join(', ')}` : '',
      sheet.truncated ? `INCOMPLETE: ${sheet.truncationNote ?? 'parsing stopped early'}` : ''
    ]
      .filter(Boolean)
      .join('\n')

    let buffer: string[] = []
    let bufferChars = header.length
    let firstRow = sheet.rows[0]?.index ?? 0
    let lastRow = firstRow

    const flush = (): void => {
      if (buffer.length === 0) return
      const range =
        firstRow === lastRow ? `row ${firstRow}` : `rows ${firstRow}–${lastRow}`
      parts.push({
        index,
        label: `Sheet "${sheet.name}" (${sheet.state}) — ${range}`,
        covers: `${sheet.name}!${range}`,
        content: `${header}\n\n${buffer.join('\n')}`
      })
      index++
      buffer = []
      bufferChars = header.length
    }

    for (const row of sheet.rows) {
      const rowLabel = row.hidden ? `R${row.index} [hidden]` : `R${row.index}`
      const line = `${rowLabel}\t${row.cells.map(renderCell).join('\t')}`
      if (bufferChars + line.length > maxChars && buffer.length > 0) {
        flush()
        firstRow = row.index
      }
      if (buffer.length === 0) firstRow = row.index
      buffer.push(line)
      bufferChars += line.length + 1
      lastRow = row.index
    }
    flush()
  }

  const totalChars = parts.reduce((total, part) => total + part.content.length, 0)

  const manifestLines: string[] = [
    '# Excel workbook export (AI-readable text)',
    '',
    `Sheets: ${inventory.sheets.length} (${inventory.visibleSheets} visible, ${inventory.hiddenSheets} hidden, ${inventory.veryHiddenSheets} very hidden)`,
    `Cells exported: ${inventory.totalCells} · rows: ${inventory.totalRows}`,
    `Parts: ${parts.length}`,
    '',
    '## Sheets in original order'
  ]
  for (const sheet of inventory.sheets) {
    manifestLines.push(
      `- ${sheet.position}. "${sheet.name}" — ${sheet.state}, ${sheet.cellCount} cell(s), ${sheet.rowCount} row(s)${
        sheet.truncated ? ' — INCOMPLETE' : ''
      }`
    )
  }
  if (parts.length > 0) {
    manifestLines.push('', '## Parts')
    for (const part of parts) {
      manifestLines.push(`${part.index}. ${part.label}`)
    }
  }
  if (inventory.features.length > 0) {
    manifestLines.push('', '## Workbook features detected')
    for (const feature of inventory.features) {
      manifestLines.push(
        `- ${feature.label}: ${feature.representable ? 'represented' : 'NOT represented'} — ${feature.note}`
      )
    }
  }
  if (inventory.warnings.length > 0) {
    manifestLines.push('', '## Warnings')
    for (const warning of inventory.warnings) manifestLines.push(`- ${warning}`)
  }
  manifestLines.push(
    '',
    '## Limits of this export',
    '- Values are exactly what the file stores. Formulas are shown as text; cached results are marked, and missing cached values stay missing — nothing was recalculated.',
    '- Unsupported objects listed above are not in the export. Absence of a feature is listed, not hidden.',
    '- Cell coordinates are preserved (A1 style), so any value can be checked against the original workbook.',
    '- The original file is unchanged; this export is a text rendering of it, not a replacement.',
    '',
    '_Generated locally in Nexus. No external service was used and no macro was executed._'
  )

  return { parts, manifest: manifestLines.join('\n'), totalChars }
}
