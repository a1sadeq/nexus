import { spawn } from 'child_process'
import {
  app,
  shell,
  BrowserWindow,
  screen,
  clipboard,
  ipcMain,
  session,
  WebContentsView,
  protocol,
  Tray,
  Menu,
  globalShortcut,
  dialog
} from 'electron'
import { join, basename, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { buildEngine } from './promptNav'
import { getCustomThemeEntry, saveCustomThemeEntry, removeCustomThemeEntry } from './customThemesStore'
import { PROVIDER_THEMES, mergeOverrides, getStructuralVars } from './providerThemes'
import { type ProviderOverrides, getMergedProviderFeatures } from '../shared/providerConfig'
import { nextThemeSwap } from './themeSwap'
import { skillsEngine, type SkillDef } from './skillsEngine'
import {
  startGoogleSignIn,
  listProfiles,
  cancelGoogleSignIn,
  syncAllSessionsFromBrowsers,
  syncSessionFromProfile,
  importCookiesFromJson,
  type GoogleSignInEvent
} from './googleAuth'
import {
  handleFolderUpload,
  handleFileUpload,
  bundleAndInjectSelectedFiles,
  generateBundleText,
  partitionCodebaseFiles,
  uploadChunksSequentially
} from './uploadManager'
import type { ConfirmFolderUploadPayload, BundleChunk } from '../shared/folderUpload'
import { buildAgentHandoffPrompt, type CompressionOptions } from '../shared/contextCompressor'

// HW Acceleration is enabled for smooth UX; we offset its 300MB cost via network
// blockers and DOM virtualization on AI tabs.
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Single-instance: a second launch toggles the existing window instead of
// spawning a duplicate app with broken tab/sidebar state.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    toggleMainWindow()
  })
}

let mainWindow: BrowserWindow | null = null

function sendToMainWindow(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}
const aiViews = new Map<string, Electron.WebContentsView>()
let activeViewId: string | null = null
let activeViewVisible = true
let tabDiscardMinutes = 10
let maxActiveTabs = 0
const evictingTabs = new Set<string>()
const viewTitles = new Map<string, string>()
const viewModelKeys = new Map<string, string>()
let providerConfig: import('../shared/providerConfig').ProviderConfigMap = {}
// MUST match the real platform AND Chromium version. Google OAuth cross-checks
// Sec-CH-UA client hints (platform + version) against the User-Agent string.
// A Windows UA on a Linux box (or a version mismatch) = "This browser or app
// may not be secure" sign-in block. Electron 43.2.0 ships Chromium 150.
const AI_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
app.userAgentFallback = AI_UA

// Memory Optimization Flags
app.commandLine.appendSwitch('disable-site-isolation-trials')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')

// LRU memory pool: last touch time per tab + saved state of evicted tabs so
// their URL and scroll position can be restored on reactivation.
const lastAccessedTimestamps = new Map<string, number>()
const evictedTabStates = new Map<string, { url: string; scrollY: number }>()

ipcMain.on('set_tab_discard_time', (_event, minutes) => {
  tabDiscardMinutes = typeof minutes === 'number' ? minutes : 10
})

ipcMain.on('set_max_active_tabs', (_event, max) => {
  maxActiveTabs = typeof max === 'number' ? max : 0
  if (activeViewId) enforceMaxActiveTabs(activeViewId)
})

ipcMain.on('show_toast', (_event, msg: string) => {
  if (!activeViewId) return
  const view = aiViews.get(activeViewId)
  if (!view) return
  
  const code = `
    (function() {
      let t = document.getElementById('__nexusTabToast');
      if (!t) {
        t = document.createElement('div');
        t.id = '__nexusTabToast';
        t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;font:14px/1.5 system-ui,sans-serif;padding:8px 24px;border-radius:999px;z-index:2147483647;pointer-events:none;opacity:0;transition:all .3s cubic-bezier(0.16, 1, 0.3, 1);white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,.4);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);margin-top:-10px;';
        document.documentElement.appendChild(t);
      }
      t.textContent = ${JSON.stringify(msg)};
      requestAnimationFrame(() => {
        t.style.opacity = '1';
        t.style.marginTop = '0px';
      });
      clearTimeout(t._t);
      t._t = setTimeout(() => { 
        t.style.opacity = '0'; 
        t.style.marginTop = '-10px';
      }, 3000);
    })();
  `;
  view.webContents.executeJavaScript(code).catch(() => {})
})


function enforceMaxActiveTabs(excludeTabId: string) {
  if (maxActiveTabs <= 0) return
  
  const activeIds = Array.from(aiViews.keys()).filter(id => !evictingTabs.has(id))
  if (activeIds.length <= maxActiveTabs) return

  const sorted = activeIds
    .filter(id => id !== excludeTabId)
    .map(id => ({ id, ts: lastAccessedTimestamps.get(id) || 0 }))
    .sort((a, b) => a.ts - b.ts)
    
  const evictCount = activeIds.length - maxActiveTabs
  for (let i = 0; i < evictCount && i < sorted.length; i++) {
    const id = sorted[i].id
    const v = aiViews.get(id)
    if (v) {
      evictingTabs.add(id)
      v.webContents.executeJavaScript('window.scrollY')
        .then((scrollY) => {
          evictingTabs.delete(id)
          finishEvict(id, v, Number(scrollY) || 0)
        })
        .catch(() => {
          evictingTabs.delete(id)
          finishEvict(id, v, 0)
        })
    }
  }
}

setInterval(() => {
  if (tabDiscardMinutes === 0) return
  const now = Date.now()
  for (const [id, v] of aiViews) {
    if (id === activeViewId) continue // Never evict the currently active tab, even if hidden behind settings or window is unfocused
    const ts = lastAccessedTimestamps.get(id)
    if (!ts) continue
    if (v.webContents.isLoading()) continue

    const title = viewTitles.get(id) || ''
    const tl = title.toLowerCase()
    const isDefaultTitle = tl === 'new chat' || tl === 'gemini' || tl === 'gemini chat' || tl === 'qwen' || tl === 'qwen chat' || tl === 'kimi' || tl === 'kimi chat' || tl === 'deepseek' || tl === 'deepseek chat'
    
    const minutesSinceAccess = (now - ts) / 60000
    const threshold = isDefaultTitle ? 1 : tabDiscardMinutes
    
    if (minutesSinceAccess >= threshold) {
      v.webContents.executeJavaScript('window.scrollY')
        .then((scrollY) => finishEvict(id, v, Number(scrollY) || 0))
        .catch(() => finishEvict(id, v, 0))
    }
  }
}, 30000)

let tray: Tray | null = null
let isQuitting = false
export let currentUiZoom = 1.0;
let currentWebviewZoom = 1.0;
let currentGlobalHotkey: string | null = null

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      const bounds = getTargetWindowBounds()
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      }
      mainWindow.setBounds(bounds)
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  } else {
    createWindow()
  }
}

function updateGlobalHotkey(hotkey: string | null) {
  if (currentGlobalHotkey) {
    globalShortcut.unregister(currentGlobalHotkey)
    currentGlobalHotkey = null
  }
  if (!hotkey || hotkey === 'none') return true

  const registered = globalShortcut.register(hotkey, () => {
    toggleMainWindow()
  })

  if (registered) {
    currentGlobalHotkey = hotkey
    console.log(`[Nexus] Global hotkey registered: ${hotkey}`)
    return true
  }
  console.error(`[Nexus] Failed to register global hotkey: ${hotkey}`)
  return false
}

ipcMain.handle('get_global_hotkey', () => currentGlobalHotkey)

ipcMain.handle('set_global_hotkey', (_event, newHotkey: string) => {
  const configPath = join(app.getPath('userData'), 'config.json')
  let cfg: any = {}
  try { cfg = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}
  cfg.hotkey = newHotkey
  try { writeFileSync(configPath, JSON.stringify(cfg, null, 2)) } catch {}
  
  return updateGlobalHotkey(newHotkey)
})

ipcMain.on('open_active_devtools', () => {
  if (activeViewId) {
    const view = aiViews.get(activeViewId)
    if (view) view.webContents.openDevTools({ mode: 'detach' })
  }
})

ipcMain.on('trigger_active_upload_folder', async () => {
  if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      await handleFolderUpload(view, mainWindow)
    }
  }
})

ipcMain.on('confirm_folder_upload', async (_event, payload: ConfirmFolderUploadPayload) => {
  if (
    activeViewId &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    Array.isArray(payload?.selectedPaths) &&
    payload.selectedPaths.length > 0
  ) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      const modelKey = viewModelKeys.get(activeViewId) || ''
      const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
      await bundleAndInjectSelectedFiles(view, payload.folderPath, payload.selectedPaths, feats.attachmentSelector)
    }
  }
})

ipcMain.handle('preview_folder_bundle', async (_event, payload: ConfirmFolderUploadPayload) => {
  if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
    return { text: '', fileCount: 0, byteSize: 0, filesIncluded: [] }
  }
  return generateBundleText(payload.folderPath, payload.selectedPaths)
})

ipcMain.handle('save_folder_bundle_to_disk', async (_event, payload: ConfirmFolderUploadPayload) => {
  if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
    return { success: false, error: 'No files selected to bundle.' }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: 'Main window is not available.' }
  }
  const folderName = path.basename(payload.folderPath).replace(/[^a-zA-Z0-9_-]/g, '_')
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Codebase Bundle',
    defaultPath: `${folderName}_codebase_bundle.txt`,
    filters: [
      { name: 'Text Bundle (*.txt)', extensions: ['txt'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ]
  })
  if (canceled || !filePath) {
    return { success: false, canceled: true }
  }
  try {
    const { text, fileCount, byteSize } = generateBundleText(payload.folderPath, payload.selectedPaths)
    fs.writeFileSync(filePath, text, 'utf-8')
    return { success: true, savedPath: filePath, fileCount, byteSize }
  } catch (err: any) {
    console.error('Failed to save codebase bundle to disk:', err)
    return { success: false, error: err?.message || 'Failed to write bundle file.' }
  }
})

ipcMain.handle(
  'partition_folder_bundle',
  async (
    _event,
    payload: {
      folderPath: string
      selectedPaths: string[]
      maxChunkBytes?: number
      enableCompression?: boolean
    }
  ) => {
    if (!payload || !Array.isArray(payload.selectedPaths) || payload.selectedPaths.length === 0) {
      return null
    }
    return partitionCodebaseFiles(
      payload.folderPath,
      payload.selectedPaths,
      payload.maxChunkBytes || 8 * 1024 * 1024,
      payload.enableCompression ?? true
    )
  }
)

ipcMain.handle(
  'upload_chunks_sequentially',
  async (_event, payload: { folderName: string; chunks: BundleChunk[] }) => {
    if (
      activeViewId &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      payload &&
      Array.isArray(payload.chunks) &&
      payload.chunks.length > 0
    ) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        await uploadChunksSequentially(
          view,
          mainWindow,
          payload.chunks,
          payload.folderName,
          feats.attachmentSelector
        )
        return { success: true }
      }
    }
    return { success: false, error: 'Active AI view is not available' }
  }
)

ipcMain.handle(
  'upload_single_chunk',
  async (_event, payload: { folderName: string; chunk: BundleChunk }) => {
    if (activeViewId && mainWindow && !mainWindow.isDestroyed() && payload?.chunk) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        await uploadChunksSequentially(
          view,
          mainWindow,
          [payload.chunk],
          payload.folderName,
          feats.attachmentSelector
        )
        return { success: true }
      }
    }
    return { success: false, error: 'Active AI view is not available' }
  }
)

ipcMain.handle(
  'save_single_chunk_to_disk',
  async (_event, payload: { folderName: string; chunk: BundleChunk }) => {
    if (!mainWindow || mainWindow.isDestroyed() || !payload?.chunk) {
      return { success: false, error: 'Main window is not available.' }
    }
    const chunk = payload.chunk
    const safeName = (payload.folderName || 'bundle').replace(/[^a-zA-Z0-9_-]/g, '_')
    const defaultName = `${safeName}_part${chunk.index}_of_${chunk.totalChunks}.txt`
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `Save Chunk Part ${chunk.index}`,
      defaultPath: defaultName,
      filters: [
        { name: 'Text File (*.txt)', extensions: ['txt'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ]
    })
    if (canceled || !filePath) {
      return { success: false, canceled: true }
    }
    try {
      fs.writeFileSync(filePath, chunk.content, 'utf-8')
      return { success: true, savedPath: filePath }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to save chunk.' }
    }
  }
)


ipcMain.on('trigger_active_upload', async () => {
  if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      const modelKey = viewModelKeys.get(activeViewId) || ''
      const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
      await handleFileUpload(view, mainWindow, feats.attachmentSelector)
    }
  }
})

ipcMain.handle('shell_open', async (_event, url: string) => {
  await shell.openExternal(url)
})

ipcMain.on('window_minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window_maximize_toggle', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('window_close', () => {
  mainWindow?.close()
})

ipcMain.handle('window_is_maximized', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false
})

ipcMain.on('claim_window_focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    mainWindow.focusOnWebView()
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
  }
})

ipcMain.on('set_ui_zoom', (_, zoom) => {
  currentUiZoom = zoom;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(zoom);
  }
});

ipcMain.on('set_webview_zoom', (_, zoom) => {
  currentWebviewZoom = zoom;
  for (const view of aiViews.values()) {
    if (view && view.webContents) {
      view.webContents.setZoomFactor(zoom);
    }
  }
});

ipcMain.handle('get_platform', () => {
  return process.platform
})

// Active project directory for intelligent download routing
let activeProjectDir: string | null = null

ipcMain.on('downloads_set_active_project_dir', (_event, dir: string | null) => {
  activeProjectDir = dir && typeof dir === 'string' && dir.trim() ? dir.trim() : null
})

ipcMain.handle('downloads_show_item_in_folder', async (_event, fullPath: string) => {
  if (fullPath && typeof fullPath === 'string' && existsSync(fullPath)) {
    shell.showItemInFolder(fullPath)
  }
})

ipcMain.handle('downloads_open_path', async (_event, fullPath: string) => {
  if (fullPath && typeof fullPath === 'string' && existsSync(fullPath)) {
    return await shell.openPath(fullPath)
  }
  return 'File not found'
})

ipcMain.on('downloads_copy_path', (_event, fullPath: string) => {
  if (fullPath && typeof fullPath === 'string') {
    clipboard.writeText(fullPath)
  }
})

ipcMain.handle('downloads_get_default_dir', async () => {
  return join(app.getPath('downloads'), 'nexus')
})

const registeredSessions = new WeakSet<Electron.Session>()

