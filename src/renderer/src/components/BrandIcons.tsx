import type { ReactNode, SVGProps } from 'react'
import { useIconConfig, type IconPack } from '../lib/iconContext'

/**
 * BrandIcons — shared inline SVG icon set (no external deps, CSP-safe).
 * Brand marks are official SVG paths from simple-icons (MIT) and remain strictly authentic.
 * UI glyphs dynamically adapt to the active Icon Pack (5 packs) and Stroke Weight.
 */

/* ------------------------------------------------------------------ */
/* Brand marks (fill-based, strictly authentic & unchanged)           */
/* ------------------------------------------------------------------ */

const BRAND_PATHS: Record<string, string> = {
  gemini:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  chatgpt:
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  deepseek:
    'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
  qwen: 'M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z',
  kimi: 'M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441',
  claude: 'M13.8 2.4a8.2 8.2 0 0 1 5.9 5.9 8.2 8.2 0 0 1-5.9 5.9V2.4zm-3.6 0v11.8a8.2 8.2 0 0 1-5.9-5.9 8.2 8.2 0 0 1 5.9-5.9zM12 21.6a9.6 9.6 0 1 0 0-19.2 9.6 9.6 0 0 0 0 19.2z',
  perplexity: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2l7 3.5v7.6l-7 3.5-7-3.5V7.7l7-3.5zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  grok: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  mistral: 'M4 4h4v4H4V4zm12 0h4v4h-4V4zm-6 6h4v4h-4v-4zm-6 6h4v4H4v-4zm12 0h4v4h-4v-4z',
  copilot: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V15a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 11H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 16.93z'
}

export function BrandIcon({
  id,
  size = 16,
  customSvg,
  ...props
}: { id: string; size?: number; customSvg?: string } & SVGProps<SVGSVGElement>) {
  if (customSvg) {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, ...(props.style as any) }}
        dangerouslySetInnerHTML={{ __html: customSvg }}
      />
    )
  }
  const d = BRAND_PATHS[id]
  if (!d) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d={d} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Dynamic Multi-Pack Universal UI Glyphs                             */
/* ------------------------------------------------------------------ */

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

type PackRenderers = Record<IconPack, (strokeWidth: number) => ReactNode>

function createUniversalIcon(renderers: PackRenderers, displayName: string) {
  function UniversalIcon({ size = 16, className = '', ...props }: IconProps) {
    const { iconPack = 'lucide-line', strokeWidth = 1.75, glowEffect } = useIconConfig()
    const renderer = renderers[iconPack] || renderers['lucide-line']

    const glowClass = glowEffect ? 'drop-shadow-[0_0_5px_currentColor]' : ''
    const combinedClass = `${className} ${glowClass}`.trim()

    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={combinedClass}
        {...props}
      >
        {renderer(strokeWidth)}
      </svg>
    )
  }
  UniversalIcon.displayName = displayName
  return UniversalIcon
}

/* 1. Search Icon */
export const IconSearch = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <line x1="10" y1="6" x2="10" y2="14" strokeWidth={sw} />
        <line x1="6" y1="10" x2="14" y2="10" strokeWidth={sw} />
        <path d="m17 17 4 4" strokeWidth={sw + 0.5} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="11" cy="11" r="8" fill="currentColor" fillOpacity={0.2} />
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M10 2a8 8 0 0 1 6.32 12.9l5.38 5.38a1 1 0 0 1-1.41 1.41l-5.38-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="4" y="4" width="12" height="12" />
        <line x1="16" y1="16" x2="21" y2="21" />
      </>
    )
  },
  'IconSearch'
)

