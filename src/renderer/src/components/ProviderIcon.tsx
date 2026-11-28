import type { ReactElement } from 'react'
import './ProviderIcon.css'
import { BrandIcon } from './BrandIcons'
import TabProviderMark from './TabProviderMark'
import { resolveProviderIconSource } from '../lib/providerIcon'
import { BRAND_IDS } from '../lib/modelVisuals'

/**
 * The icon on a tab, in the order you would expect:
 *
 *   1. the SVG you configured for that provider in Settings → AI Providers;
 *   2. otherwise the built-in brand path for the key;
 *   3. otherwise the provider's own initial, drawn in the provider's colour;
 *   4. otherwise the neutral mark.
 *
 * Step 1 is the point. The configured markup was being ignored in exactly the three places tabs
 * are drawn, so a custom icon appeared in the settings list, the model pills and the URL bar —
 * everywhere except the tab.
 *
 * Step 3 is what the tab row needed for providers added by hand. Steps 1 and 2 need something
 * configured or a known brand, so a custom provider fell through to the neutral ring — the same ring
 * for every one of them, which is why a freshly added provider looked like "the sparkle icon".
 * The initial is different for each provider, carries the provider's colour, and needs no artwork.
 *
 * The markup is sanitised in `lib/providerIcon` before it reaches `dangerouslySetInnerHTML`.
 */
export interface ProviderIconProps {
  /** Provider key, e.g. `gemini`. */
  modelKey: string
  /** Raw "Custom SVG Icon Markup" from the provider configuration. */
  customSvg?: string
  color: string
  size?: number
  /**
   * The provider's name, used for the letter shown when there is no configured or brand icon — so a
   * hand-added provider is identifiable rather than generic.
   */
  fallbackLabel?: string
  /** Selected tab: brighter, with a slightly stronger glow on the neutral fallback. */
  active?: boolean
  className?: string
}

export default function ProviderIcon({
  modelKey,
  customSvg,
  color,
  size = 16,
  fallbackLabel,
  active = false,
  className
}: ProviderIconProps): ReactElement {
  const source = resolveProviderIconSource(modelKey, customSvg, Object.keys(BRAND_IDS))

  if (source.custom) {
    return (
      <span
        className={`provider-tab-icon ${className ?? ''}`.trim()}
        style={{ width: size, height: size, color }}
        // Sanitised above: elements that can execute or load are already gone.
        dangerouslySetInnerHTML={{ __html: source.custom }}
        aria-hidden="true"
        data-provider-icon="custom"
      />
    )
  }

  if (source.hasBrand) {
    return (
      <span
        className={`provider-tab-icon ${className ?? ''}`.trim()}
        style={{ width: size, height: size, color }}
        aria-hidden="true"
        data-provider-icon="brand"
      >
        <BrandIcon id={modelKey} size={size} />
      </span>
    )
  }

  const initial = (fallbackLabel || '').trim().charAt(0).toUpperCase()
  if (initial) {
    return (
      <span
        className={`provider-tab-icon provider-tab-initial ${className ?? ''}`.trim()}
        style={{
          width: size,
          height: size,
          color,
          // Sized relative to the box so the letter scales with the slot it is given.
          fontSize: Math.round(size * 0.68),
          lineHeight: `${size}px`,
          borderColor: color
        }}
        aria-hidden="true"
        data-provider-icon="initial"
      >
        {initial}
      </span>
    )
  }

  return <TabProviderMark color={color} size={size} active={active} />
}
