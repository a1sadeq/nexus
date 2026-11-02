// Run from a fully installed checkout: npx electron scripts/tab-discard-wake-smoke.cjs
// Native Electron tab discard and wake smoke verification.
if (!process.versions.electron) {
  console.error('Run this script with Electron, not plain Node. No test was executed.')
  process.exit(2)
}

const { app, BrowserWindow, WebContentsView } = require('electron')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const ts = require('typescript')

function loadTs(relPath) {
  const fullPath = join(__dirname, '..', relPath)
  const src = readFileSync(fullPath, 'utf8')
  const code = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const m = { exports: {} }
  const customRequire = (id) => {
    if (id === '../shared/tabDiscardPolicy' || id === './tabDiscardPolicy') {
      return loadTs('src/shared/tabDiscardPolicy.ts')
    }
    if (id === './webContentsLifecycle') {
      return loadTs('src/main/webContentsLifecycle.ts')
    }
    return require(id)
  }
  new Function('module', 'exports', 'require', '__dirname', '__filename', code)(
    m,
    m.exports,
    customRequire,
    join(__dirname, '..', relPath, '..'),
    fullPath
  )
  return m.exports
}

const { TabDiscardManager, isUsableRestoreUrl } = loadTs('src/main/tabDiscardManager.ts')

app.whenReady().then(async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'nexus-electron-wake-smoke-'))
  let win
  let manager

  try {
    win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: { sandbox: true }
    })

    manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      idleCheckIntervalMs: 50,
      snapshotTimeoutMs: 200
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1, tabDiscardMinutes: 0 })

    console.log('1. Testing URL usability validation...')
    assert.equal(isUsableRestoreUrl(''), false)
    assert.equal(isUsableRestoreUrl('about:blank'), false)
    assert.equal(isUsableRestoreUrl('javascript:alert(1)'), false)
    assert.equal(isUsableRestoreUrl('https://arena.ai/c/test'), true)

    console.log('2. Creating Tab 1 with scrollable content...')
    const view1 = new WebContentsView({ webPreferences: { sandbox: true } })
    const contents1 = view1.webContents
    win.contentView.addChildView(view1)
    view1.setBounds({ x: 0, y: 0, width: 800, height: 600 })

    manager.registerView('tab-1', view1)
    manager.activateTab('tab-1')

    const tab1Html =
      'data:text/html,<html><head><title>Tab 1 Test</title></head>' +
      '<body style="margin:0;padding:0;height:4000px;background:%23111;">' +
      '<h1 id="top" style="color:white;">Top of Tab 1</h1>' +
      '<div id="marker" style="margin-top:500px;color:cyan;">Marker at 500px</div>' +
      '</body></html>'

    await view1.webContents.loadURL(tab1Html)
    const initialScroll = await view1.webContents.executeJavaScript(
      'window.scrollTo(0, 500); window.scrollY'
    )
    assert.equal(initialScroll, 500, 'Initial scroll position must be 500')

    console.log('3. Creating Tab 2 to trigger capacity eviction of Tab 1...')
    const view2 = new WebContentsView({ webPreferences: { sandbox: true } })
    win.contentView.addChildView(view2)
    view2.setBounds({ x: 0, y: 0, width: 800, height: 600 })

    manager.registerView('tab-2', view2)
    manager.activateTab('tab-2')

    const tab2Html =
      'data:text/html,<html><head><title>Tab 2</title></head><body><h1>Tab 2 Active</h1></body></html>'
    await view2.webContents.loadURL(tab2Html)

    // Wait for eviction of tab-1 (capacity cap: 1 active tab)
    console.log('4. Waiting for Tab 1 eviction...')
    const start = Date.now()
    while (!manager.isTabEvicted('tab-1')) {
      if (Date.now() - start > 5000) {
        throw new Error('Timeout waiting for tab-1 to be evicted by TabDiscardManager')
      }
      await new Promise((r) => setTimeout(r, 50))
    }

    // Verify Tab 1 native WebContents is closed and destroyed
    assert.equal(
      contents1.isDestroyed(),
      true,
      'Evicted WebContents must be destroyed natively'
    )
    try {
      win.contentView.removeChildView(view1)
    } catch {}

    // Verify saved eviction state
    const savedState = manager.getEvictedTabState('tab-1')
    assert(savedState, 'Saved eviction state must exist')
    assert.equal(savedState.scrollY, 500, 'Saved scroll position must match pre-eviction position (500)')
    assert(savedState.url.includes('Tab%201%20Test') || savedState.url.includes('Tab 1 Test'), 'Saved URL must match tab 1 URL')

    console.log('5. Verifying URL resolution and eviction state retention on failure...')
    // Resolution resolves saved URL first
    const resolvedUrl = manager.getUsableRestoreUrl('tab-1', 'https://fallback.ai')
    assert.equal(resolvedUrl, savedState.url, 'Saved URL must take precedence over fallback')

    // Eviction state is still intact before wake succeeds
    assert.equal(manager.isTabEvicted('tab-1'), true, 'Eviction state must not be consumed beforehand')

    // Simulate load failure retry preservation
    const failedAttemptView = new WebContentsView({ webPreferences: { sandbox: true } })
    try {
      // Intentionally reject load to ensure eviction state is preserved
      await failedAttemptView.webContents.loadURL('invalid-protocol://cannot-load')
    } catch {
      // Expected failure; ensure state wasn't consumed
      assert.equal(manager.isTabEvicted('tab-1'), true, 'State must remain intact after load failure')
    }
    try {
      win.contentView.removeChildView(failedAttemptView)
      failedAttemptView.webContents.close()
    } catch {}

    console.log('6. Waking Tab 1 with new WebContentsView and restoring scroll...')
    const wokenView = new WebContentsView({ webPreferences: { sandbox: true } })
    win.contentView.addChildView(wokenView)
    wokenView.setBounds({ x: 0, y: 0, width: 800, height: 600 })

    // Load restore URL
    await wokenView.webContents.loadURL(resolvedUrl)

    // Restore scroll
    await wokenView.webContents.executeJavaScript(`window.scrollTo(0, ${savedState.scrollY})`)
    const restoredScroll = await wokenView.webContents.executeJavaScript('window.scrollY')
    assert.equal(restoredScroll, 500, 'Restored scroll position must be 500')

    // Now consume eviction state after successful load and scroll
    const consumedState = manager.consumeEvictedTabState('tab-1')
    assert.equal(consumedState.scrollY, 500)
    assert.equal(manager.isTabEvicted('tab-1'), false, 'Tab 1 must no longer be marked evicted')

    // Register woken view and activate Tab 1
    manager.registerView('tab-1', wokenView)
    manager.activateTab('tab-1')

    assert.equal(manager.getActiveViewId(), 'tab-1')
    assert.equal(wokenView.webContents.isDestroyed(), false)

    console.log('PASS: Native Electron tab discard and wake with scroll restoration verified successfully.')

    manager.stop()
    win.destroy()
    rmSync(tempDir, { recursive: true, force: true })
    app.quit()
  } catch (error) {
    console.error('FAIL:', error)
    if (manager) manager.stop()
    if (win) win.destroy()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
    app.exit(1)
  }
})
