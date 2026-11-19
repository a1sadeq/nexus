import { dialog, type BrowserWindow, type WebContentsView } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type {
  FolderScanResult,
  ScannedFileInfo,
  BundlePreviewResult,
  BundleChunk,
  PartitionResult
} from '../shared/folderUpload'
import { annotateFileVariants } from '../shared/fileVariants'
import { decodeBundleText } from './uploadTextSafety'
import { partitionPreparedFiles } from './uploadPartition'
import {
  classifyUploadKind,
  classifyUploadKindWithSniff,
  isTextKind,
  requiresOriginalAttachment,
  type UploadFileKind
} from '../shared/uploadFileKind'
import {
  ATTACHMENT_PROBE_SCRIPT,
  attachCountWarning,
  buildPartFilePlan,
  createUploadTempDir,
  describeAttachOutcome,
  parseAttachmentProbeResult,
  scheduleUploadTempCleanup,
  writePartFile,
  type AttachOutcome
} from './uploadAttachAll'
import type { AttachAllResult, OriginalAttachment, SkippedDirectory } from '../shared/folderUpload'

const SUGGESTED_REMOVAL_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'flake.lock'
])

const SUGGESTED_REMOVAL_EXTENSIONS = new Set([
  '.map',
  '.min.js',
  '.min.css',
  '.log',
  '.tmp',
  '.bak',
  '.csv',
  '.sql',
  '.sqlite',
  '.sqlite3'
])

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  'vendor',
  'target',
  'bin',
  'obj',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.turbo',
  '.yarn',
  '.pnpm',
  '.parcel-cache',
  'coverage',
  '.idea',
  '.vscode'
])

/** Caps how many skipped directories we report, so a huge tree cannot blow up the UI. */
const MAX_SKIPPED_DIRS = 100

/**
 * Why a directory was not scanned. Plan 03: nothing is dropped silently — the folder
 * modal lists these with the reason, and says they were not read.
 */
const ignoredDirReason = (name: string): string => {
  if (name === '.git') return 'version control history — not scanned'
  if (name.startsWith('.')) return 'hidden/tooling directory — not scanned'
  return 'dependency or build output — not scanned'
}

const PRIORITY_DIR_NAMES = new Set([
  'src',
  'lib',
  'app',
  'packages',
  'components',
  'routes',
  'docs',
  'include',
  'crates',
  'server',
  'client',
  'ui'
])

// Binary routing now lives in src/shared/uploadFileKind.ts (plan 03).

const MAX_FOLDER_FILES = 2000
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB per file
const MAX_SCAN_BYTES = 200 * 1024 * 1024 // Stop folder work at 200MB total
const MAX_CHUNK_SIZE = 8 * 1024 * 1024 // 8MB per chunk
const MAX_ORIGINAL_FILES = 200 // attachment route, per scan
const MAX_ORIGINAL_FILE_SIZE = 100 * 1024 * 1024

const DIALOG_COOLDOWN_MS = 600
/** A picker that never settles must not wedge uploads for the rest of the session. */
const DIALOG_TIMEOUT_MS = 5 * 60 * 1000
/** Hard ceiling for a CDP dispatch; a hung injection used to leave the debugger attached. */
const INJECT_TIMEOUT_MS = 30 * 1000

let pickerOpenedAt = 0
let lastDialogTimestamp = 0

/**
 * Returns true when a picker has been "open" for longer than any real dialog could take.
 * Previously a native dialog whose promise never settled (mixed file+folder pickers are not
 * supported on Linux/Windows) left the boolean latch stuck at `true`, so every later upload
 * silently returned until the app was restarted.
 */
function pickerLockIsStale(now = Date.now()): boolean {
  return pickerOpenedAt > 0 && now - pickerOpenedAt > DIALOG_TIMEOUT_MS
}

function acquirePickerLock(): boolean {
  const now = Date.now()
  if (pickerLockIsStale(now)) {
    console.warn('Upload picker lock was stale; recovering without a restart.')
    pickerOpenedAt = 0
  }
  if (pickerOpenedAt > 0 || now - lastDialogTimestamp < DIALOG_COOLDOWN_MS) return false
  pickerOpenedAt = now
  lastDialogTimestamp = now
  return true
}

function releasePickerLock(): void {
  pickerOpenedAt = 0
  lastDialogTimestamp = Date.now()
}

/** True while a native picker is open (or believed to be open). */
export function isUploadPickerBusy(): boolean {
  if (pickerLockIsStale()) {
    pickerOpenedAt = 0
    return false
  }
  return pickerOpenedAt > 0
}

/** Escape hatch used by diagnostics and tests: clears the lock and the cooldown. */
export function releaseUploadPicker(): void {
  pickerOpenedAt = 0
  lastDialogTimestamp = 0
}

/** A picker cannot still be visible if the main window is focused and taking shortcuts. */
const PICKER_ABANDON_GRACE_MS = 2000

/**
 * Called when an upload shortcut fires. If the main window has keyboard focus, no visible modal
 * picker can be in front of it, so any claimed lock is abandoned (e.g. a GTK dialog that opened
 * behind the window and never returned). Without this the shared latch stays set and BOTH
 * Ctrl+O and Ctrl+Shift+O stay dead until the app is restarted.
 */
export function recoverAbandonedPicker(mainWindow: unknown, now = Date.now()): boolean {
  const focused = Boolean(
    (mainWindow as { isFocused?: () => boolean } | null | undefined)?.isFocused?.()
  )
  if (!focused || pickerOpenedAt === 0) return false
  if (now - pickerOpenedAt < PICKER_ABANDON_GRACE_MS) return false
  console.warn('Upload picker was abandoned while the window had focus; recovering.')
  pickerOpenedAt = 0
  lastDialogTimestamp = 0
  return true
}

