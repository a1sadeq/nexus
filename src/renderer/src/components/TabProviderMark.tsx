import type { CSSProperties, ReactElement } from 'react'

/**
 * The mark shown on a tab.
 *
 * It used to be the provider's brand SVG (`BrandIcon`) — whatever icon that provider had
 * configured in Settings. Three problems with that: the icons come from a user-editable field
 * so they are inconsistent in weight and colour, several are wordmarks that are illegible at
 * 11 px, and a tab row of them reads as a logo wall rather than a list of your conversations.
 *
 * So the mark is neutral: a ring and a core in the provider colour. The provider is still
 * identifiable at a glance — by colour, which is what the eye actually uses at this size — and
 * the provider name is still in the tooltip and the tab's own text. Nothing is lost that was
 * readable to begin with.
 *
 * `shape` exists for the one place that wants a square-ish mark rather than a dot.
 */
export interface TabProviderMarkProps {
  color: string
  size?: number
  /** `dot` is the default round mark; `ring` is a thinner outline for dense rows. */
  shape?: 'dot' | 'ring'
  /** Brighter core and a stronger glow, used for the selected tab. */
  active?: boolean
  className?: string
}

export default function TabProviderMark({
  color,
  size = 16,
  shape = 'dot',
  active = false,
  className
}: TabProviderMarkProps): ReactElement {
  const core = shape === 'ring' ? size * 0.34 : size * 0.44
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: '9999px',
    color,
    flexShrink: 0,
    // Colour is the identifier, so the glow has to be visible but must not bloom over the text.
    boxShadow: active ? `0 0 7px ${color}` : `0 0 4px ${color}`,
    opacity: active ? 1 : 0.92
  }

  return (
    <span
      className={className}
      style={style}
      data-tab-provider-mark={shape}
      aria-hidden="true"
      title={undefined}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        focusable="false"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r={7}
          stroke="currentColor"
          strokeWidth={shape === 'ring' ? 1 : 1.4}
          strokeOpacity={active ? 0.95 : 0.7}
        />
        <circle cx="8" cy="8" r={core / 2} fill="currentColor" />
      </svg>
    </span>
  )
}