function injectDownloadToastIntoWebviews(info: {
  id: string
  filename: string
  fullPath: string
  directory: string
  fileSize: number
  mimeType?: string
  isProjectDir: boolean
  timestamp: number
}) {
  const jsonStr = JSON.stringify(info)
  const script = `
    (() => {
      try {
        const info = ${jsonStr};
        let host = document.getElementById('nexus-download-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'nexus-download-host';
          host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;gap:12px;max-width:410px;width:calc(100vw - 40px);pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
          document.body.appendChild(host);
        }

        const formatSize = (bytes) => {
          if (!bytes || bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };

        const ext = (info.filename.split('.').pop() || 'FILE').toUpperCase();
        const shortDir = info.directory.split(/[\\/\\\\]/).filter(Boolean).pop() || info.directory;

        const toast = document.createElement('div');
        toast.id = 'nexus-download-' + info.id;
        toast.style.cssText = 'pointer-events:auto;background:linear-gradient(135deg,rgba(18,22,34,0.96) 0%,rgba(10,12,20,0.98) 100%);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid ' + (info.isProjectDir ? 'rgba(34,211,238,0.45)' : 'rgba(99,102,241,0.45)') + ';border-radius:16px;box-shadow:0 16px 36px rgba(0,0,0,0.7),0 0 24px ' + (info.isProjectDir ? 'rgba(34,211,238,0.2)' : 'rgba(99,102,241,0.2)') + ';padding:14px 16px;color:#f8fafc;display:flex;flex-direction:column;gap:10px;animation:nexusToastIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards;';

        if (!document.getElementById('nexus-download-styles')) {
          const style = document.createElement('style');
          style.id = 'nexus-download-styles';
          style.textContent = '@keyframes nexusToastIn{from{opacity:0;transform:translateY(16px) scale(0.96);}to{opacity:1;transform:translateY(0) scale(1);}} @keyframes nexusToastOut{from{opacity:1;transform:translateY(0) scale(1);}to{opacity:0;transform:translateY(16px) scale(0.96);}}';
          document.head.appendChild(style);
        }

        toast.innerHTML = \`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              <div style="width:36px;height:36px;border-radius:10px;background:\${info.isProjectDir ? 'rgba(34,211,238,0.15)' : 'rgba(99,102,241,0.15)'};border:1px solid \${info.isProjectDir ? 'rgba(34,211,238,0.35)' : 'rgba(99,102,241,0.35)'};display:flex;align-items:center;justify-content:center;color:\${info.isProjectDir ? '#22d3ee' : '#818cf8'};font-size:16px;flex-shrink:0;">
                📥
              </div>
              <div style="display:flex;flex-direction:column;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-weight:700;font-size:13px;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;" title="\${info.filename}">\${info.filename}</span>
                  <span style="font-size:9px;font-family:monospace;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.9);flex-shrink:0;">\${ext}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;margin-top:2px;">
                  <span>\${formatSize(info.fileSize)}</span>
                  <span>•</span>
                  <span style="color:#34d399;font-weight:600;">✓ Downloaded</span>
                </div>
              </div>
            </div>
            <button id="nexus-close-\${info.id}" style="background:transparent;border:none;color:#94a3b8;font-size:15px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;" title="Dismiss">✕</button>
          </div>

          <div style="background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 10px;font-size:11px;font-family:monospace;color:#cbd5e1;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <span style="color:\${info.isProjectDir ? '#22d3ee' : '#818cf8'};">📁</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="\${info.directory}">\${info.isProjectDir ? 'Project: ' + shortDir : 'downloads/nexus'}</span>
            </div>
            \${info.isProjectDir ? '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(34,211,238,0.2);color:#22d3ee;font-weight:700;">PROJECT</span>' : ''}
          </div>

          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            <button id="nexus-open-loc-\${info.id}" style="flex:1.2;background:\${info.isProjectDir ? 'linear-gradient(135deg,#0891b2,#0284c7)' : 'linear-gradient(135deg,#4f46e5,#6366f1)'};border:none;border-radius:8px;padding:7px 10px;color:#ffffff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:all 0.15s;">
              📂 Open Location
            </button>
            <button id="nexus-open-file-\${info.id}" style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:7px 10px;color:#ffffff;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:all 0.15s;">
              ⚡ Open File
            </button>
            <button id="nexus-copy-path-\${info.id}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 9px;color:#94a3b8;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;" title="Copy Full Path">
              📋
            </button>
          </div>
        \`;

        host.appendChild(toast);

        let dismissTimer;
        const removeWithAnim = () => {
          if (toast.parentElement) {
            toast.style.animation = 'nexusToastOut 0.2s cubic-bezier(0.16,1,0.3,1) forwards';
            setTimeout(() => { if (toast.parentElement) toast.remove(); }, 200);
          }
        };

        const startTimer = () => {
          clearTimeout(dismissTimer);
          dismissTimer = setTimeout(removeWithAnim, 8000);
        };

        toast.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
        toast.addEventListener('mouseleave', startTimer);
        startTimer();

        document.getElementById('nexus-close-' + info.id)?.addEventListener('click', removeWithAnim);

        document.getElementById('nexus-open-loc-' + info.id)?.addEventListener('click', () => {
          console.log('__nexus_download_action__:' + JSON.stringify({ action: 'showItemInFolder', fullPath: info.fullPath }));
        });

        document.getElementById('nexus-open-file-' + info.id)?.addEventListener('click', () => {
          console.log('__nexus_download_action__:' + JSON.stringify({ action: 'openPath', fullPath: info.fullPath }));
        });

        const copyBtn = document.getElementById('nexus-copy-path-' + info.id);
        copyBtn?.addEventListener('click', () => {
          console.log('__nexus_download_action__:' + JSON.stringify({ action: 'copyPath', fullPath: info.fullPath }));
          if (copyBtn) {
            copyBtn.textContent = '✓';
            copyBtn.style.color = '#34d399';
            setTimeout(() => {
              if (copyBtn) {
                copyBtn.textContent = '📋';
                copyBtn.style.color = '#94a3b8';
              }
            }, 2000);
          }
        });
      } catch (err) {
        console.error('[Nexus Injected Toast Error]', err);
      }
    })();
  `

  for (const view of aiViews.values()) {
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.executeJavaScript(script).catch(() => {})
    }
  }
}

function registerDownloadHandler(targetSession: Electron.Session) {
  if (registeredSessions.has(targetSession)) return
  registeredSessions.add(targetSession)

  targetSession.on('will-download', (_event, item, _webContents) => {
    const rawFilename = item.getFilename() || 'download'
    const targetDir = activeProjectDir && existsSync(activeProjectDir)
      ? activeProjectDir
      : join(app.getPath('downloads'), 'nexus')

    try {
      mkdirSync(targetDir, { recursive: true })
    } catch (err) {
      console.error('[Nexus Downloads] Failed to create destination directory:', targetDir, err)
    }

    // Determine unique save path avoiding accidental file clobbering
    let savePath = join(targetDir, rawFilename)
    const ext = extname(rawFilename)
    const base = basename(rawFilename, ext)
    let counter = 1
    while (existsSync(savePath)) {
      savePath = join(targetDir, `${base} (${counter})${ext}`)
      counter++
    }

    item.setSavePath(savePath)

    item.on('done', (_doneEvent, state) => {
      if (state === 'completed') {
        const finalPath = item.getSavePath() || savePath
        const isProject = Boolean(activeProjectDir && targetDir === activeProjectDir)
        const downloadInfo = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: basename(finalPath),
          fullPath: finalPath,
          directory: targetDir,
          fileSize: item.getTotalBytes(),
          mimeType: item.getMimeType(),
          isProjectDir: isProject,
          timestamp: Date.now()
        }

        sendToMainWindow('download_completed', downloadInfo)
        injectDownloadToastIntoWebviews(downloadInfo)
      } else if (state === 'interrupted' || state === 'cancelled') {
        console.warn(`[Nexus Downloads] Download ${state}: ${rawFilename}`)
      }
    })
  })
}

async function injectSkillPromptIntoWebview(
  tabId: string,
  promptText: string,
  autoSend: boolean = false
): Promise<boolean> {
  const view = aiViews.get(tabId)
  if (!view || view.webContents.isDestroyed()) return false

  const modelKey = viewModelKeys.get(tabId) || ''
  const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
  const customComposer = feats.composerSelector ? JSON.stringify(feats.composerSelector) : 'null'
  const customSend = feats.sendButtonSelector ? JSON.stringify(feats.sendButtonSelector) : 'null'
  const effectiveAutoSend = autoSend || feats.autoSubmitSkillPrompt === true

  const script = `
    (() => {
      const text = ${JSON.stringify(promptText)};
      const autoSend = ${Boolean(effectiveAutoSend)};
      const customComp = ${customComposer};
      const customSnd = ${customSend};

      const baseSelectors = [
        // Gemini
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        // ChatGPT
        '#prompt-textarea',
        'div#prompt-textarea',
        'textarea[data-id="root"]',
        // Claude
        'div.ProseMirror',
        'div[contenteditable="true"].ProseMirror',
        // Kimi
        'div.chat-input-editor',
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        // Qwen
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([style*="display: none"]):not([disabled])',
        // DeepSeek
        '#chat-input',
        'textarea#chat-input',
        // Perplexity
        'textarea[placeholder*="Ask"]',
        // Generic Fallbacks
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])'
      ];
      const selectors = customComp ? [customComp, ...baseSelectors] : baseSelectors;

      let el = null;
      for (const sel of selectors) {
        const found = document.querySelector(sel);
        if (found && found.offsetParent !== null) {
          el = found;
          break;
        }
      }
      if (!el) {
        for (const sel of selectors) {
          const found = document.querySelector(sel);
          if (found) {
            el = found;
            break;
          }
        }
      }

      if (!el) return false;

      el.focus();

      if (el.isContentEditable) {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      try {
        el.scrollTop = el.scrollHeight;
      } catch(e) {}

      if (autoSend) {
        setTimeout(() => {
          const baseSendSelectors = [
            'button[aria-label*="Send"]',
            'button[data-testid="send-button"]',
            'button[aria-label*="Submit"]',
            '.send-button',
            'button.mb-1.me-1',
            'button[type="submit"]'
          ];
          const sendSelectors = customSnd ? [customSnd, ...baseSendSelectors] : baseSendSelectors;
          for (const s of sendSelectors) {
            const btn = document.querySelector(s);
            if (btn && !btn.disabled && btn.offsetParent !== null) {
              btn.click();
              return;
            }
          }
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }, 200);
      }

      return true;
    })()
  `

  try {
    const result = await view.webContents.executeJavaScript(script)
    return Boolean(result)
  } catch (err) {
    console.error('[injectSkillPromptIntoWebview] Injection error:', err)
    return false
  }
}

// Skills & Project Directory IPC Handlers

ipcMain.handle('switch_to_tauri', () => {
  console.log('Switching to Tauri (Nexus Lite)...')
  
  const projectRoot = process.env.NODE_ENV === 'development' 
    ? path.join(__dirname, '../../')
    : path.join(app.getAppPath(), '../../') // Might need adjustment in prod

  const releaseBin = process.platform === 'win32' 
    ? path.join(projectRoot, 'src-tauri/target/release/nexus.exe')
    : path.join(projectRoot, 'src-tauri/target/release/nexus')

  let child;
  if (fs.existsSync(releaseBin)) {
    child = spawn(releaseBin, [], { detached: true, stdio: 'ignore', cwd: projectRoot, shell: true })
  } else {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    child = spawn(npmCmd, ['run', 'tauri', 'dev'], { detached: true, stdio: 'ignore', cwd: projectRoot, shell: true })
  }
  child.unref()
  setTimeout(() => {
    app.quit()
  }, 200)
})

ipcMain.handle('skills_list', () => skillsEngine.listSkills())
ipcMain.handle('skills_save', (_event, skill: SkillDef) => skillsEngine.saveSkill(skill))
ipcMain.handle('skills_delete', (_event, skillId: string) => skillsEngine.deleteSkill(skillId))
ipcMain.handle('skills_toggle_pin', (_event, skillId: string) => skillsEngine.togglePin(skillId))
ipcMain.handle('skills_increment_usage', (_event, skillId: string) => skillsEngine.incrementUsage(skillId))

ipcMain.handle('skills_get_pinned_categories', () => {
  return skillsEngine.getPinnedCategories()
})
ipcMain.handle('skills_toggle_category_pin', async (_e, cat) => {
  return await skillsEngine.toggleCategoryPin(cat)
})
ipcMain.handle('skills_rename_category', async (_e, oldName, newName) => {
  return await skillsEngine.renameCategory(oldName, newName)
})
ipcMain.handle('skills_delete_category', async (_e, cat) => {
  return await skillsEngine.deleteCategory(cat)
})
ipcMain.handle('skills_assign_category', async (_e, cat, ids) => {
  return await skillsEngine.assignSkillsToCategory(cat, ids)
})
ipcMain.handle('skills_read_file', (_event, filePath: string, projectDir?: string) =>
  skillsEngine.readSkillFile(filePath, projectDir)
)
ipcMain.handle('skills_execute_command', (_event, command: string, projectDir?: string, requireSecurityCheck: boolean = true) =>
  skillsEngine.executeSkillCommand(command, projectDir, requireSecurityCheck)
)
ipcMain.handle('skills_scan_project_files', (_event, projectDir: string) =>
  skillsEngine.scanProjectFiles(projectDir)
)
ipcMain.handle('skills_choose_project_dir', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  return res.filePaths[0] || null
})
ipcMain.handle('skills_get_skills_dir', () => skillsEngine.getSkillsDirectory())
ipcMain.handle('skills_open_skills_dir', async () => {
  const dir = skillsEngine.getSkillsDirectory()
  if (dir) await shell.openPath(dir)
  return true
})
ipcMain.handle('skills_get_safe_commands', () => skillsEngine.getSafeCommands())
ipcMain.handle('skills_add_safe_command', (_event, cmd: string) => skillsEngine.addSafeCommand(cmd))
ipcMain.handle('skills_remove_safe_command', (_event, cmd: string) => skillsEngine.removeSafeCommand(cmd))
ipcMain.handle(
  'skills_inject_prompt',
  async (_event, tabId: string, promptText: string, autoSend: boolean = false) => {
    const targetId = tabId || activeViewId
    if (!targetId) return false
    return injectSkillPromptIntoWebview(targetId, promptText, autoSend)
  }
)