/* 2. Settings Icon */
export const IconSettings = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <polygon points="12 2 19 6 19 18 12 22 5 18 5 6" strokeWidth={sw} />
        <circle cx="12" cy="12" r="3.5" strokeWidth={sw} />
        <line x1="12" y1="2" x2="12" y2="6" strokeWidth={sw} />
        <line x1="12" y1="18" x2="12" y2="22" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="8" fill="currentColor" fillOpacity={0.25} />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 1a3 3 0 0 0-3 3v.2A7.95 7.95 0 0 0 6.6 5.6l-.1-.1a3 3 0 0 0-4.24 4.24l.1.1A7.95 7.95 0 0 0 1.2 12.4H1a3 3 0 0 0 0 6h.2a7.95 7.95 0 0 0 1.2 2.6l-.1.1a3 3 0 0 0 4.24 4.24l.1-.1a7.95 7.95 0 0 0 2.6 1.2v.2a3 3 0 0 0 6 0v-.2a7.95 7.95 0 0 0 2.6-1.2l.1.1a3 3 0 0 0 4.24-4.24l-.1-.1a7.95 7.95 0 0 0 1.2-2.6h.2a3 3 0 0 0 0-6h-.2a7.95 7.95 0 0 0-1.2-2.6l.1-.1a3 3 0 0 0-4.24-4.24l-.1.1A7.95 7.95 0 0 0 15 4.2V4a3 3 0 0 0-3-3zm0 7a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="2" y="2" width="20" height="20" rx="1" />
        <circle cx="12" cy="12" r="4" />
      </>
    )
  },
  'IconSettings'
)

/* 3. History Icon */
export const IconHistory = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L2 9" strokeWidth={sw} />
        <polyline points="2 3 2 9 8 9" strokeWidth={sw} />
        <polyline points="12 7 12 12 16 12" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity={0.2} />
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <polyline points="12 7 12 12 15 14" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.59l3.7 2.22-.98 1.63L11 13V6h2v6.59z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <polyline points="12 7 12 12 16 12" />
      </>
    )
  },
  'IconHistory'
)

/* 4. Sliders Icon */
export const IconSliders = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <line x1="4" x2="4" y1="21" y2="14" />
        <line x1="4" x2="4" y1="10" y2="3" />
        <line x1="12" x2="12" y1="21" y2="12" />
        <line x1="12" x2="12" y1="8" y2="3" />
        <line x1="20" x2="20" y1="21" y2="16" />
        <line x1="20" x2="20" y1="12" y2="3" />
        <line x1="1" x2="7" y1="14" y2="14" />
        <line x1="9" x2="15" y1="8" y2="8" />
        <line x1="17" x2="23" y1="16" y2="16" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <line x1="5" y1="3" x2="5" y2="21" strokeWidth={sw} />
        <line x1="12" y1="3" x2="12" y2="21" strokeWidth={sw} />
        <line x1="19" y1="3" x2="19" y2="21" strokeWidth={sw} />
        <rect x="2" y="11" width="6" height="4" fill="currentColor" />
        <rect x="9" y="6" width="6" height="4" fill="currentColor" />
        <rect x="16" y="14" width="6" height="4" fill="currentColor" />
      </>
    ),
    'duotone-glow': () => (
      <>
        <line x1="4" x2="4" y1="3" y2="21" />
        <line x1="12" x2="12" y1="3" y2="21" />
        <line x1="20" x2="20" y1="3" y2="21" />
        <circle cx="4" cy="14" r="3" fill="currentColor" fillOpacity={0.3} />
        <circle cx="12" cy="8" r="3" fill="currentColor" fillOpacity={0.3} />
        <circle cx="20" cy="16" r="3" fill="currentColor" fillOpacity={0.3} />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M3 4h3v2H3V4zm0 6h18v2H3v-2zm0 6h9v2H3v-2zm0 6h14v2H3v-2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <line x1="4" y1="3" x2="4" y2="21" />
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="20" y1="3" x2="20" y2="21" />
        <rect x="2" y="13" width="4" height="4" />
        <rect x="10" y="7" width="4" height="4" />
        <rect x="18" y="15" width="4" height="4" />
      </>
    )
  },
  'IconSliders'
)

/* 5. Sparkles / AI Icon */
export const IconSparkles = createUniversalIcon(
  {
    'lucide-line': () => (
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    ),
    'cyber-hud': () => (
      <>
        <polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </>
    ),
    'duotone-glow': () => (
      <path
        fill="currentColor"
        fillOpacity={0.25}
        d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"
      />
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 1l2.8 7.2L22 11l-6.2 3.8L17.5 22 12 17.5 6.5 22l1.7-7.2L2 11l7.2-2.8z"
      />
    ),
    'retro-monoline': () => (
      <>
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <rect x="9" y="9" width="6" height="6" />
      </>
    )
  },
  'IconSparkles'
)

