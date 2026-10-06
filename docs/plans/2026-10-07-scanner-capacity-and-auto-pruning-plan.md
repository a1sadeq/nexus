# Scanner Capacity Expansion & Smart Auto-Pruning Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Expand folder scanning capacity to 10,000 files, enrich the ignored directories blacklist with industry-standard bloat folders, and implement intelligent auto-pruning so that huge codebases are never refused.

**Architecture:** Update `scanFolder` in `uploadManager.ts` with a 10,000-file ceiling; expand `IGNORE_DIRS` (virtualenvs, build caches, package managers); implement a smart two-pass crawler that prioritizes critical source files (`src/`, `app/`, `lib/`, `docs/`) and prunes low-priority directories when nearing capacity; expose `prunedCount` and `prunedDirs` in `FolderScanResult`.

**Tech Stack:** Node.js `fs`, TypeScript 5.9, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **The User Promise**: Never say "No" to the user. A hard 1000-file barrier frustrates developers working in real monorepos. If a repo is enormous, the system should act like an intelligent senior architect: filtering the noise (caches, virtual environments, binaries) while capturing all the meaningful code.
- **Visual Feedback**:
  - When pruning occurs, display a subtle obsidian amber pill in the modal header:
    `⚡ Smart Filtered: 10,000 code files loaded (pruned 4 heavy asset/cache directories)`.
  - Tooltip shows exactly which directories were pruned so the user has complete visibility and trust.

---

### Task 1: 10k Capacity & Smart Pruning Crawler

**Files:**
- Modify: `src/main/uploadManager.ts`
- Modify: `src/shared/folderUpload.ts`
- Test: `src/main/folderUpload.test.ts`

**Step 1: Write unit tests for capacity & pruning**
```ts
it('scans up to 10,000 files and smartly skips ignored heavy directories like .venv and target', () => {
  // Test directory ignore list and crawler capacity
})
```

**Step 2: Run test to verify it fails**
Run: `npm test -- folderUpload.test.ts`
Expected: FAIL

**Step 3: Update `uploadManager.ts`**
1. Increase `MAX_FOLDER_FILES = 10000`.
2. Expand `IGNORE_DIRS`:
```ts
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '.svelte-kit', '.cache', 'vendor', 'target', 'bin', 'obj', '.venv',
  'venv', 'env', '__pycache__', '.turbo', '.yarn', '.pnpm', '.parcel-cache',
  'coverage', '.idea', '.vscode'
])
```
3. Implement 2-phase priority crawl:
   - Priority 1: Source directories (`src`, `lib`, `app`, `packages`, `components`, `routes`, `docs`).
   - Priority 2: Other directories.
   - If limit reached: record pruned directories and continue without throwing.

**Step 4: Update `FolderScanResult` in `src/shared/folderUpload.ts`**
Add `prunedDirs?: string[]` and `isTruncated?: boolean`.

**Step 5: Run tests and verify**
Run: `npm test -- folderUpload.test.ts`
Expected: PASS

**Step 6: Commit**
```bash
git add src/main/uploadManager.ts src/shared/folderUpload.ts src/main/folderUpload.test.ts
git commit -m "feat(upload): expand scanner capacity to 10,000 files with smart pruning"
```
