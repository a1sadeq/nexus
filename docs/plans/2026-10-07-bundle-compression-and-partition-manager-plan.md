# Bundle Compression & Chunks Partition Management Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Provide full control over large uploads for file-limited AI chats by compressing codebase files before bundling, offering an interactive "Bundle Partition & Chunks" management drawer with configurable chunk sizes (5MB / 8MB / 10MB), itemizing each chunk's files and sizes, slicing individual huge files across line breaks, and executing automated paced sequential uploads with manual per-part controls.

**Architecture:** Create `compressAndPartitionFiles` pipeline in `src/shared/folderUpload.ts` / `src/main/uploadManager.ts`; add IPC handlers for chunk inspection and paced sequential CDP injection; build `ChunkPartitionDrawer` in `FolderUploadModal.tsx` with chunk size pills, part cards, progress telemetry, and individual part download/upload triggers.

**Tech Stack:** React 19, Electron IPC, Node.js `fs`, Tailwind CSS 4, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **The Problem**: AI providers have strict file thresholds (e.g., 10MB per file, or maximum 5 files per prompt). When users dump 30MB of code, the AI chat drops the request or truncates context silently.
- **The Visual Experience**:
  - **Pre-Bundle Compression Gauge**: An interactive badge showing token & byte savings:
    `⚡ Context Optimized: 14.8 MB → 10.2 MB (31% reduction)`.
  - **Cyberpunk Partition Cards**: Each chunk is displayed as an obsidian module with neon border glow:
    - `Part 1 of 3 · 4.8 MB / 5.0 MB · 18 files [Ready]`
    - Expandable file list inside each chunk showing individual file size badges.
  - **Chunk Size Dial**: Segmented pill selector `[ 5 MB ] [ 8 MB ] [ 10 MB ]` that recalculates parts in real time.
- **Paced Upload Telemetry**:
  - Automated upload smoothly uploads Part 1, flashes an emerald checkmark, waits 1.5s for the AI chat to settle, and uploads Part 2, keeping the user in full control via HUD toast feedback.
  - Manual overrides: Each part card features an individual `Upload This Part` and `Download Part` button.

---

### Task 1: Compression & Chunk Partitioning Utility

**Files:**
- Modify: `src/main/uploadManager.ts`
- Modify: `src/shared/folderUpload.ts`
- Test: `src/main/folderUpload.test.ts`

**Step 1: Write unit tests for compression & chunk partitioner**
```ts
describe('compressAndPartitionFiles', () => {
  it('compresses whitespace and partitions files into chunks strictly below maxChunkSize', () => {
    // Tests chunk distribution and single huge file slicing
  })
})
```

**Step 2: Run test to verify it fails**
Run: `npm test -- folderUpload.test.ts`
Expected: FAIL

**Step 3: Implement partitioner in `uploadManager.ts`**
```ts
export interface BundleChunk {
  index: number
  totalChunks: number
  byteSize: number
  fileCount: number
  files: Array<{ relativePath: string; size: number }>
  content: string
}
```
Implement `partitionCodebaseFiles(folderPath, selectedPaths, maxChunkBytes, enableCompression)`.

**Step 4: Add sequential paced upload handler in `src/main/index.ts`**
Handler `upload_chunks_sequentially`:
Injects chunks one by one with a 1.5s pacing interval and progress events to renderer.

**Step 5: Run tests and verify**
Run: `npm test -- folderUpload.test.ts`
Expected: PASS

---

### Task 2: Interactive "Bundle Partition & Chunks" Drawer in `FolderUploadModal`

**Files:**
- Modify: `src/renderer/src/components/FolderUploadModal.tsx`

**Step 1: Build `ChunkPartitionDrawer` Component**
- Slide-over or modal drawer toggled by a "Chunks & Partitions" badge button in the footer.
- Segmented control for Max Chunk Size: `5 MB`, `8 MB`, `10 MB`.
- List of chunk cards showing:
  - Part number and progress bar (% of chunk limit filled).
  - Expandable accordion of files inside the chunk.
  - "Download Part" button.
  - "Upload Part" button.
- Global "Upload All Chunks Sequentially" button with live pacing indicators.

**Step 2: Run tests & typecheck**
Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

**Step 3: Commit**
```bash
git add src/main/uploadManager.ts src/main/index.ts src/shared/folderUpload.ts src/renderer/src/components/FolderUploadModal.tsx
git commit -m "feat(upload): implement pre-bundle compression and interactive chunk partition management"
```