// Broadcast skills updates to renderer windows in real-time
skillsEngine.onSkillsChanged(() => {
  sendToMainWindow('skills_updated')
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

function getTargetWindowBounds() {
  try {
    const currentCursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(currentCursor) || screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize
    const targetW = Math.round(width * 0.82)
    const targetH = Math.round(height * 0.82)
    return {
      width: targetW,
      height: targetH,
      x: Math.round(display.workArea.x + (width - targetW) / 2),
      y: Math.round(display.workArea.y + (height - targetH) / 2)
    }
  } catch {
    return { width: 1574, height: 886 }
  }
}

// ---------------------------------------------------------------------------
// Customizable shortcut routing.
// The renderer pushes the effective keymap (defaults + user customizations)
// via 'set_shortcut_map' and the open state of any fullscreen overlay via
// 'set_overlays_open'. When an overlay is open the renderer owns the keyboard
// entirely (its overlays handle their own keys), so main stops intercepting —
// otherwise in-overlay keys like Ctrl+J/K list navigation, Ctrl+H/L filter
// cycling or Escape would be consumed before the overlay ever saw them.
// ---------------------------------------------------------------------------
const SHORTCUTS_FILE = join(app.getPath('userData'), 'shortcuts.json')

const DEFAULT_ACTION_KEYS: Record<string, string[]> = {
  'tab-cycle': ['Ctrl', 'Tab'],
  'tab-pin': ['Alt', 'P'],
  'model-reload': ['Ctrl', 'R'],
  'settings-open': ['Ctrl', ','],
  'tab-reopen': ['Ctrl', 'Shift', 'T'],
  'tab-new': ['Ctrl', 'T'],
  'tab-close': ['Ctrl', 'W'],
  'history-open': ['Ctrl', 'H'],
  'tab-overview': ['Ctrl', 'Shift', 'A'],
  'sidebar-toggle': ['Ctrl', 'B'],
  'url-bar': ['Ctrl', 'L'],
  'upload-file': ['Ctrl', 'O'],
  'upload-folder': ['Ctrl', 'Shift', 'O'],
  'model-dev-tools': ['Ctrl', 'Shift', 'D'],
  'skills-palette': ['Ctrl', 'S'],
  'skills-base-modal': ['Ctrl', 'Shift', 'S'],
  'fuzzy-cmd': ['Ctrl', 'Shift', 'P'],
  'model-next': ['Ctrl', ']'],
  'model-prev': ['Ctrl', '['],
  'guide-open': ['F1']
}

let customKeymap: Record<string, string[]> = {}
let overlaysOpen = false

function isValidKeymap(map: unknown): map is Record<string, string[]> {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false
  return Object.values(map as Record<string, unknown>).every(
    (v) => Array.isArray(v) && v.every((k) => typeof k === 'string')
  )
}

function loadCustomKeymap(): void {
  try {
    const parsed = JSON.parse(readFileSync(SHORTCUTS_FILE, 'utf-8'))
    if (isValidKeymap(parsed)) customKeymap = parsed
  } catch {}
}

ipcMain.on('set_overlays_open', (_event, open: boolean) => {
  overlaysOpen = Boolean(open)
})

ipcMain.on('set_shortcut_map', (_event, map: unknown) => {
  if (!isValidKeymap(map)) return
  customKeymap = map
  try {
    writeFileSync(SHORTCUTS_FILE, JSON.stringify(map, null, 2))
  } catch {}
})

function actionKeys(id: string): string[] {
  const custom = customKeymap[id]
  if (Array.isArray(custom) && custom.length > 0) return custom
  return DEFAULT_ACTION_KEYS[id] || []
}

// Map physical key codes to their unmodified key so combos like Ctrl+] match
// even when input.key reports a layout-specific character.
const CODE_KEY_MAP: Record<string, string> = {
  KeyB: 'b',
  KeyO: 'o',
  BracketRight: ']',
  BracketLeft: '[',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: ' ',
  Tab: 'tab',
  Escape: 'escape',
  Enter: 'enter'
}

function modifiersMatch(input: Electron.Input, keys: string[]): boolean {
  const eventCtrl = Boolean(input.control || input.meta)
  const hasCtrl = keys.includes('Ctrl') || keys.includes('Control') || keys.includes('Meta')
  return (
    hasCtrl === eventCtrl &&
    keys.includes('Alt') === Boolean(input.alt) &&
    keys.includes('Shift') === Boolean(input.shift)
  )
}

function keyMatches(input: Electron.Input, keys: string[]): boolean {
  const nonMods = keys.filter((k) => !['Ctrl', 'Control', 'Alt', 'Shift', 'Meta'].includes(k))
  if (nonMods.length === 0) return false
  const target = nonMods[0].toLowerCase()
  const eventKey = (input.key || '').toLowerCase()
  if (eventKey && eventKey === target) return true
  if (target === 'b' && (eventKey === 'b' || input.code === 'KeyB' || input.code?.toLowerCase() === 'keyb')) return true
  if (target === 'o' && (eventKey === 'o' || input.code === 'KeyO' || input.code?.toLowerCase() === 'keyo')) return true
  if (eventKey === ' ' && target === 'space') return true
  const codeKey = CODE_KEY_MAP[input.code || '']
  return Boolean(codeKey) && codeKey.toLowerCase() === target
}

function matchesAction(input: Electron.Input, id: string): boolean {
  const keys = actionKeys(id)
  if (keys.length === 0) return false
  return modifiersMatch(input, keys) && keyMatches(input, keys)
}

function routeGlobalShortcut(event: Electron.Event, input: Electron.Input, _source: 'window' | 'view'): boolean {
  if (input.type !== 'keyDown') return false

  const isCtrlOrMeta = Boolean(input.control || input.meta)
  const keyLower = (input.key || '').toLowerCase()
  const code = input.code || ''

  // Escape always also reaches the renderer (non-consuming) so overlays can
  // run their own cancel logic; close_overlay is idempotent.
  if (keyLower === 'escape' || code === 'Escape') {
    sendToMainWindow('execute-global-action', { action: 'close_overlay' })
    return false
  }

  // While a fullscreen overlay is open the renderer owns the keyboard.
  if (overlaysOpen) return false

  // Alt+J / Alt+K -> In-chat prompt navigation (only when active webview is visible)
  const isAltJK = input.alt && !input.control && !input.shift && !input.meta && (
    keyLower === 'j' || keyLower === 'k' || code === 'KeyJ' || code === 'KeyK'
  )
  if (isAltJK) {
    if (activeViewId && activeViewVisible) {
      event.preventDefault()
      const dir: 'older' | 'newer' = (keyLower === 'k' || code === 'KeyK') ? 'older' : 'newer'
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        view.webContents
          .executeJavaScript(buildEngine(dir, feats.promptNavSelector))
          .catch(() => {})
      }
      return true
    }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab -> Cycle tabs
  if (matchesAction(input, 'tab-cycle')) {
    event.preventDefault()
    sendToMainWindow('trigger_tab_cycle', { shift: input.shift })
    return true
  }

  // Alt+P -> Toggle Pin Active Tab
  if (matchesAction(input, 'tab-pin')) {
    if (activeViewId) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action: 'toggle_pin', tabId: activeViewId })
    }
    return true
  }

  // Ctrl+R -> Reload Active View directly in main
  if (matchesAction(input, 'model-reload')) {
    event.preventDefault()
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload()
    }
    return true
  }

  // Ctrl+O -> Upload File directly in main (guarded against repeat & renderer bounce)
  if (matchesAction(input, 'upload-file')) {
    event.preventDefault()
    if (input.isAutoRepeat) return true
    if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        const modelKey = viewModelKeys.get(activeViewId) || ''
        const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
        handleFileUpload(view, mainWindow, feats.attachmentSelector).catch((err) => {
          console.error('Failed to handle file upload:', err)
        })
      }
    }
    return true
  }

  // Ctrl+Shift+O -> Upload Folder directly in main (guarded against repeat & renderer bounce)
  if (matchesAction(input, 'upload-folder')) {
    event.preventDefault()
    if (input.isAutoRepeat) return true
    if (activeViewId && mainWindow && !mainWindow.isDestroyed()) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        handleFolderUpload(view, mainWindow).catch((err) => {
          console.error('Failed to handle folder upload:', err)
        })
      }
    }
    return true
  }

  // Keymap-driven actions (each honors user customizations from Settings)
  const keymapActions: Array<[string, string]> = [
    ['settings-open', 'toggle_settings'],
    ['tab-reopen', 'reopen_tab'],
    ['tab-new', 'new_tab'],
    ['tab-close', 'close_tab'],
    ['history-open', 'toggle_history'],
    ['tab-overview', 'toggle_tab_overview'],
    ['sidebar-toggle', 'toggle_sidebar'],
    ['url-bar', 'toggle_url_bar'],
    ['fuzzy-cmd', 'toggle_url_bar'],
    ['skills-palette', 'toggle_skills'],
    ['skills-base-modal', 'toggle_base_skills'],
    ['model-next', 'model_next'],
    ['model-prev', 'model_prev'],
    ['guide-open', 'guide_open'],
    ['export-context', 'toggle_export']
  ]
  for (const [id, action] of keymapActions) {
    if (matchesAction(input, id)) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action })
      return true
    }
  }

  // Ctrl+J / Ctrl+K -> Previous / Next tab
  if (matchesAction(input, 'tab-prev') || matchesAction(input, 'tab-next')) {
    event.preventDefault()
    const prev = matchesAction(input, 'tab-prev')
    sendToMainWindow('execute-global-action', { action: 'navigate_tab', direction: prev ? 'prev' : 'next' })
    return true
  }

  // Ctrl+Shift+D or Ctrl+Shift+I -> DevTools
  if (
    matchesAction(input, 'model-dev-tools') ||
    (isCtrlOrMeta && input.shift && !input.alt && (keyLower === 'i' || code === 'KeyI'))
  ) {
    event.preventDefault()
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.openDevTools({ mode: 'detach' })
    }
    return true
  }

  // Digits 1..9: Ctrl+1..9 (regular tab) or Alt+1..9 (pinned tab)
  const digitMatch = keyLower.match(/^[1-9]$/)
  if (digitMatch && !input.shift) {
    const digit = parseInt(digitMatch[0], 10)
    if (isCtrlOrMeta && !input.alt) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action: 'switch_tab_index', index: digit - 1, isPinned: false })
      return true
    } else if (input.alt && !isCtrlOrMeta) {
      event.preventDefault()
      sendToMainWindow('execute-global-action', { action: 'switch_tab_index', index: digit - 1, isPinned: true })
      return true
    }
  }

  // Zoom: Ctrl+Minus, Ctrl+Equal, Ctrl+0, Numpad (Shift = UI zoom)
  if (isCtrlOrMeta && !input.alt && (code === 'Minus' || code === 'Equal' || code === 'Digit0' || code === 'NumpadAdd' || code === 'NumpadSubtract' || code === 'Numpad0')) {
    event.preventDefault()
    sendToMainWindow('execute-global-action', { action: 'zoom', code, shift: input.shift })
    return true
  }

  return false
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const bounds = getTargetWindowBounds()

  mainWindow = new BrowserWindow({
    title: 'Nexus',
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: true,
    autoHideMenuBar: true,
    frame: process.platform === 'linux',
    ...(process.platform !== 'linux' ? {
      titleBarStyle: 'hidden'
    } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: ['--js-flags=--max-old-space-size=256']
    }
  })

  mainWindow.setMenu(null)

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  })

  // When the OS window regains focus, hand Chromium focus to whichever surface
  // is visible so keyboard input is never swallowed:
  //  - webview visible → AI view (focus-retention script restores the caret)
  //  - webview hidden (overlay open) → React renderer so overlay shortcuts work
  mainWindow.on('focus', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (activeViewVisible && !overlaysOpen && activeViewId) {
      const view = aiViews.get(activeViewId)
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.focus()
        focusPromptInView(view)
      }
    } else if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.focusOnWebView()
      mainWindow.webContents.focus()
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    } else {
      if (previewTimer) {
        clearInterval(previewTimer)
        previewTimer = null
      }
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    routeGlobalShortcut(event, input, 'window')
  })

  // Fix #2: Stop 3fps screenshot capture when window is hidden to tray
  mainWindow.on('hide', () => {
    if (previewTimer) {
      clearInterval(previewTimer)
      previewTimer = null
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    currentUiZoom = 1.0; // reset on destroy if needed
  })

  mainWindow.on('app-command', (_e, cmd) => {
    if (!activeViewId) return
    const activeView = aiViews.get(activeViewId)
    if (!activeView || activeView.webContents.isDestroyed()) return
    if (cmd === 'browser-backward') {
      if (activeView.webContents.navigationHistory.canGoBack()) {
        activeView.webContents.navigationHistory.goBack()
        sendToMainWindow('history-nav-hud', { action: 'back', message: '← Back' })
      } else {
        sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'Start of History' })
      }
    } else if (cmd === 'browser-forward') {
      if (activeView.webContents.navigationHistory.canGoForward()) {
        activeView.webContents.navigationHistory.goForward()
        sendToMainWindow('history-nav-hud', { action: 'forward', message: '→ Forward' })
      } else {
        sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'End of History' })
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isDevUrl =
      is.dev &&
      process.env['ELECTRON_RENDERER_URL'] &&
      url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    const isProdUrl = url.startsWith('file://') && url.includes('renderer/index.html')
    if (!isDevUrl && !isProdUrl) {
      e.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Wayland stays default (X11+NVIDIA GPU presenter is broken); GPU is disabled so
// Chromium never inits Vulkan (Wayland surface_factory + Vulkan incompatibility error).
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
app.commandLine.appendSwitch('enable-wayland-ime')
app.commandLine.appendSwitch('wayland-text-input-version', '3')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
// NOTE: GPU is intentionally ENABLED. A previous build disabled it for RAM and
// for an NVIDIA crash that does not apply here (this machine uses the Intel
// iGPU, which Chromium drives fine — verified). Disabling the GPU kills WebGL
// entirely in the AI webviews ("no webgl context"), which Google's sign-in risk
// engine reads as a non-Chrome/automated browser and rejects the flow with
// /v3/signin/rejected ("This browser or app may not be secure"). Real Chrome on
// this machine exposes the Intel GPU via WebGL.
app.commandLine.appendSwitch('process-per-site')

// userData pinned: renaming package.json must never orphan tabs/logins again
app.setPath('userData', join(app.getPath('appData'), 'nexus'))

const thumbnailsDir = join(app.getPath('userData'), 'thumbnails')
mkdirSync(thumbnailsDir, { recursive: true })

// thumb:// must be privileged BEFORE app ready: standard+secure so the renderer
// (http://localhost:5173) may fetch images from it without CORS/opaque errors.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.nexus.app')

  loadCustomKeymap()
  loadThemeFromDisk()
  loadProviderConfigFromDisk()
  session.fromPartition('persist:ai-shared').clearCache().catch(console.error)

  // One-time migration: the old OAuth cookie bridge left empty/corrupted
  // Google cookies in the AI webview partition (blank page on Gemini).
  // Purge them once so the webview shows a fresh sign-in screen. The flag
  // ensures a subsequent valid in-webview sign-in is never wiped.
  const authRemovedFlag = join(app.getPath('userData'), 'oauth-removed.flag')
  if (!existsSync(authRemovedFlag)) {
    const aiSession = session.fromPartition('persist:ai-shared')
    aiSession.cookies
      .get({})
      .then((cookies) => {
        const google = cookies.filter((c) => (c.domain || '').toLowerCase().includes('google'))
        return Promise.all(
          google.map((c) => {
            const host = (c.domain || '').replace(/^\./, '')
            return aiSession.cookies.remove(
              `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`,
              c.name
            )
          })
        )
      })
      .then(() => {
        mkdirSync(app.getPath('userData'), { recursive: true })
        writeFileSync(authRemovedFlag, new Date().toISOString(), { mode: 0o600 })
      })
      .catch(console.error)
  }

  // thumb:// serves JPEG thumbnails from the disk-backed thumbnails dir.
  // 'thumb://abc.jpg' parses as hostname 'abc.jpg' + empty pathname, so
  // concatenating hostname+pathname reconstructs the original filename.
  protocol.handle('thumb', async (request) => {
    try {
      const parsed = new URL(request.url)
      const filename = decodeURIComponent(parsed.hostname + parsed.pathname)
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '')
      const filePath = join(thumbnailsDir, safe)
      const data = await readFileSync(filePath)
      return new Response(data, { headers: { 'Content-Type': 'image/jpeg' } })
    } catch {
      return new Response('', { status: 404 })
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    window.webContents.userAgent = AI_UA
    window.webContents.setWindowOpenHandler(() => {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:ai-shared',
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      }
    })
  })

  // Task B3: Network Telemetry Blocker
  session
    .fromPartition('persist:ai-shared')
    .webRequest.onBeforeRequest(
      {
        urls: [
          '*://sentry.io/*',
          '*://*.sentry.io/*',
          '*://google-analytics.com/*',
          '*://*.google-analytics.com/*',
          '*://posthog.com/*',
          '*://*.posthog.com/*'
        ]
      },
      (_details, callback) => {
        callback({ cancel: true })
      }
    )

  session.fromPartition('persist:ai-shared').webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }

    for (const key of Object.keys(requestHeaders)) {
      if (key.toLowerCase() === 'user-agent') {
        requestHeaders[key] = AI_UA
      }
    }

    callback({ requestHeaders })
  })

  session.fromPartition('persist:ai-shared').webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    const headersToRemove = [
      'x-frame-options',
      'X-Frame-Options',
      'content-security-policy',
      'Content-Security-Policy',
      'cross-origin-opener-policy',
      'Cross-Origin-Opener-Policy',
      'cross-origin-embedder-policy',
      'Cross-Origin-Embedder-Policy'
    ]

    for (const header of headersToRemove) {
      if (responseHeaders[header]) delete responseHeaders[header]
    }

    callback({ cancel: false, responseHeaders })
  })

  // Register intelligent download manager routing
  registerDownloadHandler(session.fromPartition('persist:ai-shared'))
  registerDownloadHandler(session.defaultSession)
  app.on('web-contents-created', (_event, contents) => {
    if (contents && contents.session) {
      registerDownloadHandler(contents.session)
    }
  })

  createWindow()

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show / Hide Nexus', click: () => { toggleMainWindow() } },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('Nexus AI')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    toggleMainWindow()
  })

  const noHotkey = process.argv.includes('--no-hotkey')
  const hotkeyArg = process.argv.find((a) => a.startsWith('--hotkey='))
  let customHotkey = hotkeyArg ? hotkeyArg.split('=')[1] : null

  if (!customHotkey && !noHotkey) {
    try {
      const configPath = join(app.getPath('userData'), 'config.json')
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (cfg.hotkey === false || cfg.hotkey === 'none') customHotkey = 'none'
      else if (typeof cfg.hotkey === 'string') customHotkey = cfg.hotkey
    } catch {
      // no config file or invalid json
    }
  }

  const finalHotkey = customHotkey === 'none' || noHotkey ? null : customHotkey || 'Alt+Space'
  updateGlobalHotkey(finalHotkey)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // e.preventDefault() not needed, removing app.quit() is enough
})


