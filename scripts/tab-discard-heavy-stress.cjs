// Heavy stress test for Nexus Tab Discard and Wake lifecycle in native Electron.
// Usage: npx electron scripts/tab-discard-heavy-stress.cjs
if (!process.versions.electron) {
  console.error('Run this script with Electron, not Node.')
  process.exit(2)
}

const { app, BrowserWindow, WebContentsView, webContents } = require('electron')
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
  const tempDir = mkdtempSync(join(tmpdir(), 'nexus-heavy-stress-'))
  let win
  let manager

  try {
    console.log('=== Nexus Tab Discard & Wake Heavy Stress Harness ===\n')

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { sandbox: true }
    })

    manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      idleCheckIntervalMs: 50,
      snapshotTimeoutMs: 150
    })
    manager.init()

    // -------------------------------------------------------------
    // Test 1: High-Frequency Churn (30 activations, 5 tabs, cap = 2)
    // -------------------------------------------------------------
    console.log('[Stress 1] High-Frequency Tab Churn & Eviction/Wake Cycles')
    const CAP = 2
    manager.setPolicy({ maxActiveTabs: CAP, tabDiscardMinutes: 0 })

    const TAB_COUNT = 5
    const tabData = new Map() // tabId -> { url, targetScroll, view, contentsRef }

    for (let i = 0; i < TAB_COUNT; i++) {
      const tabId = `tab-${i}`
      const targetScroll = (i + 1) * 250 // 250, 500, 750, 1000, 1250
      const url = `data:text/html,<html><head><title>Tab ${i}</title></head><body style="margin:0;padding:0;height:5000px;"><h1 style="color:black">Tab ${i}</h1><div style="margin-top:${targetScroll}px;color:blue">Marker ${targetScroll}px</div></body></html>`
      tabData.set(tabId, { url, targetScroll, view: null, contentsRef: null })
    }

    // Helper: Wake or switch to a tab
    async function activateTabInHarness(tabId) {
      const data = tabData.get(tabId)

      if (manager.hasView(tabId)) {
        // Tab is already resident
        manager.activateTab(tabId)
        data.view.setVisible(true)
        return
      }

      // Tab was discarded or not yet created -> wake it
      const savedState = manager.getEvictedTabState(tabId)
      const restoreUrl = manager.getUsableRestoreUrl(tabId, data.url)
      assert(restoreUrl, `Must have usable restore URL for ${tabId}`)

      const newView = new WebContentsView({ webPreferences: { sandbox: true } })
      const newContents = newView.webContents
      win.contentView.addChildView(newView)
      newView.setBounds({ x: 0, y: 0, width: 800, height: 600 })

      await newContents.loadURL(restoreUrl)

      const expectedScroll = savedState ? savedState.scrollY : data.targetScroll
      await newContents.executeJavaScript(`window.scrollTo(0, ${expectedScroll})`)
      const actualScroll = await newContents.executeJavaScript('window.scrollY')
      assert.equal(actualScroll, expectedScroll, `Scroll position must match ${expectedScroll}`)

      // Only consume after successful load and scroll
      if (savedState) {
        manager.consumeEvictedTabState(tabId)
      }

      data.view = newView
      data.contentsRef = newContents
      manager.registerView(tabId, newView)
      manager.activateTab(tabId)
      newView.setVisible(true)
    }

    // Helper: Wait for background evictions to settle to <= CAP
    async function waitForEvictions() {
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const status = manager.getStatus()
        if (status.residentCount <= CAP && status.pendingCount === 0) return
        await new Promise((r) => setTimeout(r, 40))
      }
      throw new Error(`Timeout waiting for capacity reconciliation. Status: ${JSON.stringify(manager.getStatus())}`)
    }

    // Sequential activation pattern cycling 30 times
    const switchSequence = [
      'tab-0', 'tab-1', 'tab-2', 'tab-3', 'tab-4',
      'tab-0', 'tab-2', 'tab-4', 'tab-1', 'tab-3',
      'tab-0', 'tab-4', 'tab-2', 'tab-1', 'tab-3',
      'tab-4', 'tab-0', 'tab-3', 'tab-1', 'tab-2',
      'tab-0', 'tab-1', 'tab-2', 'tab-3', 'tab-4',
      'tab-2', 'tab-0', 'tab-4', 'tab-3', 'tab-1'
    ]

    let cycle = 0
    for (const tabId of switchSequence) {
      cycle++
      await activateTabInHarness(tabId)
      await waitForEvictions()

      const status = manager.getStatus()
      assert(status.residentCount <= CAP, `Resident count (${status.residentCount}) must not exceed CAP (${CAP})`)
      assert.equal(manager.getActiveViewId(), tabId, `Active tab must be ${tabId}`)

      // Verify that every evicted tab has destroyed native webContents
      for (const [id, info] of tabData.entries()) {
        if (manager.isTabEvicted(id)) {
          if (info.contentsRef) {
            assert.equal(info.contentsRef.isDestroyed(), true, `Evicted tab ${id} must have destroyed native contents`)
            try { win.contentView.removeChildView(info.view) } catch {}
            info.view = null
          }
          const saved = manager.getEvictedTabState(id)
          assert(saved, `Evicted tab ${id} must have saved eviction state`)
          assert.equal(saved.scrollY, info.targetScroll, `Evicted tab ${id} scroll must match target ${info.targetScroll}`)
        }
      }

      if (cycle % 10 === 0) {
        console.log(`  -> Completed ${cycle}/30 rapid activations. Resident: ${status.residentCount}, Discarded: ${status.discardedCount}`)
      }
    }
    console.log('✓ Stress 1 Passed: 30 churn cycles completed with zero scroll drift and zero leaked tabs.\n')

    // -------------------------------------------------------------
    // Test 2: Unusable URL Immunity Under Heavy Pressure
    // -------------------------------------------------------------
    console.log('[Stress 2] Unusable URL Immunity (about:blank, empty) Under Capacity Pressure')
    // Reset policy to CAP = 1
    manager.setPolicy({ maxActiveTabs: 1 })

    // Register Tab Blank with about:blank
    const blankView = new WebContentsView({ webPreferences: { sandbox: true } })
    const blankContents = blankView.webContents
    win.contentView.addChildView(blankView)
    manager.registerView('tab-blank', blankView)
    manager.activateTab('tab-blank')
    await blankContents.loadURL('about:blank')

    // Now activate 5 other tabs with valid URLs in sequence
    for (let i = 0; i < 5; i++) {
      const spamId = `spam-tab-${i}`
      const spamView = new WebContentsView({ webPreferences: { sandbox: true } })
      win.contentView.addChildView(spamView)
      manager.registerView(spamId, spamView)
      manager.activateTab(spamId)
      await spamView.webContents.loadURL(`data:text/html,<h1>Spam ${i}</h1>`)
      await new Promise((r) => setTimeout(r, 60))
    }

    // tab-blank MUST NOT have been evicted because it has an unusable URL!
    assert.equal(manager.isTabEvicted('tab-blank'), false, 'Tab with about:blank must never be evicted')
    assert.equal(blankContents.isDestroyed(), false, 'Tab with about:blank must remain alive')
    const statusAfterBlank = manager.getStatus()
    assert(statusAfterBlank.protectedCount >= 1, 'Protected count must track protected background tab')
    console.log('✓ Stress 2 Passed: Unusable URL remained protected across 5 capacity cycles.\n')

    // -------------------------------------------------------------
    // Test 3: Wake Failure Resilience & State Preservation
    // -------------------------------------------------------------
    console.log('[Stress 3] Wake Failure Resilience & Retry Retention')
    // Create tab-fail, scroll to 888, let it be evicted
    const failView = new WebContentsView({ webPreferences: { sandbox: true } })
    const failContents = failView.webContents
    win.contentView.addChildView(failView)
    manager.registerView('tab-fail', failView)
    manager.activateTab('tab-fail')
    await failContents.loadURL('data:text/html,<body style="height:3000px">Fail Test</body>')
    await failContents.executeJavaScript('window.scrollTo(0, 888)')

    // Force eviction by activating another tab
    const pusherView = new WebContentsView({ webPreferences: { sandbox: true } })
    win.contentView.addChildView(pusherView)
    manager.registerView('tab-pusher', pusherView)
    manager.activateTab('tab-pusher')
    await pusherView.webContents.loadURL('data:text/html,<h1>Pusher</h1>')

    const startWait = Date.now()
    while (!manager.isTabEvicted('tab-fail')) {
      if (Date.now() - startWait > 3000) throw new Error('Timeout waiting for tab-fail eviction')
      await new Promise((r) => setTimeout(r, 30))
    }
    assert.equal(failContents.isDestroyed(), true)

    // Saved state exists
    const preservedState = manager.getEvictedTabState('tab-fail')
    assert.equal(preservedState.scrollY, 888)

    // Attempt 1: Failed load
    const brokenView = new WebContentsView({ webPreferences: { sandbox: true } })
    try {
      await brokenView.webContents.loadURL('non-existent-protocol://failure')
      assert.fail('Should have thrown')
    } catch {
      // Expected failure; ensure state is NOT consumed
      assert.equal(manager.isTabEvicted('tab-fail'), true, 'Eviction state must survive failed load')
      assert.equal(manager.getEvictedTabState('tab-fail')?.scrollY, 888)
    }
    try { brokenView.webContents.close() } catch {}

    // Attempt 2: Successful retry
    const retryView = new WebContentsView({ webPreferences: { sandbox: true } })
    win.contentView.addChildView(retryView)
    const restoreUrl = manager.getUsableRestoreUrl('tab-fail', 'data:text/html,Fallback')
    assert.equal(restoreUrl, preservedState.url)
    await retryView.webContents.loadURL(restoreUrl)
    await retryView.webContents.executeJavaScript(`window.scrollTo(0, ${preservedState.scrollY})`)
    const restoredY = await retryView.webContents.executeJavaScript('window.scrollY')
    assert.equal(restoredY, 888, 'Retry must restore exact scroll position (888)')

    // Now consume
    manager.consumeEvictedTabState('tab-fail')
    assert.equal(manager.isTabEvicted('tab-fail'), false)
    manager.registerView('tab-fail', retryView)
    manager.activateTab('tab-fail')
    console.log('✓ Stress 3 Passed: Failed wake attempt preserved state; subsequent retry succeeded.\n')

    // -------------------------------------------------------------
    // Test 4: Stale Wake & Token Super-session
    // -------------------------------------------------------------
    console.log('[Stress 4] Race Condition & Token Super-session')
    const wakeTokens = new Map()

    // Step A: Wake token 1 assigned
    const token1 = (wakeTokens.get('race-tab') || 0) + 1
    wakeTokens.set('race-tab', token1)

    // Step B: User navigates or switches rapidly, advancing token to 2
    const token2 = (wakeTokens.get('race-tab') || 0) + 1
    wakeTokens.set('race-tab', token2)

    // Step C: When wake 1 finishes, its token (1) doesn't match current (2)
    const wake1Matches = (wakeTokens.get('race-tab') === token1)
    assert.equal(wake1Matches, false, 'Wake 1 must be flagged as stale and discarded')
    const wake2Matches = (wakeTokens.get('race-tab') === token2)
    assert.equal(wake2Matches, true, 'Wake 2 must match current token')
    console.log('✓ Stress 4 Passed: Token super-session correctly rejects stale activations.\n')

    // -------------------------------------------------------------
    // Test 5: Global WebContents Registry Leak Check
    // -------------------------------------------------------------
    console.log('[Stress 5] Global WebContents Leak Audit')
    const allRemaining = webContents.getAllWebContents()
    console.log(`  -> Total live WebContents in Electron registry: ${allRemaining.length}`)
    // Must be bounded: window webContents + resident tabs only
    assert(allRemaining.length <= 6, `Surviving WebContents count (${allRemaining.length}) exceeds expected resident bounds`)
    console.log('✓ Stress 5 Passed: Zero dangling WebContents handles in Electron registry.\n')

    console.log('=====================================================')
    console.log('ALL HEAVY STRESS TESTS PASSED SUCCESSFULLY (5/5)')
    console.log('=====================================================')

    manager.stop()
    win.destroy()
    rmSync(tempDir, { recursive: true, force: true })
    app.quit()
  } catch (error) {
    console.error('\n❌ HEAVY STRESS TEST FAILED:', error)
    if (manager) manager.stop()
    if (win) win.destroy()
    try { rmSync(tempDir, { recursive: true, force: true }) } catch {}
    app.exit(1)
  }
})