/** Native dialogs attached to a hidden/minimised parent can open invisibly on Linux. */
function ensureWindowInteractive(mainWindow: BrowserWindow): void {
  try {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  } catch {
    // Never let window housekeeping block an upload.
  }
}

/** Resolves/rejects with the promise, or rejects once `ms` elapses. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        if (typeof timer.unref === 'function') timer.unref()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Classifies a scanned file into suggested-removal categories.
 * Size alone never triggers automatic deselection — large user-authored
 * source files remain selected; only explicit noise/sensitive patterns do.
 */
export function classifyFileForUpload(
  name: string,
  ext: string
): { isSuggestedRemoval: boolean; removalReason?: string } {
  const lowerName = name.toLowerCase()

  // Sensitive secrets – always flag but UI decides default selection
  if (lowerName.startsWith('.env')) {
    return { isSuggestedRemoval: true, removalReason: 'Sensitive / Secrets file' }
  }

  // Obvious bloat / generated artifacts
  if (SUGGESTED_REMOVAL_FILENAMES.has(lowerName)) {
    return { isSuggestedRemoval: true, removalReason: 'Lockfile (large / redundant)' }
  }
  if (lowerName.endsWith('.min.js') || lowerName.endsWith('.min.css')) {
    return { isSuggestedRemoval: true, removalReason: 'Minified asset' }
  }
  if (lowerName.endsWith('.map')) {
    return { isSuggestedRemoval: true, removalReason: 'Source map' }
  }
  if (lowerName.endsWith('.log')) {
    return { isSuggestedRemoval: true, removalReason: 'Log file' }
  }
  if (SUGGESTED_REMOVAL_EXTENSIONS.has(ext)) {
    return { isSuggestedRemoval: true, removalReason: 'Data dump / temporary' }
  }

  // Size is informational only – never auto-deselect large source files
  return { isSuggestedRemoval: false }
}

/**
 * Recursively scans a selected folder for text files with a 10,000 file ceiling,
 * prioritizing key source folders and pruning low-priority bloat when nearing capacity.
 */
export function scanFolder(folderPath: string): FolderScanResult {
  const files: ScannedFileInfo[] = []
  let totalBytes = 0
  let textBytes = 0
  let originalCount = 0
  let examinedBytes = 0
  const prunedDirs: string[] = []
  const skippedDirs: SkippedDirectory[] = []
  let isTruncated = false

  const crawl = (dir: string): void => {
    if (files.length >= MAX_FOLDER_FILES || totalBytes >= MAX_SCAN_BYTES) {
      isTruncated = true
      const rel = path.relative(folderPath, dir)
      if (rel && !prunedDirs.includes(rel)) {
        prunedDirs.push(rel)
      }
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    const subdirs: fs.Dirent[] = []
    const fileEntries: fs.Dirent[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          subdirs.push(entry)
        } else if (skippedDirs.length < MAX_SKIPPED_DIRS) {
          skippedDirs.push({
            relativePath: path.relative(folderPath, path.join(dir, entry.name)),
            reason: ignoredDirReason(entry.name)
          })
        }
      } else if (entry.isFile()) {
        fileEntries.push(entry)
      }
    }

    // Process files in current directory
    for (const entry of fileEntries) {
      if (files.length >= MAX_FOLDER_FILES || totalBytes >= MAX_SCAN_BYTES) {
        isTruncated = true
        break
      }
      const fullPath = path.join(dir, entry.name)
      const ext = path.extname(entry.name).toLowerCase()
      const declaredKind = classifyUploadKind(ext)
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) continue

      try {
        const stat = fs.statSync(fullPath)
        examinedBytes += stat.size
        if (examinedBytes > MAX_SCAN_BYTES + MAX_ORIGINAL_FILE_SIZE) {
          isTruncated = true
          break
        }

        // Attachments use their own budget: a folder of screenshots must not eat the
        // text budget and silently truncate the source files the user wanted.
        if (requiresOriginalAttachment(declaredKind)) {
          if (
            originalCount >= MAX_ORIGINAL_FILES ||
            stat.size > MAX_ORIGINAL_FILE_SIZE ||
            stat.size === 0
          ) {
            isTruncated = true
            continue
          }
          const classification = classifyFileForUpload(entry.name, ext)
          files.push({
            path: fullPath,
            relativePath: path.relative(folderPath, fullPath),
            size: stat.size,
            extension: ext || 'no-ext',
            kind: declaredKind,
            isSuggestedRemoval: classification.isSuggestedRemoval,
            removalReason: classification.removalReason
          })
          originalCount++
          totalBytes += stat.size
          continue
        }

        if (stat.size > MAX_FILE_SIZE || textBytes + stat.size > MAX_SCAN_BYTES) {
          if (textBytes + stat.size > MAX_SCAN_BYTES) isTruncated = true
          continue
        }

        // Check first 1024 bytes for null byte (binary file indicator for unknown types)
        const fd = fs.openSync(fullPath, 'r')
        const buffer = Buffer.alloc(1024)
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0)
        fs.closeSync(fd)
        const kind = classifyUploadKindWithSniff(ext, buffer.indexOf(0) !== -1 && buffer.indexOf(0) < bytesRead)

        const relativePath = path.relative(folderPath, fullPath)
        const classification = classifyFileForUpload(entry.name, ext)

        files.push({
          path: fullPath,
          relativePath,
          size: stat.size,
          extension: ext || 'no-ext',
          kind,
          isSuggestedRemoval: classification.isSuggestedRemoval,
          removalReason: classification.removalReason
        })
        if (isTextKind(kind)) textBytes += stat.size
        else originalCount++
        totalBytes += stat.size
      } catch {
        // Ignore unreadable files
      }
    }

    // Sort subdirectories: priority directories first, then alphabetical
    subdirs.sort((a, b) => {
      const aPriority = PRIORITY_DIR_NAMES.has(a.name.toLowerCase()) ? 0 : 1
      const bPriority = PRIORITY_DIR_NAMES.has(b.name.toLowerCase()) ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.name.localeCompare(b.name)
    })

    for (const subdir of subdirs) {
      if (files.length >= MAX_FOLDER_FILES || totalBytes >= MAX_SCAN_BYTES) {
        isTruncated = true
        const rel = path.relative(folderPath, path.join(dir, subdir.name))
        if (rel && !prunedDirs.includes(rel)) {
          prunedDirs.push(rel)
        }
      } else {
        crawl(path.join(dir, subdir.name))
      }
    }
  }

  crawl(folderPath)

  // Annotate likely duplicate variants so the UI can surface them to the user.
  annotateFileVariants(files as any[])

  return {
    folderPath,
    folderName: path.basename(folderPath),
    totalFiles: files.length,
    totalBytes,
    files,
    prunedDirs: prunedDirs.length > 0 ? prunedDirs : undefined,
    skippedDirs: skippedDirs.length > 0 ? skippedDirs : undefined,
    isTruncated: isTruncated || undefined
  }
}