/* 6. Zap / Energy Icon */
export const IconZap = createUniversalIcon(
  {
    'lucide-line': () => <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    'cyber-hud': (sw) => (
      <>
        <polygon points="13 2 4 14 13 14 11 22 20 10 11 10 13 2" strokeWidth={sw} />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </>
    ),
    'duotone-glow': () => (
      <polygon
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
        fill="currentColor"
        fillOpacity={0.25}
      />
    ),
    'solid-silhouette': () => (
      <polygon
        fill="currentColor"
        stroke="none"
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
      />
    ),
    'retro-monoline': () => <polyline points="14 2 4 13 12 13 10 22 20 11 12 11 14 2" />
  },
  'IconZap'
)

/* 7. Layers Icon */
export const IconLayers = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
        <path d="m22 12.5-8.58 3.91a2 2 0 0 1-1.66 0L2.6 12.5" />
        <path d="m22 17.5-8.58 3.91a2 2 0 0 1-1.66 0L2.6 17.5" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <polygon points="12 2 22 7 12 12 2 7" strokeWidth={sw} />
        <polyline points="2 12 12 17 22 12" strokeWidth={sw} />
        <polyline points="2 17 12 22 22 17" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <polygon points="12 2 22 7 12 12 2 7" fill="currentColor" fillOpacity={0.25} />
        <polyline points="2 12 12 17 22 12" />
        <polyline points="2 17 12 22 22 17" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2L2 7l10 5 10-5-10-5zm0 8L2 15l10 5 10-5-10-5z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="5" />
        <rect x="3" y="10" width="18" height="5" />
        <rect x="3" y="17" width="18" height="5" />
      </>
    )
  },
  'IconLayers'
)

/* 8. Close / X Icon */
export const IconX = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={sw} />
        <line x1="8" y1="8" x2="16" y2="16" strokeWidth={sw} />
        <line x1="16" y1="8" x2="8" y2="16" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity={0.2} />
        <path d="M15 9 9 15M9 9l6 6" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.7 12.3l-1.4 1.4L12 13.4l-2.3 2.3-1.4-1.4 2.3-2.3-2.3-2.3 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3z"
      />
    ),
    'retro-monoline': () => (
      <>
        <line x1="5" y1="5" x2="19" y2="19" />
        <line x1="19" y1="5" x2="5" y2="19" />
      </>
    )
  },
  'IconX'
)

/* Folder Icon */
export const IconFolder = createUniversalIcon(
  {
    'lucide-line': () => (
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    ),
    'cyber-hud': (sw) => (
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" strokeWidth={sw} />
        <line x1="2" y1="10" x2="22" y2="10" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="currentColor" fillOpacity={0.25} />
        <path d="M2 10h20" />
      </>
    ),
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    ),
    'retro-monoline': () => (
      <polygon points="2 5 9 5 11 8 22 8 22 19 2 19" />
    )
  },
  'IconFolder'
)

/* Terminal / Code Command Icon */
export const IconTerminal = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" strokeWidth={sw} />
        <polyline points="6 15 10 11 6 7" strokeWidth={sw} />
        <line x1="12" y1="15" x2="16" y2="15" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" fill="currentColor" fillOpacity={0.2} />
        <polyline points="6 15 10 11 6 7" />
        <line x1="12" y1="15" x2="16" y2="15" />
      </>
    ),
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-12.5 13L6 14.5 9 11 6 7.5 7.5 6l4.5 5-4.5 5zm9 0h-5v-2h5v2z" />
    ),
    'retro-monoline': () => (
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    )
  },
  'IconTerminal'
)

/* 9. Plus / Add Icon */
export const IconPlus = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={sw} />
        <line x1="12" y1="7" x2="12" y2="17" strokeWidth={sw} />
        <line x1="7" y1="12" x2="17" y2="12" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity={0.2} />
        <path d="M12 7v10M7 12h10" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 9h4v2h-4v4h-2v-4H7v-2h4V7h2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </>
    )
  },
  'IconPlus'
)

