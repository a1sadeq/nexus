import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { scanFolder } from './uploadManager'

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
})