/**
 * Handles folder selection, scans files with suggested removals,
 * and notifies the renderer to display the interactive filter modal.
 */
export async function handleFolderUpload(
  view: WebContentsView,
  mainWindow: BrowserWindow
): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || !view || view.webContents.isDestroyed()) {
    return
  }

  ensureWindowInteractive(mainWindow)
  if (!acquirePickerLock()) return

  try {
    const { canceled, filePaths } = await withTimeout(
      dialog.showOpenDialog(mainWindow, {
        title: 'Select Folder to Upload',
        properties: ['openDirectory']
      }),
      DIALOG_TIMEOUT_MS,
      'Folder picker'
    )

    if (canceled || filePaths.length === 0) return

    const folderPath = filePaths[0]
    const scanResult = await scanFolderAsync(folderPath)

    if (scanResult.totalFiles === 0) {
      showNexusToast(view, 'No readable text files found in folder.')
      return
    }

    if (scanResult.isTruncated)
      showNexusToast(
        view,
        'Folder exceeds the 200 MB / 2,000-file safety limit. Only the initial budget was loaded.'
      )
    // Send scanned folder data to renderer to show sleek modern filter popup
    mainWindow.webContents.send('show_folder_upload_modal', scanResult)
  } catch (err) {
    console.error('Folder upload scan failed:', err)
    safeDetachDebugger(view)
  } finally {
    releasePickerLock()
  }
}

const yieldToMain = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Non-blocking production scanner. The synchronous export remains for compatibility/tests. */
export async function scanFolderAsync(folderPath: string): Promise<FolderScanResult> {
  const files: ScannedFileInfo[] = []
  const prunedDirs: string[] = []
  const skippedDirs: SkippedDirectory[] = []
  let totalBytes = 0
  let textBytes = 0
  let originalCount = 0
  let examinedBytes = 0
  let isTruncated = false
  let operations = 0
  const queue: string[] = [folderPath]
  while (queue.length && files.length < MAX_FOLDER_FILES && totalBytes < MAX_SCAN_BYTES) {
    const dir = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        if (skippedDirs.length < MAX_SKIPPED_DIRS) {
          skippedDirs.push({
            relativePath: path.relative(folderPath, path.join(dir, entry.name)),
            reason: ignoredDirReason(entry.name)
          })
        }
      }
    }
    const subdirs = entries
      .filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
      .sort(
        (a, b) =>
          Number(PRIORITY_DIR_NAMES.has(b.name.toLowerCase())) -
            Number(PRIORITY_DIR_NAMES.has(a.name.toLowerCase())) || a.name.localeCompare(b.name)
      )
    queue.push(...subdirs.map((e) => path.join(dir, e.name)))
    for (const entry of entries) {
      if (files.length >= MAX_FOLDER_FILES || totalBytes >= MAX_SCAN_BYTES) {
        isTruncated = true
        break
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) continue
      const declaredKind = classifyUploadKind(ext)
      const fullPath = path.join(dir, entry.name)
      try {
        const stat = await fs.promises.stat(fullPath)
        examinedBytes += stat.size
        if (examinedBytes > MAX_SCAN_BYTES + MAX_ORIGINAL_FILE_SIZE) {
          isTruncated = true
          break
        }

        // Binary kinds go down the attachment route with their own budget.
        if (requiresOriginalAttachment(declaredKind)) {
          if (
            originalCount >= MAX_ORIGINAL_FILES ||
            stat.size > MAX_ORIGINAL_FILE_SIZE ||
            stat.size === 0
          ) {
            isTruncated = true
            continue
          }
          const classification = classifyFileForUpload(entry.name, ext)
          files.push({
            path: fullPath,
            relativePath: path.relative(folderPath, fullPath),
            size: stat.size,
            extension: ext || 'no-ext',
            kind: declaredKind,
            isSuggestedRemoval: classification.isSuggestedRemoval,
            removalReason: classification.removalReason
          })
          originalCount++
          totalBytes += stat.size
          continue
        }

        if (stat.size > MAX_FILE_SIZE || textBytes + stat.size > MAX_SCAN_BYTES) {
          if (textBytes + stat.size > MAX_SCAN_BYTES) isTruncated = true
          continue
        }
        const handle = await fs.promises.open(fullPath, 'r')
        const buffer = Buffer.allocUnsafe(1024)
        const { bytesRead } = await handle.read(buffer, 0, 1024, 0)
        await handle.close()
        const kind = classifyUploadKindWithSniff(
          ext,
          buffer.subarray(0, bytesRead).includes(0)
        )
        const classification = classifyFileForUpload(entry.name, ext)
        files.push({
          path: fullPath,
          relativePath: path.relative(folderPath, fullPath),
          size: stat.size,
          extension: ext || 'no-ext',
          kind,
          isSuggestedRemoval: classification.isSuggestedRemoval,
          removalReason: classification.removalReason
        })
        if (isTextKind(kind)) textBytes += stat.size
        else originalCount++
        totalBytes += stat.size
      } catch {
        /* Ignore disappearing/unreadable entries. */
      }
      if (++operations % 40 === 0) await yieldToMain()
    }
  }
  if (queue.length) {
    isTruncated = true
    prunedDirs.push(
      ...queue
        .slice(0, 100)
        .map((d) => path.relative(folderPath, d))
        .filter(Boolean)
    )
  }
  annotateFileVariants(files as any[])
  return {
    folderPath,
    folderName: path.basename(folderPath),
    totalFiles: files.length,
    totalBytes,
    files,
    prunedDirs: prunedDirs.length ? prunedDirs : undefined,
    skippedDirs: skippedDirs.length ? skippedDirs : undefined,
    isTruncated: isTruncated || undefined
  }
}

