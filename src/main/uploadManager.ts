import { dialog, type BrowserWindow, type WebContentsView } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type {
  FolderScanResult,
  ScannedFileInfo,
  BundlePreviewResult,
  BundleChunk,
  PartitionResult,
  ChunkFileItem
} from '../shared/folderUpload'

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

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.zip',
  '.tar',
  '.gz',
  '.mp3',
  '.mp4',
  '.mov',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
  '.db',
  '.sqlite'
])


const MAX_FOLDER_FILES = 10000
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
const MAX_CHUNK_SIZE = 8 * 1024 * 1024 // 8MB per chunk

let isDialogOpen = false
let lastDialogTimestamp = 0
const DIALOG_COOLDOWN_MS = 600

/**
 * Recursively scans a selected folder for text files with a 10,000 file ceiling,
 * prioritizing key source folders and pruning low-priority bloat when nearing capacity.
 */
export function scanFolder(folderPath: string): FolderScanResult {
  const files: ScannedFileInfo[] = []
  let totalBytes = 0
  const prunedDirs: string[] = []
  let isTruncated = false

  const crawl = (dir: string): void => {
    if (files.length >= MAX_FOLDER_FILES) {
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
        }
      } else if (entry.isFile()) {
        fileEntries.push(entry)
      }
    }

    // Process files in current directory
    for (const entry of fileEntries) {
      if (files.length >= MAX_FOLDER_FILES) {
        isTruncated = true
        break
      }
      const fullPath = path.join(dir, entry.name)
      const ext = path.extname(entry.name).toLowerCase()
      if (BINARY_EXTENSIONS.has(ext)) continue
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env')) continue

      try {
        const stat = fs.statSync(fullPath)
        if (stat.size > MAX_FILE_SIZE) continue

        // Check first 1024 bytes for null byte (binary file indicator)
        const fd = fs.openSync(fullPath, 'r')
        const buffer = Buffer.alloc(1024)
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0)
        fs.closeSync(fd)
        if (buffer.indexOf(0) !== -1 && buffer.indexOf(0) < bytesRead) continue

        const relativePath = path.relative(folderPath, fullPath)
        const lowerName = entry.name.toLowerCase()

        let isSuggestedRemoval = false
        let removalReason: string | undefined

        if (SUGGESTED_REMOVAL_FILENAMES.has(lowerName)) {
          isSuggestedRemoval = true
          removalReason = 'Lockfile (large / redundant)'
        } else if (lowerName.startsWith('.env')) {
          isSuggestedRemoval = true
          removalReason = 'Sensitive / Secrets file'
        } else if (lowerName.endsWith('.min.js') || lowerName.endsWith('.min.css')) {
          isSuggestedRemoval = true
          removalReason = 'Minified asset'
        } else if (lowerName.endsWith('.map')) {
          isSuggestedRemoval = true
          removalReason = 'Source map'
        } else if (lowerName.endsWith('.log')) {
          isSuggestedRemoval = true
          removalReason = 'Log file'
        } else if (stat.size > 250 * 1024) {
          isSuggestedRemoval = true
          removalReason = `Large file (${Math.round(stat.size / 1024)} KB)`
        } else if (SUGGESTED_REMOVAL_EXTENSIONS.has(ext)) {
          isSuggestedRemoval = true
          removalReason = 'Data dump / temporary'
        }

        files.push({
          path: fullPath,
          relativePath,
          size: stat.size,
          extension: ext || 'no-ext',
          isSuggestedRemoval,
          removalReason
        })
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
      if (files.length >= MAX_FOLDER_FILES) {
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

  return {
    folderPath,
    folderName: path.basename(folderPath),
    totalFiles: files.length,
    totalBytes,
    files,
    prunedDirs: prunedDirs.length > 0 ? prunedDirs : undefined,
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

  const now = Date.now()
  if (isDialogOpen || now - lastDialogTimestamp < DIALOG_COOLDOWN_MS) {
    return
  }

  isDialogOpen = true
  lastDialogTimestamp = now

  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Folder to Upload',
      properties: ['openDirectory']
    })

    if (canceled || filePaths.length === 0) return

    const folderPath = filePaths[0]
    const scanResult = scanFolder(folderPath)

    if (scanResult.totalFiles === 0) {
      showNexusToast(view, 'No readable text files found in folder.')
      return
    }

    // Send scanned folder data to renderer to show sleek modern filter popup
    mainWindow.webContents.send('show_folder_upload_modal', scanResult)
  } catch (err) {
    console.error('Folder upload scan failed:', err)
    safeDetachDebugger(view)
  } finally {
    isDialogOpen = false
    lastDialogTimestamp = Date.now()
  }
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
      const contentStr = fs.readFileSync(fullPath, 'utf-8')
      const relativePath = path.relative(folderPath, fullPath)
      const fileHeader = `================================================================\nFile: ${relativePath}\n================================================================\n\n`
      text += fileHeader + contentStr + '\n\n'
      fileCount++
      filesIncluded.push(relativePath)
    } catch (err) {
      console.error(`Failed to read file for bundle generation: ${fullPath}`, err)
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

  const tempPath = path.join(os.tmpdir(), `${fileName}.txt`)
  const content = fs.readFileSync(originalPath, 'utf-8')
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
  enableCompression: boolean = true
): PartitionResult {
  const folderName = path.basename(folderPath)
  let originalBytes = 0
  let totalProcessedBytes = 0
  const processedFiles: Array<{ relativePath: string; content: string; size: number }> = []

  for (const fullPath of selectedPaths) {
    try {
      const rawContent = fs.readFileSync(fullPath, 'utf-8')
      const rawSize = Buffer.byteLength(rawContent, 'utf-8')
      originalBytes += rawSize

      const content = enableCompression ? compressCodeContent(rawContent) : rawContent
      const processedSize = Buffer.byteLength(content, 'utf-8')
      totalProcessedBytes += processedSize

      const relativePath = path.relative(folderPath, fullPath)
      processedFiles.push({ relativePath, content, size: processedSize })
    } catch (err) {
      console.error(`Failed to read file for partition: ${fullPath}`, err)
    }
  }

  const chunks: BundleChunk[] = []
  let currentFiles: ChunkFileItem[] = []
  let currentContent = ''
  let currentBytes = 0

  const finalizeChunk = (): void => {
    if (currentFiles.length === 0 && !currentContent) return
    const chunkIdx = chunks.length + 1
    const header = `================================================================\nCodebase Bundle Part ${chunkIdx}: ${folderName}\nFiles Included: ${currentFiles.length}\n================================================================\n\n`
    const finalContent = header + currentContent
    const finalBytes = Buffer.byteLength(finalContent, 'utf-8')

    chunks.push({
      index: chunkIdx,
      totalChunks: 0,
      byteSize: finalBytes,
      fileCount: currentFiles.length,
      files: [...currentFiles],
      content: finalContent
    })

    currentFiles = []
    currentContent = ''
    currentBytes = 0
  }

  const headerOverhead = 220

  for (const file of processedFiles) {
    const fileHeader = `================================================================\nFile: ${file.relativePath}\n================================================================\n\n`
    const filePayload = fileHeader + file.content + '\n\n'
    const payloadBytes = Buffer.byteLength(filePayload, 'utf-8')

    // If single file alone exceeds maxChunkBytes - headerOverhead, slice line-by-line
    if (payloadBytes > maxChunkBytes - headerOverhead) {
      if (currentFiles.length > 0) {
        finalizeChunk()
      }

      const lines = file.content.split('\n')
      let subPartIndex = 1
      let subPartContent = ''
      let subPartBytes = 0

      for (let i = 0; i < lines.length; i++) {
        const lineStr = lines[i] + (i < lines.length - 1 ? '\n' : '')
        const lineBytes = Buffer.byteLength(lineStr, 'utf-8')
        const partHeader = `================================================================\nFile: ${file.relativePath} (Part ${subPartIndex})\n================================================================\n\n`
        const partHeaderBytes = Buffer.byteLength(partHeader, 'utf-8')

        if (subPartBytes + lineBytes + partHeaderBytes + headerOverhead > maxChunkBytes && subPartContent) {
          const chunkIdx = chunks.length + 1
          const chunkHeader = `================================================================\nCodebase Bundle Part ${chunkIdx}: ${folderName}\nFiles Included: 1 (Part ${subPartIndex} of ${file.relativePath})\n================================================================\n\n`
          const finalChunk = chunkHeader + partHeader + subPartContent + '\n\n'

          chunks.push({
            index: chunkIdx,
            totalChunks: 0,
            byteSize: Buffer.byteLength(finalChunk, 'utf-8'),
            fileCount: 1,
            files: [{ relativePath: `${file.relativePath} (Part ${subPartIndex})`, size: subPartBytes }],
            content: finalChunk
          })

          subPartIndex++
          subPartContent = ''
          subPartBytes = 0
        }

        subPartContent += lineStr
        subPartBytes += lineBytes
      }

      if (subPartContent) {
        const chunkIdx = chunks.length + 1
        const partHeader = `================================================================\nFile: ${file.relativePath} (Part ${subPartIndex})\n================================================================\n\n`
        const chunkHeader = `================================================================\nCodebase Bundle Part ${chunkIdx}: ${folderName}\nFiles Included: 1 (Part ${subPartIndex} of ${file.relativePath})\n================================================================\n\n`
        const finalChunk = chunkHeader + partHeader + subPartContent + '\n\n'

        chunks.push({
          index: chunkIdx,
          totalChunks: 0,
          byteSize: Buffer.byteLength(finalChunk, 'utf-8'),
          fileCount: 1,
          files: [{ relativePath: `${file.relativePath} (Part ${subPartIndex})`, size: subPartBytes }],
          content: finalChunk
        })
      }
      continue
    }

    if (currentBytes + payloadBytes + headerOverhead > maxChunkBytes && currentFiles.length > 0) {
      finalizeChunk()
    }

    currentContent += filePayload
    currentBytes += payloadBytes
    currentFiles.push({ relativePath: file.relativePath, size: file.size })
  }

  if (currentFiles.length > 0) {
    finalizeChunk()
  }

  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length
  }

  const savedBytes = Math.max(0, originalBytes - totalProcessedBytes)
  const reductionPercent = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0

  return {
    chunks,
    totalBytes: chunks.reduce((acc, c) => acc + c.byteSize, 0),
    totalFiles: selectedPaths.length,
    originalBytes,
    savedBytes,
    reductionPercent
  }
}