/* Message Square / Chat Icon */
export const IconMessageSquare = createUniversalIcon(
  {
    'lucide-line': () => (
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    ),
    'cyber-hud': (sw) => (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeWidth={sw} />
        <line x1="8" y1="9" x2="16" y2="9" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor" fillOpacity={0.2} />
        <line x1="8" y1="9" x2="16" y2="9" />
      </>
    ),
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    ),
    'retro-monoline': () => (
      <polygon points="3 4 21 4 21 16 7 16 3 20 3 4" />
    )
  },
  'IconMessageSquare'
)

/* 10. Pin Icon */
export const IconPin = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <line x1="12" x2="12" y1="17" y2="22" />
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <polygon points="12 2 17 8 13 8 13 18 11 18 11 8 7 8" strokeWidth={sw} />
        <line x1="12" y1="18" x2="12" y2="22" strokeWidth={sw + 0.5} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="7" r="4" fill="currentColor" fillOpacity={0.25} />
        <path d="M12 11v11" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M16 2H8a1 1 0 0 0 0 2h1v5l-2 2v2h4v8a1 1 0 0 0 2 0v-8h4v-2l-2-2V4h1a1 1 0 0 0 0-2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="8" y="3" width="8" height="6" />
        <line x1="12" y1="9" x2="12" y2="21" />
      </>
    )
  },
  'IconPin'
)

/* 11. Monitor Icon */
export const IconMonitor = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="2" y="3" width="20" height="14" strokeWidth={sw} />
        <line x1="6" y1="21" x2="18" y2="21" strokeWidth={sw} />
        <line x1="12" y1="17" x2="12" y2="21" strokeWidth={sw} />
        <line x1="6" y1="6" x2="8" y2="6" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" fill="currentColor" fillOpacity={0.2} />
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="8" y1="21" x2="16" y2="21" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7v2H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 10H4V5h16z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="13" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
      </>
    )
  },
  'IconMonitor'
)

/* 12. Keyboard Icon */
export const IconKeyboard = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="2" y="4" width="20" height="16" strokeWidth={sw} />
        <line x1="6" y1="9" x2="18" y2="9" strokeWidth={sw} />
        <line x1="6" y1="13" x2="18" y2="13" strokeWidth={sw} />
        <line x1="8" y1="17" x2="16" y2="17" strokeWidth={sw + 0.5} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" fillOpacity={0.2} />
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <circle cx="7" cy="9" r="1" fill="currentColor" />
        <circle cx="12" cy="9" r="1" fill="currentColor" />
        <circle cx="17" cy="9" r="1" fill="currentColor" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-12 5h2v2H8zm4 0h2v2h-2zm4 0h2v2h-2zM8 13h2v2H8zm4 0h2v2h-2zm4 0h2v2h-2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="5" width="18" height="14" />
        <line x1="7" y1="15" x2="17" y2="15" />
      </>
    )
  },
  'IconKeyboard'
)

/* 13. Grid / Palette / Standard Glyphs */
export const IconGrid = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="7" height="7" strokeWidth={sw} />
        <rect x="14" y="3" width="7" height="7" strokeWidth={sw} />
        <rect x="14" y="14" width="7" height="7" strokeWidth={sw} />
        <rect x="3" y="14" width="7" height="7" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor" fillOpacity={0.25} />
        <rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" fillOpacity={0.25} />
        <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" fillOpacity={0.25} />
        <rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" fillOpacity={0.25} />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="2" y="2" width="8" height="8" />
        <rect x="14" y="2" width="8" height="8" />
        <rect x="14" y="14" width="8" height="8" />
        <rect x="2" y="14" width="8" height="8" />
      </>
    )
  },
  'IconGrid'
)

