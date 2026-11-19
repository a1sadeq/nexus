import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Office → PDF conversion via a *locally installed* LibreOffice (plan 02).
 *
 * Plan 02's rules this module implements:
 *  - local only, no external conversion service;
 *  - an isolated temporary LibreOffice profile per job, so the user's own profile is never
 *    touched and two jobs cannot collide;
 *  - shell-free argument arrays, `-env:UserInstallation` pinned to the job directory;
 *  - bounded time, and the process tree is killed on timeout or cancellation;
 *  - macros are not executed (the headless converter never runs them) and no document is
 *    ever opened interactively;
 *  - the output must be a **real, validated PDF**: correct header, trailer, non-zero size and
 *    at least one page object. A converter that exits 0 but writes nothing useful is a
 *    failure, not a "successful conversion".
 *
 * What this module deliberately does NOT claim: that the PDF looks like the original. Font
 * substitution, RTL shaping and complex layout can change; the caller must preview it and say
 * so. That is why `warnings` exists and why nothing here compares page counts.
 */

export interface ConverterPaths {
  soffice?: string
  /** Where it was found, for the honesty line in the UI. */
  source?: 'env' | 'path' | 'bundled' | 'none'
}

const BINARIES = process.platform === 'win32' ? ['soffice.exe', 'soffice.com'] : ['soffice', 'libreoffice']

function isExecutable(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function locateOfficeConverter(
  env: NodeJS.ProcessEnv = process.env,
  options: { appRoot?: string } = {}
): ConverterPaths {
  const override = env.NEXUS_SOFFICE_PATH
  if (override && isExecutable(override)) return { soffice: override, source: 'env' }

  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  for (const binary of BINARIES) {
    for (const dir of dirs) {
      const full = path.join(dir, binary)
      if (isExecutable(full)) return { soffice: full, source: 'path' }
    }
  }

  // Common install locations, because GUI installs often are not on PATH.
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
        ]
      : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice']
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return { soffice: candidate, source: 'path' }
  }

  if (options.appRoot) {
    for (const bundled of [
      path.join(options.appRoot, 'vendor', 'libreoffice', 'program', 'soffice'),
      path.join(options.appRoot, 'resources', 'libreoffice', 'program', 'soffice')
    ]) {
      if (isExecutable(bundled)) return { soffice: bundled, source: 'bundled' }
    }
  }

  return { source: 'none' }
}

export type ConvertFailureReason =
  | 'converter-missing'
  | 'unsupported-format'
  | 'timeout'
  | 'cancelled'
  | 'convert-failed'
  | 'invalid-output'

export type ConvertResult =
  | {
      ok: true
      pdfPath: string
      jobDir: string
      bytes: number
      /** Approximate: counted page objects, not a rendered page count. */
      pageCount: number
      /** Non-empty when the environment may produce a visually different result. */
      warnings: string[]
    }
  | { ok: false; reason: ConvertFailureReason; message: string; jobDir?: string }

export interface ConvertOptions {
  inputPath: string
  /** Only Word/PowerPoint make sense here; Excel must use the data export instead. */
  expectedKind: 'word' | 'presentation'
  converterPath?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Where to put the profile and output. A fresh dir is created when omitted. */
  jobDir?: string
  onJobCreated?: (jobDir: string) => void
}

const DEFAULT_TIMEOUT_MS = 180_000

interface RunOutcome {
  code: number | null
  stderr: string
  timedOut: boolean
  aborted: boolean
}

function runConverter(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
    } catch (error) {
      resolve({ code: null, stderr: (error as Error).message, timedOut: false, aborted: false })
      return
    }

    const stderrChunks: Buffer[] = []
    let settled = false
    let timedOut = false
    let aborted = false
    let fallback: NodeJS.Timeout | undefined

    const killTree = (): void => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL')
          return
        }
      } catch {
        /* already gone */
      }
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (fallback) clearTimeout(fallback)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        code,
        stderr: Buffer.concat(stderrChunks).toString('utf8').slice(0, 4000),
        timedOut,
        aborted
      })
    }

    const onAbort = (): void => {
      aborted = true
      killTree()
      fallback = setTimeout(() => finish(null), 500)
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      fallback = setTimeout(() => finish(null), 500)
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    // Bound the pipes: a babbling converter must not fill memory.
    child.stderr?.on('data', (buf: Buffer) => {
      if (stderrChunks.length < 64) stderrChunks.push(buf)
    })
    child.stdout?.on('data', () => undefined)
    child.on('error', () => finish(null))
    child.on('close', (code: number | null) => finish(code))
  })
}

/**
 * Validate that a file is a plausible PDF rather than a renamed Office document.
 * Deliberately conservative: this is a sanity check, not a full parse.
 */
export function validatePdf(filePath: string): { ok: true; pageCount: number; bytes: number } | { ok: false; message: string } {
  let data: Buffer
  try {
    data = fs.readFileSync(filePath)
  } catch {
    return { ok: false, message: 'The converter reported success but produced no file.' }
  }
  if (data.length === 0) return { ok: false, message: 'The converter produced an empty file.' }
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, message: 'The output is not a PDF (missing the %PDF- header).' }
  }
  const tail = data.subarray(Math.max(0, data.length - 2048)).toString('latin1')
  if (!tail.includes('%%EOF')) {
    return { ok: false, message: 'The PDF is truncated (no %%EOF trailer).' }
  }
  // Page objects look like "/Type /Page" (not "/Pages"). Approximate by design.
  const text = data.toString('latin1')
  const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  if (pageCount === 0) {
    return { ok: false, message: 'The PDF contains no page objects, so it is not a usable document.' }
  }
  return { ok: true, pageCount, bytes: data.length }
}

