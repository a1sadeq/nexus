# Folder Upload Directory Grouping & Folder Deselection Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Group scanned files in `FolderUploadModal` by relative directory path, providing collapsible folder headers and tri-state checkboxes to easily select or deselect entire folders at once.

**Architecture:** Compute directory clusters from `filteredFiles` using `useMemo`; maintain `collapsedDirs: Set<string>` state for interactive folding; implement tri-state checkbox logic (checked / indeterminate / unchecked); render structured folder hierarchy with smooth transitions.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **Cybernetic Hierarchy & Aesthetics**:
  - The flat file list is transformed into a clean, architectural directory breakdown.
  - Folder headers feature 1px subtle neon border accents (`border-white/10 bg-white/[0.03] hover:bg-white/[0.06]`), monospaced path typography, and an icon representing the folder capsule.
  - Collapsed state displays a glowing counter badge (e.g. `12 files hidden · 48 KB`) so the user never loses situational awareness.
- **Tri-State Checkbox Ergonomics**:
  - **All Selected**: Glowing indigo square with crisp checkmark (`✓`).
  - **Partially Selected**: Semi-translucent indigo fill with a centered horizontal dash marker (`—`), instantly communicating mixed states without visual ambiguity.
  - **None Selected**: Crisp 1px border on obsidian backdrop, turning on with instant feedback on hover.
- **Micro-Interactions**:
  - Chevrons smoothly rotate 90° (`transition-transform duration-150`) upon folding.
  - Clicking the folder row folds/unfolds the section; clicking the checkbox directly toggles selection.
  - Accessible keyboard navigation (`Space` or `Enter` toggles checkbox).

---

### Task 1: Directory Grouping Engine & Tri-State Checkboxes

**Files:**
- Modify: `src/renderer/src/components/FolderUploadModal.tsx:393-462`
- Test: `src/renderer/src/components/FolderUploadModal.test.tsx`

**Step 1: Write unit tests for directory grouping and folder toggling**
Extend `FolderUploadModal.test.tsx`:
```tsx
it('groups files by directory and toggles all files in a folder when folder checkbox is clicked', () => {
  // Test clicking folder checkbox selects all files in that folder
  // Test clicking it again deselects all files in that folder
  // Test indeterminate state when 1 of 2 files in folder is selected
})
```

**Step 2: Run test to verify it fails**
Run: `npm run test -- FolderUploadModal.test.tsx`
Expected: FAIL

**Step 3: Implement directory grouping & state in `FolderUploadModal.tsx`**
1. Compute `directoryGroups` from `filteredFiles`:
```tsx
interface DirectoryGroup {
  dirPath: string
  displayName: string
  files: ScannedFileInfo[]
  totalBytes: number
  selectedCount: number
}
```
2. Track `collapsedDirs`:
```tsx
const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
const toggleCollapseDir = (dirPath: string) => {
  setCollapsedDirs((prev) => {
    const next = new Set(prev)
    if (next.has(dirPath)) next.delete(dirPath)
    else next.add(dirPath)
    return next
  })
}
```
3. Implement `toggleDirectory(dirFiles: ScannedFileInfo[])`:
```tsx
const toggleDirectory = (dirFiles: ScannedFileInfo[]) => {
  setSelectedPaths((prev) => {
    const next = new Set(prev)
    const allSelected = dirFiles.every((f) => next.has(f.path))
    if (allSelected) {
      for (const f of dirFiles) next.delete(f.path)
    } else {
      for (const f of dirFiles) next.add(f.path)
    }
    return next
  })
}
```
4. Render folder headers with tri-state glyph and collapsible child file rows.

**Step 4: Run tests to verify they pass**
Run: `npm run test`
Expected: PASS

**Step 5: Commit**
```bash
git add src/renderer/src/components/FolderUploadModal.tsx src/renderer/src/components/FolderUploadModal.test.tsx
git commit -m "feat(upload): add directory grouping and folder deselection to FolderUploadModal"
```