async function processFilesForUpload(filePaths: string[]): Promise<string[]> {
  const processed: string[] = []
  for (const originalPath of filePaths) {
    const ext = path.extname(originalPath).toLowerCase()
    // Text files are masqueraded to .txt when a provider rejects their extension; media,
    // documents and other binaries are attached as the original file.
    if (ext === '.txt' || requiresOriginalAttachment(classifyUploadKind(ext))) {
      processed.push(originalPath)
    } else {
      try {
        processed.push(createMasqueradedTextFile(originalPath))
      } catch (err) {
        // Re-throw so the caller surfaces the rejection instead of silently
        // passing a raw binary path through to CDP where it will fail opaque.
        throw new Error(
          `Cannot bundle ${path.basename(originalPath)}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    await yieldToMain()
  }
  return processed
}

/** Ctrl+O: every selected file and folder enters the same review flow as Ctrl+Shift+O. */
/**
 * Turns an arbitrary native selection (files and/or folders) into review-modal data.
 * Never throws: unreadable paths are skipped so one bad entry cannot abort the selection.
 */
export async function buildSelectionScanResult(selectedPaths: string[]): Promise<FolderScanResult> {
  const directFiles: string[] = []
  const folders: string[] = []
  for (const selected of selectedPaths) {
    try {
      ;(await fs.promises.stat(selected)).isDirectory()
        ? folders.push(selected)
        : directFiles.push(selected)
    } catch {}
  }

  const scans: FolderScanResult[] = []
  for (const folder of folders) {
    scans.push(await scanFolderAsync(folder))
    await yieldToMain()
  }

  const files = scans.flatMap((r) => r.files)
  for (const filePath of directFiles) {
    try {
      const stat = await fs.promises.stat(filePath)
      files.push({
        path: filePath,
        relativePath: path.basename(filePath),
        size: stat.size,
        extension: path.extname(filePath).toLowerCase() || 'no-ext',
        ...classifyFileForUpload(path.basename(filePath), path.extname(filePath).toLowerCase())
      })
    } catch {}
  }

  const roots = [...folders, ...directFiles.map((f) => path.dirname(f))]
  let common = roots[0] || path.parse(selectedPaths[0] ?? '.').root
  for (const root of roots.slice(1)) {
    while (common !== path.dirname(common) && root !== common && !root.startsWith(common + path.sep))
      common = path.dirname(common)
  }
  for (const file of files) {
    // Always normalise: mixed selections can share a basename across folders.
    file.relativePath = path.relative(common, file.path) || path.basename(file.path)
  }

  annotateFileVariants(files)

  return {
    folderPath: common,
    folderName:
      folders.length === 1 && !directFiles.length
        ? path.basename(folders[0])
        : `${directFiles.length} files + ${folders.length} folders`,
    totalFiles: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    files,
    prunedDirs: scans.flatMap((r) => r.prunedDirs ?? []),
    skippedDirs: scans.flatMap((r) => r.skippedDirs ?? []),
    isTruncated: scans.some((r) => r.isTruncated) || undefined
  }
}

async function runSelectionPicker(
  view: WebContentsView,
  mainWindow: BrowserWindow,
  title: string,
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections'>
): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed() || !view || view.webContents.isDestroyed()) return false
  ensureWindowInteractive(mainWindow)
  if (!acquirePickerLock()) return false
  try {
    const result = await withTimeout(
      dialog.showOpenDialog(mainWindow, { title, properties }),
      DIALOG_TIMEOUT_MS,
      'Upload picker'
    )
    if (result.canceled || !result.filePaths.length) return true

    const scanResult = await buildSelectionScanResult(result.filePaths)
    if (!scanResult.files.length) {
      showNexusToast(view, 'No readable text files found in the selection.')
      return true
    }
    if (scanResult.isTruncated)
      showNexusToast(
        view,
        'Selection exceeds the 200 MB / 2,000-file safety limit. Only the initial budget was loaded.'
      )
    mainWindow.webContents.send('show_folder_upload_modal', scanResult)
    return true
  } catch (err) {
    console.error('Upload selection failed:', err)
    showNexusToast(view, 'Upload failed. Try a smaller selection.')
    return false
  } finally {
    releasePickerLock()
  }
}

/**
 * Ctrl+O: files only. `openFile` and `openDirectory` cannot be combined in one native
 * picker on Windows or Linux, which made the old mixed picker unreliable there.
 */
export async function handleFilesUpload(
  view: WebContentsView,
  mainWindow: BrowserWindow
): Promise<void> {
  await runSelectionPicker(view, mainWindow, 'Upload Files to AI', ['openFile', 'multiSelections'])
}

/** Explicit "files + folders" picker for platforms/UIs that support the combination. */
export async function handleMixedUpload(
  view: WebContentsView,
  mainWindow: BrowserWindow,
  customSelector?: string
): Promise<void> {
  void customSelector // Review/confirmation resolves the active provider selector through the existing flow.
  await runSelectionPicker(view, mainWindow, 'Upload Files and Folders to AI', [
    'openFile',
    'openDirectory',
    'multiSelections'
  ])
}

/** Non-blocking bundle preview used by renderer IPC. */
export async function generateBundleTextAsync(
  folderPath: string,
  selectedPaths: string[]
): Promise<BundlePreviewResult> {
  const parts = [
    `================================================================\nCodebase Bundle: ${path.basename(folderPath)}\nTotal Selected Files: ${selectedPaths.length}\n================================================================\n\n`
  ]
  const filesIncluded: string[] = []
  for (const fullPath of selectedPaths) {
    try {
      const content = decodeBundleText(fullPath, await fs.promises.readFile(fullPath))
      const relativePath = path.relative(folderPath, fullPath)
      parts.push(
        `================================================================\nFile: ${relativePath}\n================================================================\n\n${content}\n\n`
      )
      filesIncluded.push(relativePath)
    } catch (err) {
      throw new Error(
        `Could not prepare selected file ${path.basename(fullPath)}: ${err instanceof Error ? err.message : 'read failed'}`
      )
    }
    await yieldToMain()
  }
  const text = parts.join('')
  return { text, fileCount: filesIncluded.length, byteSize: Buffer.byteLength(text), filesIncluded }
}

/**
 * Generates a unified plain-text codebase bundle containing all selected files
 * with structured file separation headers, suitable for inspection and export.
 */
export function generateBundleText(
  folderPath: string,
  selectedPaths: string[]
): BundlePreviewResult {
  const folderName = path.basename(folderPath)
  let text = `================================================================\nCodebase Bundle: ${folderName}\nTotal Selected Files: ${selectedPaths.length}\n================================================================\n\n`
  let fileCount = 0
  const filesIncluded: string[] = []

  for (const fullPath of selectedPaths) {
    try {
      const contentStr = decodeBundleText(fullPath, fs.readFileSync(fullPath))
      const relativePath = path.relative(folderPath, fullPath)
      const fileHeader = `================================================================\nFile: ${relativePath}\n================================================================\n\n`
      text += fileHeader + contentStr + '\n\n'
      fileCount++
      filesIncluded.push(relativePath)
    } catch (err) {
      throw new Error(
        `Could not prepare selected file ${path.basename(fullPath)}: ${err instanceof Error ? err.message : 'read failed'}`
      )
    }
  }

  const byteSize = Buffer.byteLength(text, 'utf-8')
  return { text, fileCount, byteSize, filesIncluded }
}

/**
 * Prepares a masqueraded .txt copy with structured source header comment
 * for AI chat webviews that reject raw code extensions.
 */
export function createMasqueradedTextFile(originalPath: string): string {
  const fileName = path.basename(originalPath)
  const ext = path.extname(originalPath).toLowerCase()
  if (ext === '.txt') return originalPath

  const content = decodeBundleText(originalPath, fs.readFileSync(originalPath))
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upload-'))
  const tempPath = path.join(tempDir, `${fileName}.txt`)
  const formatDesc = ext ? ext : 'plain text / extensionless'
  const header = `/* ================================================================\n * SOURCE FILE: ${fileName}\n * ORIGINAL FORMAT: ${formatDesc}\n * ================================================================ */\n\n`
  fs.writeFileSync(tempPath, header + content, 'utf-8')
  return tempPath
}

/**
 * Strips redundant whitespace and collapses excessive empty lines from code.
 */
export function compressCodeContent(content: string): string {
  if (!content) return ''
  return content
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Compresses and partitions codebase files into chunks strictly below maxChunkBytes,
 * slicing single oversized files across line breaks.
 */
export function partitionCodebaseFiles(
  folderPath: string,
  selectedPaths: string[],
  maxChunkBytes: number = 8 * 1024 * 1024,
  enableCompression: boolean = false
): PartitionResult {
  const folderName = path.basename(folderPath)
  let originalBytes = 0
  let totalProcessedBytes = 0
  const processedFiles: Array<{ relativePath: string; content: string; size: number }> = []
  const originalAttachments: OriginalAttachment[] = []

  for (const fullPath of selectedPaths) {
    // Non-text selections are delivered as the original file. They must never be decoded
    // through the UTF-8 text path, which would corrupt them.
    const kind = classifyUploadKind(path.extname(fullPath))
    if (requiresOriginalAttachment(kind)) {
      try {
        const stat = fs.statSync(fullPath)
        originalAttachments.push({
          path: fullPath,
          relativePath: path.relative(folderPath, fullPath),
          size: stat.size,
          kind
        })
      } catch {
        // A file that vanished between scan and confirm is reported by the caller.
      }
      continue
    }

    try {
      const rawContent = decodeBundleText(fullPath, fs.readFileSync(fullPath))
      const rawSize = Buffer.byteLength(rawContent, 'utf-8')
      originalBytes += rawSize

      const content = enableCompression ? compressCodeContent(rawContent) : rawContent
      const processedSize = Buffer.byteLength(content, 'utf-8')
      totalProcessedBytes += processedSize

      const relativePath = path.relative(folderPath, fullPath)
      processedFiles.push({ relativePath, content, size: processedSize })
    } catch (err) {
      throw new Error(
        `Could not prepare selected file ${path.basename(fullPath)}: ${err instanceof Error ? err.message : 'read failed'}`
      )
    }
  }

  const chunks = partitionPreparedFiles(folderName, processedFiles, maxChunkBytes)

  const savedBytes = Math.max(0, originalBytes - totalProcessedBytes)
  const reductionPercent = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0

  return {
    chunks,
    originalAttachments,
    totalBytes: chunks.reduce((acc, c) => acc + c.byteSize, 0),
    totalFiles: selectedPaths.length,
    originalBytes,
    savedBytes,
    reductionPercent
  }
}

/** Reads how many attachment chips the provider composer currently shows. */
async function probeAttachmentCount(view: WebContentsView): Promise<number | null> {
  try {
    const reply = await view.webContents.executeJavaScript(ATTACHMENT_PROBE_SCRIPT)
    return parseAttachmentProbeResult(reply)
  } catch {
    return null
  }
}

/**
 * Attaches every part of a selection to ONE composer message with a single injection, so
 * the user reviews the parts and presses Send themselves. Nothing is auto-sent.
 */
export async function attachChunksAsOneMessage(
  view: WebContentsView,
  chunks: BundleChunk[],
  folderName: string,
  customSelector?: string,
  originalFiles: string[] = []
): Promise<AttachAllResult> {
  const total = chunks.length + originalFiles.length
  if (total === 0)
    return { success: false, totalParts: 0, attachedParts: null, message: 'Nothing to attach.' }

  const plan = buildPartFilePlan(folderName, chunks)
  const tempDir = createUploadTempDir()
  const partPaths: string[] = []
  const before = await probeAttachmentCount(view)
  try {
    for (const part of plan) {
      partPaths.push(writePartFile(tempDir, part))
    }
  } catch (err) {
    scheduleUploadTempCleanup(tempDir, 0)
    console.error('Could not write bundle parts:', err)
    return {
      success: false,
      totalParts: total,
      attachedParts: null,
      message: 'Could not stage the parts for attachment. Check disk space and retry.'
    }
  }

  let result: { success: boolean; method: 'input' | 'drag' | 'none' }
  try {
    result = await withTimeout(
      injectFilesViaCDP(view, [...partPaths, ...originalFiles], customSelector),
      INJECT_TIMEOUT_MS,
      'Attachment dispatch'
    )
  } catch (err) {
    console.error('Attachment dispatch did not complete:', err)
    safeDetachDebugger(view)
    scheduleUploadTempCleanup(tempDir, 0)
    return {
      success: false,
      totalParts: total,
      attachedParts: null,
      message: `Could not attach the ${total === 1 ? 'part' : 'parts'}. Use Download to attach manually.`
    }
  }
  if (!result.success) {
    safeDetachDebugger(view)
    scheduleUploadTempCleanup(tempDir, 0)
    return {
      success: false,
      totalParts: total,
      attachedParts: null,
      message: `Could not attach the ${total === 1 ? 'part' : 'parts'}. Use Download to attach manually.`
    }
  }

  const after = await probeAttachmentCount(view)
  const unit: 'part' | 'file' = originalFiles.length > 0 ? 'file' : 'part'
  const outcome: AttachOutcome = describeAttachOutcome(total, before, after, unit)
  scheduleUploadTempCleanup(tempDir)

  const warning = attachCountWarning(total)
  const message = warning ? `${outcome.message} ${warning}` : outcome.message

  return {
    success: true,
    totalParts: total,
    attachedParts: outcome.attached,
    verified: outcome.verified,
    needsUserCheck: outcome.needsUserCheck,
    message
  }
}

/**
 * Sequentially injects a single bundle chunk into the active AI webview with progress
 * notifications. Per-part controls and the single-chunk IPC route use this.
 *
 * Multi-part selections are delivered by attachChunksAsOneMessage() instead; this guard is
 * kept so the existing single-part contract (and its integration test) still holds.
 */
export async function uploadChunksSequentially(
  view: WebContentsView,
  mainWindow: BrowserWindow,
  chunks: BundleChunk[],
  folderName: string,
  customSelector?: string
): Promise<void> {
  const total = chunks.length
  if (total > 1)
    throw new Error(
      'Multiple batches require manual, one-at-a-time delivery; use the individual part controls.'
    )
  for (let i = 0; i < total; i++) {
    const chunk = chunks[i]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder_upload_chunk_progress', {
        currentChunk: chunk.index,
        totalChunks: total,
        byteSize: chunk.byteSize,
        status: 'uploading',
        message: `Uploading Part ${chunk.index} of ${total}...`
      })
    }

    const safeName = folderName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const tempDir = createUploadTempDir()
    const chunkPath = path.join(tempDir, `${safeName}_part${chunk.index}_of_${total}.txt`)
    fs.writeFileSync(chunkPath, chunk.content, { encoding: 'utf-8', mode: 0o600 })

    const before = total === 1 ? await probeAttachmentCount(view) : null
    let result: { success: boolean; method: 'input' | 'drag' | 'none' }
    try {
      result = await withTimeout(
        injectFilesViaCDP(view, [chunkPath], customSelector),
        INJECT_TIMEOUT_MS,
        'Attachment dispatch'
      )
    } catch (err) {
      result = { success: false, method: 'none' }
      console.error('Attachment dispatch did not complete:', err)
    }
    if (!result.success) {
      safeDetachDebugger(view)
      scheduleUploadTempCleanup(tempDir, 0)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('folder_upload_chunk_progress', {
          currentChunk: chunk.index,
          totalChunks: total,
          byteSize: chunk.byteSize,
          status: 'failed',
          message: `Could not attach Part ${chunk.index}; remaining parts were not attempted.`
        })
      }
      throw new Error('Attachment dispatch failed; provider acceptance is unknown.')
    }

    const outcome =
      before === null
        ? null
        : describeAttachOutcome(1, before, await probeAttachmentCount(view), 'part')
    scheduleUploadTempCleanup(tempDir)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder_upload_chunk_progress', {
        currentChunk: chunk.index,
        totalChunks: total,
        byteSize: chunk.byteSize,
        status: 'completed',
        message:
          outcome?.verified === true
            ? `Part ${chunk.index} of ${total} attached.`
            : `Part ${chunk.index} of ${total} sent; check the composer before pressing Send.`
      })
    }

    showNexusToast(view, outcome?.message ?? `Part ${chunk.index} of ${total} sent to the composer.`)

    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

/** Splits a selection into text files (bundled) and originals (attached as-is). */
export function splitSelectionByDelivery(
  folderPath: string,
  selectedPaths: string[]
): { textPaths: string[]; originals: OriginalAttachment[] } {
  const textPaths: string[] = []
  const originals: OriginalAttachment[] = []
  for (const fullPath of selectedPaths) {
    const kind: UploadFileKind = classifyUploadKind(path.extname(fullPath))
    if (!requiresOriginalAttachment(kind)) {
      textPaths.push(fullPath)
      continue
    }
    try {
      originals.push({
        path: fullPath,
        relativePath: path.relative(folderPath, fullPath),
        size: fs.statSync(fullPath).size,
        kind
      })
    } catch {
      // Disappeared between scan and confirm: report via the omitted list.
      originals.push({ path: fullPath, relativePath: path.relative(folderPath, fullPath), size: 0, kind })
    }
  }
  return { textPaths, originals }
}

/**
 * Bundles the user-selected file paths into structured chunks and injects them
 * into the active AI webview via CDP DevTools protocol.
 *
 * Every part of the selection is attached to one composer message; no message is sent.
 */
export async function bundleAndInjectSelectedFiles(
  view: WebContentsView,
  folderPath: string,
  selectedPaths: string[],
  customSelector?: string,
  options?: { maxChunkBytes?: number }
): Promise<AttachAllResult | null> {
  if (!view || view.webContents.isDestroyed() || !selectedPaths || selectedPaths.length === 0) {
    return null
  }

  try {
    // Text files become bundle parts; everything else is attached as the original file.
    const partition = partitionCodebaseFiles(
      folderPath,
      selectedPaths,
      options?.maxChunkBytes ?? MAX_CHUNK_SIZE,
      false
    )
    const originals = (partition.originalAttachments ?? []).map((attachment) => attachment.path)

    if (partition.chunks.length === 0 && originals.length === 0) {
      showNexusToast(view, 'No selected files could be prepared for upload.')
      return null
    }

    // One injection: every text part and every original file land in the same message.
    // The user reviews them and decides when to press Send.
    const result = await attachChunksAsOneMessage(
      view,
      partition.chunks,
      path.basename(folderPath),
      customSelector,
      originals
    )
    showNexusToast(view, result.message)
    return result
  } catch (err) {
    console.error('Folder bundling failed:', err)
    showNexusToast(
      view,
      'Could not prepare or attach the selection. See the Chunks & Parts drawer for details.'
    )
    safeDetachDebugger(view)
    return null
  }
}

/**
 * Handles individual file upload with smart `.txt` masquerading for unsupported extensions.
 */
export async function handleFileUpload(
  view: WebContentsView,
  mainWindow: BrowserWindow,
  customSelector?: string
): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || !view || view.webContents.isDestroyed()) {
    return
  }

  ensureWindowInteractive(mainWindow)
  if (!acquirePickerLock()) return

  try {
    const { canceled, filePaths } = await withTimeout(
      dialog.showOpenDialog(mainWindow, {
        title: 'Upload File to AI',
        properties: ['openFile', 'multiSelections']
      }),
      DIALOG_TIMEOUT_MS,
      'File picker'
    )

    if (canceled || filePaths.length === 0) return

    const processedPaths = await processFilesForUpload(filePaths)

    await injectFilesViaCDP(view, processedPaths, customSelector)
  } catch (err) {
    console.error('CDP Drag Drop failed:', err)
    safeDetachDebugger(view)
  } finally {
    releasePickerLock()
  }
}

/**
 * Injects an array of file paths natively into the webview using CDP DOM and Drag/Drop events.
 */
async function injectFilesViaCDP(
  view: WebContentsView,
  filePaths: string[],
  customSelector?: string
): Promise<{ success: boolean; method: 'input' | 'drag' | 'none' }> {
  let injectionResult: { success: boolean; method: 'input' | 'drag' | 'none' } = {
    success: false,
    method: 'none'
  }

  const inputSelector =
    customSelector && customSelector.includes('input')
      ? customSelector.trim()
      : 'input[type="file"]'
  const domInfo: { w: number; h: number; dropX: number; dropY: number; targetInputIndex: number } =
    await view.webContents
      .executeJavaScript(
        `
        (() => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          let dropX = Math.round(w / 2);
          let dropY = Math.round(h * 0.82);

          const promptArea = document.querySelector(
            'textarea, [contenteditable="true"], [role="textbox"], [data-testid="prompt-textarea"], #prompt-textarea, rich-textarea, .chat-input-editor, .ProseMirror, form'
          );
          if (promptArea) {
            const rect = promptArea.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              dropX = Math.round(rect.left + rect.width / 2);
              dropY = Math.round(rect.top + rect.height / 2);
            }
          }

          const inputs = Array.from(document.querySelectorAll(${JSON.stringify(inputSelector)}));
          let targetInputIndex = -1;
          for (let i = inputs.length - 1; i >= 0; i--) {
            const input = inputs[i];
            const accept = (input.getAttribute('accept') || '').toLowerCase().trim();
            const isMediaOnly =
              (accept.includes('image/') || accept.includes('video/') || accept.includes('audio/')) &&
              !accept.includes('*/*') &&
              !accept.includes('text') &&
              !accept.includes('.txt') &&
              !accept.includes('.pdf') &&
              !accept.includes('doc');
            if (isMediaOnly) continue;
            targetInputIndex = i;
            break;
          }

          return { w, h, dropX, dropY, targetInputIndex };
        })()
      `
      )
      .catch(() => ({
        w: 1200,
        h: 800,
        dropX: 600,
        dropY: 650,
        targetInputIndex: -1
      }))

  // A hung or failed earlier dispatch can leave the debugger attached; attaching again
  // throws, which used to make every subsequent upload fail until the app restarted.
  try {
    if (view.webContents.debugger.isAttached()) safeDetachDebugger(view)
    view.webContents.debugger.attach('1.3')
  } catch (attachErr) {
    console.error('Could not attach CDP debugger for upload:', attachErr)
    return { success: false, method: 'none' }
  }

  // Method 1: Direct DOM input[type="file"] node injection (only if a compatible document input exists)
  let injectedViaInput = false
  try {
    const { root } = (await view.webContents.debugger.sendCommand('DOM.getDocument', {
      depth: -1
    })) as { root: { nodeId: number } }

    const selectorToUse = inputSelector
    let targetNodeId: number | undefined

    const { nodeIds } = (await view.webContents.debugger.sendCommand('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: selectorToUse
    })) as { nodeIds: number[] }

    // ONLY target the input if it's confirmed compatible (never force media-only inputs!)
    if (
      nodeIds &&
      nodeIds.length > 0 &&
      domInfo.targetInputIndex >= 0 &&
      domInfo.targetInputIndex < nodeIds.length
    ) {
      targetNodeId = nodeIds[domInfo.targetInputIndex]
    }

    if (targetNodeId !== undefined) {
      await view.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: targetNodeId,
        files: filePaths
      })
      injectedViaInput = true
      injectionResult = { success: true, method: 'input' }
    }
  } catch (e) {
    console.warn('CDP DOM file injection skipped or failed, falling back to Drag & Drop:', e)
  }

  // Method 2: Native Drag & Drop Simulation targeting prompt coordinates (Fallback when DOM file input was media-only or absent)
  if (!injectedViaInput) {
    try {
      const data = {
        items: [
          { mimeType: 'text/plain', data: '' },
          { mimeType: 'application/octet-stream', data: '' }
        ],
        files: filePaths,
        dragOperationsMask: 1
      }

      const targetX = Math.round(domInfo.dropX)
      const targetY = Math.round(domInfo.dropY)

      // Enter directly at the active composer/dropzone coordinates to trigger webview drop listeners
      await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        type: 'dragEnter',
        x: targetX,
        y: targetY,
        data,
        modifiers: 0
      })
      await new Promise((r) => setTimeout(r, 60))

      await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        type: 'dragOver',
        x: targetX,
        y: targetY,
        data,
        modifiers: 0
      })
      await new Promise((r) => setTimeout(r, 60))

      await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        type: 'drop',
        x: targetX,
        y: targetY,
        data,
        modifiers: 0
      })
      injectionResult = { success: true, method: 'drag' }
    } catch (dragErr) {
      console.error('CDP Drag Drop event dispatch failed:', dragErr)
    }
  }

  // Await 400ms settlement so Chromium and webview drop event listeners finish reading files before detaching debugger
  await new Promise((r) => setTimeout(r, 400))
  safeDetachDebugger(view)

  return injectionResult
}

function safeDetachDebugger(view: WebContentsView): void {
  try {
    if (view.webContents.debugger.isAttached()) {
      view.webContents.debugger.detach()
    }
  } catch {
    // Ignore detachment errors
  }
}

function showNexusToast(view: WebContentsView, message: string): void {
  view.webContents
    .executeJavaScript(
      `
    (function() {
      let t = document.getElementById('__nexusTabToast');
      if (!t) {
        t = document.createElement('div');
        t.id = '__nexusTabToast';
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:rgba(5,15,20,0.92);color:#00e5ff;font:13px/1.5 "Share Tech Mono",monospace;padding:8px 24px;border-radius:4px;z-index:2147483647;pointer-events:none;opacity:0;transition:all .3s cubic-bezier(0.16, 1, 0.3, 1);white-space:nowrap;box-shadow:0 0 20px rgba(0,229,255,0.3);backdrop-filter:blur(12px);border:1px solid rgba(0,229,255,0.4);margin-top:-10px;text-transform:uppercase;letter-spacing:1px;';
        document.documentElement.appendChild(t);
      }
      t.textContent = ${JSON.stringify(message)};
      requestAnimationFrame(() => { t.style.opacity = '1'; t.style.marginTop = '0px'; });
      clearTimeout(t._t);
      t._t = setTimeout(() => { t.style.opacity = '0'; t.style.marginTop = '-10px'; }, 3000);
    })();
  `
    )
    .catch(() => {})
}
