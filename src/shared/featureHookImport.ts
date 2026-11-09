import type { ProviderFeatureConfig } from './providerConfig'

export const FEATURE_HOOK_KEYS = [
  'attachmentSelector', 'promptNavSelector', 'composerSelector', 'sendButtonSelector',
  'chatTitleSelector', 'newChatSelector', 'stopGenerationSelector', 'virtualizationSelector',
  'assistantMessageSelector', 'streamingSelector', 'errorSelector', 'completionActionSelector'
] as const
export type FeatureHookKey = typeof FEATURE_HOOK_KEYS[number]
export type HookSelectors = Partial<Record<FeatureHookKey, string>>

/** AI selector import is deliberately not an executable/general settings import. */
export function parseFeatureHookImport(input: string): { selectors: HookSelectors; ignored: string[] } {
  if (input.length > 32000) throw new Error('Selector JSON exceeds the 32k-character limit')
  const raw = input.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1] ?? input.trim()
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object of selector strings')
  const selectors: HookSelectors = {}, ignored: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (!(FEATURE_HOOK_KEYS as readonly string[]).includes(key)) throw new Error(`Unsupported AI import field: ${key}. Only the supported selector keys are allowed.`)
    if (typeof value !== 'string') throw new Error(`${key} must be a string, not ${value === null ? 'null' : typeof value}`)
    const trimmed = value.trim()
    if (!trimmed) { ignored.push(key); continue }
    if (trimmed.length > 2000) throw new Error(`${key} exceeds the 2000-character selector limit`)
    if (/\[(?:DYNAMIC_ID|VALUE_REDACTED|LABEL_REDACTED|REDACTED_URL|EMAIL|SECRET)\]/.test(trimmed)) throw new Error(`${key} contains an evidence redaction placeholder, not a real selector`)
    selectors[key as FeatureHookKey] = trimmed
  }
  if (!Object.keys(selectors).length) throw new Error('No nonempty selectors to validate. Empty fields keep existing settings unchanged.')
  return { selectors, ignored }
}

export interface HookMatchMeasurement { count?: number; error?: string }
export function selectMeasuredHookUpdates(selectors: HookSelectors, measurements: Partial<Record<FeatureHookKey, HookMatchMeasurement>>) {
  const updates: Partial<ProviderFeatureConfig> = {}, skipped: string[] = []
  for (const [key, selector] of Object.entries(selectors)) {
    const measurement = measurements[key as FeatureHookKey]
    if (!measurement || measurement.error || typeof measurement.count !== 'number' || !Number.isFinite(measurement.count) || measurement.count < 0) {
      throw new Error(`${key}: ${measurement?.error || 'missing live validation'}. Nothing was applied.`)
    }
    if (measurement.count === 0) { skipped.push(key); continue }
    updates[key as FeatureHookKey] = selector
  }
  return { updates, skipped }
}