export async function convertToPdf(options: ConvertOptions): Promise<ConvertResult> {
  const converterPath = options.converterPath ?? locateOfficeConverter().soffice
  if (!converterPath || !isExecutable(converterPath)) {
    return {
      ok: false,
      reason: 'converter-missing',
      message:
        'LibreOffice (soffice) is not installed or not on PATH, so Nexus cannot produce a PDF locally. Set NEXUS_SOFFICE_PATH to a soffice binary, or use the extracted text instead.'
    }
  }
  if (!fs.existsSync(options.inputPath)) {
    return { ok: false, reason: 'convert-failed', message: 'The source document no longer exists.' }
  }

  const jobDir = options.jobDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-office-'))
  try {
    fs.mkdirSync(jobDir, { recursive: true })
    fs.chmodSync(jobDir, 0o700)
  } catch {
    /* best effort on platforms without POSIX modes */
  }
  if (!options.jobDir) options.onJobCreated?.(jobDir)

  const profileDir = path.join(jobDir, 'profile')
  const outDir = path.join(jobDir, 'out')
  const warnings: string[] = []
  try {
    fs.mkdirSync(profileDir, { recursive: true })
    fs.mkdirSync(outDir, { recursive: true })
  } catch (error) {
    return {
      ok: false,
      reason: 'convert-failed',
      message: `Could not create the converter workspace: ${(error as Error).message}`,
      jobDir
    }
  }

  const args = [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    '--nologo',
    '--nofirststartwizard',
    // Isolated profile: never touches the user's LibreOffice configuration.
    `-env:UserInstallation=file://${profileDir.split(path.sep).join('/')}`,
    '--convert-to',
    'pdf:writer_pdf_Export',
    '--outdir',
    outDir,
    options.inputPath
  ]

  const outcome = await runConverter(
    converterPath,
    args,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.signal
  )

  if (outcome.aborted) {
    return { ok: false, reason: 'cancelled', message: 'Conversion cancelled.', jobDir }
  }
  if (outcome.timedOut) {
    return {
      ok: false,
      reason: 'timeout',
      message: 'Converting this document took too long and was stopped. The file may be very large or damaged.',
      jobDir
    }
  }

  const expectedPdf = path.join(
    outDir,
    `${path.basename(options.inputPath, path.extname(options.inputPath))}.pdf`
  )
  const produced = fs.existsSync(expectedPdf)
    ? expectedPdf
    : (() => {
        const candidates = fs
          .readdirSync(outDir)
          .filter((name) => name.toLowerCase().endsWith('.pdf'))
          .map((name) => path.join(outDir, name))
        return candidates[0] ?? null
      })()

  if (!produced) {
    const detail = outcome.stderr.trim()
    return {
      ok: false,
      reason: 'convert-failed',
      message: `LibreOffice exited with code ${outcome.code} and produced no PDF.${detail ? ` Converter said: ${detail}` : ''}`,
      jobDir
    }
  }

  const validated = validatePdf(produced)
  if (!validated.ok) {
    return { ok: false, reason: 'invalid-output', message: validated.message, jobDir }
  }

  warnings.push(
    'The PDF was produced by LibreOffice, not by the application that authored the file. Fonts substituted on this machine, RTL shaping, text boxes, animations and embedded media can change how it looks.'
  )
  if (outcome.code !== 0) {
    warnings.push(`The converter reported exit code ${outcome.code}; the PDF was still readable and was validated.`)
  }
  if (options.expectedKind === 'presentation') {
    warnings.push(
      'Hidden slides are excluded from this PDF only if the converter honours the hidden flag; check the preview before sending.'
    )
  }

  return {
    ok: true,
    pdfPath: produced,
    jobDir,
    bytes: validated.bytes,
    pageCount: validated.pageCount,
    warnings
  }
}

/** Remove a conversion workspace. Never touches the source document. */
export function cleanupConversionDir(jobDir: string | undefined): void {
  if (!jobDir) return
  try {
    fs.rmSync(jobDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

/** Sweep abandoned workspaces from a crashed session. */
export function sweepStaleConversionDirs(
  maxAgeMs = 6 * 60 * 60 * 1000,
  now = Date.now()
): string[] {
  const removed: string[] = []
  let entries: string[] = []
  try {
    entries = fs.readdirSync(os.tmpdir())
  } catch {
    return removed
  }
  for (const entry of entries) {
    if (!entry.startsWith('nexus-office-')) continue
    const full = path.join(os.tmpdir(), entry)
    try {
      const stat = fs.statSync(full)
      if (!stat.isDirectory() || now - stat.mtimeMs < maxAgeMs) continue
      fs.rmSync(full, { recursive: true, force: true })
      removed.push(full)
    } catch {
      /* skip unreadable entries */
    }
  }
  return removed
}
