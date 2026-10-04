# Folder Upload Enhancements: Directory Grouping, Contextual Search & Bundle Preview/Download Design

**Date:** 2026-10-05  
**Status:** Approved  
**Author:** Antigravity AI & Amr Elsadek  
**Target Component:** `FolderUploadModal` & `uploadManager`  
**Design System:** UI/UX Pro Max Cyberpunk HUD / Obsidian Glassmorphism  

---

## 1. Executive Summary

This design elevates the `Ctrl+Shift+O` Folder Upload experience from a simple flat-list selector to a high-precision, user-controlled **Codebase Ingestion Station**. It addresses three key user needs:
1. **Folder-Level Selection/Deselection**: Hierarchical directory grouping with collapsible folder headers and tri-state checkboxes.
2. **Contextual Search Batching**: Adaptive "Select Matching (N)" and "Deselect Matching (N)" toolbar actions that operate exclusively on filtered search results.
3. **Full Inspection & Local Export**: Ability to preview the generated bundle text in a cybernetic terminal viewer and download/save it directly to disk via native OS dialogs before injection.

---

## 2. UI/UX Pro Max Aesthetic Architecture

- **Visual Theme**: Obsidian Graphite (`#0A0D14`), Neon Cyan (`#00F0FF`), and Alert Amber (`#FFB300`) accents on dark glass.
- **Micro-Interactions**:
  - Tri-state checkbox glyphs: Checked (`✓`), Indeterminate (`—`), Unchecked (` `).
  - Collapsible folder chevron animation (`transform duration-150`).
  - Copy to clipboard pulse animation with temporary emerald state (`#10B981`).
  - Contextual button label transitions with live counters.
- **Accessibility & Touch Targets**: Minimum 36px interactive touch areas, high-contrast text (>4.5:1 ratio), and keyboard focus rings (`focus:ring-2 focus:ring-indigo-500/50`).

---

## 3. Dedicated Task Plans

The implementation is partitioned into three focused plan files:
1. `docs/plans/2026-10-05-folder-upload-search-selection-plan.md`
2. `docs/plans/2026-10-05-folder-upload-directory-grouping-plan.md`
3. `docs/plans/2026-10-05-folder-upload-preview-download-plan.md`