function focusPromptInView(view: Electron.WebContentsView | null | undefined, modelKey?: string): void {
  if (!view || view.webContents.isDestroyed()) return
  const feats = modelKey ? getMergedProviderFeatures(modelKey, providerConfig[modelKey]) : null
  const customSel = feats?.composerSelector ? JSON.stringify(feats.composerSelector) : 'null'
  const script = `
    (() => {
      const custom = ${customSel};
      const baseSelectors = [
        // Gemini
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        // ChatGPT
        '#prompt-textarea',
        'div#prompt-textarea',
        'textarea[data-id="root"]',
        // Claude
        'div.ProseMirror',
        'div[contenteditable="true"].ProseMirror',
        // Kimi
        'div.chat-input-editor',
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        // Qwen
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([style*="display: none"]):not([disabled])',
        // DeepSeek
        '#chat-input',
        'textarea#chat-input',
        // Perplexity
        'textarea[placeholder*="Ask"]',
        // Generic Fallbacks
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])'
      ];
      const selectors = custom ? [custom, ...baseSelectors] : baseSelectors;

      const tryFocus = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null && !el.disabled) {
            el.focus({ preventScroll: false });
            if (typeof el.selectionStart === 'number') {
              el.selectionStart = el.selectionEnd = el.value.length;
            } else if (window.getSelection && document.createRange) {
              try {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              } catch (_) {}
            }
            return true;
          }
        }
        return false;
      };

      if (!tryFocus()) {
        setTimeout(tryFocus, 50);
        setTimeout(tryFocus, 150);
        setTimeout(tryFocus, 350);
      }
    })();
  `
  view.webContents.executeJavaScript(script).catch(() => {})
}

function buildWebviewRuntimeJs(modelKey?: string): string {
  const resolvedKey = modelKey || ''
  const globalOv = providerConfig['ALL'] || providerConfig['global'] || {}
  const specificOv = providerConfig[resolvedKey] || {}
  const feats = getMergedProviderFeatures(resolvedKey, specificOv, globalOv)

  const customComp = feats.composerSelector ? JSON.stringify(feats.composerSelector) : 'null'
  const customTitleSel = feats.chatTitleSelector ? JSON.stringify(feats.chatTitleSelector) : 'null'
  const pollInterval = typeof feats.chatTitlePollingIntervalMs === 'number' ? feats.chatTitlePollingIntervalMs : 1500
  const enableSlash = feats.enableSlashFocus !== false
  const enableRetention = feats.enableFocusRetention !== false
  const virtSelector = feats.virtualizationSelector
    ? feats.virtualizationSelector
    : '[class*="user-query"]:not([class*="assistant"]), .qwen-chat-message-user, .segment.segment-user, .user-query-bubble-with-background'
  const customInit = feats.customInitScript || ''

  return `/* === Nexus AI Webview Runtime Automation Script === */
/* Target Provider: ${resolvedKey || 'Universal'} */

// 0. Fix Shift+Scroll for horizontal scrolling in code blocks (Universal Linux/Electron Quirks fix)
if (!window.__nexusShiftScrollInjected) {
  window.addEventListener('wheel', (e) => {
    // If we receive a purely vertical scroll with Shift held (Electron Linux quirk)
    if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
      e.preventDefault();
      e.stopPropagation(); // Hide the broken event from Monaco/React
      
      // Dispatch a corrected horizontal event
      const correctedEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaY, // Translate vertical to horizontal
        deltaY: 0,
        deltaZ: 0,
        deltaMode: e.deltaMode,
        shiftKey: false // Strip shift so it looks like a pure horizontal trackpad scroll
      });
      e.target.dispatchEvent(correctedEvent);
    }
  }, { capture: true, passive: false });
  window.__nexusShiftScrollInjected = true;
}

// 1. Global '/' shortcut to focus chat prompt
if (!window.__slashFocusInjected && ${enableSlash}) {
  window.addEventListener('keydown', (e) => {
    // Ignore if user is already typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      const custom = ${customComp};
      const baseSelectors = [
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        '#prompt-textarea',
        'div#prompt-textarea',
        'textarea[data-id="root"]',
        'div.ProseMirror',
        'div[contenteditable="true"].ProseMirror',
        'div.chat-input-editor',
        '.chat-input [contenteditable="true"]',
        '.chat-input textarea',
        'textarea#chat-input', 'textarea[class*="chat-input"]', 'textarea.ant-input:not([style*="display: none"]):not([disabled])',
        '#chat-input',
        'textarea#chat-input',
        'textarea[placeholder*="Ask"]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea:not([disabled])',
        'input[type="text"]:not([disabled])'
      ];
      const selectors = custom ? [custom, ...baseSelectors] : baseSelectors;
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null && !el.disabled) {
          el.focus();
          if (typeof el.selectionStart === 'number') {
            el.selectionStart = el.selectionEnd = el.value.length;
          }
          break;
        }
      }
    }
  });
  window.__slashFocusInjected = true;
}

// 2. Chat Title Extractor / Polling
if (!window.__titleExtractionInjected) {
  const titleSel = ${customTitleSel};
  if (titleSel && ${pollInterval > 0}) {
    setInterval(() => {
      try {
        const el = document.querySelector(titleSel);
        const txt = el ? (el.innerText || el.textContent || '').trim() : '';
        if (txt && document.title !== txt) {
          document.title = txt;
        }
      } catch(e) {}
    }, ${pollInterval});
  }
  window.__titleExtractionInjected = true;
}

// 3. Focus retention
if (!window.__focusRetentionInjected && ${enableRetention}) {
  let __savedFocus = null;
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) {
      __savedFocus = {
        el,
        start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
        end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null
      };
    }
  }, true);

  const __restoreFocus = () => {
    if (__savedFocus && __savedFocus.el && __savedFocus.el.isConnected) {
      const saved = __savedFocus;
      __savedFocus = null;
      try {
        saved.el.focus({ preventScroll: true });
        if (saved.start !== null && saved.el.setSelectionRange) {
          saved.el.setSelectionRange(saved.start, saved.end);
        }
      } catch(e) {}
    }
  };
  window.addEventListener('focus', __restoreFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') __restoreFocus();
  });
  window.__focusRetentionInjected = true;
}

// 4. Virtualized Chat Rendering (Memory Optimization)
if (!window.__virtualizedChatInjected) {
  const style = document.createElement('style');
  style.textContent = \`
    \${${JSON.stringify(virtSelector)}} {
      content-visibility: auto;
      contain-intrinsic-size: 1px 100px;
    }
  \`;
  document.head.appendChild(style);
  window.__virtualizedChatInjected = true;
}

// 5. Custom Injected User Script
try {
  ${customInit}
} catch (err) {
  console.error('[Nexus Custom Init Script Error]', err);
}
`
}

function ensureAiView(tabId: string): Electron.WebContentsView {
  let view = aiViews.get(tabId)
  if (view) return view

  view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:ai-shared',
      backgroundThrottling: true
    }
  })

  view.webContents.userAgent = AI_UA
  view.webContents.setZoomFactor(currentWebviewZoom);
  view.webContents.setZoomFactor(currentWebviewZoom);
  setViewBackground(view)
  view.setVisible(false)

  view.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'copy' },
      { role: 'paste' },
      { role: 'cut' },
      { type: 'separator' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Go Back', click: () => { if (view.webContents.canGoBack()) view.webContents.goBack() } },
      { label: 'Reload Page', click: () => view.webContents.reload() },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) }
    ]
    const menu = Menu.buildFromTemplate(template)
    menu.popup()
  })

  view.webContents.on('render-process-gone', (_e, details) => {
    if (tabId === activeViewId) {
      console.log(`[Lifecycle] Active tab ${tabId} discarded by OS (${details.reason}). Auto-reloading...`)
      try {
        view.webContents.reload()
      } catch (err) {
        console.error('[Lifecycle] Failed to auto-reload:', err)
      }
    }
  })

  // Catch newly created popup windows (like OAuth or target="_blank" links)
  view.webContents.on('did-create-window', (popupWindow) => {
    popupWindow.on('closed', () => {
      if (activeViewId === tabId && activeViewVisible && !overlaysOpen && !view.webContents.isDestroyed()) {
        view.webContents.focus()
        focusPromptInView(view)
      }
    })
    popupWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key.toLowerCase() === 'l' && input.type === 'keyDown') {
        event.preventDefault();
        const currentUrl = popupWindow.webContents.getURL();
        
        // Spawn a tiny frameless window as the URL bar to completely bypass CSP
        const win = new BrowserWindow({
          width: 600,
          height: 60,
          parent: popupWindow,
          modal: true,
          frame: false,
          transparent: true,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        });
        
        const html = `
          <html>
          <body style="margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="width:100%;height:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;display:flex;align-items:center;padding:0 12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);box-sizing:border-box;">
              <input id="u" value="${currentUrl}" style="flex:1;background:#0f172a;color:#f8fafc;padding:10px 14px;border:1px solid #475569;border-radius:6px;font-size:14px;outline:none;font-family:sans-serif;" />
              <button id="c" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:8px 12px;margin-left:4px;">✕</button>
            </div>
            <script>
              const { ipcRenderer } = require('electron');
              const u = document.getElementById('u');
              u.select();
              u.focus();
              u.onkeydown = (e) => {
                if (e.key === 'Enter') ipcRenderer.send('popup-nav-' + ${win.id}, u.value);
                if (e.key === 'Escape') ipcRenderer.send('popup-close-' + ${win.id});
              };
              document.getElementById('c').onclick = () => ipcRenderer.send('popup-close-' + ${win.id});
            </script>
          </body>
          </html>
        `;
        
        // using global ipcMain
        const navHandler = (_e, url) => {
          let finalUrl = url.trim();
          if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
          popupWindow.webContents.loadURL(finalUrl);
          win.close();
        };
        const closeHandler = () => win.close();
        
        ipcMain.once('popup-nav-' + win.id, navHandler);
        ipcMain.once('popup-close-' + win.id, closeHandler);
        
        win.on('closed', () => {
          ipcMain.removeListener('popup-nav-' + win.id, navHandler);
          ipcMain.removeListener('popup-close-' + win.id, closeHandler);
        });
        
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      }
    });
  });

  // Allow OAuth popup windows to open with window.opener in the shared AI partition
  view.webContents.setWindowOpenHandler((_details) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow ?? undefined,
        autoHideMenuBar: true,
        width: 550,
        height: 680,
        center: true,
        webPreferences: {
          partition: 'persist:ai-shared',
          nodeIntegration: false,
          contextIsolation: true
        }
      }
    }
  })

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.addChildView(view)
    } catch {}
  }

  // Forward keyboard events (like global shortcuts) from the inner view back to the main window,
  // handling all global shortcuts through unified native IPC routing.
  view.webContents.on('before-input-event', (event, input) => {
    if (routeGlobalShortcut(event, input, 'view')) {
      return
    }

    // Intercept global Ctrl/Cmd shortcuts so Chromium and webview single-page apps don't trigger
    // internal/browser actions (e.g. Save As on Ctrl+S, new window on Ctrl+N, internal search)
    const isControlOrMeta = Boolean(input.control || input.meta)
    const keyLower = (input.key || '').toLowerCase()
    const isB = keyLower === 'b' || input.code === 'KeyB' || input.code?.toLowerCase() === 'keyb'
    const globalKeys = ['b', 'd', 's', 'n', 'o']
    if (input.type === 'keyDown' && isControlOrMeta && !input.alt && (globalKeys.includes(keyLower) || isB)) {
      event.preventDefault()
    }
  })

  view.webContents.on('page-title-updated', (_event, title) => {
    viewTitles.set(tabId, title) // Fix #1: Track titles for proper idle eviction
    const modelKey = viewModelKeys.get(tabId) || ''
    const feats = getMergedProviderFeatures(modelKey, providerConfig[modelKey])
    const defaultTitles = feats.defaultChatTitles || []
    const isDefault = defaultTitles.some((t) => {
      const defaultLower = t.toLowerCase().trim();
      const titleLower = (title || '').toLowerCase().trim();
      return titleLower === defaultLower || 
             titleLower.startsWith(defaultLower + ' -') || 
             titleLower.startsWith(defaultLower + ' |') ||
             titleLower === 'chatgpt' ||
             titleLower === 'qwen' ||
             titleLower === 'claude' || titleLower === 'google gemini' || titleLower === 'kimi ai' || titleLower === 'qwen studio';
    });
    
    // Also ignore empty titles or generic "new chat" variations
    const genericNoise = !title || title.trim() === '' || /^new chat\b/i.test(title.trim()) || title.trim().startsWith('http://') || title.trim().startsWith('https://') || title.trim().toLowerCase() === 'loading' || title.trim().toLowerCase() === 'loading...';

    if (isDefault || genericNoise) {
      // Filter out generic default title noise
      return
    }
    sendToMainWindow('ai-title-updated', tabId, title)
  })

  view.webContents.on('dom-ready', () => {
    applyWebviewTheme(view, viewModelKeys.get(tabId))
  })

  view.webContents.on('did-finish-load', () => {
    const modelKey = viewModelKeys.get(tabId) || ''
    applyWebviewTheme(view, modelKey)
    if (activeViewId === tabId && activeViewVisible && !overlaysOpen) {
      focusPromptInView(view, modelKey)
    }

    const script = buildWebviewRuntimeJs(modelKey)
    view.webContents.executeJavaScript(script).catch((err) => console.error(err))
  })

  view.webContents.on('did-navigate', (_event, url) => {
    viewCssState.delete(view.webContents)
    sendToMainWindow('ai-url-updated', tabId, url)
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    sendToMainWindow('ai-url-updated', tabId, url)
  })
  view.webContents.on('did-start-loading', () => {
    sendToMainWindow('ai-loading', tabId, true)
  })
  view.webContents.on('did-stop-loading', () => {
    sendToMainWindow('ai-loading', tabId, false)
    // Never steal focus from an open renderer overlay (popups/modals): a
    // background load finishing a few seconds later would otherwise yank
    // keyboard focus out of the overlay's input.
    if (
      !overlaysOpen &&
      activeViewId === tabId &&
      activeViewVisible &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !view.webContents.isDestroyed()
    ) {
      view.webContents.focus()
      focusPromptInView(view)
    }
  })

  // Console message interceptor for in-webview download action buttons
  view.webContents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.startsWith('__nexus_download_action__:')) {
      try {
        const payload = JSON.parse(message.slice('__nexus_download_action__:'.length))
        if (payload.action === 'showItemInFolder' && payload.fullPath) {
          if (existsSync(payload.fullPath)) {
            shell.showItemInFolder(payload.fullPath)
          }
        } else if (payload.action === 'openPath' && payload.fullPath) {
          if (existsSync(payload.fullPath)) {
            shell.openPath(payload.fullPath)
          }
        } else if (payload.action === 'copyPath' && payload.fullPath) {
          clipboard.writeText(payload.fullPath)
        }
      } catch (err) {
        console.error('[Nexus Download Action Console Error]', err)
      }
    }
  })

  aiViews.set(tabId, view)
  lastAccessedTimestamps.set(tabId, Date.now())
  return view
}

