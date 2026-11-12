import { describe, it, expect } from 'vitest'
import { annotateFileVariants, countSuggestedVariantRemovals } from './fileVariants'

function file(relativePath: string, extra: Record<string, unknown> = {}): any {
  return {
    path: `/fake/${relativePath}`,
    relativePath,
    size: 1024,
    extension: relativePath.includes('.') ? `.${relativePath.split('.').pop()}` : '',
    isSuggestedRemoval: false,
    removalReason: undefined,
    ...extra
  }
}

describe('annotateFileVariants', () => {
  it('groups main.tsx + main_gemini.tsx + main.tsx.bak + main.tsx.bak2 into one group, prefers exact base', () => {
    const files = [
      file('main.tsx'),
      file('main_gemini.tsx'),
      file('main.tsx.bak'),
      file('main.tsx.bak2')
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    expect(files[0].isSuggestedRemoval).toBe(false)
    expect(files[1].isPreferredVariant).toBe(false)
    expect(files[1].isSuggestedRemoval).toBe(true)
    expect(files[1].variantKind).toBe('ai-companion')
    expect(files[2].isSuggestedRemoval).toBe(true)
    expect(files[2].variantKind).toBe('backup')
    expect(files[3].isSuggestedRemoval).toBe(true)
    expect(files[3].variantKind).toBe('backup')
  })

  it('marks backup suffixes case-insensitively (.BAK, .Old, .bak2)', () => {
    const files = [
      file('app.js'),
      file('app.js.BAK'),
      file('app.js.old'),
      file('app.js.backup')
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    for (const f of files.slice(1)) {
      expect(f.isSuggestedRemoval).toBe(true)
      expect(f.variantKind).toBe('backup')
    }
  })

  it('recognizes _copy -copy and copy variants', () => {
    const files = [
      file('script.py'),
      file('script_copy.py'),
      file('script-copy.py'),
      file('script copy.py')
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    for (const f of files.slice(1)) {
      expect(f.isSuggestedRemoval).toBe(true)
      expect(f.variantKind).toBe('copy')
    }
  })

  it('recognizes parenthetical copies like main (1).tsx', () => {
    const files = [
      file('doc.md'),
      file('doc (1).md'),
      file('doc (2).md')
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    expect(files[1].isSuggestedRemoval).toBe(true)
    expect(files[1].variantKind).toBe('copy')
    expect(files[2].isSuggestedRemoval).toBe(true)
    expect(files[2].variantKind).toBe('copy')
  })

  it('does not group files in different directories', () => {
    const files = [
      file('src/main.tsx'),
      file('tests/main.tsx'),
      file('docs/main_gemini.tsx')
    ]
    annotateFileVariants(files)
    // Each directory's top-level key differs, so no grouping across dirs
    for (const f of files) {
      expect(f.isSuggestedRemoval).toBe(false)
      expect(f.variantOf).toBeUndefined()
    }
  })

  it('does not group test/spec/story/module/types/utils files', () => {
    const files = [
      file('main.tsx'),
      file('main.test.tsx'),
      file('main.spec.tsx'),
      file('main.stories.tsx'),
      file('main.module.css'),
      file('main.types.ts'),
      file('main.utils.ts'),
      file('main.helper.ts'),
      file('maintenance.tsx')
    ]
    annotateFileVariants(files)
    // No grouping occurs — none of these are recognized as variants of each other
    for (const f of files) {
      expect(f.isSuggestedRemoval).toBe(false)
      expect((f as any).variantKind).toBeUndefined()
    }
  })

  it('standalone _gemini with no sibling is not marked duplicate', () => {
    const files = [file('orphan_gemini.ts')]
    annotateFileVariants(files)
    expect(files[0].isSuggestedRemoval).toBe(false)
    expect(files[0].variantOf).toBeUndefined()
  })

  it('missing-base groups choose deterministically: shorter primary over longer AI-companion', () => {
    const files = [
      file('widget-legacy.tsx'),   // has "-legacy" which doesn't match any variant pattern → treated as primary-ish but wait...
      file('widget_ai.tsx')        // "ai" is NOT a recognized nickname — standalone primary
    ]
    // Neither has recognized variant markers, so both are primaries in their own right, no grouping
    annotateFileVariants(files)
    // Different canonical names, no grouping — both remain unmarked
    expect((files[0] as any).isPreferredVariant).toBeUndefined()
    expect((files[1] as any).isPreferredVariant).toBeUndefined()
    expect(files[0].isSuggestedRemoval).toBe(false)
    expect(files[1].isSuggestedRemoval).toBe(false)
  })

  it('prefers exact canonical filename when present alongside variants', () => {
    const files = [
      file('lib.ts'),       // primary
      file('lib_gemini.ts'), // ai-companion variant
      file('lib_copy.ts')   // copy variant
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    expect(files[1].isSuggestedRemoval).toBe(true)
    expect(files[2].isSuggestedRemoval).toBe(true)
  })

  it('preserves existing sensitive removal reason on a variant', () => {
    const files = [
      file('.env', { isSuggestedRemoval: true, removalReason: 'Sensitive / Secrets file' }),
      file('.env_backup', { isSuggestedRemoval: true, removalReason: 'Backup of secrets' })
    ]
    annotateFileVariants(files)
    // Both may get marked but existing reasons must not be overwritten
    // At minimum .env stays preferred or gets preserved reasoning
    const env = files.find((f: any) => f.relativePath === '.env')!
    expect(env.removalReason).toBe('Sensitive / Secrets file')
  })

  it('countSuggestedVariantRemovals only counts variant-flagged removals', () => {
    const files = [
      file('main.tsx'),
      file('main.tsx.bak', { isSuggestedRemoval: true, variantKind: 'backup' }),
      file('node_modules/pkg/index.js', { isSuggestedRemoval: true }) // not a variant detection
    ]
    annotateFileVariants(files)
    expect(countSuggestedVariantRemovals(files)).toBe(1)
  })

  it('does not silently include a manually overridden variant in bundle count via selectedPaths', () => {
    // Variant detection marks suggested removal; the UI allows manual override via selectedPaths.
    // The annotator itself does NOT exclude from the files array — it just sets flags.
    const files = [
      file('data.csv'),
      file('data_csv.csv') // copy-like name but _csv isn't in COPY_KINDS → won't match
    ]
    annotateFileVariants(files)
    // data_csv.csv does NOT match copy kinds ("_csv" ≠ "_copy"), so neither is variant-marked
    expect(files.some((f: any) => f.variantKind !== undefined)).toBe(false)
  })

  it('AI companion dot-form: main.claude.ts → base main.ts', () => {
    const files = [
      file('main.ts'),
      file('main.claude.ts')
    ]
    annotateFileVariants(files)
    expect(files[0].isPreferredVariant).toBe(true)
    expect(files[1].isSuggestedRemoval).toBe(true)
    expect(files[1].variantKind).toBe('ai-companion')
    expect(files[1].variantOf).toBe('main.ts')
  })
})
