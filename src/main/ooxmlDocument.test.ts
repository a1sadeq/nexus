import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  buildPresentationParts,
  buildWordParts,
  readPresentation,
  readWordDocument,
  resolvePartPath,
  wordParagraphText
} from './ooxmlDocument'
import { buildZip } from './testZipBuilder'

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ooxml-test-'))
  tempDirs.push(dir)
  return dir
}
const write = (entries: Parameters<typeof buildZip>[0], name: string): string => {
  const dir = tempDir()
  const file = path.join(dir, name)
  fs.writeFileSync(file, buildZip(entries))
  return file
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const DOCUMENT_XML = `<?xml version="1.0"?>
<w:document>
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Revenue grew </w:t></w:r><w:r><w:t>12%</w:t></w:r><w:r><w:tab/><w:t>see table</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>
    <w:p><w:r><w:t>Arabic: </w:t></w:r><w:r><w:t>الإجمالي ٤٢</w:t></w:r></w:p>
    <w:p><w:r><w:delText>deleted revision</w:delText></w:r><w:r><w:t>kept text</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Egypt</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`

const COMMENTS_XML = `<?xml version="1.0"?>
<w:comments><w:comment w:id="1" w:author="Sara"><w:p><w:r><w:t>Double-check this figure</w:t></w:r></w:p></w:comment></w:comments>`

const HEADER_XML = `<w:hdr><w:p><w:r><w:t>Confidential — internal</w:t></w:r></w:p></w:hdr>`

function docx(extra: Parameters<typeof buildZip>[0] = []): string {
  return write(
    [
      { name: 'word/document.xml', content: DOCUMENT_XML },
      { name: 'word/comments.xml', content: COMMENTS_XML },
      { name: 'word/header1.xml', content: HEADER_XML },
      { name: 'word/media/image1.png', content: 'PNG' },
      { name: 'word/styles.xml', content: '<w:styles/>' },
      ...extra
    ],
    'report.docx'
  )
}

const PRESENTATION_XML = `<?xml version="1.0"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
    <p:sldId id="258" r:id="rId4"/>
  </p:sldIdLst>
</p:presentation>`

const PRESENTATION_RELS = `<Relationships>
  <Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="slide" Target="slides/slide3.xml"/>
</Relationships>`

const slide = (title: string, body: string, hidden = false): string => `<?xml version="1.0"?>
<p:sld${hidden ? ' show="0"' : ''}>
  <p:cSld>
    <p:spTree>
      <p:sp><p:spPr/><p:ph type="title"/><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p><a:p><a:r><a:t>second line</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`

const NOTES = `<?xml version="1.0"?>
<p:notes><p:cSld><p:spTree>
  <p:sp><p:spPr/><p:ph type="sldNum"/><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:txBody><a:p><a:r><a:t>Remember to mention the discount.</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`

function pptx(): string {
  return write(
    [
      { name: 'ppt/presentation.xml', content: PRESENTATION_XML },
      { name: 'ppt/_rels/presentation.xml.rels', content: PRESENTATION_RELS },
      { name: 'ppt/slides/slide1.xml', content: slide('Intro', 'Welcome everyone') },
      { name: 'ppt/slides/slide2.xml', content: slide('Secret plans', 'Hidden content', true) },
      { name: 'ppt/slides/slide3.xml', content: slide('Numbers', 'Revenue is up') },
      {
        name: 'ppt/slides/_rels/slide3.xml.rels',
        content: '<Relationships><Relationship Id="rId9" Type="notesSlide" Target="../notesSlides/notesSlide3.xml"/></Relationships>'
      },
      { name: 'ppt/notesSlides/notesSlide3.xml', content: NOTES },
      { name: 'ppt/media/image1.png', content: 'PNG' },
      { name: 'ppt/charts/chart1.xml', content: '<chart/>' }
    ],
    'deck.pptx'
  )
}

describe('Word extraction', () => {
  it('keeps document order, headings, lists and tab separators', () => {
    const result = readWordDocument(docx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = result.sections[0]
    expect(body.label).toBe('Document body')
    expect(body.blocks[0]).toMatchObject({ kind: 'heading', text: 'Quarterly report', level: 1 })
    expect(body.blocks[1].text).toBe('Revenue grew 12%\tsee table')
    expect(body.blocks[2]).toMatchObject({ kind: 'list', text: 'First bullet' })
    expect(body.blocks.find((block) => block.text.includes('الإجمالي'))?.text).toContain('٤٢')
  })

  it('excludes deleted revision text and warns about tracked changes', () => {
    const result = readWordDocument(docx())
    if (!result.ok) return
    const text = result.sections.flatMap((section) => section.blocks.map((block) => block.text)).join(' ')
    expect(text).not.toContain('deleted revision')
    expect(text).toContain('kept text')
    expect(result.inventory.hasTrackedChanges).toBe(true)
    expect(result.warnings.join(' ')).toContain('tracked changes')
  })

  it('represents tables as labelled rows', () => {
    const result = readWordDocument(docx())
    if (!result.ok) return
    const rows = result.sections[0].blocks.filter((block) => block.kind === 'table-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ text: 'Region | Sales', source: 'table 1, row 1' })
    expect(rows[1].text).toBe('Egypt | 120')
    expect(result.inventory.tables).toBe(1)
  })

  it('separates headers and comments from the body, and warns about them', () => {
    const result = readWordDocument(docx())
    if (!result.ok) return
    const labels = result.sections.map((section) => section.label)
    expect(labels).toEqual(['Document body', 'Headers and footers', 'Comments'])
    expect(result.sections[2].blocks[0].text).toBe('Sara: Double-check this figure')
    const warnings = result.warnings.join(' ')
    expect(warnings).toContain('1 comment(s) are included as a separate section')
    expect(warnings).toContain('1 image(s)')
    expect(warnings).toContain('Layout, fonts')
  })

  it('refuses an archive that is not a Word document', () => {
    const file = write([{ name: 'xl/workbook.xml', content: '<workbook/>' }], 'notword.docx')
    const result = readWordDocument(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-word-document')
  })

  it('refuses a non-zip file and a missing file', () => {
    const dir = tempDir()
    const fake = path.join(dir, 'fake.docx')
    fs.writeFileSync(fake, 'plain text, not a docx')
    const notZip = readWordDocument(fake)
    expect(notZip.ok).toBe(false)
    if (!notZip.ok) expect(notZip.reason).toBe('not-a-zip')

    const missing = readWordDocument('/definitely/not/here.docx')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe('read-failed')
  })

  it('builds labelled text parts and an honest manifest', () => {
    const result = readWordDocument(docx())
    if (!result.ok) return
    const { parts, manifest } = buildWordParts(result.sections, result.inventory)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts[0].content).toContain('# Quarterly report')
    expect(manifest).toContain('Word document export')
    expect(manifest).toContain('untrusted content')
    expect(manifest).toContain('Layout, fonts')
  })

  it('splits long sections at block boundaries', () => {
    const result = readWordDocument(docx())
    if (!result.ok) return
    const { parts } = buildWordParts(result.sections, result.inventory, { maxCharsPerPart: 40 })
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.some((part) => part.label.includes('part 2'))).toBe(true)
  })

  it('extracts paragraph text with entities decoded', () => {
    expect(wordParagraphText('<w:p><w:r><w:t>a &amp; b &lt;c&gt;</w:t></w:r></w:p>')).toBe('a & b <c>')
  })
})

describe('PowerPoint extraction', () => {
  it('follows slide order from sldIdLst, not file numbering', () => {
    const result = readPresentation(pptx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slides.map((entry) => entry.title)).toEqual(['Intro', 'Secret plans', 'Numbers'])
    expect(result.slides.map((entry) => entry.number)).toEqual([1, 2, 3])
  })

  it('detects hidden slides before anything is prepared', () => {
    const result = readPresentation(pptx())
    if (!result.ok) return
    expect(result.slides[1].hidden).toBe(true)
    expect(result.slides[0].hidden).toBe(false)
    expect(result.inventory.hiddenSlides).toBe(1)
    expect(result.warnings.join(' ')).toContain('#2')
  })

  it('detects speaker notes and excludes the slide-number placeholder', () => {
    const result = readPresentation(pptx())
    if (!result.ok) return
    expect(result.inventory.slidesWithNotes).toBe(1)
    const notes = result.slides[2].notes
    expect(notes).toEqual(['Remember to mention the discount.'])
    expect(notes.join(' ')).not.toMatch(/^\s*7\s*$/)
    expect(result.warnings.join(' ')).toContain('speaker notes')
  })

  it('inventories media, charts and macros without claiming to represent them', () => {
    const result = readPresentation(pptx())
    if (!result.ok) return
    expect(result.inventory.embeddedMedia).toBe(1)
    expect(result.inventory.charts).toBe(1)
    const warnings = result.warnings.join(' ')
    expect(warnings).toContain('chart(s) are not described')
    expect(warnings).toContain('Animations, transitions')
  })

  it('excludes hidden slides and notes by default, and includes them only when approved', () => {
    const result = readPresentation(pptx())
    if (!result.ok) return

    const conservative = buildPresentationParts(result.slides, result.inventory)
    const conservativeText = conservative.parts.map((part) => part.content).join('\n')
    expect(conservativeText).not.toContain('Hidden content')
    expect(conservativeText).not.toContain('Remember to mention the discount')
    expect(conservative.manifest).toContain('Hidden slides included: no')
    expect(conservative.manifest).toContain('Speaker notes included: no')

    const everything = buildPresentationParts(result.slides, result.inventory, {
      includeNotes: true,
      includeHidden: true
    })
    const fullText = everything.parts.map((part) => part.content).join('\n')
    expect(fullText).toContain('Hidden content')
    expect(fullText).toContain('## Slide 2 [hidden]')
    expect(fullText).toContain('Notes: Remember to mention the discount.')
    expect(everything.manifest).toContain('Hidden slides included: yes (per your approval)')
  })

  it('refuses an archive that is not a presentation', () => {
    const file = write([{ name: 'word/document.xml', content: '<w:document/>' }], 'notdeck.pptx')
    const result = readPresentation(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-a-presentation')
  })

  it('reports a corrupted presentation instead of throwing', () => {
    const dir = tempDir()
    const file = path.join(dir, 'broken.pptx')
    fs.writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))
    const result = readPresentation(file)
    expect(result.ok).toBe(false)
  })
})

describe('part path resolution', () => {
  it('resolves relative, parent-relative and absolute targets', () => {
    expect(resolvePartPath('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
    expect(resolvePartPath('ppt/slides', '../notesSlides/notesSlide3.xml')).toBe(
      'ppt/notesSlides/notesSlide3.xml'
    )
    expect(resolvePartPath('ppt', '/ppt/slides/slide2.xml')).toBe('ppt/slides/slide2.xml')
  })

  it('collapses traversal at the archive root', () => {
    expect(resolvePartPath('ppt', '../../../../etc/passwd')).toBe('etc/passwd')
  })
})
