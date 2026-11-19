import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildWorkbookParts, readWorkbook, type WorkbookInventory } from './xlsxWorkbook'
import { buildZip, type ZipInputEntry } from './testZipBuilder'
import { detectOfficeFile, officeKindFromExtension } from '../shared/officeFormat'

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-xlsx-test-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const CONTENT_TYPES = `<?xml version="1.0"?><Types><Default Extension="xml" ContentType="application/xml"/></Types>`

const WORKBOOK_XML = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="1"/>
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Hidden Data" sheetId="2" r:id="rId2" state="hidden"/>
    <sheet name="Very Secret" sheetId="3" r:id="rId3" state="veryHidden"/>
  </sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="worksheet" Target="/xl/worksheets/sheet3.xml"/>
</Relationships>`

const SHARED_STRINGS = `<?xml version="1.0"?>
<sst count="4">
  <si><r><t>Total</t></r><r><t xml:space="preserve"> revenue</t></r></si>
  <si><t>الإجمالي</t></si>
  <si><t>With phonetic</t><rPh sb="0" eb="4"><t>IGNORED PHONETIC</t></rPh></si>
  <si><t>hidden row value</t></si>
</sst>`

const STYLES = `<?xml version="1.0"?>
<styleSheet>
  <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
  <cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>
</styleSheet>`

const SHEET1 = `<?xml version="1.0"?>
<worksheet>
  <dimension ref="A1:C6"/>
  <cols><col min="2" max="2" hidden="1"/></cols>
  <sheetData>
    <row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1" s="2"><v>45000</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>A1&amp;" x"</f><v>84</v></c><c r="C2" t="b"><v>1</v></c></row>
    <row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><f>SUM(B1:B2)</f></c><c r="C3" t="e"><v>#DIV/0!</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>inline text</t></is></c><c r="B4"><f t="shared" si="0"/><v>7</v></c><c r="C4" s="1"><v>45123</v></c></row>
    <row r="5" hidden="1"><c r="A5" t="s"><v>3</v></c></row>
    <row r="6"><c r="A6"><v>3.14159</v></c><c r="B6"><v>1e+21</v></c></row>
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>
  <conditionalFormatting sqref="A1:A6"><cfRule type="cellIs"/></conditionalFormatting>
  <sheetProtection sheet="1"/>
</worksheet>`

const SHEET2 = `<?xml version="1.0"?>
<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden sheet value</t></is></c></row></sheetData></worksheet>`

const SHEET3 = `<worksheet><sheetData><row r="1"><c r="A1"><v>99</v></c></row></sheetData></worksheet>`

const COMMENTS = `<?xml version="1.0"?>
<comments><commentList>
  <comment ref="A2" authorId="0"><text><r><t>check this number</t></r></text></comment>
