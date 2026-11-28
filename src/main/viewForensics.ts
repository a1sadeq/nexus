/**
 * What does the page think it looks like?
 *
 * Three builds of blank-view repair were spent on witnesses that describe the view instead of the
 * picture: `getVisible()` describes the wrapper, the presentation check describes geometry, and the
 * pixel probe describes the frame. The report that prompted this module added a fourth kind of
 * complaint the app could not answer at all: *the frame is painted, and it is black*.
 *
 * A frame that is nearly black is not blank — `capturePage()` returns a real, non-uniform image, so the
 * blank-surface probe correctly says "painted", and the user is left looking at an unreadable page with
 * a scrollbar glowing in the corner. Nothing in the app could say *why* the page was dark, because
 * nothing ever asked the page.
 *
 * This module asks. It runs one small script in the page and reports what the page's own computed style
 * says about itself: the background and text colours of `body` and `html`, opacity, filters, transforms,
 * the viewport, and whether the document is scrolling. With the theme facts the main process already
 * holds for that view (accent, aura, the stylesheet key) that is enough to tell the two very different
 * causes apart:
 *
 *   * the site is dark (nothing to fix — the page shipped that way), or
 *   * **our** stylesheet has made the page unreadable: text and background resolved to within a hair of
 *     each other, which is what a tab colour used as an accent can do to a page whose own theme derived
 *     text from its background.
 *
 * The second case is a real, fixable bug, and it survived every previous build because the app never
 * looked at the text it was painting.
 */

/** The facts a page can report about its own appearance. All strings are raw computed values. */
export interface PageAppearance {
  /** Did the script run and answer? */
  ok: boolean
  url: string
  title: string
  visibilityState: string
  viewport: { width: number; height: number; dpr: number }
  scroll: { scrollHeight: number; clientHeight: number; scrollbarPx: number }
  bodyBg: string
  bodyColor: string
  htmlBg: string
  htmlColor: string
  bodyOpacity: string
  htmlFilter: string
  bodyFilter: string
  bodyTransform: string
  prefersDark: boolean
  /** Number of stylesheets the page can see, ours included. */
  styleSheets: number
  /** Whatever went wrong, when `ok` is false. */
  error?: string
}

export const EMPTY_APPEARANCE: PageAppearance = {
  ok: false,
  url: '',
  title: '',
  visibilityState: 'unknown',
  viewport: { width: 0, height: 0, dpr: 0 },
  scroll: { scrollHeight: 0, clientHeight: 0, scrollbarPx: 0 },
  bodyBg: '',
  bodyColor: '',
  htmlBg: '',
  htmlColor: '',
  bodyOpacity: '',
  htmlFilter: '',
  bodyFilter: '',
  bodyTransform: '',
  prefersDark: false,
  styleSheets: 0
}

/**
 * The script. Deliberately tiny and read-only: no element queries, no layout reads beyond what
 * `getComputedStyle` and `documentElement.scrollHeight` already cost, and no writes. It runs on every
 * suspicious probe, not on a timer, so it never competes with the page for a frame.
 */
export function buildAppearanceScript(): string {
  return `(() => {
    try {
      const html = document.documentElement;
      const body = document.body;
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const h = cs(html);
      const b = cs(body);
      return {
        url: location.href,
        title: document.title || '',
        visibilityState: document.visibilityState,
        viewport: {
          width: window.innerWidth || 0,
          height: window.innerHeight || 0,
          dpr: window.devicePixelRatio || 1
        },
        scroll: {
          scrollHeight: html ? html.scrollHeight : 0,
          clientHeight: html ? html.clientHeight : 0,
          scrollbarPx: html ? Math.max(0, (window.innerWidth || 0) - html.clientWidth) : 0
        },
        bodyBg: b ? b.backgroundColor : '',
        bodyColor: b ? b.color : '',
        htmlBg: h ? h.backgroundColor : '',
        htmlColor: h ? h.color : '',
        bodyOpacity: b ? b.opacity : '',
        htmlFilter: h ? h.filter : '',
        bodyFilter: b ? b.filter : '',
        bodyTransform: b ? b.transform : '',
        prefersDark: !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches),
        styleSheets: document.styleSheets ? document.styleSheets.length : 0
      };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  })()`
}

