import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  scanFolder,
  generateBundleText,
  createMasqueradedTextFile,
  compressCodeContent,
  partitionCodebaseFiles
} from './uploadManager'

describe('scanFolder', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-scan-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('scans text files and detects extensions', () => {
    fs.writeFileSync(path.join(tempDir, 'index.ts'), 'console.log("hello")', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'styles.css'), 'body { color: red; }', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Doc', 'utf8')

    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(3)
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      'README.md',
      'index.ts',
      'styles.css'
    ])
    expect(result.files.every((f) => !f.isSuggestedRemoval)).toBe(true)
  })

  it('flags lockfiles, .env files, and minified bundles for suggested removal', () => {
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'export const x = 1;', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion": 3}', 'utf8')
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_KEY=12345', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'bundle.min.js'), 'function a(){}', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'app.js.map'), '{"version": 3}', 'utf8')

    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(5)

    const lockfile = result.files.find((f) => f.relativePath === 'package-lock.json')
    expect(lockfile?.isSuggestedRemoval).toBe(true)
    expect(lockfile?.removalReason).toContain('Lockfile')

    const envFile = result.files.find((f) => f.relativePath === '.env')
    expect(envFile?.isSuggestedRemoval).toBe(true)
    expect(envFile?.removalReason).toContain('Secrets')

    const minFile = result.files.find((f) => f.relativePath === 'bundle.min.js')
    expect(minFile?.isSuggestedRemoval).toBe(true)
    expect(minFile?.removalReason).toContain('Minified')

    const mapFile = result.files.find((f) => f.relativePath === 'app.js.map')
    expect(mapFile?.isSuggestedRemoval).toBe(true)
    expect(mapFile?.removalReason).toContain('Source map')

    const regularFile = result.files.find((f) => f.relativePath === 'app.ts')
    expect(regularFile?.isSuggestedRemoval).toBe(false)
  })

  it('ignores ignored directories like node_modules and .git', () => {
    const nodeModules = path.join(tempDir, 'node_modules', 'dep')
    fs.mkdirSync(nodeModules, { recursive: true })
    fs.writeFileSync(path.join(nodeModules, 'dep.js'), 'module.exports = {}', 'utf8')

    fs.writeFileSync(path.join(tempDir, 'main.js'), 'require("dep")', 'utf8')

    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(1)
    expect(result.files[0].relativePath).toBe('main.js')
  })

  it('ignores heavy bloat directories including .venv, target, bin, and __pycache__', () => {
    const venvDir = path.join(tempDir, '.venv', 'lib')
    const targetDir = path.join(tempDir, 'target', 'debug')
    const pycacheDir = path.join(tempDir, '__pycache__')
    fs.mkdirSync(venvDir, { recursive: true })
    fs.mkdirSync(targetDir, { recursive: true })
    fs.mkdirSync(pycacheDir, { recursive: true })
    fs.writeFileSync(path.join(venvDir, 'site.py'), 'pass', 'utf8')
    fs.writeFileSync(path.join(targetDir, 'binary.rs'), 'fn main(){}', 'utf8')
    fs.writeFileSync(path.join(pycacheDir, 'module.cpython-310.pyc'), 'binary', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'actual.py'), 'print("valid")', 'utf8')

    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(1)
    expect(result.files[0].relativePath).toBe('actual.py')
  })

  it('generates bundle text with file separators and accurate statistics', () => {
    const f1 = path.join(tempDir, 'file1.txt')
    const f2 = path.join(tempDir, 'src', 'file2.js')
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(f1, 'Content of file 1', 'utf8')
    fs.writeFileSync(f2, 'console.log("hello")', 'utf8')

    const bundle = generateBundleText(tempDir, [f1, f2])
    expect(bundle.fileCount).toBe(2)
    expect(bundle.filesIncluded).toEqual(['file1.txt', 'src/file2.js'])
    expect(bundle.text).toContain('File: file1.txt')
    expect(bundle.text).toContain('Content of file 1')
    expect(bundle.text).toContain('File: src/file2.js')
    expect(bundle.text).toContain('console.log("hello")')
    expect(bundle.byteSize).toBeGreaterThan(0)
  })
})



