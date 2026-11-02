# Task 2: AI Context Header & Smart Non-Destructive File Compressor

**File:** `docs/plans/2026-10-30-ai-context-header-and-smart-compressor-plan.md`  
**Related Components:** `src/main/aiContextGenerator.ts`, `src/main/smartCompressor.ts`, `src/main/uploadManager.ts`

---

## 1. Objective

Enhance bundled and ingested files for AI learning by:
1. Generating a standardized, dense **AI Context Header** at the very top of each bundle or converted file that gives the AI model precise ingestion instructions, a structured file map, and a reading/citation protocol.
2. Implementing a **Smart Non-Destructive Compressor** for normal source code and text files that eliminates token waste (redundant license headers, excessive blank lines, trailing whitespace, repetitive comment bloat) without altering any executable logic, types, or syntax.

---

## 2. Evidence-Based Requirements & Design

Based on recent context engineering research (`context-genome`, `arian`):
- A dense, structured context preface enables the AI to navigate cross-file references 55% faster and prevents context hallucinations.
- Models waste significant attention weights and tokens scanning repetitive boilerplate (e.g. 50-line standard MIT/Apache licenses repeated across 30 files in a folder).
- Non-destructive compression collapses whitespace and strips redundant headers while preserving all functional code, API signatures, comments explaining non-trivial logic, and structural indents.

---

## 3. AI Context Header Specification

The generated AI context header will be injected at the very top of the bundle:

```markdown
<!-- ========================================================================= -->
<!-- NEXUS AI INGESTION CONTEXT: [PROJECT_OR_FOLDER_NAME]                      -->
<!-- Generated: [ISO_TIMESTAMP] | Total Files: [N] | Content Size: [SIZE_KB]   -->
<!-- ========================================================================= -->

## 🤖 AI Ingestion & Reading Protocol

1. **Repository Overview**: You are analyzing a curated codebase/document bundle prepared by Nexus.
2. **File Boundary Markers**: Each file is encapsulated in standard Markdown delimiters:
   `### 📄 File: [relative_path] (Format: [ext], Lines: [L])`
3. **Cross-Referencing**: When tracing imports, functions, or concepts, refer to the File Map below.
4. **Citation Protocol**: In your responses, cite exact file paths and line ranges (e.g., `[src/auth/login.ts:42-58]`) when referencing implementation details.
5. **Noise Suppression**: Boilerplate license headers and repetitive whitespace have been normalized for maximum token clarity.

## 🗺️ File Map & Index

| # | Relative Path | Type | Lines | Size | Purpose / Summary |
|---|---|---|---|---|---|
| 1 | `src/index.ts` | TypeScript | 142 | 4.8 KB | Main application entry point |
| 2 | `docs/architecture.pdf` | Converted PDF | 88 | 3.2 KB | Architectural specification (converted to Markdown) |
| ... | ... | ... | ... | ... | ... |

---
```

---

## 4. Smart Non-Destructive Compressor Specification

### `src/main/smartCompressor.ts`

```typescript
export interface SmartCompressOptions {
  stripLicenseHeaders?: boolean
  collapseBlankLines?: boolean
  trimTrailingWhitespace?: boolean
  pruneCommentNoise?: boolean
}

export interface CompressResult {
  content: string
  originalBytes: number
  compressedBytes: number
  savedBytes: number
  savedPercent: number
  linesRemoved: number
}

export function smartCompressContent(
  rawContent: string,
  filePath: string,
  options?: SmartCompressOptions
): CompressResult
```

### Compression Rules:
1. **License Header Stripping**:
   - Detect standard boilerplate (Apache 2.0, MIT, GPL, Mozilla, BSD, Creative Commons, etc.) at the beginning of files (`/* ... */`, `// ...`, `# ...`).
   - Replace with a one-line token tag: `// [License: MIT / Apache-2.0 Boilerplate Removed]`.
2. **Blank Line Normalization**:
   - Collapse 3 or more consecutive newlines into 2 (`\n\n`), preventing artificial context window stretching.
3. **Trailing Whitespace Trimming**:
   - Strip spaces and tabs at the end of lines (`[ \t]+$`).
4. **Semantic Preservation**:
   - Never remove docstrings (`/** ... */` containing `@param`, `@returns`).
   - Never remove inline comments detailing complex algorithms or safety constraints.
   - Never mutate strings, regex literals, or template strings.

---

## 5. Verification & Testing Criteria

- Verify that JavaScript, TypeScript, Python, Rust, HTML, CSS, Markdown, and JSON files parse cleanly and remain syntactically identical after smart compression.
- Verify byte savings of 15%–40% on typical open-source repositories with verbose license headers and loose formatting.
- Verify that AI models accurately acknowledge and follow the Ingestion & Citation Protocol.