/** Turn whatever came back from the page into a complete record. Never throws, never guesses. */
export function parseAppearance(raw: unknown): PageAppearance {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_APPEARANCE, ok: false, error: 'no answer from the page' }
  }
  const value = raw as Record<string, unknown>
  if (typeof value.error === 'string' && value.error.length > 0) {
    return { ...EMPTY_APPEARANCE, ok: false, error: value.error.slice(0, 200) }
  }
  const str = (key: string): string => (typeof value[key] === 'string' ? (value[key] as string) : '')
  const num = (key: string, fallback = 0): number =>
    typeof value[key] === 'number' && Number.isFinite(value[key] as number)
      ? (value[key] as number)
      : fallback
  const viewport = (value.viewport ?? {}) as Record<string, unknown>
  const scroll = (value.scroll ?? {}) as Record<string, unknown>
  const nested = (obj: Record<string, unknown>, key: string, fallback = 0): number =>
    typeof obj[key] === 'number' && Number.isFinite(obj[key] as number) ? (obj[key] as number) : fallback
  return {
    ok: true,
    url: str('url'),
    title: str('title'),
    visibilityState: str('visibilityState') || 'unknown',
    viewport: {
      width: nested(viewport, 'width'),
      height: nested(viewport, 'height'),
      dpr: nested(viewport, 'dpr', 1)
    },
    scroll: {
      scrollHeight: nested(scroll, 'scrollHeight'),
      clientHeight: nested(scroll, 'clientHeight'),
      scrollbarPx: nested(scroll, 'scrollbarPx')
    },
    bodyBg: str('bodyBg'),
    bodyColor: str('bodyColor'),
    htmlBg: str('htmlBg'),
    htmlColor: str('htmlColor'),
    bodyOpacity: str('bodyOpacity'),
    htmlFilter: str('htmlFilter'),
    bodyFilter: str('bodyFilter'),
    bodyTransform: str('bodyTransform'),
    prefersDark: value.prefersDark === true,
    styleSheets: num('styleSheets')
  }
}

/**
 * Read one CSS colour the way the compositor eventually will, to one luminance number.
 *
 * Accepts the forms `getComputedStyle` actually returns (`rgb(r, g, b)`, `rgba(…)`, `color(srgb …)` is
 * not handled and returns null on purpose — inventing a value for a form we have never seen is how a
 * diagnostic starts lying), plus hex for callers that already have a literal.
 */
export function colourLuminance(css: string): number | null {
  if (typeof css !== 'string') return null
  const text = css.trim().toLowerCase()
  if (text.length === 0) return null
  if (text === 'transparent') return 0
  let r = -1
  let g = -1
  let b = -1
  const rgb = text.match(/^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/)
  if (rgb) {
    r = Number(rgb[1])
    g = Number(rgb[2])
    b = Number(rgb[3])
  } else {
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
    if (hex) {
      const raw = hex[1]
      if (raw.length === 3 || raw.length === 4) {
        r = parseInt(raw[0] + raw[0], 16)
        g = parseInt(raw[1] + raw[1], 16)
        b = parseInt(raw[2] + raw[2], 16)
      } else {
        r = parseInt(raw.slice(0, 2), 16)
        g = parseInt(raw.slice(2, 4), 16)
        b = parseInt(raw.slice(4, 6), 16)
      }
    }
  }
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG contrast ratio between two luminances, 1 (identical) to 21 (black on white).
 *
 * The WCAG formula works on relative luminance in 0–1, but {@link colourLuminance} answers in 0–255
 * (the unit the pixels and the `> 140` background test are already in), so the division happens here,
 * once, rather than at every call site.
 */
export function contrastRatio(a: number, b: number): number {
  const light = Math.max(a, b) / 255
  const dark = Math.min(a, b) / 255
  return (light + 0.05) / (dark + 0.05)
}

/** Below this, a page is not merely dark: its own text has been painted into its own background. */
export const UNREADABLE_CONTRAST = 1.35

/** Below this mean luminance a frame is "black with something in it", not "painted". */
export const DARK_FRAME_LUMINANCE = 18

export interface ReadabilityVerdict {
  /** Both colours were readable and the ratio came out below the threshold. */
  unreadable: boolean
  /** `null` when the page did not give us two colours to compare. */
  ratio: number | null
  reason: string
}

/**
 * Does the page's own text disappear into the page's own background?
 *
 * `body` is tried first and `html` is the fallback, because a themed page very often sets the colour on
 * `body` and leaves `html` at its default — and comparing `html`'s default black against a dark `body`
 * background would report every dark site as unreadable.
 */
export function judgeReadability(appearance: PageAppearance): ReadabilityVerdict {
  if (!appearance.ok) return { unreadable: false, ratio: null, reason: 'the page did not answer' }
  const backgrounds = [appearance.bodyBg, appearance.htmlBg]
  const foregrounds = [appearance.bodyColor, appearance.htmlColor]
  for (let i = 0; i < backgrounds.length; i++) {
    const bg = colourLuminance(backgrounds[i])
    const fg = colourLuminance(foregrounds[i])
    if (bg === null || fg === null) continue
    const ratio = contrastRatio(bg, fg)
    return {
      unreadable: ratio < UNREADABLE_CONTRAST,
      ratio: Math.round(ratio * 100) / 100,
      reason: `text ${foregrounds[i]} on ${backgrounds[i]}`
    }
  }
  return { unreadable: false, ratio: null, reason: 'the page reported no comparable colours' }
}