ipcMain.on('navigate_to_url', (_event, tabId, url, bounds, modelKey) => {
  console.log('[navigate_to_url]', tabId, url)
  resolveModelKey(tabId, url, modelKey)
  
  if (currentUiZoom !== 1.0 && bounds) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }
  
  const view = ensureAiView(tabId)
  applyWebviewTheme(view, viewModelKeys.get(tabId))
  view.setBounds(bounds)
  if (bounds.width > 0) lastRealBounds.set(tabId, bounds)
  view.webContents.loadURL(url)
})

// Webview theming: inject the active app theme's own colors into AI pages.
// Persisted to disk so views are born themed on cold start (no raw-style flash),
// and re-applied on every dom-ready/did-finish-load so navigations keep it.
let webviewTheme: { on: boolean; colors: Record<string, string> | null; radius?: number } | null =
  null

function themeFile() {
  return join(app.getPath('userData'), 'theme.json')
}

function loadThemeFromDisk() {
  try {
    const raw = readFileSync(themeFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'colors' in parsed) webviewTheme = parsed
  } catch {
    // first run: no theme file yet
  }
}

function persistTheme() {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    writeFileSync(themeFile(), JSON.stringify(webviewTheme ?? null))
  } catch {
    // non-fatal: theme still applies in-session
  }
}

function setViewBackground(view) {
  const bg = webviewTheme?.on && webviewTheme.colors?.bg ? webviewTheme.colors.bg : '#1a1a2e'
  view.setBackgroundColor(bg)
}

// Per-provider webview overrides (keyed by ModelDef.key), owned by main and
// persisted so views are born customized on cold start. Renderer syncs via
// get_provider_config / set_provider_config IPC.

// Live-preview capture stream (Settings → Webview tab). Captures the REAL
// view (no duplicate page), streams ~3fps to the renderer panel.
let previewTimer: NodeJS.Timeout | null = null
let previewViewId: string | null = null
let previewRestoreBounds: Electron.Rectangle | null = null
// Last non-zero view bounds per tab — used to un-hide a view for capture while
// the settings overlay covers it.
const lastRealBounds = new Map<string, Electron.Rectangle>()
let resizeThemeTimer: NodeJS.Timeout | null = null

function providerConfigFile() {
  return join(app.getPath('userData'), 'providers.json')
}