describe('scanFolder - conservative classification', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-scan-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('does NOT mark large source files as suggested removal based on size alone', () => {
    // Create a large TypeScript file (>250KB) by repeating content
    const line = 'export const data = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";\n'
    const largeContent = line.repeat(5000)  // ~300KB
    fs.writeFileSync(path.join(tempDir, 'large.ts'), largeContent, 'utf8')
    
    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(1)
    
    const largeFile = result.files[0]
    expect(largeFile.size).toBeGreaterThan(250 * 1024)
    // Large files should NOT be marked for suggested removal
    expect(largeFile.isSuggestedRemoval).toBe(false)
    expect(largeFile.removalReason).toBeUndefined()
  })

  it('still flags .env files as sensitive regardless of size', () => {
    const envContent = 'SECRET_KEY=12345\nDATABASE_URL=postgres://...'
    fs.writeFileSync(path.join(tempDir, '.env'), envContent, 'utf8')
    
    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(1)
    
    const envFile = result.files[0]
    expect(envFile.isSuggestedRemoval).toBe(true)
    expect(envFile.removalReason).toContain('Sensitive')
  })

  it('classifies common lockfiles and minified assets correctly', () => {
    const packages_lock = path.join(tempDir, 'package-lock.json')
    const yarn_lock = path.join(tempDir, 'yarn.lock')
    const bundle_min = path.join(tempDir, 'app.min.js')
    const source_map = path.join(tempDir, 'app.js.map')
    const log_file = path.join(tempDir, 'debug.log')
    
    fs.writeFileSync(packages_lock, '{}', 'utf8')
    fs.writeFileSync(yarn_lock, '', 'utf8')
    fs.writeFileSync(bundle_min, 'function a(){}', 'utf8')
    fs.writeFileSync(source_map, '{"version":3}', 'utf8')
    fs.writeFileSync(log_file, 'log line 1\n', 'utf8')
    
    const result = scanFolder(tempDir)
    expect(result.totalFiles).toBe(5)
    
    const pf = result.files.find(f => f.relativePath === 'package-lock.json')
    expect(pf?.isSuggestedRemoval).toBe(true)
    expect(pf?.removalReason).toContain('Lockfile')
    
    const yf = result.files.find(f => f.relativePath === 'yarn.lock')
    expect(yf?.isSuggestedRemoval).toBe(true)
    
    const mf = result.files.find(f => f.relativePath === 'app.min.js')
    expect(mf?.isSuggestedRemoval).toBe(true)
    expect(mf?.removalReason).toContain('Minified')
    
    const sf = result.files.find(f => f.relativePath === 'app.js.map')
    expect(sf?.isSuggestedRemoval).toBe(true)
    expect(sf?.removalReason).toContain('Source map')
    
    const lf = result.files.find(f => f.relativePath === 'debug.log')
    expect(lf?.isSuggestedRemoval).toBe(true)
    expect(lf?.removalReason).toContain('Log file')
  })

})

describe('createMasqueradedTextFile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-masq-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('preserves existing .txt files without duplication', () => {
    const txtPath = path.join(tempDir, 'notes.txt')
    fs.writeFileSync(txtPath, 'Hello world', 'utf8')
    const result = createMasqueradedTextFile(txtPath)
    expect(result).toBe(txtPath)
  })

  it('creates a masqueraded .txt copy with structured source header for code files', () => {
    const tsPath = path.join(tempDir, 'App.tsx')
    fs.writeFileSync(tsPath, 'export const App = () => <div>Hello</div>', 'utf8')
    const result = createMasqueradedTextFile(tsPath)

    expect(result).not.toBe(tsPath)
    expect(result.endsWith('.txt')).toBe(true)
    expect(path.basename(result)).toBe('App.tsx.txt')

    const content = fs.readFileSync(result, 'utf8')
    expect(content).toContain('SOURCE FILE: App.tsx')
    expect(content).toContain('ORIGINAL FORMAT: .tsx')
    expect(content).toContain('export const App = () => <div>Hello</div>')

    // Clean up created temp file
    try {
      fs.unlinkSync(result)
    } catch {}
  })
})

describe('compressCodeContent', () => {
  it('strips redundant trailing whitespace and collapses excessive empty lines', () => {
    const input = 'const x = 1;   \n\n\n\nconst y = 2;\t\t\n\n\nconst z = 3;'
    const output = compressCodeContent(input)
    expect(output).toBe('const x = 1;\n\nconst y = 2;\n\nconst z = 3;')
  })
})

describe('partitionCodebaseFiles', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-part-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('partitions files into chunks strictly below maxChunkBytes with accurate metrics', () => {
    const f1 = path.join(tempDir, 'file1.ts')
    const f2 = path.join(tempDir, 'file2.ts')
    const f3 = path.join(tempDir, 'file3.ts')
    // Write ~600 bytes each
    fs.writeFileSync(f1, 'a'.repeat(600), 'utf8')
    fs.writeFileSync(f2, 'b'.repeat(600), 'utf8')
    fs.writeFileSync(f3, 'c'.repeat(600), 'utf8')

    // Set max chunk bytes to 1000 bytes
    const partition = partitionCodebaseFiles(tempDir, [f1, f2, f3], 1000, false)
    expect(partition.chunks.length).toBeGreaterThan(1)
    expect(partition.totalFiles).toBe(3)
    for (const chunk of partition.chunks) {
      expect(chunk.byteSize).toBeLessThanOrEqual(1000)
    }
  })

  it('slices a single file that exceeds maxChunkBytes into sub-parts', () => {
    const hugeFile = path.join(tempDir, 'huge.ts')
    // Write 2500 bytes of lines
    const line = 'x'.repeat(50) + '\n'
    fs.writeFileSync(hugeFile, line.repeat(50), 'utf8')

    const partition = partitionCodebaseFiles(tempDir, [hugeFile], 1000, false)
    expect(partition.chunks.length).toBeGreaterThanOrEqual(3)
    for (const chunk of partition.chunks) {
      expect(chunk.byteSize).toBeLessThanOrEqual(1000)
    }
    expect(partition.chunks[0].content).toContain('Part 1')
  })
})