/**
 * Sequentially injects bundle chunks into active AI webview with pacing and live progress notifications.
 */
export async function uploadChunksSequentially(
  view: WebContentsView,
  mainWindow: BrowserWindow,
  chunks: BundleChunk[],
  folderName: string,
  customSelector?: string
): Promise<void> {
  const total = chunks.length
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
    const chunkPath = path.join(os.tmpdir(), `${safeName}_part${chunk.index}_of_${total}.txt`)
    fs.writeFileSync(chunkPath, chunk.content, 'utf-8')

    await injectFilesViaCDP(view, [chunkPath], customSelector)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder_upload_chunk_progress', {
        currentChunk: chunk.index,
        totalChunks: total,
        byteSize: chunk.byteSize,
        status: 'completed',
        message: `Uploaded Part ${chunk.index} of ${total}`
      })
    }

    showNexusToast(view, `Uploaded Part ${chunk.index}/${total} (${formatBytes(chunk.byteSize)})`)

    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}

/**
 * Bundles the user-selected file paths into structured chunks and injects them
 * into the active AI webview via CDP DevTools protocol.
 */
export async function bundleAndInjectSelectedFiles(
  view: WebContentsView,
  folderPath: string,
  selectedPaths: string[],
  customSelector?: string
): Promise<void> {
  if (!view || view.webContents.isDestroyed() || !selectedPaths || selectedPaths.length === 0) {
    return
  }

  try {
    const partition = partitionCodebaseFiles(folderPath, selectedPaths, MAX_CHUNK_SIZE, true)
    if (partition.chunks.length === 0) {
      showNexusToast(view, 'No selected files could be bundled.')
      return
    }

    const folderName = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]/g, '_')
    const chunkPaths: string[] = []

    for (const chunk of partition.chunks) {
      const chunkPath = path.join(
        os.tmpdir(),
        `${folderName}_part${chunk.index}_of_${chunk.totalChunks}_codebase.txt`
      )
      fs.writeFileSync(chunkPath, chunk.content, 'utf-8')
      chunkPaths.push(chunkPath)
    }

    await injectFilesViaCDP(view, chunkPaths, customSelector)
    showNexusToast(
      view,
      `Bundled ${partition.totalFiles} files into ${chunkPaths.length} chunk(s) (${formatBytes(partition.totalBytes)}).`
    )
  } catch (err) {
    console.error('Folder bundling failed:', err)
    safeDetachDebugger(view)
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

  const now = Date.now()
  if (isDialogOpen || now - lastDialogTimestamp < DIALOG_COOLDOWN_MS) {
    return
  }

  isDialogOpen = true
  lastDialogTimestamp = now

  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Upload File to AI',
      properties: ['openFile', 'multiSelections']
    })

    if (canceled || filePaths.length === 0) return

    const processedPaths = filePaths.map((originalPath) => {
      const ext = path.extname(originalPath).toLowerCase()
      if (ext === '.txt' || ext === '.pdf' || BINARY_EXTENSIONS.has(ext)) {
        return originalPath
      }
      try {
        return createMasqueradedTextFile(originalPath)
      } catch (err) {
        console.error('Failed to masquerade file:', err)
        return originalPath
      }
    })

    await injectFilesViaCDP(view, processedPaths, customSelector)
  } catch (err) {
    console.error('CDP Drag Drop failed:', err)
    safeDetachDebugger(view)
  } finally {
    isDialogOpen = false
    lastDialogTimestamp = Date.now()
  }
}

