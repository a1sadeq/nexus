# Folder Upload Contextual Search Selection Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Implement intelligent, contextual batch selection in `FolderUploadModal` so that when a user searches for files, "Select All" and "Deselect All" dynamically adapt to "Select Matching (N)" and "Deselect Matching (N)", operating strictly on matching search results without overwriting existing selections.

**Architecture:** Extend `FolderUploadModal.tsx` state management to differentiate global vs. filtered selection actions; memoize search matches; apply set union / difference operations to `selectedPaths`; preserve keyboard navigation and accessibility.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4, Vitest.

---

## 🎨 Artist View & Mind (UI/UX Pro Max)

- **Cognitive Flow**: When a user filters files (e.g. typing `test` or `.tsx`), their visual and mental focus narrows to the search results. Clicking "Select All" must respect this mental model by selecting *only what is visible*, never secretly selecting hundreds of hidden files.
- **Visual Typography & Feedback**:
  - Default State (No Search): Clean obsidian pills labeled `Select All` and `Deselect All`.
  - Active Search State: Pill labels transition to dynamic counters: `Select Matching (N)` with an indigo highlight (`bg-indigo-500/20 text-indigo-200 border-indigo-500/40`), and `Deselect Matching (N)` in subtle muted glass (`bg-white/[0.04] text-gray-300`).
  - Zero Matches State: Buttons are gracefully disabled (`opacity-40 cursor-not-allowed`) to prevent ghost clicks.
- **Accessibility & Touch**: Focus rings (`focus:ring-2 focus:ring-indigo-500/50`), min touch target height 32px, `aria-label` stating exact file count impacted.

---

### Task 1: Contextual Search Selection Logic & UI

**Files:**
- Modify: `src/renderer/src/components/FolderUploadModal.tsx:291-307`
- Test: `src/renderer/src/components/FolderUploadModal.test.tsx` (new test file)

**Step 1: Write unit tests for contextual search selection**
Create `src/renderer/src/components/FolderUploadModal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FolderUploadModal } from './FolderUploadModal'
import type { FolderScanResult } from '../../../shared/folderUpload'

const mockData: FolderScanResult = {
  folderPath: '/test/app',
  folderName: 'app',
  totalFiles: 4,
  totalBytes: 4000,
  files: [
    { path: '/test/app/index.ts', relativePath: 'index.ts', size: 1000, extension: '.ts', isSuggestedRemoval: false },
    { path: '/test/app/App.tsx', relativePath: 'App.tsx', size: 1000, extension: '.tsx', isSuggestedRemoval: false },
    { path: '/test/app/App.test.tsx', relativePath: 'App.test.tsx', size: 1000, extension: '.tsx', isSuggestedRemoval: false },
    { path: '/test/app/style.css', relativePath: 'style.css', size: 1000, extension: '.css', isSuggestedRemoval: false }
  ]
}

describe('FolderUploadModal contextual search selection', () => {
  it('adapts buttons to Select Matching (N) when search is active and only alters matching files', () => {
    // Tests that filtering by "test" shows "Select Matching (1)" and "Deselect Matching (1)"
    // and clicking Deselect Matching only unchecks App.test.tsx
  })
})
```

**Step 2: Run test to verify it fails**
Run: `npm run test -- FolderUploadModal.test.tsx`
Expected: FAIL (file or assertion not found)

**Step 3: Implement contextual search callbacks in `FolderUploadModal.tsx`**
1. Add `isSearching = search.trim().length > 0`
2. Add `selectMatching`:
```tsx
const selectMatching = useCallback(() => {
  setSelectedPaths((prev) => {
    const next = new Set(prev)
    for (const f of filteredFiles) next.add(f.path)
    return next
  })
}, [filteredFiles])
```
3. Add `deselectMatching`:
```tsx
const deselectMatching = useCallback(() => {
  setSelectedPaths((prev) => {
    const next = new Set(prev)
    for (const f of filteredFiles) next.delete(f.path)
    return next
  })
}, [filteredFiles])
```
4. Render adaptive button text with count badges:
```tsx
<button
  type="button"
  onClick={isSearching ? selectMatching : selectAll}
  disabled={isSearching && filteredFiles.length === 0}
  className="..."
>
  {isSearching ? `Select Matching (${filteredFiles.length})` : 'Select All'}
</button>
<button
  type="button"
  onClick={isSearching ? deselectMatching : deselectAll}
  disabled={isSearching && filteredFiles.length === 0}
  className="..."
>
  {isSearching ? `Deselect Matching (${filteredFiles.length})` : 'Deselect All'}
</button>
```

**Step 4: Run tests to verify they pass**
Run: `npm run test`
Expected: PASS

**Step 5: Commit**
```bash
git add src/renderer/src/components/FolderUploadModal.tsx src/renderer/src/components/FolderUploadModal.test.tsx
git commit -m "feat(upload): add contextual search selection to FolderUploadModal"
```