function loadProviderConfigFromDisk() {
  try {
    const raw = readFileSync(providerConfigFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') providerConfig = parsed
  } catch {
    // first run: no file yet
  }
}

function persistProviderConfig() {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    writeFileSync(providerConfigFile(), JSON.stringify(providerConfig, null, 2))
  } catch {
    // non-fatal
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  )
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function isDarkColor(hex) {
  const { r, g, b } = hexToRgb(hex)
  // Perceived luminance (WCAG-ish): dark <= 0.45
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 <= 0.45
}

function buildWebviewThemeCss(themeData, url, viewWidthPx, overrides, modelKey?: string) {
  const colors = themeData.colors || {}
  const dark = isDarkColor(colors.bg || '#1a1a2e')
  const vars = {
    bg: colors.bg || '#1a1a2e',
    surface: colors.surface || '#16213e',
    surface2: colors.surface2 || '#0f3460',
    accent: colors.accent || '#e94560',
    text: colors.text || '#eaeaea',
    text2: colors.text2 || '#8899aa',
    border: colors.border || '#2a2a2e',
    radius: themeData.radius ?? 8,
    borderWidth: 1,
    ambientAura: themeData.ambientAura,
    ambientAuraMode: themeData.ambientAuraMode,
    ambientAuraIntensity: themeData.ambientAuraIntensity,
    ambientAuraColor: themeData.ambientAuraColor,
    bubbleStyle: themeData.bubbleStyle,
    bubbleGradientDepth: themeData.bubbleGradientDepth,
    codeBlockStyle: themeData.codeBlockStyle,
    codeBlockMargin: themeData.codeBlockMargin,
    composerGlow: themeData.composerGlow,
    composerHaloIntensity: themeData.composerHaloIntensity,
    messageGap: themeData.messageGap,
    aiResponseWidthPx: themeData.aiResponseWidthPx,
    userPromptWidthPx: themeData.userPromptWidthPx,
    cssFeatures: overrides?.cssFeatures || {}
  }
  const merged = mergeOverrides(vars, overrides)
  if (merged.pageWidthPx != null && typeof viewWidthPx === 'number' && viewWidthPx > 0) {
    merged.pageWidthPx = Math.max(320, Math.min(merged.pageWidthPx, viewWidthPx - 40))
  }
  let host = ''
  try {
    host = url ? new URL(url).host : ''
  } catch {
    host = ''
  }
  const provider = PROVIDER_THEMES.find((p) =>
    p.hosts.some((h) => host === h || host.endsWith('.' + h))
  )
  let css = provider ? provider.css(merged) : genericFallbackCss(merged, dark)
  
  // Apply customthemes.conf if exists
  const customKey = modelKey || resolveModelKey('', url)
  if (customKey) {
    const customEntry = getCustomThemeEntry(customKey, host)
    if (customEntry && customEntry.enabled && customEntry.css) {
      css += '\n\n/* customthemes.conf */\n' + customEntry.css
    }
  }
  
  // Sanitize customCss before appending: strip bare property declarations
  // (lines like "--bg: #0a0a0f;" outside any selector block) and validate
  // the CSS doesn't start with naked text that crashes the parser.
  if (overrides?.customCss) {
    let userCss = overrides.customCss.trim()
    const lines = userCss.split('\n')
    const cleaned: string[] = []
    let insideBlock = 0
    let insideComment = false
    for (const line of lines) {
      const trimmed = line.trim()
      
      if (trimmed.includes('/*')) insideComment = true
      
      if (!insideComment) {
        for (const ch of trimmed) {
          if (ch === '{') insideBlock++
          if (ch === '}') insideBlock = Math.max(0, insideBlock - 1)
        }
      }
      
      let skip = false
      if (!insideComment && insideBlock === 0) {
        if (/^--[\w-]+\s*:/.test(trimmed)) skip = true
        else if (trimmed.length > 0 && !trimmed.startsWith('/') && !trimmed.startsWith('@') && !trimmed.includes('{') && !trimmed.includes('}') && !trimmed.includes(':') && !trimmed.includes(';') && !trimmed.endsWith(',')) skip = true
      }
      
      if (trimmed.includes('*/')) insideComment = false
      
      if (!skip) cleaned.push(line)
    }
    userCss = cleaned.join('\n').trim()
    if (userCss) css += '\n' + userCss
  }
  
  return css
}

function genericFallbackCss(v, dark) {
  const feat = v.cssFeatures || { structural: true, colors: true, bubbles: true, typography: true }
  
  const doStruct = feat.structural !== false
  const doColor = feat.colors !== false
  const doBubble = feat.bubbles !== false
  const doTypo = feat.typography !== false

  const typography: string[] = []
  if (doTypo) {
    if (v.fontWeight != null) typography.push(`font-weight: ${v.fontWeight} !important;`)
    if (v.fontSize != null) typography.push(`font-size: ${v.fontSize}px !important;`)
    if (v.fontFamily) typography.push(`font-family: ${v.fontFamily} !important;`)
    if (v.lineHeight != null) typography.push(`line-height: ${v.lineHeight} !important;`)
    if (v.letterSpacing != null) typography.push(`letter-spacing: ${v.letterSpacing}px !important;`)
  }
  const bodyTypography = typography.length ? `body { ${typography.join(' ')} }` : ''

  return `
    ${getStructuralVars(v)}
    :root {
      --nexus-bg: ${v.bg};
      --nexus-surface: ${v.surface};
      --nexus-surface2: ${v.surface2};
      --nexus-accent: ${v.accent};
      --nexus-text: ${v.text};
      --nexus-text2: ${v.text2};
      --nexus-border: ${v.border};
      --radius: ${v.radius ?? 8}px;
    }
    ${doColor ? `
    html { background-color: var(--nexus-bg) !important; color-scheme: ${dark ? 'dark' : 'light'} !important; }
    body { background-color: var(--nexus-bg) !important; ${bodyTypography} }
    ::selection { background: var(--nexus-accent) !important; color: var(--nexus-bg) !important; }
    a { color: var(--nexus-accent) !important; }
    input, textarea, [contenteditable="true"] { caret-color: var(--nexus-accent) !important; }
    ` : ''}
    
    * { scrollbar-color: var(--nexus-surface2) var(--nexus-surface) !important; scrollbar-width: thin !important; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-thumb { background: var(--nexus-surface2) !important; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--nexus-accent) !important; }
    ::-webkit-scrollbar-track { background: transparent !important; }

    /* Universal Code Block & Container Safety for Unthemed / Custom Agents */
    pre, code, pre > code, .code-block, [class*="code-block"], [class*="codeBlock"] {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    pre {
      overflow-x: auto !important;
      white-space: pre !important;
      word-break: normal !important;
      word-wrap: normal !important;
    }
    html, body, #root, #app, #__next, main, [class*="chat-history"], [class*="conversation"] {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    ${
      v.ambientAura && v.ambientAuraMode === 'chat-center'
        ? `body::after { content: ''; position: fixed; top: 35%; left: 50%; transform: translate(-50%, -35%); width: 70vw; height: 70vh; background: radial-gradient(circle, ${v.ambientAuraColor || v.accent}33 0%, transparent 70%); pointer-events: none; z-index: 0; }`
        : v.ambientAura
          ? `body::before { content: ''; position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 ${Math.round((v.ambientAuraIntensity ?? 45) * 1.2)}px ${v.ambientAuraColor || v.accent}66, inset 0 0 15px ${v.ambientAuraColor || v.accent}33; z-index: 999999; }`
          : ''
    }

    ${v.themeSelectors?.appContainer ? `
    /* Custom App Container & Canvas Transparency Overwrite */
    #root, #__next, #app, body > div, body > main,
        ${v.themeSelectors.appContainer},
    ${v.themeSelectors.appContainer} > div,
    ${v.themeSelectors.appContainer} > div > div,
    ${v.themeSelectors.appContainer} main,
    ${v.themeSelectors.appContainer} .flex-1,
    ${v.themeSelectors.appContainer} .flex-auto,
    ${v.themeSelectors.appContainer} .flex-col,
    ${v.themeSelectors.appContainer} [class*="chat-main"],
    ${v.themeSelectors.appContainer} [class*="chat-content"],
    ${v.themeSelectors.appContainer} [class*="messages-wrapper"],
    ${v.themeSelectors.appContainer} #messages-container,
    ${v.themeSelectors.appContainer} .flex.flex-1.overflow-y-auto,
    ${v.themeSelectors.appContainer} .flex-1.min-w-0 {
      ${doColor ? 'background-color: transparent !important; background-image: none !important;' : ''}
    }
    ${doColor ? `
    /* Utility background neutralizer */
    ${v.themeSelectors.appContainer} [class*="dark:bg-[#1"],
    ${v.themeSelectors.appContainer} [class*="dark:bg-[#2"],
    ${v.themeSelectors.appContainer} [class*="bg-[#f"],
    ${v.themeSelectors.appContainer} [class*="bg-white"],
    ${v.themeSelectors.appContainer} [class*="bg-black"],
    ${v.themeSelectors.appContainer} [class*="bg-gray-"],
    ${v.themeSelectors.appContainer} [class*="bg-zinc-"],
    ${v.themeSelectors.appContainer} [class*="bg-neutral-"] {
      background-color: transparent !important;
    }` : ''}
    ` : ''}

    ${v.themeSelectors?.chatWrapper ? `
    /* Custom Central Chat Column Overwrite */
    ${v.themeSelectors.chatWrapper} {
      ${doColor ? 'background-color: transparent !important; background-image: none !important;' : ''}
      ${doStruct ? `
      width: 100% !important; 
      max-width: 100% !important; 
      box-sizing: border-box !important;
      padding-left: calc(max(1rem, 50% - (var(--nexus-ai-width) / 2))) !important;
      padding-right: calc(max(1rem, 50% - (var(--nexus-ai-width) / 2))) !important;
      ` : ''}
    }` : ''}
    
    ${v.themeSelectors?.sidebar ? `
    /* Custom Sidebar Overwrite */
    ${v.themeSelectors.sidebar} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; border-color: var(--nexus-border) !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.header ? `
    /* Custom Header Overwrite */
    ${v.themeSelectors.header} {
      ${doColor ? 'background-color: transparent !important; border-bottom: 1px solid var(--nexus-border) !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.modelDropdown ? `
    /* Custom Model Dropdown / Badge Overwrite */
    ${v.themeSelectors.modelDropdown} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; color: var(--nexus-text) !important; border: 1px solid var(--nexus-border) !important;' : ''}
      ${doBubble ? 'border-radius: var(--radius) !important;' : ''}
    }` : ''}
    
    ${v.themeSelectors?.userMessage ? `
    /* Custom User Message Overwrite */
    ${v.themeSelectors.userMessage} {
      ${doBubble ? `
      background: var(--nexus-bubble-bg) !important;
      background-color: var(--nexus-bubble-bg-color) !important;
      background-image: var(--nexus-bubble-bg) !important;
      border: var(--nexus-bubble-border) !important;
      border-radius: var(--radius) !important;
      box-shadow: var(--nexus-bubble-shadow) !important;
      padding: 12px 16px !important;
      ` : ''}
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      ${doStruct ? `
      width: max-content !important;
      max-width: var(--nexus-user-width) !important;
      margin-left: auto !important;
      margin-right: 0 !important;
      margin-bottom: var(--nexus-message-gap) !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      ` : ''}
    }` : ''}

    ${v.themeSelectors?.aiMessage ? `
    /* Custom AI Message Overwrite */
    ${v.themeSelectors.aiMessage} {
      ${doStruct ? `width: 100% !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; margin-bottom: var(--nexus-message-gap) !important; box-sizing: border-box !important;` : ''}
    }
    ${v.themeSelectors.aiMessage.split(',').map(s => `${s.trim()} div, ${s.trim()} p, ${s.trim()} article`).join(', ')} {
      ${doStruct ? 'max-width: 100% !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.markdownProse ? `
    /* Custom Markdown Prose Typography Overwrite */
    ${v.themeSelectors.markdownProse} {
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      ${doStruct ? 'max-width: 100% !important;' : ''}
    }
    ${v.themeSelectors.markdownProse.split(',').map((s: string) => `${s.trim()} p, ${s.trim()} li, ${s.trim()} span`).join(', ')} {
      ${doColor ? 'color: inherit !important;' : ''}
    }
    ${v.themeSelectors.markdownProse.split(',').map((s: string) => `${s.trim()} h1, ${s.trim()} h2, ${s.trim()} h3, ${s.trim()} h4`).join(', ')} {
      ${doColor ? 'color: var(--nexus-text) !important;' : ''}
      font-weight: 700 !important;
    }
    ${v.themeSelectors.markdownProse.split(',').map((s: string) => `${s.trim()} table, ${s.trim()} th, ${s.trim()} td`).join(', ')} {
      ${doColor ? 'border-color: var(--nexus-border) !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.thinkingBlock ? `
    /* Custom Thinking / Reasoning Block Overwrite */
    ${v.themeSelectors.thinkingBlock} {
      ${doBubble ? 'border-radius: var(--radius) !important; border: 1px solid var(--nexus-border) !important;' : ''}
      ${doColor ? 'background-color: var(--nexus-surface2) !important; color: var(--nexus-text2) !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.codeBlock ? `
    /* Custom Code Block Overwrite */
    ${v.themeSelectors.codeBlock} {
      ${doBubble ? 'border-radius: var(--radius) !important; box-shadow: var(--nexus-code-shadow) !important; margin: var(--nexus-code-margin) !important; padding: 14px 18px !important; border: var(--nexus-code-border) !important;' : ''}
      ${doColor ? 'background: var(--nexus-code-bg) !important; color: var(--nexus-text) !important;' : ''}
      ${doStruct ? 'overflow-x: auto !important;' : ''}
    }
    ${v.themeSelectors.codeBlock.split(',').map((s: string) => `${s.trim()} code`).join(', ')} {
      ${doColor ? 'background: transparent !important; color: inherit !important;' : ''}
      font-size: inherit !important;
      padding: 0 !important;
      border: none !important;
    }` : ''}

    ${v.themeSelectors?.composer ? `
    /* Custom Composer Overwrite */
    ${v.themeSelectors.composer} {
      ${doColor ? 'background-color: var(--nexus-surface) !important; color: var(--nexus-text) !important;' : ''}
      ${doBubble ? 'border: 1px solid var(--nexus-border) !important; border-radius: var(--radius) !important; transition: box-shadow 0.3s ease, border-color 0.3s ease !important;' : ''}
      ${doStruct ? `width: 100% !important; max-width: var(--nexus-ai-width) !important; margin-left: auto !important; margin-right: auto !important; box-sizing: border-box !important;` : ''}
    }
    ${v.themeSelectors.composer.split(',').map((s: string) => `form:focus-within ${s.trim()}`).join(', ')},
    ${v.themeSelectors.composer.split(',').map((s: string) => `${s.trim()}:focus`).join(', ')} {
      ${doBubble ? 'border: var(--nexus-composer-focus-border) !important; border-bottom: var(--nexus-composer-focus-border-bottom) !important; box-shadow: var(--nexus-composer-focus-shadow) !important; outline: none !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.sendButton ? `
    /* Custom Send Button Overwrite */
    ${v.themeSelectors.sendButton} {
      ${doColor ? 'background-color: var(--nexus-accent) !important; color: var(--nexus-bg) !important; border-color: transparent !important;' : ''}
      ${doBubble ? 'border-radius: var(--radius) !important; box-shadow: 0 0 12px var(--nexus-accent) !important;' : ''}
    }` : ''}

    ${v.themeSelectors?.actionButtons ? `
    /* Custom Action Buttons / Toolbar Overwrite */
    ${v.themeSelectors.actionButtons} {
      ${doColor ? 'color: var(--nexus-text2) !important;' : ''}
    }
    ${v.themeSelectors.actionButtons.split(',').map((s: string) => `${s.trim()} button, ${s.trim()} svg`).join(', ')} {
      ${doColor ? 'color: var(--nexus-text2) !important;' : ''}
    }
    ${v.themeSelectors.actionButtons.split(',').map((s: string) => `${s.trim()} button:hover, ${s.trim()} svg:hover`).join(', ')} {
      ${doColor ? 'color: var(--nexus-accent) !important;' : ''}
    }` : ''}
  `
}
// Keyed insertCSS management: exactly ONE theme stylesheet per view, always
// swapped (removeInsertedCSS then insertCSS), never stacked. Previously every
// resize/navigation/settings change appended a new giant stylesheet — that
// accumulation caused multi-GB memory + multi-minute freezes.
const viewCssState = new WeakMap<Electron.WebContents, { css: string; key: string }>()
const viewCssChains = new WeakMap<Electron.WebContents, Promise<void>>()
const focusCssKeys = new WeakMap<Electron.WebContents, string>()

function getOverridesForModel(modelKey?: string, url?: string): ProviderOverrides | undefined {
  if (!providerConfig || typeof providerConfig !== 'object') return undefined
  if (modelKey) {
    if (providerConfig[modelKey]) return providerConfig[modelKey]
    const lower = modelKey.toLowerCase().trim()
    for (const [k, v] of Object.entries(providerConfig)) {
      if (k.toLowerCase().trim() === lower) return v
    }
  }
  // Fallback: match by URL domain
  if (url) {
    try {
      const host = new URL(url).host.toLowerCase()
      if (host.includes('gemini') || host.includes('aistudio')) {
        return getOverridesForModel('gemini')
      }
      if (host.includes('chatgpt') || host.includes('openai')) {
        return getOverridesForModel('chatgpt')
      }
      if (host.includes('claude') || host.includes('anthropic')) {
        return getOverridesForModel('claude')
      }
      if (host.includes('deepseek')) {
        return getOverridesForModel('deepseek')
      }
      if (host.includes('perplexity') || host.includes('pplx')) {
        return getOverridesForModel('perplexity')
      }
      if (host.includes('kimi') || host.includes('moonshot')) {
        return getOverridesForModel('kimi')
      }
      if (host.includes('qwen') || host.includes('aliyun')) {
        return getOverridesForModel('qwen')
      }
      if (host.includes('mistral')) {
        return getOverridesForModel('mistral')
      }
      if (host.includes('grok') || host.includes('x.ai')) {
        return getOverridesForModel('grok')
      }

      // Dynamic fallback: match against user-configured models from models.json
      try {
        const modelsRaw = fs.readFileSync(path.join(app.getPath('userData'), 'models.json'), 'utf-8')
        const models = JSON.parse(modelsRaw)
        if (Array.isArray(models)) {
          for (const m of models) {
            if (m.url && m.key) {
              try {
                const mHost = new URL(m.url).host.toLowerCase()
                if (host === mHost || host.endsWith('.' + mHost) || mHost.endsWith('.' + host)) {
                  return getOverridesForModel(m.key)
                }
              } catch {}
            }
          }
        }
      } catch {}
    } catch {}
  }
  return undefined
}

function resolveModelKey(tabId: string, url?: string, explicitModelKey?: string): string | undefined {
  if (explicitModelKey) {
    if (tabId) viewModelKeys.set(tabId, explicitModelKey)
    return explicitModelKey
  }
  if (tabId && viewModelKeys.has(tabId)) {
    return viewModelKeys.get(tabId)
  }
  if (url) {
    try {
      const host = new URL(url).host.toLowerCase()
      let inferredKey: string | undefined
      if (host.includes('gemini') || host.includes('aistudio')) inferredKey = 'gemini'
      else if (host.includes('chatgpt') || host.includes('openai')) inferredKey = 'chatgpt'
      else if (host.includes('claude') || host.includes('anthropic')) inferredKey = 'claude'
      else if (host.includes('deepseek')) inferredKey = 'deepseek'
      else if (host.includes('perplexity') || host.includes('pplx')) inferredKey = 'perplexity'
      else if (host.includes('kimi') || host.includes('moonshot')) inferredKey = 'kimi'
      else if (host.includes('qwen') || host.includes('aliyun')) inferredKey = 'qwen'
      else if (host.includes('mistral')) inferredKey = 'mistral'
      else if (host.includes('grok') || host.includes('x.ai')) inferredKey = 'grok'

      // Dynamic fallback: match against user-configured models from models.json
      if (!inferredKey) {
        try {
          const modelsRaw = fs.readFileSync(path.join(app.getPath('userData'), 'models.json'), 'utf-8')
          const models = JSON.parse(modelsRaw)
          if (Array.isArray(models)) {
            for (const m of models) {
              if (m.url && m.key) {
                try {
                  const mHost = new URL(m.url).host.toLowerCase()
                  if (host === mHost || host.endsWith('.' + mHost) || mHost.endsWith('.' + host)) {
                    inferredKey = m.key
                    break
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }

      if (inferredKey && tabId) {
        viewModelKeys.set(tabId, inferredKey)
      }
      return inferredKey
    } catch {}
  }
  return undefined
}

function computeThemeCss(view, modelKey?: string): string {
  const theme = webviewTheme
  const url = view.webContents.getURL()
  const resolvedKey = modelKey || resolveModelKey('', url)
  const overrides = getOverridesForModel(resolvedKey, url)
  const on = overrides?.on === 'on' ? true : overrides?.on === 'off' ? false : (theme?.on ?? false)
  if (on && theme?.colors) {
    return buildWebviewThemeCss(theme, url, view.getBounds().width, overrides, resolvedKey)
  }
  return overrides?.customCss ? overrides.customCss : ''
}
function applyWebviewTheme(view, modelKey?: string) {
  const wc = view.webContents
  const url = wc.getURL()
  const resolvedKey = modelKey || resolveModelKey('', url)
  const overrides = getOverridesForModel(resolvedKey, url)
  const css = computeThemeCss(view, resolvedKey)
  const bg = overrides?.surfaceBgColor || (webviewTheme?.on && webviewTheme.colors?.bg) || '#1a1a2e'
  view.setBackgroundColor(bg)
  // insertCSS on a page that has NOT committed a document (empty URL /
  // about:blank) HANGS FOREVER (observed: promise never settles), and because
  // applies are serialized on a per-view promise chain, one hung insertCSS
  // blocks every later apply — theme never lands. Skip only while there is no
  // committed URL; isLoading() is too aggressive (SPAs stay "loading" for
  // minutes via long-poll) and would suppress all applies.
  if (!wc.getURL()) return
  const prevChain = viewCssChains.get(wc) ?? Promise.resolve()
  const nextChain = prevChain.then(async () => {
    const decision = nextThemeSwap(viewCssState.get(wc) ?? null, css)
    if (!decision.swap) return
    if (decision.oldKey) {
      try {
        await wc.removeInsertedCSS(decision.oldKey)
      } catch {
        /* key already gone (page reloaded) */
      }
    }
    try {
      // insertCSS resolves only after the frame actually applies the stylesheet.
      // If the renderer is busy/throttled that can stall for many seconds — the
      // next apply would queue behind it. Time-box it so a stalled frame can
      // never wedge the chain; did-finish-load/resize re-applies anyway.
      const key = await Promise.race([
        wc.insertCSS(decision.css),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('insertCSS timeout')), 5000)
        )
      ])
      viewCssState.set(wc, { css: decision.css, key })
      for (const [id, v] of aiViews.entries()) {
        if (v.webContents === wc) {
          sendToMainWindow('ai-theme-applied', id)
          break
        }
      }
    } catch (e: any) {
      console.error('[theme] insertCSS failed:', String(e))
    }
  })
  viewCssChains.set(wc, nextChain)
}
ipcMain.on('set_webview_theme', (_event, payload) => {
  webviewTheme = payload || null
  persistTheme()
  for (const [tabId, view] of aiViews) {
    applyWebviewTheme(view, resolveModelKey(tabId, view.webContents.getURL()))
  }
  if (previewTimer) capturePreviewFrame()
})

ipcMain.handle('get_provider_config', () => providerConfig)

ipcMain.handle('get_full_provider_css', (_event, modelKey: string, providerUrl?: string) => {
  const theme = webviewTheme
  const keyToUse = (!modelKey || modelKey === 'ALL') ? 'gemini' : modelKey
  const overrides = getOverridesForModel(keyToUse)
  const defaultUrls: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    perplexity: 'https://www.perplexity.ai',
    deepseek: 'https://chat.deepseek.com',
    kimi: 'https://kimi.moonshot.cn',
    qwen: 'https://chat.qwenlm.ai',
    mistral: 'https://chat.mistral.ai',
    grok: 'https://grok.com'
  }
  const sampleUrl = providerUrl || (keyToUse && defaultUrls[keyToUse.toLowerCase()]) || 'https://gemini.google.com'
  if (theme && theme.colors) {
    return buildWebviewThemeCss(theme, sampleUrl, 1200, overrides, keyToUse)
  }
  return overrides?.customCss || ''
})

ipcMain.handle('get_full_provider_js', (_event, modelKey?: string) => {
  const keyToUse = (!modelKey || modelKey === 'ALL') ? undefined : modelKey
  return buildWebviewRuntimeJs(keyToUse)
})

ipcMain.handle('execute_live_provider_js', async (_event, modelKey: string, code: string) => {
  const targetKey = (modelKey || '').toLowerCase()
  for (const [tabId, view] of aiViews) {
    const vKey = (viewModelKeys.get(tabId) || '').toLowerCase()
    if (vKey === targetKey || (!targetKey && tabId === activeViewId)) {
      if (view && !view.webContents.isDestroyed()) {
        try {
          const res = await view.webContents.executeJavaScript(code)
          return { success: true, result: res !== undefined ? String(res) : 'Executed successfully (no return value)' }
        } catch (err: any) {
          return { success: false, error: err?.message || String(err) }
        }
      }
    }
  }
  if (activeViewId && aiViews.has(activeViewId)) {
    const view = aiViews.get(activeViewId)
    if (view && !view.webContents.isDestroyed()) {
      try {
        const res = await view.webContents.executeJavaScript(code)
        return { success: true, result: res !== undefined ? String(res) : 'Executed successfully' }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    }
  }
  return { success: false, error: `No active webview tab found for ${modelKey || 'provider'}. Please open a tab first.` }
})

ipcMain.handle('get_custom_theme_entry', (_event, modelKey: string) => {
  return getCustomThemeEntry(modelKey)
})

ipcMain.handle('get_provider_base_css', (_event, modelKey: string, providerUrl?: string) => {
  const theme = webviewTheme
  if (!theme || !theme.colors) return ''
  
  const defaultUrls: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    perplexity: 'https://www.perplexity.ai',
    deepseek: 'https://chat.deepseek.com',
    kimi: 'https://kimi.moonshot.cn',
    qwen: 'https://chat.qwenlm.ai',
    mistral: 'https://chat.mistral.ai',
    grok: 'https://grok.com'
  }
  const sampleUrl = providerUrl || (modelKey && defaultUrls[modelKey.toLowerCase()]) || ''
  
  // Create generic empty overrides so we get raw base CSS
  const rawOverrides = {}
  
  let host = ''
  try {
    host = sampleUrl ? new URL(sampleUrl).host : ''
  } catch {}
  
  const provider = PROVIDER_THEMES.find((p) =>
    p.hosts.some((h) => host === h || host.endsWith('.' + h))
  )
  
  const vars = {
    bg: theme.colors.bg || '#1a1a2e',
    surface: theme.colors.surface || '#16213e',
    surface2: theme.colors.surface2 || '#0f3460',
    accent: theme.colors.accent || '#e94560',
    text: theme.colors.text || '#eaeaea',
    text2: theme.colors.text2 || '#8899aa',
    border: theme.colors.border || '#2a2a2e',
    radius: theme.radius ?? 8,
    borderWidth: 1,
    ambientAura: (theme as any).ambientAura,
    ambientAuraMode: (theme as any).ambientAuraMode,
    ambientAuraIntensity: (theme as any).ambientAuraIntensity,
    ambientAuraColor: (theme as any).ambientAuraColor,
    bubbleStyle: (theme as any).bubbleStyle,
    bubbleGradientDepth: (theme as any).bubbleGradientDepth,
    codeBlockStyle: (theme as any).codeBlockStyle,
    codeBlockMargin: (theme as any).codeBlockMargin,
    composerGlow: (theme as any).composerGlow,
    composerHaloIntensity: (theme as any).composerHaloIntensity,
    messageGap: (theme as any).messageGap,
    aiResponseWidthPx: (theme as any).aiResponseWidthPx,
    userPromptWidthPx: (theme as any).userPromptWidthPx
  }
  
  const merged = mergeOverrides(vars, rawOverrides)
  const dark = isDarkColor(merged.bg)
  return provider ? provider.css(merged) : genericFallbackCss(merged, dark)
})

ipcMain.handle('save_custom_theme_file', (_event, modelKey: string, css: string, url?: string) => {
  const success = saveCustomThemeEntry(modelKey, css, url)
  if (success) {
    // Re-apply theme for all matching active tabs
    for (const [tabId, view] of aiViews) {
      if (resolveModelKey(tabId, view.webContents.getURL()) === modelKey) {
        applyWebviewTheme(view, modelKey)
      }
    }
  }
  return success
})

ipcMain.handle('reset_custom_theme_file', (_event, modelKey: string) => {
  const success = removeCustomThemeEntry(modelKey)
  if (success) {
    for (const [tabId, view] of aiViews) {
      if (resolveModelKey(tabId, view.webContents.getURL()) === modelKey) {
        applyWebviewTheme(view, modelKey)
      }
    }
  }
  return success
})

ipcMain.handle('extract_provider_live_dom', async (_event, modelKey: string, providerUrl?: string) => {
  try {
    let targetView: Electron.WebContentsView | null = null

    // 1. Match by model key in active views
    for (const [tabId, view] of aiViews) {
      if (viewModelKeys.get(tabId) === modelKey) {
        targetView = view
        break
      }
    }

    // 2. Match by URL host if not matched by key
    if (!targetView && providerUrl) {
      try {
        const targetHost = new URL(providerUrl).host.toLowerCase()
        for (const [, view] of aiViews) {
          const vUrl = view.webContents.getURL()
          if (vUrl && new URL(vUrl).host.toLowerCase() === targetHost) {
            targetView = view
            break
          }
        }
      } catch {}
    }

    // 3. Fallback to active view if model matches or no target found
    if (!targetView && activeViewId && aiViews.has(activeViewId)) {
      const active = aiViews.get(activeViewId)!
      if (viewModelKeys.get(activeViewId) === modelKey) {
        targetView = active
      }
    }

    if (!targetView || targetView.webContents.isDestroyed()) {
      return { success: false, reason: 'no_open_tab' }
    }

    const script = `(() => {
      try {
        const root = document.body;
        if (!root) return { success: false, reason: 'no_root' };

        const clone = root.cloneNode(true);
        const toRemove = clone.querySelectorAll('script, style, link, noscript, iframe, canvas, meta, base, svg, img, video, audio');
        toRemove.forEach(el => el.remove());

        // Remove hidden/fixed overlays that pollute the DOM and waste tokens
        const overlays = clone.querySelectorAll('[class*="fixed"], [class*="z-10000"], [id^="bits-"]');
        overlays.forEach(el => el.remove());

        // Strip attributes from the root clone itself (TreeWalker misses the root)
        const rootAttrs = Array.from(clone.attributes || []);
        for (const attr of rootAttrs) {
          const name = attr.name.toLowerCase();
          if (name !== 'id' && name !== 'class' && !name.startsWith('data-') && name !== 'role' && name !== 'placeholder' && name !== 'type' && name !== 'contenteditable') {
            clone.removeAttribute(attr.name);
          }
        }

        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
        const nodesToRemove = [];
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            const el = node;
            const attrs = Array.from(el.attributes);
            for (const attr of attrs) {
              const name = attr.name.toLowerCase();
              if (name !== 'id' && name !== 'class' && !name.startsWith('data-') && name !== 'role' && name !== 'placeholder' && name !== 'type' && name !== 'contenteditable') {
                el.removeAttribute(attr.name);
              }
            }
          } else if (node.nodeType === 3) { // TEXT_NODE
            if (node.nodeValue && node.nodeValue.trim().length > 0) {
              node.nodeValue = '[TEXT]';
            }
          } else if (node.nodeType === 8) { // COMMENT_NODE
            nodesToRemove.push(node);
          }
        }
        
        nodesToRemove.forEach(c => c.remove());
        
        // Remove empty divs repeatedly to collapse the tree
        let previousLength = -1;
        while (previousLength !== clone.innerHTML.length) {
          previousLength = clone.innerHTML.length;
          const emptyEls = clone.querySelectorAll('div:empty, span:empty, p:empty, a:empty, button:empty');
          emptyEls.forEach(el => el.remove());
        }

        let html = clone.outerHTML || '';
        
        // Final aggressive cleanup of empty class/id attributes to save tokens
        html = html.replace(/ class=""/g, '').replace(/ id=""/g, '');

        return {
          success: true,
          html,
          url: location.href,
          title: document.title
        };
      } catch (e: any) {
        return { success: false, error: String(e) };
      }
    })();`

    const result = await targetView.webContents.executeJavaScript(script)
    return result || { success: false, reason: 'script_failed' }
  } catch (err) {
    console.error('extract_provider_live_dom error:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.on('set_provider_config', (_event, map) => {
  providerConfig = map && typeof map === 'object' ? map : {}
  persistProviderConfig()
  for (const [tabId, view] of aiViews) {
    applyWebviewTheme(view, resolveModelKey(tabId, view.webContents.getURL()))
  }
  if (previewTimer) {
    capturePreviewFrame()
    setTimeout(capturePreviewFrame, 150) // Force a second capture after CSS lands
  }
})

// Switch tabs: show target view, hide the rest. Loads URL only on first visit.
ipcMain.on('activate_tab', (_event, tabId, url, bounds, modelKey) => {
  lastAccessedTimestamps.set(tabId, Date.now())

  if (currentUiZoom !== 1.0 && bounds) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }

  const wasEvicted = evictedTabStates.has(tabId)
  const view = ensureAiView(tabId)
  console.log('[activate_tab]', tabId, 'url=', url, 'current=', view.webContents.getURL())
  resolveModelKey(tabId, url, modelKey)
  applyWebviewTheme(view, viewModelKeys.get(tabId))
  const isHidden = bounds.width === 0 && bounds.height === 0
  for (const [id, v] of aiViews) v.setVisible(!isHidden && id === tabId)
  activeViewId = tabId
  activeViewVisible = !isHidden
  view.setBounds(bounds)
  if (!isHidden) lastRealBounds.set(tabId, bounds)
  const current = view.webContents.getURL()
  if (wasEvicted) {
    // Tab was evicted from memory: recreate with its saved URL and restore scroll.
    const evicted = evictedTabStates.get(tabId)
    evictedTabStates.delete(tabId)
    console.log('[activate_tab] RESTORING evicted tab:', tabId, evicted?.url)
    if (evicted) {
      view.webContents.once('did-finish-load', () => {
        view.webContents.executeJavaScript(`window.scrollTo(0, ${evicted.scrollY})`).catch(() => {})
      })
      view.webContents.loadURL(evicted.url)
    }
  } else if (url && !current) {
    console.log('[activate_tab] LOADING empty view:', url)
    view.webContents.loadURL(url)
  }

  if (mainWindow && !mainWindow.isDestroyed() && !view.webContents.isDestroyed() && activeViewVisible && !overlaysOpen) {
    view.webContents.focus()
    focusPromptInView(view)
  }

  enforceMaxActiveTabs(tabId)
})

ipcMain.on('navigate_tab', (_event, tabId: string, url: string, modelKey?: string) => {
  const view = ensureAiView(tabId)
  resolveModelKey(tabId, url, modelKey)
  applyWebviewTheme(view, viewModelKeys.get(tabId))
  console.log('[navigate_tab]', tabId, 'url=', url)
  void view.webContents.loadURL(url)
})

ipcMain.handle('history_go_back', () => {
  if (!activeViewId) return false
  const activeView = aiViews.get(activeViewId)
  if (!activeView || activeView.webContents.isDestroyed()) return false
  if (activeView.webContents.navigationHistory.canGoBack()) {
    activeView.webContents.navigationHistory.goBack()
    sendToMainWindow('history-nav-hud', { action: 'back', message: '← Back' })
    return true
  } else {
    sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'Start of History' })
    return false
  }
})

ipcMain.handle('history_go_forward', () => {
  if (!activeViewId) return false
  const activeView = aiViews.get(activeViewId)
  if (!activeView || activeView.webContents.isDestroyed()) return false
  if (activeView.webContents.navigationHistory.canGoForward()) {
    activeView.webContents.navigationHistory.goForward()
    sendToMainWindow('history-nav-hud', { action: 'forward', message: '→ Forward' })
    return true
  } else {
    sendToMainWindow('history-nav-hud', { action: 'boundary', message: 'End of History' })
    return false
  }
})



function finishEvict(tabId: string, view: Electron.WebContentsView, scrollY: number) {
  if (!aiViews.has(tabId) || aiViews.get(tabId) !== view) return
  try {
    evictedTabStates.set(tabId, { url: view.webContents.getURL(), scrollY })
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {}
  }
  try {
    ;(view.webContents as Electron.WebContents & { destroy: () => void }).destroy()
  } catch {}
  aiViews.delete(tabId)
  lastAccessedTimestamps.delete(tabId)
  viewModelKeys.delete(tabId)
  lastRealBounds.delete(tabId)
  viewTitles.delete(tabId) // Fix #5: map memory leak
  
  // Fix #3: disk/memory leak - cleanup orphaned thumbnails
  const safeId = tabId.replace(/[^a-zA-Z0-9._-]/g, '')
  const thumbFilename = lastThumbnailFiles.get(safeId)
  if (thumbFilename) {
    try {
      const fs = require('fs') // ensure fs is available
      fs.unlink(join(app.getPath('userData'), 'thumbnails', thumbFilename), () => {})
    } catch {}
    lastThumbnailFiles.delete(safeId)
  }
  
  console.log('[evict]', tabId, 'scrollY=', scrollY)
}

ipcMain.on('destroy_tab_view', (_event, tabId) => {
  console.log('[destroy_tab_view]', tabId)
  evictedTabStates.delete(tabId)
  lastAccessedTimestamps.delete(tabId)
  lastRealBounds.delete(tabId)
  viewModelKeys.delete(tabId)
  const view = aiViews.get(tabId)
  if (!view) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {}
  }
  try {
    ;(view.webContents as Electron.WebContents & { destroy: () => void }).destroy()
  } catch {}
  aiViews.delete(tabId)
  viewTitles.delete(tabId) // Fix #5: map memory leak
  
  // Fix #3: disk/memory leak - cleanup orphaned thumbnails
  const safeId = tabId.replace(/[^a-zA-Z0-9._-]/g, '')
  const thumbFilename = lastThumbnailFiles.get(safeId)
  if (thumbFilename) {
    try {
      const fs = require('fs')
      fs.unlink(join(app.getPath('userData'), 'thumbnails', thumbFilename), () => {})
    } catch {}
    lastThumbnailFiles.delete(safeId)
  }

  if (activeViewId === tabId) activeViewId = null
})

// Ctrl+R: full reload of the active AI view (like a browser reload)
ipcMain.on('reload_active_view', () => {
  const view = activeViewId ? aiViews.get(activeViewId) : null
  if (view) view.webContents.reload()
})

// On a successful Google session import, reload the active AI view so Gemini
// picks up the cookies; forward every flow event to the renderer for the toast.
function forwardGoogleSignInEvent(ev: GoogleSignInEvent): void {
  if (ev.stage === 'success') {
    for (const view of aiViews.values()) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
    }
  }
  sendToMainWindow('google-signin-event', ev)
}

const GEMINI_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?hl=en&passive=true&continue=' +
  encodeURIComponent('https://gemini.google.com/signin?continue=https%3A%2F%2Fgemini.google.com%2Fapp') +
  '&flowName=GlifWebSignIn&flowEntry=ServiceLogin'

ipcMain.handle('google_signin_start', () => {
  void startGoogleSignIn(GEMINI_LOGIN_URL, { onEvent: forwardGoogleSignInEvent })
})

ipcMain.handle('google_signin_pick_profile', (_event, profileId: string) => {
  void startGoogleSignIn(GEMINI_LOGIN_URL, { profileId, onEvent: forwardGoogleSignInEvent })
})

ipcMain.handle('google_signin_profiles', () => listProfiles())

ipcMain.on('google_signin_cancel', () => {
  cancelGoogleSignIn()
})

ipcMain.handle('sessions_sync_all', async () => {
  const result = await syncAllSessionsFromBrowsers()
  if (result.success) {
    for (const view of aiViews.values()) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
    }
  }
  return result
})

ipcMain.handle('sessions_sync_profile', async (_event, profileId: string) => {
  const result = await syncSessionFromProfile(profileId)
  if (result.success) {
    for (const view of aiViews.values()) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
    }
  }
  return result
})

ipcMain.handle('cookies_import_json', async (_event, jsonStr: string) => {
  const result = await importCookiesFromJson(jsonStr)
  if (result.success) {
    for (const view of aiViews.values()) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
    }
  }
  return result
})

ipcMain.on('resize_view', (_event, bounds) => {
  console.log('[DEBUG-RESIZE] App.tsx sent bounds (unscaled):', bounds);

  // Apply UI zoom factor to convert DOM pixels back to physical DIPs for BrowserView
  if (currentUiZoom !== 1.0) {
    bounds = {
      x: Math.round(bounds.x * currentUiZoom),
      y: Math.round(bounds.y * currentUiZoom),
      width: Math.round(bounds.width * currentUiZoom),
      height: Math.round(bounds.height * currentUiZoom)
    }
  }

  const hidden = bounds.width === 0 && bounds.height === 0
  activeViewVisible = !hidden
  for (const [tabId, view] of aiViews) {
    const prev = view.getBounds()
    if (!hidden) {
      view.setBounds(bounds)
      lastRealBounds.set(tabId, bounds)
    }
    view.setVisible(!hidden && tabId === activeViewId)
    // Re-theme only when the view width actually changed: px-based pageWidth
    // is derived from bounds, so window resizes must re-apply it. The
    // renderer fires resize_view repeatedly at the same size — skip those.
    // Debounced: a drag fires ~60 events/sec; we settle once at the end.
    if (!hidden && (Math.abs(prev.width - bounds.width) > 1 || Math.abs(prev.height - bounds.height) > 1)) {
      if (resizeThemeTimer) clearTimeout(resizeThemeTimer)
      resizeThemeTimer = setTimeout(() => {
        for (const [tabId, v] of aiViews) applyWebviewTheme(v, viewModelKeys.get(tabId))
      }, 120)
    }
    console.log('[resize_view] applied=', JSON.stringify(view.getBounds()))
  }
  if (hidden) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus()
      mainWindow.focusOnWebView()
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus()
      }
    }
  } else {
    const view = activeViewId ? aiViews.get(activeViewId) : null
    if (view && !view.webContents.isDestroyed() && mainWindow && !mainWindow.isDestroyed()) {
      view.webContents.focus()
      focusPromptInView(view)
    }
  }
})

ipcMain.on('toggle_focus_mode', (_event, enabled) => {
  const view = activeViewId ? aiViews.get(activeViewId) : null
  if (!view) return
  const wc = view.webContents
  const old = focusCssKeys.get(wc)
  if (enabled) {
    if (old) wc.removeInsertedCSS(old).catch(() => {})
    wc.insertCSS('header, nav, aside, .sidebar { display: none !important; }')
      .then((k) => focusCssKeys.set(wc, k))
      .catch(() => {})
  } else if (old) {
    wc.removeInsertedCSS(old).catch(() => {})
    focusCssKeys.delete(wc)
  }
})

const lastThumbnailFiles = new Map<string, string>()






ipcMain.handle('clipboard_write', (_, text) => {
  require('electron').clipboard.writeText(text);
});

ipcMain.handle('extract_context', async (_event, options?: CompressionOptions) => {
  if (!activeViewId) return null
  const view = aiViews.get(activeViewId)
  if (!view) return null

  try {
    const extractFn = function(): any {
      // @ts-nocheck
      try {
        var chat: Array<{ role: string; text: string; thinking?: string }> = []
        var url = (window.location.href || '').toLowerCase()

        function cleanNodeText(node: any): string {
          if (!node) return ''
          var clone = node.cloneNode(true)
          // Strip button elements and feedback artifacts
          clone.querySelectorAll('button, [role="button"], .copy-button, .feedback-button, svg, [aria-hidden="true"], [data-testid*="copy"], .citation, .citations').forEach(function(b: any) {
            b.remove()
          })
          return (clone.innerText || clone.textContent || '').trim()
        }

        // 1. ChatGPT
        if (url.indexOf('chatgpt.com') !== -1) {
          document.querySelectorAll('[data-message-author-role]').forEach(function(el: any) {
            var role = el.getAttribute('data-message-author-role') === 'user' ? 'User' : 'Assistant'
            var text = cleanNodeText(el)
            if (text) {
              chat.push({ role: role, text: text })
            }
          })
        }
        // 2. Claude.ai
        else if (url.indexOf('claude.ai') !== -1) {
          document.querySelectorAll('.font-user-message, .font-claude-message, [data-testid="user-message"]').forEach(function(el: any) {
            var isUser = el.className.indexOf('user') !== -1 || el.getAttribute('data-testid') === 'user-message'
            var role = isUser ? 'User' : 'Assistant'

            var thinkingText = ''
            var thoughtEl = el.querySelector('[class*="thought"], [class*="thinking"], details')
            if (thoughtEl) {
              thinkingText = cleanNodeText(thoughtEl)
            }

            var text = cleanNodeText(el)
            if (text) {
              chat.push({ role: role, text: text, thinking: thinkingText || undefined })
            }
          })
        }
        // 3. Gemini
        else if (url.indexOf('gemini.google.com') !== -1) {
          document.querySelectorAll('message-content, user-query, [class*="user-query"], [class*="model-response"]').forEach(function(el: any) {
            var tag = (el.tagName || '').toLowerCase()
            var isUser = tag === 'user-query' || (el.className || '').indexOf('user-query') !== -1
            var role = isUser ? 'User' : 'Assistant'
            var text = cleanNodeText(el)
            if (text) {
              chat.push({ role: role, text: text })
            }
          })
        }
        // 4. DeepSeek
        else if (url.indexOf('deepseek.com') !== -1) {
          document.querySelectorAll('div[class*="ds-message"], div[class*="chat-message"], div[class*="user-message"], div[class*="assistant-message"]').forEach(function(el: any) {
            var isUser = (el.className || '').indexOf('user') !== -1 || el.querySelector('[class*="user"]') !== null
            var role = isUser ? 'User' : 'Assistant'

            var thoughtEl = el.querySelector('[class*="thought"], [class*="reasoning"]')
            var thinkingText = thoughtEl ? cleanNodeText(thoughtEl) : undefined

            var text = cleanNodeText(el)
            if (text) {
              chat.push({ role: role, text: text, thinking: thinkingText })
            }
          })
        }
        // 5. Kimi & Qwen & Mistral
        else if (url.indexOf('kimi.moonshot.cn') !== -1 || url.indexOf('qwenlm.ai') !== -1 || url.indexOf('mistral.ai') !== -1) {
          document.querySelectorAll('div[class*="message"], div[class*="chat-item"], div[class*="segment"]').forEach(function(el: any) {
            var isUser = (el.className || '').indexOf('user') !== -1
            var role = isUser ? 'User' : 'Assistant'
            var text = cleanNodeText(el)
            if (text) {
              chat.push({ role: role, text: text })
            }
          })
        }

        // 6. Universal Fallback
        if (chat.length === 0) {
          var container = document.querySelector('main') || document.querySelector('[role="main"]') || document.getElementById('main') || document.body
          if (container) {
            var bubbles = container.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-row"], [class*="turn"], [data-role]')
            if (bubbles.length >= 2) {
              bubbles.forEach(function(b: any) {
                var isUser = (b.className || '').indexOf('user') !== -1 || b.getAttribute('data-role') === 'user'
                var text = cleanNodeText(b)
                if (text && text.length > 5) {
                  chat.push({ role: isUser ? 'User' : 'Assistant', text: text })
                }
              })
            }

            if (chat.length === 0) {
              var wholeText = cleanNodeText(container)
              if (wholeText) {
                chat.push({ role: 'Assistant', text: wholeText })
              }
            }
          }
        }

        var output = chat.map(function(item) {
          var res = '## ' + item.role + '\n' + item.text
          if (item.thinking) {
            res += '\n<thinking>\n' + item.thinking + '\n</thinking>'
          }
          return res
        }).join('\n\n')

        return output || '# Session Transcript\n(No conversation messages could be detected on active tab)'
      } catch (e: any) {
        return 'Error extracting context: ' + (e.message || String(e))
      }
    }

    const script = '(' + extractFn.toString() + ')()'
    const rawContext = await view.webContents.executeJavaScript(script)

    if (rawContext && typeof rawContext === 'string' && rawContext.startsWith('Error extracting context:')) {
      return { success: false, error: rawContext, prompt: rawContext, rawText: rawContext }
    }

    const modelKey = viewModelKeys.get(activeViewId) || 'ai-session'
    const modelLabels: Record<string, string> = {
      gemini: 'Google Gemini',
      chatgpt: 'OpenAI ChatGPT',
      claude: 'Anthropic Claude',
      deepseek: 'DeepSeek AI',
      kimi: 'Kimi Moonshot',
      qwen: 'Qwen AI',
      mistral: 'Mistral Le Chat',
      grok: 'xAI Grok',
      copilot: 'Microsoft Copilot',
      perplexity: 'Perplexity AI'
    }
    const providerLabel = (modelKey && modelLabels[modelKey.toLowerCase()]) || modelKey.toUpperCase()

    // Deterministic LLM context compression and agent handoff generation
    const result = buildAgentHandoffPrompt({
      providerName: providerLabel,
      rawText: rawContext || '',
      options: options || { mode: 'handoff' }
    })

    return {
      success: true,
      modelKey,
      providerName: providerLabel,
      rawText: rawContext,
      ...result
    }
  } catch (err: any) {
    console.error('Failed to extract context:', err)
    return null
  }
})
ipcMain.handle('capture_tab_snapshot', async (_event, tabId?: string) => {
  const id = tabId ?? activeViewId
  if (!id) return null
  const view = id ? aiViews.get(id) : null
  if (!view) return null
  try {
    const image = await view.webContents.capturePage()
    const resized = image.resize({ width: 800 })
    const jpeg = resized.toJPEG(80)
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '')
    const filename = `${safeId}-${Date.now()}.jpg`
    const filepath = join(thumbnailsDir, filename)
    writeFileSync(filepath, jpeg)

    const oldFilename = lastThumbnailFiles.get(safeId)
    if (oldFilename && oldFilename !== filename) {
      fs.unlink(join(thumbnailsDir, oldFilename), () => {})
    }
    lastThumbnailFiles.set(safeId, filename)

    return 'thumb://' + filename
  } catch (err) {
    console.error('Failed to capture snapshot:', err)
    return null
  }
})

