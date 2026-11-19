import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  cleanupConversionDir,
  convertToPdf,
  locateOfficeConverter,
  sweepStaleConversionDirs,
  validatePdf
} from './officeConvert'

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-conv-test-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const VALID_PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\ntrailer\n<< /Root 2 0 R >>\n%%EOF\n',
  'latin1'
)

/**
 * A stand-in for soffice that behaves like the real thing: it reads --outdir and the last
 * argument (the input), then writes <basename>.pdf there.
 */
function fakeSoffice(
  dir: string,
  options: { write?: 'valid' | 'empty' | 'not-a-pdf' | 'nothing'; exitCode?: number; hang?: boolean } = {}
): string {
  const mode = options.write ?? 'valid'
  const file = path.join(dir, 'soffice')
  const script = `#!/bin/sh
${options.hang ? 'sleep 30\n' : ''}
outdir=""
prev=""
input=""
for a in "$@"; do
  if [ "$prev" = "--outdir" ]; then outdir="$a"; fi
  prev="$a"
  input="$a"
done
base=$(basename "$input")
base=\${base%.*}
${
  mode === 'valid'
    ? `printf '%s' '${VALID_PDF.toString('latin1').replace(/'/g, "'\\''")}' > "$outdir/$base.pdf"`
    : mode === 'empty'
      ? ': > "$outdir/$base.pdf"'
      : mode === 'not-a-pdf'
        ? `printf 'not a pdf at all' > "$outdir/$base.pdf"`
        : `:`
}
exit ${options.exitCode ?? 0}
`
  fs.writeFileSync(file, script, { mode: 0o755 })
  return file
}

function docxFile(): string {
  const dir = tempDir()
  const file = path.join(dir, 'report.docx')
  fs.writeFileSync(file, 'pretend docx bytes')
  return file
}

describe('converter discovery', () => {
  it('prefers an explicit env override and reports the source', () => {
    const dir = tempDir()
    const bin = path.join(dir, 'soffice')
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    expect(locateOfficeConverter({ NEXUS_SOFFICE_PATH: bin } as NodeJS.ProcessEnv)).toEqual({
      soffice: bin,
      source: 'env'
    })
  })

  it('reports none when nothing is installed', () => {
    const dir = tempDir()
    const found = locateOfficeConverter(
      { NEXUS_SOFFICE_PATH: path.join(dir, 'missing'), PATH: dir } as NodeJS.ProcessEnv,
      { appRoot: path.join(dir, 'app') }
    )
    expect(found.source).toBe('none')
    expect(found.soffice).toBeUndefined()
  })

  it('finds a bundled converter', () => {
    const dir = tempDir()
    const bundled = path.join(dir, 'app', 'vendor', 'libreoffice', 'program')
    fs.mkdirSync(bundled, { recursive: true })
    const bin = path.join(bundled, 'soffice')
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    const found = locateOfficeConverter({ PATH: '' } as NodeJS.ProcessEnv, { appRoot: path.join(dir, 'app') })
    expect(found.source).toBe('bundled')
    expect(found.soffice).toBe(bin)
  })
})

describe('PDF validation', () => {
  it('accepts a real PDF and counts page objects', () => {
    const dir = tempDir()
    const file = path.join(dir, 'ok.pdf')
    fs.writeFileSync(file, VALID_PDF)
    const result = validatePdf(file)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pageCount).toBe(1)
  })

  it('rejects an empty file', () => {
    const dir = tempDir()
    const file = path.join(dir, 'empty.pdf')
    fs.writeFileSync(file, '')
    expect(validatePdf(file).ok).toBe(false)
  })

  it('rejects a renamed Office file pretending to be a PDF', () => {
    const dir = tempDir()
    const file = path.join(dir, 'renamed.pdf')
    fs.writeFileSync(file, 'PK\x03\x04 not really a pdf')
    const result = validatePdf(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('%PDF-')
  })

  it('rejects a truncated PDF with no trailer', () => {
    const dir = tempDir()
    const file = path.join(dir, 'truncated.pdf')
    fs.writeFileSync(file, '%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n')
    const result = validatePdf(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('truncated')
  })

  it('rejects a PDF with no page objects', () => {
    const dir = tempDir()
    const file = path.join(dir, 'nopages.pdf')
    fs.writeFileSync(file, '%PDF-1.7\n%%EOF\n')
    const result = validatePdf(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('no page objects')
  })
})

describe('conversion', () => {
  it('converts with an isolated profile and validates the PDF', async () => {
    const dir = tempDir()
    const converter = fakeSoffice(dir)
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: converter
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    tempDirs.push(result.jobDir)
    expect(fs.existsSync(result.pdfPath)).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.pageCount).toBe(1)
    // Never claims visual equivalence.
    expect(result.warnings.join(' ')).toContain('Fonts substituted on this machine')
    // Isolated profile existed during the run.
    expect(fs.existsSync(path.join(result.jobDir, 'profile'))).toBe(true)
  })

  it('passes -env:UserInstallation so the user profile is untouched', async () => {
    const dir = tempDir()
    // A converter that records its arguments instead of converting.
    const recorder = path.join(dir, 'soffice')
    const argFile = path.join(dir, 'args.txt')
    fs.writeFileSync(
      recorder,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${argFile}"\nexit 0\n`,
      { mode: 0o755 }
    )
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: recorder
    })
    // No PDF produced → honest failure, but we can still inspect the arguments.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('convert-failed')
    const args = fs.readFileSync(argFile, 'utf8')
    expect(args).toContain('-env:UserInstallation=file://')
    expect(args).toContain('--headless')
    expect(args).toContain('--convert-to')
    expect(args).not.toContain('--invisible-open') // never opens a document interactively
  })

  it('fails honestly when the converter is missing', async () => {
    const dir = tempDir()
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: path.join(dir, 'nope')
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('converter-missing')
  })

  it('fails when the converter exits 0 but writes nothing', async () => {
    const dir = tempDir()
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: fakeSoffice(dir, { write: 'nothing' })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('convert-failed')
  })

  it('rejects an empty or non-PDF output even when the exit code is 0', async () => {
    const dir = tempDir()
    const empty = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: fakeSoffice(dir, { write: 'empty' })
    })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('invalid-output')

    const notPdf = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: fakeSoffice(dir, { write: 'not-a-pdf' })
    })
    expect(notPdf.ok).toBe(false)
    if (!notPdf.ok) expect(notPdf.reason).toBe('invalid-output')
  })

  it('kills a hanging converter and reports a timeout', async () => {
    const dir = tempDir()
    const started = Date.now()
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: fakeSoffice(dir, { hang: true }),
      timeoutMs: 400
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('honours cancellation', async () => {
    const dir = tempDir()
    const controller = new AbortController()
    controller.abort()
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'word',
      converterPath: fakeSoffice(dir),
      signal: controller.signal
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('cancelled')
  })

  it('warns that hidden-slide exclusion in a PDF cannot be guaranteed', async () => {
    const dir = tempDir()
    const result = await convertToPdf({
      inputPath: docxFile(),
      expectedKind: 'presentation',
      converterPath: fakeSoffice(dir)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    tempDirs.push(result.jobDir)
    expect(result.warnings.join(' ')).toContain('Hidden slides are excluded from this PDF only if')
  })
})

describe('workspace cleanup', () => {
  it('removes a conversion workspace and is safe to repeat', () => {
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-office-'))
    fs.writeFileSync(path.join(jobDir, 'x.pdf'), 'x')
    cleanupConversionDir(jobDir)
    expect(fs.existsSync(jobDir)).toBe(false)
    expect(() => cleanupConversionDir(jobDir)).not.toThrow()
    expect(() => cleanupConversionDir(undefined)).not.toThrow()
  })

  it('sweeps stale workspaces but keeps fresh ones', () => {
    const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-office-'))
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-office-'))
    tempDirs.push(fresh)
    const old = Date.now() - 48 * 60 * 60 * 1000
    fs.utimesSync(stale, old / 1000, old / 1000)
    const removed = sweepStaleConversionDirs()
    expect(removed).toContain(stale)
    expect(fs.existsSync(fresh)).toBe(true)
  })

  it('never modifies the source document', async () => {
    const dir = tempDir()
    const input = path.join(dir, 'keep.docx')
    fs.writeFileSync(input, 'original bytes')
    const result = await convertToPdf({
      inputPath: input,
      expectedKind: 'word',
      converterPath: fakeSoffice(dir)
    })
    if (result.ok) tempDirs.push(result.jobDir)
    expect(fs.readFileSync(input, 'utf8')).toBe('original bytes')
  })
})
