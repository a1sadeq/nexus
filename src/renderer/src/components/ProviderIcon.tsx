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
 *   3. otherwise the neutral mark.
 *
 * Step 1 is the point. The configured markup was being ignored in exactly the three places tabs
 * are drawn, so a custom icon appeared in the settings list, the model pills and the URL bar —
 * everywhere except the tab.
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
  /** Selected tab: brighter, with a slightly stronger glow on the neutral fallback. */
  active?: boolean
  className?: string
}

export default function ProviderIcon({
  modelKey,
  customSvg,
  color,
  size = 16,
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

  return <TabProviderMark color={color} size={size} active={active} />
}
