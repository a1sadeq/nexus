// Manual smoke runner: npx electron scripts/media-diagnostic.cjs
// Separate Electron process, NOT the installed Nexus app or its user profile.
const { app, BrowserWindow, WebContentsView } = require('electron')
const { join } = require('path')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-wayland-ime')
  app.commandLine.appendSwitch('wayland-text-input-version', '3')
}
app.commandLine.appendSwitch('process-per-site')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 980, height: 800, title: 'Nexus media diagnostic' })
  const view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: true } })
  win.contentView.addChildView(view)
  const resize = () => { const [width, height] = win.getContentSize(); view.setBounds({ x: 0, y: 0, width, height }) }
  resize(); win.on('resize', resize)
  console.log('Electron', process.versions.electron, 'Chromium', process.versions.chrome, 'platform', process.platform)
  console.log('GPU feature status:', JSON.stringify(app.getGPUFeatureStatus()))
  view.webContents.on('render-process-gone', (_event, details) => console.error('Renderer gone:', details.reason, details.exitCode))
  view.webContents.loadFile(join(__dirname, 'media-diagnostic.html')).catch(error => console.error('Failed to open diagnostic:', error.message))
})
app.on('window-all-closed', () => app.quit())