// Live preview stream: capture the real view (no duplicate page) ~3fps while
// the Settings → Webview tab is open, so theme knobs reflect instantly.
function findPreviewView(providerKey: string | null): [string, Electron.WebContentsView] | null {
  if (providerKey) {
    for (const [tabId, view] of aiViews) {
      if (viewModelKeys.get(tabId) === providerKey) return [tabId, view]
    }
    // Named provider with no open tab: do NOT show an unrelated view — the
    // renderer shows an "open this provider first" message instead.
    return null
  }
  if (!activeViewId) return null
  const active = aiViews.get(activeViewId)
  return active ? [activeViewId, active] : null
}

async function capturePreviewFrame() {
  if (!previewViewId) return
  const view = aiViews.get(previewViewId)
  if (!view || view.webContents.isDestroyed()) return
  try {
    const img = await view.webContents.capturePage()
    if (img.isEmpty()) return
    const size = img.getSize()
    const targetWidth = Math.min(1600, Math.max(1024, size.width))
    const resized = size.width > targetWidth ? img.resize({ width: targetWidth, quality: 'better' }) : img
    const jpegBase64 = resized.toJPEG(92).toString('base64')
    sendToMainWindow('webview_preview_frame', 'data:image/jpeg;base64,' + jpegBase64)
  } catch {
    // view navigated/destroyed mid-capture — next tick retries
  }
}

