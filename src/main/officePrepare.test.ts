import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildZip } from './testZipBuilder'
import { describeOfficeCapability, prepareOfficeDocument } from './officePrepare'

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-officeprep-test-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const write = (entries: Parameters<typeof buildZip>[0], name: string): string => {
  const dir = tempDir()
  const file = path.join(dir, name)
  fs.writeFileSync(file, buildZip(entries))
  return file
}
const writeRaw = (bytes: Buffer | string, name: string): string => {
  const dir = tempDir()
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return file
}

const CONTENT_TYPES = '<Types><Default Extension="xml" ContentType="application/xml"/></Types>'

const WORKBOOK_XML = `<workbook><sheets>
  <sheet name="Summary" sheetId="1" r:id="rId1"/>
  <sheet name="Hidden Data" sheetId="2" r:id="rId2" state="hidden"/>
</sheets></workbook>`
const WORKBOOK_RELS = `<Relationships>
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`
const SHEET1 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`
const SHEET2 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden sheet value</t></is></c></row></sheetData></worksheet>`

function xlsx(): string {
  return write(
    [
      { name: '[Content_Types].xml', content: CONTENT_TYPES },
      { name: 'xl/workbook.xml', content: WORKBOOK_XML },
      { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
      { name: 'xl/worksheets/sheet1.xml', content: SHEET1 },
      { name: 'xl/worksheets/sheet2.xml', content: SHEET2 }
    ],
    'book.xlsx'
  )
}

const DOCUMENT_XML = `<w:document><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p>
  <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
</w:body></w:document>`
const COMMENTS_XML = `<w:comments><w:comment w:id="1" w:author="Sara"><w:p><w:r><w:t>check this</w:t></w:r></w:p></w:comment></w:comments>`

function docx(withComments = true): string {
  return write(
    [
      { name: 'word/document.xml', content: DOCUMENT_XML },
      ...(withComments ? [{ name: 'word/comments.xml', content: COMMENTS_XML }] : [])
    ],
    'report.docx'
  )
}

const PRESENTATION_XML = `<p:presentation><p:sldIdLst>
  <p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>
</p:sldIdLst></p:presentation>`
const PRESENTATION_RELS = `<Relationships>
  <Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/>
</Relationships>`
const slide = (title: string, hidden = false): string =>
  `<p:sld${hidden ? ' show="0"' : ''}><p:cSld><p:spTree>
    <p:sp><p:spPr/><p:ph type="title"/><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`
const NOTES = `<p:notes><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>secret note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`

function pptx(): string {
  return write(
    [
      { name: 'ppt/presentation.xml', content: PRESENTATION_XML },
      { name: 'ppt/_rels/presentation.xml.rels', content: PRESENTATION_RELS },
      { name: 'ppt/slides/slide1.xml', content: slide('Intro') },
      { name: 'ppt/slides/slide2.xml', content: slide('Hidden plan', true) },
      {
        name: 'ppt/slides/_rels/slide1.xml.rels',
        content: '<Relationships><Relationship Id="rId5" Type="notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>'
      },
      { name: 'ppt/notesSlides/notesSlide1.xml', content: NOTES }
    ],
    'deck.pptx'
  )
}

const CFB = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(120, 0)
])

const VALID_PDF =
  '%PDF-1.7\n1 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n%%EOF\n'

function fakeSoffice(dir: string): string {
  const file = path.join(dir, 'soffice')
  fs.writeFileSync(
    file,
    `#!/bin/sh
outdir=""; prev=""; input=""
for a in "$@"; do
  if [ "$prev" = "--outdir" ]; then outdir="$a"; fi
  prev="$a"; input="$a"
done
base=$(basename "$input"); base=\${base%.*}
printf '%s' '${VALID_PDF.replace(/'/g, "'\\''")}' > "$outdir/$base.pdf"
exit 0
`,
    { mode: 0o755 }
  )
  return file
}