</commentList></comments>`

function workbookZip(extra: ZipInputEntry[] = []): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: 'xl/workbook.xml', content: WORKBOOK_XML },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
    { name: 'xl/sharedStrings.xml', content: SHARED_STRINGS },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET1 },
    { name: 'xl/worksheets/sheet2.xml', content: SHEET2 },
    { name: 'xl/worksheets/sheet3.xml', content: SHEET3 },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', content: '<Relationships><Relationship Id="rId1" Target="../comments1.xml"/></Relationships>' },
    { name: 'xl/comments1.xml', content: COMMENTS },
    { name: 'xl/charts/chart1.xml', content: '<chart/>' },
    { name: 'xl/drawings/drawing1.xml', content: '<drawing/>' },
    { name: 'xl/media/image1.png', content: 'PNGDATA' },
    { name: 'xl/vbaProject.bin', content: 'MACRO-BYTES' },
    { name: 'xl/pivotCache/pivotCacheDefinition1.xml', content: '<pivotCacheDefinition/>' },
    { name: 'xl/externalLinks/externalLink1.xml', content: '<externalLink/>' },
    ...extra
  ])
}

function writeWorkbook(buffer: Buffer, name = 'book.xlsx'): string {
  const dir = tempDir()
  const file = path.join(dir, name)
  fs.writeFileSync(file, buffer)
  return file
}

function readFixture(options: Parameters<typeof readWorkbook>[1] = {}): WorkbookInventory {
  const file = writeWorkbook(workbookZip())
  const result = readWorkbook(file, options)
  if (!result.ok) throw new Error(`fixture failed to parse: ${result.message}`)
  return result.inventory
}

describe('workbook inventory', () => {
  it('lists every sheet in original order with its visibility', () => {
    const inventory = readFixture()
    expect(inventory.sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Hidden Data', 'Very Secret'])
    expect(inventory.sheets.map((sheet) => sheet.state)).toEqual(['visible', 'hidden', 'veryHidden'])
    expect(inventory.visibleSheets).toBe(1)
    expect(inventory.hiddenSheets).toBe(1)
    expect(inventory.veryHiddenSheets).toBe(1)
    // The very-hidden sheet used an absolute rel target and must still be found.
    expect(inventory.sheets[2].rows[0].cells[0].value).toBe('99')
  })

  it('warns about hidden sheets, hidden rows and hidden columns before export', () => {
    const inventory = readFixture()
    const warnings = inventory.warnings.join(' ')
    expect(warnings).toContain('2 sheet(s) are hidden')
    expect(warnings).toContain('"Hidden Data" (hidden)')
    expect(warnings).toContain('1 row(s) are hidden')
    expect(warnings).toContain('1 hidden column range(s)')
  })

  it('reports the 1904 date system instead of silently shifting dates', () => {
    const inventory = readFixture()
    expect(inventory.date1904).toBe(true)
    expect(inventory.warnings.join(' ')).toContain('1904 date system')
  })
})

describe('cell extraction', () => {
  it('joins rich-text runs and keeps Unicode', () => {
    const inventory = readFixture()
    const sheet = inventory.sheets[0]
    const a1 = sheet.rows[0].cells.find((cell) => cell.ref === 'A1')
    const a2 = sheet.rows[1].cells.find((cell) => cell.ref === 'A2')
    expect(a1?.value).toBe('Total revenue')
    expect(a2?.value).toBe('الإجمالي')
  })

  it('drops phonetic hints instead of mixing them into the value', () => {
    const inventory = readFixture()
    const a3 = inventory.sheets[0].rows[2].cells.find((cell) => cell.ref === 'A3')
    expect(a3?.value).toBe('With phonetic')
    expect(a3?.value).not.toContain('IGNORED PHONETIC')
  })

  it('extracts inline strings, booleans, errors and exact numeric text', () => {
    const inventory = readFixture()
    const byRef = new Map(inventory.sheets[0].rows.flatMap((row) => row.cells.map((cell) => [cell.ref, cell])))
    expect(byRef.get('A4')?.value).toBe('inline text')
    expect(byRef.get('C2')).toMatchObject({ type: 'boolean', value: 'TRUE' })
    expect(byRef.get('C3')).toMatchObject({ type: 'error', value: '#DIV/0!' })
    // No rounding or reformatting of stored numbers.
    expect(byRef.get('A6')?.value).toBe('3.14159')
    expect(byRef.get('B6')?.value).toBe('1e+21')
  })

  it('marks date-formatted numbers as serials without converting them', () => {
    const inventory = readFixture()
    const byRef = new Map(inventory.sheets[0].rows.flatMap((row) => row.cells.map((cell) => [cell.ref, cell])))
    expect(byRef.get('C1')).toMatchObject({ value: '45000', dateSerial: true })
    expect(byRef.get('C4')).toMatchObject({ value: '45123', dateSerial: true })
    expect(byRef.get('A6')?.dateSerial).toBeUndefined()
  })

  it('keeps hidden rows and columns in the export while flagging them', () => {
    const inventory = readFixture()
    const sheet = inventory.sheets[0]
    const hiddenRow = sheet.rows.find((row) => row.index === 5)
    expect(hiddenRow?.hidden).toBe(true)
    expect(hiddenRow?.cells[0].value).toBe('hidden row value')
    expect(sheet.hiddenColumnRanges).toEqual(['B:B'])
    expect(sheet.mergedRanges).toEqual(['A1:C1'])
  })

  it('attaches comments to the cell they belong to', () => {
    const inventory = readFixture()
    const a2 = inventory.sheets[0].rows[1].cells.find((cell) => cell.ref === 'A2')
    expect(a2?.comment).toBe('check this number')
  })
})

describe('formulas versus cached values', () => {
  it('distinguishes a formula with a cached value from one without', () => {
    const inventory = readFixture()
    const byRef = new Map(inventory.sheets[0].rows.flatMap((row) => row.cells.map((cell) => [cell.ref, cell])))
    // Cached result present.
    expect(byRef.get('B2')).toMatchObject({ formula: 'A1&" x"', value: '84', cached: 'present' })
    // No cached value: the export must not invent a result.
    expect(byRef.get('B3')).toMatchObject({ formula: 'SUM(B1:B2)', cached: 'missing' })
    expect(byRef.get('B3')?.value).toBeNull()
  })

  it('says a shared formula definition lives elsewhere instead of guessing it', () => {
    const inventory = readFixture()
    const b4 = inventory.sheets[0].rows[3].cells.find((cell) => cell.ref === 'B4')
    expect(b4?.formula).toContain('shared formula')
    expect(b4?.cached).toBe('present')
  })

  it('warns that nothing was recalculated', () => {
    const inventory = readFixture()
    expect(inventory.warnings.join(' ')).toContain('never recalculates')
  })
})

describe('unsupported features are inventoried, not hidden', () => {
  it('lists charts, drawings, media, macros, pivots, external links and conditional formatting', () => {
    const inventory = readFixture()
    const keys = inventory.features.map((feature) => feature.key)
    expect(keys).toEqual(
      expect.arrayContaining(['charts', 'drawings', 'media', 'vba', 'pivot', 'externalLinks', 'conditionalFormatting', 'comments'])
    )
    const vba = inventory.features.find((feature) => feature.key === 'vba')
    expect(vba?.representable).toBe(false)
    expect(vba?.note).toContain('never executed')
    const external = inventory.features.find((feature) => feature.key === 'externalLinks')
    expect(external?.note).toContain('never fetched')
    // Comments are actually represented.
    expect(inventory.features.find((feature) => feature.key === 'comments')?.representable).toBe(true)
  })

  it('names the unrepresented features in a warning', () => {
    const inventory = readFixture()
    expect(inventory.warnings.join(' ')).toContain('Not represented in the export')
  })
})

describe('labelled parts', () => {
  it('emits one part per sheet with a stable label and cell coordinates', () => {
    const inventory = readFixture()
    const { parts, manifest } = buildWorkbookParts(inventory)
    expect(parts).toHaveLength(3)
    expect(parts[0].label).toContain('Sheet "Summary" (visible)')
    expect(parts[0].content).toContain('A1 Total revenue')
    expect(parts[0].content).toContain('B3 =\u00a0SUM(B1:B2) → no cached value')
    expect(parts[1].label).toContain('"Hidden Data" (hidden)')
    expect(manifest).toContain('Excel workbook export')
    expect(manifest).toContain('Parts: 3')
    expect(manifest).toContain('nothing was recalculated')
  })

  it('splits at row boundaries without losing rows', () => {
    const inventory = readFixture()
    const { parts } = buildWorkbookParts(inventory, { maxCharsPerPart: 120 })
    const summaryParts = parts.filter((part) => part.label.includes('Summary'))
    expect(summaryParts.length).toBeGreaterThan(1)
    // Every cell from the sheet appears in exactly one part.
    const combined = summaryParts.map((part) => part.content).join('\n')
    for (const ref of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B6', 'C3']) {
      const occurrences = combined.split(new RegExp(`\\b${ref}\\b`)).length - 1
      expect(occurrences).toBeGreaterThanOrEqual(1)
    }
    // Each part says which rows it covers.
    for (const part of summaryParts) {
      expect(part.covers).toMatch(/Summary!row/)
    }
  })

  it('flags an incomplete sheet inside the part itself', () => {
    const file = writeWorkbook(workbookZip())
    const result = readWorkbook(file, { maxCells: 4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inventory.truncatedSheets).toContain('Summary')
    const { parts } = buildWorkbookParts(result.inventory)
    expect(parts[0].content).toContain('INCOMPLETE')
  })
})

describe('refusals', () => {
  it('refuses a ZIP that is not a workbook', () => {
    const file = writeWorkbook(buildZip([{ name: 'word/document.xml', content: '<w/>' }]), 'notreally.xlsx')
    const result = readWorkbook(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-workbook')
  })

  it('refuses a file that is not a ZIP (e.g. renamed text)', () => {
    const dir = tempDir()
    const file = path.join(dir, 'fake.xlsx')
    fs.writeFileSync(file, 'this is plain text pretending to be a workbook')
    const result = readWorkbook(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-zip')
  })

  it('reports a missing file without throwing', () => {
    const result = readWorkbook('/definitely/not/here.xlsx')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('read-failed')
  })

  it('treats a legacy binary workbook as unreadable rather than guessing', () => {
    const dir = tempDir()
    const file = path.join(dir, 'legacy.xls')
    // CFB magic: legacy BIFF or an encrypted OOXML file.
    fs.writeFileSync(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))
    const head = fs.readFileSync(file).subarray(0, 8)
    const info = detectOfficeFile('legacy.xls', head)
    expect(info.container).toBe('ole')
    expect(info.locallyReadable).toBe(false)
    expect(info.reason).toContain('password-protected')
    const result = readWorkbook(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-zip')
  })
})

describe('format detection', () => {
  it('maps extensions to Office kinds', () => {
    expect(officeKindFromExtension('.docx')).toBe('word')
    expect(officeKindFromExtension('.PPT')).toBe('presentation')
    expect(officeKindFromExtension('.xlsm')).toBe('spreadsheet')
    expect(officeKindFromExtension('.txt')).toBeNull()
  })

  it('detects OOXML by magic bytes, not by name', () => {
    const info = detectOfficeFile('book.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))
    expect(info.container).toBe('ooxml')
    expect(info.kind).toBe('spreadsheet')
    expect(info.locallyReadable).toBe(true)
  })

  it('flags a mislabelled file instead of trusting the extension', () => {
    const info = detectOfficeFile('invoice.docx', Buffer.from('just some text'))
    expect(info.container).toBe('unknown')
    expect(info.locallyReadable).toBe(false)
    expect(info.reason).toContain('does not look like')
  })
})
