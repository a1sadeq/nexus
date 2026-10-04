# Folder Upload Bundle Preview & Download to Disk Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Enable users to view (preview in a full cybernetic code inspection modal) and download (export directly to disk via native save dialog) the exact generated codebase bundle text before uploading, guaranteeing complete transparency and control.

**Architecture:** Create `generateBundlePayload` utility in `src/shared/folderUpload.ts` / `src/main/uploadManager.ts`; implement IPC handlers `preview_folder_bundle` and `save_folder_bundle_to_disk`; build `BundlePreviewModal` overlay in React with copy-to-clipboard, token counter, and monospaced code viewer.

**Tech Stack:** React 19, Electron IPC, Node.js `fs`, Tailwind CSS 4, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **Transparency & Trust**: Users uploading entire repositories need absolute trust in what is being sent to third-party AI models. The preview view acts as a high-tech "pre-flight inspection chamber".
- **Visual Design & Atmosphere**:
  - The preview window takes on a **Cyberpunk Code Vault** look: deep obsidian backdrop (`#090B10`), glowing cyan border highlights (`border-cyan-500/30`), and an animated status bar with token estimation (`⚡ 12,450 tokens · 42.8 KB · 14 files`).
  - Code Viewer: Dark terminal styling with soft line numbers, clean monospaced font (`font-mono text-xs`), and high-contrast file boundary markers (`=== File: <path> ===`).
- **Interactive Micro-Delights**:
  - **Copy to Clipboard**: Button shows `📋 Copy Bundle` -> transforms with gentle pulse into `✓ Copied to Clipboard!` in vibrant emerald (`bg-emerald-500/20 text-emerald-300 border-emerald-500/40`) for 2 seconds.
  - **Download to Disk**: Native OS Save Dialog lets users choose the exact destination, followed by an immediate toast displaying the saved file location.

---

### Task 1: Main Process Bundle Generators & Save Dialog IPC

**Files:**
- Modify: `src/main/uploadManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/folderUpload.ts`
- Test: `src/main/folderUpload.test.ts`

**Step 1: Write unit tests for bundle generation**
Extend `src/main/folderUpload.test.ts`:
```ts
it('generates unified bundle text with file separators and calculates token estimates', () => {
  // Test bundle generation with multiple files
})
```

**Step 2: Run test to verify it fails**
Run: `npm test -- folderUpload.test.ts`
Expected: FAIL

**Step 3: Implement bundle generation & IPC handlers**
1. Add `generateBundleText(folderPath: string, selectedPaths: string[]): { text: string; fileCount: number; byteSize: number }` in `uploadManager.ts`.
2. Add IPC handler `preview_folder_bundle` in `src/main/index.ts`:
```ts
ipcMain.handle('preview_folder_bundle', async (_event, payload: ConfirmFolderUploadPayload) => {
  return generateBundleText(payload.folderPath, payload.selectedPaths)
})
```
3. Add IPC handler `save_folder_bundle_to_disk` in `src/main/index.ts`:
```ts
ipcMain.handle('save_folder_bundle_to_disk', async (_event, payload: ConfirmFolderUploadPayload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Codebase Bundle',
    defaultPath: `${path.basename(payload.folderPath)}_codebase_bundle.txt`,
    filters: [{ name: 'Text Document', extensions: ['txt'] }]
  })
  if (canceled || !filePath) return { success: false }
  const { text } = generateBundleText(payload.folderPath, payload.selectedPaths)
  fs.writeFileSync(filePath, text, 'utf-8')
  return { success: true, savedPath: filePath }
})
```

**Step 4: Run tests to verify they pass**
Run: `npm test -- folderUpload.test.ts`
Expected: PASS

---

### Task 2: Renderer Preview Modal & Download Action in Footer

**Files:**
- Modify: `src/renderer/src/components/FolderUploadModal.tsx`

**Step 1: Build `BundlePreviewModal` inside `FolderUploadModal.tsx`**
- Render preview overlay when `isPreviewOpen === true`.
- Fetch bundle text via `window.electron?.ipcRenderer.invoke('preview_folder_bundle', ...)`.
- Include Token estimator gauge (`~Math.ceil(byteSize / 4)` tokens), character count, and line count.
- Include `Copy to Clipboard` with clipboard API and toast feedback.

**Step 2: Add "Preview Bundle" and "Download Bundle" buttons to footer**
- Add secondary footer action group:
  - `Preview Bundle` button with eye icon.
  - `Download Bundle` button with download icon calling `save_folder_bundle_to_disk`.
- Maintain primary `Upload {N} Files` button with glowing gradient.

**Step 3: Verify visually and run test suite**
Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

**Step 4: Commit**
```bash
git add src/main/uploadManager.ts src/main/index.ts src/shared/folderUpload.ts src/renderer/src/components/FolderUploadModal.tsx
git commit -m "feat(upload): add bundle preview modal and native file download to disk"
```
