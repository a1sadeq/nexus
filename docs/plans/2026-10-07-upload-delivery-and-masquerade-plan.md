# Upload Delivery Pipeline & Smart Masquerading Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the "not supported file extension" error on `Ctrl+O` (single/multi-file upload) and `Ctrl+Shift+O` (folder upload) by implementing universal `.txt` masquerading, intelligent document file input targeting, and a multi-tier delivery fallback (file input -> dropzone drag/drop -> prompt composer paste).

**Architecture:** Update `uploadManager.ts` to inspect file input `accept` attributes (skipping `image/*`-only inputs), create clean `.txt` copies with source metadata headers (`/* Source File: <name> */`), and add a tertiary prompt-paste fallback when native file input injection fails.

**Tech Stack:** Electron 43, Chrome DevTools Protocol (CDP), Node.js `fs`, TypeScript 5.9, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **The Problem Experience**: When an engineer uploads `App.tsx` or `server.py`, the AI webview abruptly crashes the flow with a red modal: *"File type not supported"*. This breaks immersion and feels like a broken bridge.
- **The Invisible Bridge**:
  - Nexus seamlessly presents the file to the AI webview disguised as `<filename>.<ext>.txt` (e.g. `App.tsx.txt`).
  - At the top of the file, Nexus prepends an aesthetic metadata banner:
    ```text
    /* ================================================================
     * SOURCE FILE: App.tsx
     * ORIGINAL FORMAT: TypeScript JSX (.tsx)
     * ================================================================ */
    ```
  - The AI model reads the real filename and language syntax flawlessly, while the web host's strict file filter happily accepts the `.txt` payload.
- **Micro-Interactions**:
  - High-tech HUD toast with cyan glow: `⚡ Injected App.tsx via Smart TXT Bridge`.
  - If file input is locked by the provider, seamless auto-fallback: `⚡ Attached code directly to prompt composer`.

---

### Task 1: Smart Masquerading Utility & CDP Input Filter

**Files:**
- Modify: `src/main/uploadManager.ts`
- Test: `src/main/uploadManager.test.ts` (new / extended)

**Step 1: Write unit tests for masquerade path & header generator**
```ts
describe('masqueradeFilePath', () => {
  it('creates a .txt copy for non-.txt code files with clear metadata header', () => {
    // Verifies App.tsx -> App.tsx.txt with header comments
  })
})
```

**Step 2: Run test to verify it fails**
Run: `npm test -- uploadManager.test.ts`
Expected: FAIL

**Step 3: Implement smart masquerading in `uploadManager.ts`**
```ts
export function createMasqueradedTextFile(originalPath: string): string {
  const fileName = path.basename(originalPath)
  const ext = path.extname(originalPath).toLowerCase()
  if (ext === '.txt') return originalPath

  const tempPath = path.join(os.tmpdir(), `${fileName}.txt`)
  const content = fs.readFileSync(originalPath, 'utf-8')
  const header = `/* ================================================================\n * SOURCE FILE: ${fileName}\n * ORIGINAL FORMAT: ${ext}\n * ================================================================ */\n\n`
  fs.writeFileSync(tempPath, header + content, 'utf-8')
  return tempPath
}
```

**Step 4: Update CDP Input Query to reject `image/*`-only inputs**
In `injectFilesViaCDP`:
1. Query all `input[type="file"]`.
2. Evaluate `accept` attribute: filter out inputs where `accept.includes('image/')` and does NOT include `text`, `pdf`, `*/*`, or doc formats.
3. Select the document or generic attachment input.
4. If injection throws or fails, invoke prompt composer paste fallback via `Input.insertText` or DOM paste event.

**Step 5: Run tests and verify**
Run: `npm test`
Expected: PASS

**Step 6: Commit**
```bash
git add src/main/uploadManager.ts
git commit -m "fix(upload): implement smart txt masquerading and intelligent file input targeting"
```
