/**
 * One answer to "what does this provider look like?".
 *
 * Settings → AI Providers lets each provider carry its own colour and its own SVG markup. That
 * configuration was being read in some places and re-derived in others: the title bar pillar painted
 * `m.icon` raw, the tabs resolved the sanitised icon, the tab-colour button and the title bar fell back
 * to the *brand* colour even when a custom one was configured, and the tabs' own fallback used a
 * different map again. The result was two brands for one provider, depending on which surface you
 * looked at.
 *
 * Everything that draws a provider now asks this module, so the answer is the same everywhere:
 *
 *   colour: the provider's configured colour, else its brand colour.
 *   icon:   the provider's configured SVG (sanitised), else the built-in brand path, else the neutral
 *           mark — that last step lives in `ProviderIcon`, which every surface renders.
 */

import { modelColor, modelLabel } from './modelVisuals'
import { sanitizeSvgMarkup } from './providerIcon'

/** The shape of an entry in the provider list (Settings → AI Providers / `models`). */
export interface ProviderLike {
  key: string
  label?: string
  /** Configured "Custom SVG Icon Markup". */
  icon?: string
  /** Configured provider colour. */
  color?: string
}

export interface ProviderVisual {
  key: string
  label: string
  /** Configured colour, else the brand colour. Always a CSS colour string. */
  color: string
  /** Sanitised configured markup, when there is any. */
  icon?: string
  /** True when the colour came from the provider's own configuration. */
  customColor: boolean
}

function find(models: readonly ProviderLike[] | undefined | null, key: string): ProviderLike | undefined {
  if (!models || !key) return undefined
  const wanted = key.toLowerCase().trim()
  return models.find((m) => (m?.key || '').toLowerCase().trim() === wanted)
}

/** The provider's configured colour, else its brand colour. */
export function providerColorFor(
  key: string,
  models?: readonly ProviderLike[] | null
): string {
  const configured = find(models, key)?.color?.trim()
  if (configured) return configured
  return modelColor(key)
}

/** The provider's configured SVG markup, sanitised. Undefined when it has none. */
export function providerIconFor(
  key: string,
  models?: readonly ProviderLike[] | null
): string | undefined {
  return sanitizeSvgMarkup(find(models, key)?.icon)
}

/** The provider's configured label, else the built-in name for the key. */
export function providerLabelFor(
  key: string,
  models?: readonly ProviderLike[] | null
): string {
  const configured = find(models, key)?.label?.trim()
  if (configured) return configured
  return modelLabel(key)
}

/** Colour + icon + label in one call, for surfaces that draw all three. */
export function providerVisual(
  key: string,
  models?: readonly ProviderLike[] | null
): ProviderVisual {
  const provider = find(models, key)
  const configuredColor = provider?.color?.trim()
  return {
    key,
    label: providerLabelFor(key, models),
    color: configuredColor || modelColor(key),
    icon: sanitizeSvgMarkup(provider?.icon),
    customColor: Boolean(configuredColor)
  }
}

/** Keyed colour map for the components that take one (`modelColors`). */
export function providerColorMap(models?: readonly ProviderLike[] | null): Record<string, string> {
  const map: Record<string, string> = {}
  for (const model of models ?? []) {
    if (!model?.key) continue
    map[model.key] = model.color?.trim() || modelColor(model.key)
  }
  return map
}
