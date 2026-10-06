# Hierarchical Folder Tree & Cascading Selection Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Transform the folder selector in `FolderUploadModal` into a true hierarchical directory tree with recursive cascading selection (checking a folder selects all nested files and subfolders), depth-based default expansion (depth 1-2 open, depth 3+ collapsed), search-matching auto-expansion, and a global "Expand All / Collapse All" toggle.

**Architecture:** Build recursive `FolderTreeNode` data structure in `folderUploadHelpers.ts`; implement cascading toggle logic; track `collapsedDirs: Set<string>`; render tree with smooth indentation guidelines and tri-state checkboxes in `FolderUploadModal.tsx`.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **The Mental Model**: Folders are nested containers, not flat tags. When a user deselects `src/`, they expect everything under `src/` (including `src/renderer/components/ui/`) to be deselected instantly without hunting through 5 separate rows.
- **Visual Design & Atmosphere**:
  - **Tree Guidelines**: 1px subtle glass boundary lines (`border-l border-white/[0.07] ml-3.5 pl-3`) visually anchoring children to their parent folder.
  - **Depth Aesthetics**:
    - Root / Depth 1: Radiant cyan folder icon (`text-cyan-400 font-semibold`).
    - Depth 2+: Muted indigo folder icon (`text-indigo-400/80 font-normal`).
  - **Tri-State Checkbox Glyph**:
    - Checked (`✓`): Solid indigo square with crisp white check.
    - Indeterminate (`—`): Translucent indigo with centered dash, instantly showing when 3 out of 10 nested files are active.
    - Unchecked: 1px subtle obsidian border.
- **Global Toolbar Controls**:
  - Modern action pill: `⊞ Expand All` ↔ `⊟ Collapse All` with micro-animation.
  - When searching: Auto-expands ancestor branches containing matching search results, returning to default depth when cleared.

---

### Task 1: Recursive Tree Data Structure & Helper Functions

**Files:**
- Modify: `src/renderer/src/lib/folderUploadHelpers.ts`
- Test: `src/renderer/src/lib/folderUploadHelpers.test.ts`

**Step 1: Write unit tests for tree builder and cascading toggle**
Test cases:
- Builds recursive tree from file list with accurate recursive file counts and byte sizes.
- Toggling a parent node cascades to all nested child files and subdirectories.
- Computes tri-state correctly for parent nodes with mixed child selections.
- Resolves default collapsed dirs for depth > 2.
- Auto-expands parent chains for search matches.

**Step 2: Run test to verify it fails**
Run: `npm test -- folderUploadHelpers.test.ts`
Expected: FAIL

**Step 3: Implement tree functions in `folderUploadHelpers.ts`**
```ts
export interface FolderTreeNode {
  name: string
  fullPath: string
  depth: number
  files: ScannedFileInfo[]
  children: FolderTreeNode[]
  totalFiles: number
  totalBytes: number
  allDescendantPaths: string[]
}
```

**Step 4: Run tests to verify they pass**
Run: `npm test -- folderUploadHelpers.test.ts`
Expected: PASS

---

### Task 2: Hierarchical Tree UI & Depth Controls in `FolderUploadModal`

**Files:**
- Modify: `src/renderer/src/components/FolderUploadModal.tsx`

**Step 1: Render recursive Tree Node Component**
- Implement recursive tree renderer with:
  - Indented container with vertical guide line.
  - Chevron toggle, folder icon, tri-state checkbox, count badge.
  - File rows under leaf nodes.

**Step 2: Add Global `Expand All / Collapse All` Button**
- Add button in toolbar:
  - If any folder is collapsed -> "Expand All"
  - If all folders are expanded -> "Collapse All"

**Step 3: Wire Search Auto-Expansion**
- When `search` changes, calculate matching ancestor paths and expand them automatically.
- When `search` is cleared, restore default depth (depth 1 & 2 expanded).

**Step 4: Verify test suite & typecheck**
Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

**Step 5: Commit**
```bash
git add src/renderer/src/lib/folderUploadHelpers.ts src/renderer/src/lib/folderUploadHelpers.test.ts src/renderer/src/components/FolderUploadModal.tsx
git commit -m "feat(upload): implement hierarchical tree view with cascading toggle and depth controls"
```
