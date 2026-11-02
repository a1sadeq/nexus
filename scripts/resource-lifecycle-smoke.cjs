// Run from a fully installed checkout: npx electron scripts/resource-lifecycle-smoke.cjs
// Linux CI may require xvfb-run. This is a native lifecycle check, not a RAM benchmark.
if (!process.versions.electron) {
  console.error('Run this script with Electron, not plain Node. No test was executed.');
  process.exit(2);
}
const { app, BrowserWindow, WebContentsView, webContents } = require('electron');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const exported = {};
const source = readFileSync(join(__dirname, '../src/main/webContentsLifecycle.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
new Function('exports', compiled)(exported);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    for (let i = 0; i < 10; i++) {
      const view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: true } });
      win.contentView.addChildView(view);
      const contents = view.webContents;
      const id = contents.id;
      await contents.loadURL('data:text/html,<title>Nexus lifecycle fixture</title><p>Local test only</p>');
      await exported.closeWebContents(contents);
      assert.equal(contents.isDestroyed(), true);
      assert.equal(webContents.getAllWebContents().some(wc => wc.id === id), false);
      try { win.contentView.removeChildView(view); } catch {}
    }
    console.log('PASS: 10 real WebContentsView close/destroy cycles; no surviving fixture contents IDs.');
    win.destroy(); app.quit();
  } catch (error) {
    console.error('FAIL:', error); win.destroy(); app.exit(1);
  }
}).catch(error => { console.error('FAIL:', error); app.exit(1); });