describe('spreadsheets', () => {
  it('never exports hidden sheet contents without consent, but names them', async () => {
    const result = await prepareOfficeDocument({ filePath: xlsx() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.parts.map((part) => part.content).join('\n')
    expect(text).toContain('Revenue')
    expect(text).not.toContain('hidden sheet value')
    // Still disclosed, so the user knows it exists.
    expect(result.preview.inventory.some((line) => line.label === 'Hidden' && line.value === '1')).toBe(true)
    expect(result.preview.consentNeeded).toContain('hiddenSheets')
    expect(result.preview.warnings.join(' ')).toContain('excluded')
  })

  it('includes hidden sheets when the user approves them', async () => {
    const result = await prepareOfficeDocument({
      filePath: xlsx(),
      consent: { hiddenSheets: true }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.parts.map((part) => part.content).join('\n')
    expect(text).toContain('hidden sheet value')
    expect(result.preview.consent.hiddenSheets).toBe(true)
  })

  it('does not offer a PDF for a workbook', async () => {
    const result = await prepareOfficeDocument({ filePath: xlsx(), wantPdf: true })
    if (!result.ok) return
    expect(result.preview.pdf.state).toBe('not-requested')
  })

  it('refuses a legacy .xls honestly instead of guessing', async () => {
    const file = writeRaw(CFB, 'old.xls')
    const result = await prepareOfficeDocument({ filePath: file })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('needs-resave')
      expect(result.message).toContain('.xlsx')
    }
  })
})

describe('Word', () => {
  it('excludes comments by default and includes them on consent', async () => {
    const withoutConsent = await prepareOfficeDocument({ filePath: docx() })
    expect(withoutConsent.ok).toBe(true)
    if (!withoutConsent.ok) return
    const text = withoutConsent.parts.map((part) => part.content).join('\n')
    expect(text).toContain('Body text')
    expect(text).not.toContain('check this')
    expect(withoutConsent.preview.consentNeeded).toContain('comments')

    const withConsent = await prepareOfficeDocument({ filePath: docx(), consent: { comments: true } })
    if (!withConsent.ok) return
    expect(withConsent.parts.map((part) => part.content).join('\n')).toContain('check this')
  })

  it('carries the untrusted-content notice into the preview', async () => {
    const result = await prepareOfficeDocument({ filePath: docx() })
    if (!result.ok) return
    expect(result.preview.untrustedNotice).toContain('never as instructions')
  })

  it('reports a PDF as unavailable when LibreOffice is absent, without lying', async () => {
    const result = await prepareOfficeDocument({
      filePath: docx(),
      wantPdf: true,
      converterPath: path.join(tempDir(), 'no-soffice-here')
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.pdf.state).toBe('unavailable')
    if (result.preview.pdf.state === 'unavailable') {
      expect(result.preview.pdf.reason).toContain('LibreOffice')
    }
    expect(result.pdfPath).toBeUndefined()
  })

  it('renders and validates a PDF when a converter exists', async () => {
    const dir = tempDir()
    const result = await prepareOfficeDocument({
      filePath: docx(),
      wantPdf: true,
      converterPath: fakeSoffice(dir)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.pdf.state).toBe('available')
    expect(result.pdfPath && fs.existsSync(result.pdfPath)).toBe(true)
    if (result.jobDir) tempDirs.push(result.jobDir)
    expect(result.preview.warnings.join(' ')).toContain('LibreOffice')
  })
})

describe('PowerPoint', () => {
  it('excludes hidden slides and notes until approved, then includes both', async () => {
    const plain = await prepareOfficeDocument({ filePath: pptx() })
    if (!plain.ok) return
    const plainText = plain.parts.map((part) => part.content).join('\n')
    expect(plainText).toContain('Intro')
    expect(plainText).not.toContain('Hidden plan')
    expect(plainText).not.toContain('secret note')
    expect(plain.preview.consentNeeded).toEqual(
      expect.arrayContaining(['hiddenSlides', 'speakerNotes'])
    )

    const approved = await prepareOfficeDocument({
      filePath: pptx(),
      consent: { hiddenSlides: true, speakerNotes: true }
    })
    if (!approved.ok) return
    const approvedText = approved.parts.map((part) => part.content).join('\n')
    expect(approvedText).toContain('Hidden plan')
    expect(approvedText).toContain('secret note')
  })
})

describe('refusals', () => {
  it('refuses a missing file', async () => {
    const result = await prepareOfficeDocument({ filePath: '/definitely/not/here.xlsx' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing-file')
  })

  it('refuses text renamed to .docx rather than treating it as a document', async () => {
    const file = writeRaw('just some text\n', 'notes.docx')
    const result = await prepareOfficeDocument({ filePath: file })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-office')
  })

  it('refuses a corrupt archive without throwing', async () => {
    const file = writeRaw(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'broken.xlsx')
    const result = await prepareOfficeDocument({ filePath: file })
    expect(result.ok).toBe(false)
  })

  it('honours cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await prepareOfficeDocument({ filePath: xlsx(), signal: controller.signal })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('cancelled')
  })
})

describe('capability description', () => {
  it('explains what can be done locally without doing it', () => {
    const described = describeOfficeCapability(docx())
    expect(described.kind).toBe('word')
    expect(described.container).toBe('ooxml')
    expect(described.localText).toBe(true)
  })

  it('says plainly when a file is legacy or protected', () => {
    const described = describeOfficeCapability(writeRaw(CFB, 'protected.docx'))
    expect(described.container).toBe('ole')
    expect(described.localText).toBe(false)
    expect(described.reason).toContain('legacy binary')
  })
})