export const IconPalette = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <polygon points="12 2 22 8 19 21 5 21 2 8" strokeWidth={sw} />
        <circle cx="8" cy="10" r="1" fill="currentColor" />
        <circle cx="12" cy="7" r="1" fill="currentColor" />
        <circle cx="16" cy="10" r="1" fill="currentColor" />
      </>
    ),
    'duotone-glow': () => (
      <>
        <path
          fill="currentColor"
          fillOpacity={0.2}
          d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"
        />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 0 0 0 20c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 0.8-1.8 1.8-1.8h2.4a6 6 0 0 0 6-6C23 6 18 2 12 2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="16" cy="8" r="1.5" />
        <circle cx="12" cy="14" r="1.5" />
      </>
    )
  },
  'IconPalette'
)

export const IconGlobe = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <circle cx="12" cy="12" r="9" strokeWidth={sw} />
        <ellipse cx="12" cy="12" rx="4" ry="9" strokeWidth={sw} />
        <line x1="3" y1="12" x2="21" y2="12" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity={0.2} />
        <path d="M2 12h20M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18h-2v1.93A8 8 0 0 1 4.07 13H6v-2H4.07A8 8 0 0 1 11 4.07V6h2V4.07A8 8 0 0 1 19.93 11H18v2h1.93A8 8 0 0 1 13 19.93z"
      />
    ),
    'retro-monoline': () => (
      <>
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </>
    )
  },
  'IconGlobe'
)

export const IconCopy = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="8" y="8" width="13" height="13" strokeWidth={sw} />
        <polyline points="16 8 16 3 3 3 3 16 8 16" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fillOpacity={0.2} />
        <rect x="8" y="8" width="12" height="12" rx="2" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="7" y="7" width="14" height="14" />
        <polyline points="17 7 17 3 3 3 3 17 7 17" />
      </>
    )
  },
  'IconCopy'
)

export const IconRotate = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L22 9" strokeWidth={sw} />
        <polyline points="22 3 22 9 16 9" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity={0.2} />
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"
      />
    ),
    'retro-monoline': () => (
      <>
        <polyline points="21 3 21 9 15 9" />
        <path d="M21 9 A 9 9 0 1 0 21 15" />
      </>
    )
  },
  'IconRotate'
)

export const IconShield = createUniversalIcon(
  {
    'lucide-line': () => <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />,
    'cyber-hud': (sw) => (
      <polygon points="12 2 20 6 18 16 12 22 6 16 4 6" strokeWidth={sw} />
    ),
    'duotone-glow': () => (
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"
        fill="currentColor"
        fillOpacity={0.25}
      />
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2L4 5v7c0 5.5 3.4 10.7 8 12 4.6-1.3 8-6.5 8-12V5l-8-3z"
      />
    ),
    'retro-monoline': () => <polygon points="12 2 20 6 20 14 12 22 4 14 4 6" />
  },
  'IconShield'
)

export const IconTrash = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="5" y="6" width="14" height="15" strokeWidth={sw} />
        <line x1="3" y1="6" x2="21" y2="6" strokeWidth={sw} />
        <line x1="9" y1="3" x2="15" y2="3" strokeWidth={sw} />
        <line x1="10" y1="10" x2="10" y2="17" strokeWidth={sw} />
        <line x1="14" y1="10" x2="14" y2="17" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="5" y="6" width="14" height="15" rx="2" fill="currentColor" fillOpacity={0.2} />
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="5" y="6" width="14" height="15" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="8" y1="3" x2="16" y2="3" />
      </>
    )
  },
  'IconTrash'
)

/* Static / Standard helper icons */
export const IconPencil = createUniversalIcon(
  {
    'lucide-line': () => <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
    'cyber-hud': () => <path d="M17 3l4 4L7 21H3v-4L17 3z" />,
    'duotone-glow': () => <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="currentColor" fillOpacity={0.2} />,
    'solid-silhouette': () => <path fill="currentColor" stroke="none" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />,
    'retro-monoline': () => <polygon points="17 3 21 7 7 21 3 21 3 17 17 3" />
  },
  'IconPencil'
)

export const IconClock = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" strokeWidth={sw} />
        <polyline points="12 6 12 12 16 12" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity={0.25} />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h-2V6h2zm0 4h-2v-2h2z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <polyline points="12 6 12 12 16 12" />
      </>
    )
  },
  'IconClock'
)

