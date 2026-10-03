# Main Process Modularization Plan

## Objective
Streamline and modularize `src/main/index.ts` (currently 3,400+ lines) by extracting folder traversal, chunked bundling, and CDP drag-and-drop injection into a dedicated, clean handler module.

## Current Situation
`src/main/index.ts` contains large inline implementations of:
- `trigger_active_upload_folder`: Recursive folder crawler, binary null-byte detector, 8MB chunked bundler, and CDP DevTools protocol drag & drop injection.
- `trigger_active_upload`: Whitelist-based `.txt` masquerading and CDP DOM/drag injection.
These inline implementations clutter `index.ts`, use local `require(...)` calls, and make maintenance harder.

## Proposed Implementation
1. **Create `src/main/uploadManager.ts`**:
   - Encapsulate `handleFolderUpload(view: WebContentsView, mainWindow: BrowserWindow)` and `handleFileUpload(view: WebContentsView, mainWindow: BrowserWindow)`.
   - Use clean, top-level typed imports (`fs`, `path`, `os`).
   - Export structured methods with robust error handling and debugger detach guarantees.
2. **Refactor `src/main/index.ts`**:
   - Replace the ~200 lines of inline crawl/bundle logic with clean delegate calls to `uploadManager`.
