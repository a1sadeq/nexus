import { dialog, type BrowserWindow, type WebContentsView } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { FolderScanResult, ScannedFileInfo, BundlePreviewResult } from '../shared/folderUpload'

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
  '.next',
  'out',
  'coverage',
  '.vscode',
  '.idea'
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

const SAFE_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.csv',
  '.xlsx',
  '.xls',
  '.docx',
  '.doc',
  '.txt',
  '.py',
  '.js',
  '.ts',
  '.html',
  '.css',
  '.json',
  '.md',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.java',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.sh',
  '.xml'
])

const MAX_FOLDER_FILES = 1000
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
const MAX_CHUNK_SIZE = 8 * 1024 * 1024 // 8MB per chunk

let isDialogOpen = false
let lastDialogTimestamp = 0
const DIALOG_COOLDOWN_MS = 600

/**
 * Recursively scans a selected folder for text files, flagging noisy or sensitive
 * items (lockfiles, env secrets, minified bundles, data dumps) for suggested removal.
 */
export function scanFolder(folderPath: string): FolderScanResult {
  const files: ScannedFileInfo[] = []
  let totalBytes = 0

  const crawl = (dir: string): void => {
    if (files.length >= MAX_FOLDER_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= MAX_FOLDER_FILES) break
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          crawl(fullPath)
        }
      } else if (entry.isFile()) {
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
    }
  }

  crawl(folderPath)

  return {
    folderPath,
    folderName: path.basename(folderPath),
    totalFiles: files.length,
    totalBytes,
    files
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
 * Bundles the user-selected file paths into 8MB chunks and injects them
 * into the active AI webview via CDP DevTools protocol drag & drop.
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
    const bundledFiles: string[] = []
    let fileCount = 0

    let currentChunkIndex = 1
    let currentChunkContent = `Codebase Bundle Part ${currentChunkIndex}: ${path.basename(folderPath)}\n\n`
    let currentChunkSize = Buffer.byteLength(currentChunkContent, 'utf8')

    for (const fullPath of selectedPaths) {
      try {
        const contentStr = fs.readFileSync(fullPath, 'utf-8')
        const relativePath = path.relative(folderPath, fullPath)

        const fileHeader = `\n================================================================\nFile: ${relativePath}\n================================================================\n\n`
        const filePayload = fileHeader + contentStr + `\n`
        const payloadSize = Buffer.byteLength(filePayload, 'utf8')

        if (currentChunkSize + payloadSize > MAX_CHUNK_SIZE) {
          const folderName = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]/g, '_')
          const chunkPath = path.join(
            os.tmpdir(),
            `${folderName}_part${currentChunkIndex}_codebase.txt`
          )
          fs.writeFileSync(chunkPath, currentChunkContent, 'utf-8')
          bundledFiles.push(chunkPath)

          currentChunkIndex++
          currentChunkContent = `Codebase Bundle Part ${currentChunkIndex}: ${path.basename(folderPath)}\n\n`
          currentChunkSize = Buffer.byteLength(currentChunkContent, 'utf8')
        }

        currentChunkContent += filePayload
        currentChunkSize += payloadSize
        fileCount++
      } catch (err) {
        console.error(`Failed to read file for bundling: ${fullPath}`, err)
      }
    }

    if (
      fileCount > 0 &&
      currentChunkSize >
        Buffer.byteLength(
          `Codebase Bundle Part ${currentChunkIndex}: ${path.basename(folderPath)}\n\n`,
          'utf8'
        )
    ) {
      const folderName = path.basename(folderPath).replace(/[^a-zA-Z0-9_-]/g, '_')
      const chunkPath = path.join(
        os.tmpdir(),
        `${folderName}_part${currentChunkIndex}_codebase.txt`
      )
      fs.writeFileSync(chunkPath, currentChunkContent, 'utf-8')
      bundledFiles.push(chunkPath)
    }

    if (fileCount === 0) {
      showNexusToast(view, 'No selected files could be bundled.')
      return
    }

    await injectFilesViaCDP(view, bundledFiles, customSelector)
    showNexusToast(view, `Bundled ${fileCount} files into ${bundledFiles.length} chunk(s).`)
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
      if (!SAFE_EXTENSIONS.has(ext)) {
        try {
          const fileName = path.basename(originalPath)
          const tempPath = path.join(os.tmpdir(), `${fileName}.txt`)
          fs.copyFileSync(originalPath, tempPath)
          return tempPath
        } catch (err) {
          console.error('Failed to masquerade file:', err)
          return originalPath
        }
      }
      return originalPath
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
  const coords: { w: number; h: number; x?: number; y?: number } =
    await view.webContents.executeJavaScript(`
      ({ w: window.innerWidth, h: window.innerHeight })
    `)

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
      targetNodeId = nodeIds[nodeIds.length - 1]
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

  // Method 2: Native Drag & Drop Simulation
  const data = {
    items: [],
    files: filePaths,
    dragOperationsMask: 1
  }

  const targetX = Math.round(coords.x || coords.w / 2 || 500)
  const targetY = Math.round(coords.y || coords.h / 2 || 500)

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