ipcMain.handle('start_webview_preview', (_event, providerKey: string | null) => {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  const found = findPreviewView(providerKey)
  if (!found) {
    previewViewId = null
    previewRestoreBounds = null
    return false
  }
  const [tabId, view] = found
  previewViewId = tabId
  const b = view.getBounds()
  if (b.width === 0 && b.height === 0) {
    // Hidden under the settings overlay: give it real bounds so capturePage
    // renders, but keep it invisible (native view would cover the modal).
    previewRestoreBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    view.setBounds(lastRealBounds.get(tabId) ?? { x: 0, y: 0, width: 900, height: 700 })
    view.setVisible(false)
  } else {
    previewRestoreBounds = null
  }
  previewTimer = setInterval(capturePreviewFrame, 350)
  capturePreviewFrame()
  return true
})

ipcMain.on('stop_webview_preview', () => {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  if (previewViewId && previewRestoreBounds) {
    const view = aiViews.get(previewViewId)
    if (view) {
      view.setBounds(previewRestoreBounds)
      view.setVisible(true)
    }
  }
  previewViewId = null
  previewRestoreBounds = null
})

import fs from 'fs'
import path from 'path'

// Load from Nexus userData directory (~/.config/nexus on Linux)
const dataDir = app.getPath('userData')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

// Auto-migration from legacy ~/.config/vicinae if present
const legacyDataDir = path.join(app.getPath('appData'), 'vicinae')
if (fs.existsSync(legacyDataDir)) {
  try {
    const legacyHistory = path.join(legacyDataDir, 'history.json')
    const newHistory = path.join(dataDir, 'history.json')
    if (fs.existsSync(legacyHistory)) {
      const legacySize = fs.statSync(legacyHistory).size
      const newSize = fs.existsSync(newHistory) ? fs.statSync(newHistory).size : 0
      if (legacySize > newSize) {
        fs.copyFileSync(legacyHistory, newHistory)
      }
    }
    const legacyPatterns = path.join(legacyDataDir, 'patterns.json')
    const newPatterns = path.join(dataDir, 'patterns.json')
    if (fs.existsSync(legacyPatterns)) {
      const legacySize = fs.statSync(legacyPatterns).size
      const newSize = fs.existsSync(newPatterns) ? fs.statSync(newPatterns).size : 0
      if (legacySize > newSize) {
        fs.copyFileSync(legacyPatterns, newPatterns)
      }
    }
    const legacySkills = path.join(legacyDataDir, 'skills')
    const newSkills = path.join(dataDir, 'skills')
    if (fs.existsSync(legacySkills) && !fs.existsSync(newSkills)) {
      fs.cpSync(legacySkills, newSkills, { recursive: true })
    }
  } catch (e: any) {
    console.error('Migration error from legacy vicinae directory:', e)
  }
}

const historyFile = path.join(dataDir, 'history.json')
const tabsFile = path.join(dataDir, 'tabs.json')
const pinnedFile = path.join(dataDir, 'pinned.json')
const modelsFile = path.join(dataDir, 'models.json')
const settingsFile = path.join(dataDir, 'settings.json')

ipcMain.handle('read_history', () => {
  try {
    return fs.readFileSync(historyFile, 'utf-8')
  } catch {
    return '[]'
  }
})

ipcMain.handle('get_history', () => {
  try {
    return fs.readFileSync(historyFile, 'utf-8')
  } catch {
    return '[]'
  }
})

let historySaveTimer: NodeJS.Timeout | null = null

ipcMain.handle('save_history', (_event, dataStr) => {
  if (historySaveTimer) clearTimeout(historySaveTimer)
  historySaveTimer = setTimeout(() => {
    fs.promises.writeFile(historyFile, dataStr).catch((err) => {
      console.error('History save error:', err)
    })
  }, 2000)
})

ipcMain.handle('list_history', () => {
  try {
    return JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
  } catch {
    return []
  }
})

// Universal File-Backed App State IPC (guarantees dev and prod always share exact tabs, pinned, models)
ipcMain.handle('get_tabs', () => {
  try {
    if (fs.existsSync(tabsFile)) return fs.readFileSync(tabsFile, 'utf-8')
    return null
  } catch {
    return null
  }
})

ipcMain.handle('save_tabs', (_event, dataStr: string) => {
  try {
    fs.writeFileSync(tabsFile, dataStr, 'utf-8')
    return true
  } catch (err) {
    console.error('Tabs save error:', err)
    return false
  }
})

ipcMain.handle('get_pinned', () => {
  try {
    if (fs.existsSync(pinnedFile)) return fs.readFileSync(pinnedFile, 'utf-8')
    return null
  } catch {
    return null
  }
})

ipcMain.handle('save_pinned', (_event, dataStr: string) => {
  try {
    fs.writeFileSync(pinnedFile, dataStr, 'utf-8')
    return true
  } catch (err) {
    console.error('Pinned save error:', err)
    return false
  }
})

ipcMain.handle('get_models', () => {
  try {
    if (fs.existsSync(modelsFile)) return fs.readFileSync(modelsFile, 'utf-8')
    return null
  } catch {
    return null
  }
})

ipcMain.handle('save_models', (_event, dataStr: string) => {
  try {
    fs.writeFileSync(modelsFile, dataStr, 'utf-8')
    return true
  } catch (err) {
    console.error('Models save error:', err)
    return false
  }
})

ipcMain.handle('get_interface_settings', () => {
  try {
    if (fs.existsSync(settingsFile)) return fs.readFileSync(settingsFile, 'utf-8')
    return null
  } catch {
    return null
  }
})

ipcMain.handle('save_interface_settings', (_event, dataStr: string) => {
  try {
    fs.writeFileSync(settingsFile, dataStr, 'utf-8')
    return true
  } catch (err) {
    console.error('Interface settings save error:', err)
    return false
  }
})