/**
 * Injects an array of file paths natively into the webview using CDP DOM and Drag/Drop events.
 */
async function injectFilesViaCDP(
  view: WebContentsView,
  filePaths: string[],
  customSelector?: string
): Promise<void> {
  const domInfo: { w: number; h: number; dropX: number; dropY: number; targetInputIndex: number } =
    await view.webContents
      .executeJavaScript(`
        (() => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          let dropX = Math.round(w / 2);
          let dropY = Math.round(h * 0.82);

          const promptArea = document.querySelector(
            'textarea, [contenteditable="true"], [role="textbox"], [data-testid="prompt-textarea"], #prompt-textarea, form'
          );
          if (promptArea) {
            const rect = promptArea.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              dropX = Math.round(rect.left + rect.width / 2);
              dropY = Math.round(rect.top + rect.height / 2);
            }
          }

          const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
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
      `)
      .catch(() => ({
        w: 1200,
        h: 800,
        dropX: 600,
        dropY: 650,
        targetInputIndex: -1
      }))

  if (!view.webContents.debugger.isAttached()) {
    view.webContents.debugger.attach('1.3')
  }

  // Method 1: Direct DOM input[type="file"] node injection
  try {
    const { root } = (await view.webContents.debugger.sendCommand('DOM.getDocument', {
      depth: -1
    })) as { root: { nodeId: number } }

    const selectorToUse = customSelector?.trim() || 'input[type="file"]'
    let targetNodeId: number | undefined

    const { nodeIds } = (await view.webContents.debugger.sendCommand('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: selectorToUse
    })) as { nodeIds: number[] }

    if (nodeIds && nodeIds.length > 0) {
      if (domInfo.targetInputIndex >= 0 && domInfo.targetInputIndex < nodeIds.length) {
        targetNodeId = nodeIds[domInfo.targetInputIndex]
      } else {
        targetNodeId = nodeIds[nodeIds.length - 1]
      }
    } else if (selectorToUse !== 'input[type="file"]') {
      // Fallback to standard file input
      const fallback = (await view.webContents.debugger.sendCommand('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: 'input[type="file"]'
      })) as { nodeIds: number[] }
      if (fallback.nodeIds && fallback.nodeIds.length > 0) {
        targetNodeId = fallback.nodeIds[fallback.nodeIds.length - 1]
      }
    }

    if (targetNodeId !== undefined) {
      await view.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: targetNodeId,
        files: filePaths
      })
    }
  } catch (e) {
    console.error('CDP DOM file injection failed:', e)
  }

  // Method 2: Native Drag & Drop Simulation targeting prompt coordinates
  try {
    const data = {
      items: [],
      files: filePaths,
      dragOperationsMask: 1
    }

    const targetX = Math.round(domInfo.dropX)
    const targetY = Math.round(domInfo.dropY)

    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      type: 'dragEnter',
      x: 10,
      y: 10,
      data,
      modifiers: 0
    })
    await new Promise((r) => setTimeout(r, 50))

    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      type: 'dragOver',
      x: targetX,
      y: targetY,
      data,
      modifiers: 0
    })
    await new Promise((r) => setTimeout(r, 50))

    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      type: 'drop',
      x: targetX,
      y: targetY,
      data,
      modifiers: 0
    })
  } catch (e) {
    console.error('CDP Drag Drop event dispatch failed:', e)
  }

  safeDetachDebugger(view)
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

