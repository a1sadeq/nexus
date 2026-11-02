# Task 1: Self-Contained Semantic PDF-to-Markdown Extraction Engine

**File:** `docs/plans/2026-10-30-pdf-to-markdown-extraction-engine-plan.md`  
**Related Components:** `src/main/pdfExtractor.ts`, `src/main/uploadManager.ts`, `src/shared/folderUpload.ts`

---

## 1. Objective

Provide a zero-dependency, fully self-contained PDF extraction engine that converts binary `.pdf` documents into clean, semantic Markdown text (`.md`). The engine runs entirely offline within Electron's Node runtime on all operating systems (Linux, Windows, macOS) without requiring external CLI tools or C++ native addons (`node-gyp`).

---

## 2. Evidence-Based Requirements & Design

Based on AI benchmark research:
1. **Markdown is the Optimal AI Container**: LLMs understand heading hierarchies (`#`, `##`), markdown tables (`| Col1 | Col2 |`), lists (`-`, `1.`), and code blocks with near 2x token efficiency and higher semantic accuracy than raw binary formats or CSV/JSON for prose.
2. **Eliminate Rendering Artifacts**:
   - Strip running page headers and footers that repeat across pages.
   - Strip page numbers (e.g. `Page 1 of 18`, `- 12 -`).
   - Strip repeated watermark stamps.
   - Preserve natural reading order and reconstruct broken hyphenated words across line wraps (`imple-` + `mentation` -> `implementation`).
3. **Table & Structure Reconstruction**:
   - Identify tabular columns from horizontal and vertical text coordinate clusters.
   - Format detected tables into GitHub-flavored Markdown tables.
4. **Scanned & Image-Heavy Handling**:
   - Calculate text density per page (characters per unit area).
   - If a PDF or page has zero or near-zero extractable text (scanned image document), insert an explicit Markdown notice:
     ```markdown
     > [!WARNING]
     > **Image-Only / Scanned Content**: Page 3 of this document contains an embedded raster image without an OCR text layer. Visual elements could not be converted to plain text.
     ```
5. **Raw Passthrough Mode**:
   - Provide an explicit option to bypass extraction and upload the original binary `.pdf` file as-is when desired.

---

## 3. Architecture & API Specification

### Pure JS Parser Implementation: `src/main/pdfExtractor.ts`

```typescript
export interface PdfConversionOptions {
  preserveTables?: boolean
  stripHeadersFooters?: boolean
  includePageMarkers?: boolean
  rawPassthrough?: boolean
}

export interface PdfConversionResult {
  markdown: string
  pageCount: number
  originalBytes: number
  markdownBytes: number
  compressionRatioPercent: number
  isScannedOrImageHeavy: boolean
  scannedPageNumbers: number[]
  metadata: {
    title?: string
    author?: string
    subject?: string
    creationDate?: string
  }
}

export async function convertPdfToMarkdown(
  filePathOrBuffer: string | Buffer,
  options?: PdfConversionOptions
): Promise<PdfConversionResult>
```

### Extraction Pipeline:
1. **Header & Font Sizing**:
   - Map text items with their font size (`transform[0]` or `height`) and position coordinates (`x, y`).
   - Relative font size > 1.4x body text -> `# Heading 1`
   - Relative font size > 1.2x body text -> `## Heading 2`
   - Relative font size > 1.1x body text -> `### Heading 3`
2. **Header/Footer Suppression**:
   - Group text occurrences near the top 8% and bottom 8% of page bounding boxes.
   - If identical or matching pattern repeats across >= 2 pages, prune from output.
3. **Table Recognition**:
   - Detect rows sharing similar `y` coordinates with multiple `x` offsets.
   - Format into clean markdown table syntax.

---

## 4. Verification & Testing Criteria

- Test with text-rich PDFs (academic papers, documentation).
- Test with tabular data PDFs (financial reports, specifications).
- Test with image-only/scanned PDFs to verify fallback notices.
- Verify byte size reduction (typically 60%–90% reduction in byte/token size compared to PDF binaries).
- Ensure 0 native addon requirements across Linux, Windows, macOS builds.