export const IconChevronLeft = createUniversalIcon(
  {
    'lucide-line': () => <path d="m15 18-6-6 6-6" />,
    'cyber-hud': () => <polyline points="15 19 8 12 15 5" />,
    'duotone-glow': () => <path d="m15 18-6-6 6-6" />,
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    ),
    'retro-monoline': () => <polyline points="15 18 9 12 15 6" />
  },
  'IconChevronLeft'
)

export const IconArrowLeft = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </>
    ),
    'cyber-hud': () => (
      <>
        <polyline points="11 18 5 12 11 6" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    'duotone-glow': () => (
      <>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </>
    ),
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    ),
    'retro-monoline': () => (
      <>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 5 12 12 19" />
      </>
    )
  },
  'IconArrowLeft'
)

export const IconImage = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="18" height="18" strokeWidth={sw} />
        <circle cx="8" cy="8" r="2" strokeWidth={sw} />
        <polyline points="21 15 15 9 6 18" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" fillOpacity={0.2} />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <circle cx="8" cy="8" r="2" />
        <polyline points="21 16 15 10 5 20" />
      </>
    )
  },
  'IconImage'
)

export const IconCheck = createUniversalIcon(
  {
    'lucide-line': () => <path d="M20 6 9 17l-5-5" />,
    'cyber-hud': () => <polyline points="20 6 9 17 4 12" />,
    'duotone-glow': () => <path d="M20 6 9 17l-5-5" />,
    'solid-silhouette': () => (
      <path fill="currentColor" stroke="none" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    ),
    'retro-monoline': () => <polyline points="20 6 9 17 4 12" />
  },
  'IconCheck'
)

export const IconStar = createUniversalIcon(
  {
    'lucide-line': () => (
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    ),
    'cyber-hud': () => (
      <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" />
    ),
    'duotone-glow': () => (
      <path
        d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        fill="currentColor"
        fillOpacity={0.25}
      />
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
      />
    ),
    'retro-monoline': () => (
      <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" />
    )
  },
  'IconStar'
)

export const IconPanelLeft = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
        <path d="m16 15-3-3 3-3" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="18" height="18" strokeWidth={sw} />
        <line x1="9" y1="3" x2="9" y2="21" strokeWidth={sw} />
        <polyline points="16 15 13 12 16 9" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="3" y="3" width="6" height="18" fill="currentColor" fillOpacity={0.25} />
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18M16 15l-3-3 3-3" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-10 16H5V5h4v14zm10 0h-8V5h8v14z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </>
    )
  },
  'IconPanelLeft'
)

export const IconPanelLeftClose = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
        <path d="m14 9 3 3-3 3" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <rect x="3" y="3" width="18" height="18" strokeWidth={sw} />
        <line x1="9" y1="3" x2="9" y2="21" strokeWidth={sw} />
        <polyline points="13 9 16 12 13 15" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="3" y="3" width="6" height="18" fill="currentColor" fillOpacity={0.25} />
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18M14 9l3 3-3 3" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-10 16H5V5h4v14zm10 0h-8V5h8v14z"
      />
    ),
    'retro-monoline': () => (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </>
    )
  },
  'IconPanelLeftClose'
)

/* Icon Download */
export const IconDownload = createUniversalIcon(
  {
    'lucide-line': () => (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
    'cyber-hud': (sw) => (
      <>
        <path d="M20 14v6H4v-6" strokeWidth={sw} />
        <polyline points="7 9 12 14 17 9" strokeWidth={sw} />
        <line x1="12" y1="14" x2="12" y2="3" strokeWidth={sw} />
      </>
    ),
    'duotone-glow': () => (
      <>
        <rect x="4" y="16" width="16" height="4" rx="1" fill="currentColor" fillOpacity={0.25} />
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
    'solid-silhouette': () => (
      <path
        fill="currentColor"
        stroke="none"
        d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
      />
    ),
    'retro-monoline': () => (
      <>
        <line x1="4" y1="20" x2="20" y2="20" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    )
  },
  'IconDownload'
)

