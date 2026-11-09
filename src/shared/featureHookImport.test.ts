import { describe, it, expect } from 'vitest'
import { parseFeatureHookImport, selectMeasuredHookUpdates } from './featureHookImport'

describe('strict AI hook imports', () => {
  it('accepts fenced selector JSON and preserves empty fields', () => {
    const result = parseFeatureHookImport('```json\n{"composerSelector":" textarea ","stopGenerationSelector":"","errorSelector":".error-banner","completionActionSelector":"button.copy"}\n```')
    expect(result.selectors).toEqual({
      composerSelector: 'textarea',
      errorSelector: '.error-banner',
      completionActionSelector: 'button.copy'
    })
    expect(result.ignored).toEqual(['stopGenerationSelector'])
  })
  it.each([true, 3, null, [], {}])('rejects nonstring selector value %j', value => {
    expect(() => parseFeatureHookImport(JSON.stringify({ composerSelector: value }))).toThrow('must be a string')
  })
  it.each(['customInitScript', 'enableSlashFocus', '__proto__', 'unknown'])('rejects unexpected field %s', key => {
    expect(() => parseFeatureHookImport(`{"composerSelector":"textarea","${key}":"alert(1)"}`)).toThrow('Unsupported AI import field')
  })
  it('rejects oversized imports, selectors, placeholders, and empty-only objects', () => {
    expect(() => parseFeatureHookImport(' '.repeat(32001))).toThrow('32k')
    expect(() => parseFeatureHookImport(JSON.stringify({ composerSelector: 'a'.repeat(2001) }))).toThrow('2000')
    expect(() => parseFeatureHookImport('{"composerSelector":"#[DYNAMIC_ID]"}')).toThrow('placeholder')
    expect(() => parseFeatureHookImport('{"composerSelector":""}')).toThrow('No nonempty')
  })
  it('applies only live matches and leaves state-dependent zeros unchanged', () => {
    const result = selectMeasuredHookUpdates({ composerSelector: 'textarea', stopGenerationSelector: '.stop' }, { composerSelector: { count: 1 }, stopGenerationSelector: { count: 0 } })
    expect(result.updates).toEqual({ composerSelector: 'textarea' })
    expect(result.skipped).toEqual(['stopGenerationSelector'])
  })
  it.each([undefined, { error: 'invalid-selector' }, { count: NaN }, { count: -1 }])('fails atomically on invalid measurements %j', measurement => {
    expect(() => selectMeasuredHookUpdates({ composerSelector: '[' }, { composerSelector: measurement })).toThrow('Nothing was applied')
  })
})
