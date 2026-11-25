/*
 * eslint-disable react-hooks/set-state-in-effect --
 * The tour reads the committed DOM (which anchors exist, where they are) and tracks the settings
 * overlay it opened for a step. Both are post-paint facts, so they cannot be computed during render.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getShortcutKeys } from '../lib/shortcuts'
import { IconCheck, IconX, IconChevronLeft, IconKeyboard, IconZap, IconPalette, IconGrid } from './BrandIcons'
import './GuideTour.css'

/**
 * The Nexus guide: a spotlight tour over the real window.
 *
 * It is deliberately **not** a catalogue of buttons. Everything in this app has a label; what does not is
 * where things live and how far the styling goes. So the tour covers exactly three subjects — moving
 * between conversations, the settings panel, and the Style Studio — and it stops at eight steps.
 *
 * Two of those steps take the tour *into* Settings: the guide asks the app to open a section, waits for
 * it, and rings a real control inside it. The palette step is a gate: it will not move on until the theme
 * has actually changed, and while it is up the scrim opens around the palette grid so the click lands.
 *
 * Opened by F1, and once by itself on first run. Modal semantics follow the W3C APG dialog pattern;
 * anchors are `data-guide` attributes on the real controls, so a restyle cannot silently break the tour.
 */

export interface GuideProvider {
  key: string
  label: string
  icon?: string
  color?: string
}

export interface GuideContainer {
  id: string
  name: string
  color?: string
}

export interface GuideTourProps {
  isOpen: boolean
  onClose: (reason: 'done' | 'skipped' | 'escape') => void
  providers: GuideProvider[]
  containers: GuideContainer[]
  tabCount: number
  /** Bumped by the app on every interface-settings change; the palette step watches it. */
  settingsRevision: number
  themeId: string
  /** Ask the app to show Settings on a section (`style`, `themes`, `shortcuts`, …). */
  onOpenSettingsSection: (section: string) => void
  /** Put the workspace back the way it was before a step opened Settings. */
  onCloseSettingsSection: () => void
  onOpenSettings: () => void
  onReplayRequested?: () => void
}

interface Step {
  id: string
  eyebrow: string
  title: string
  body: ReactNode
  /** `data-guide` value to spotlight. Absent = a centred card. */
  anchor?: string
  /** Section of Settings this step needs on screen. */
  openSettings?: string
  cta?: string
  /** The forward button stays disabled until the app reports the thing actually happened. */
  gate?: 'theme'
  waiting?: string
}

const PAD = 8
const GAP = 14
const TOOLTIP_MAX = 400

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

type Placement = 'right' | 'left' | 'bottom' | 'top' | 'center'

/** Nothing is drawn closer than this to the window edge, so a card is never half off the screen. */
const EDGE = 12

interface Box {
  top: number
  left: number
  placement: Placement
}

/**
 * Where the card goes, as a top-left corner rather than a transform, so it can be clamped to the window.
 *
 * The candidates are tried in the order a reader would look — right, left, below, above — and the first
 * one that fits inside the window without covering the thing it points at wins. If none of them fit (a
 * big target in a small window), the loosest one is clamped into the margin and the card shrinks instead
 * of hanging over the edge.
 */
function placeCard(
  anchor: Rect | null,
  card: { width: number; height: number },
  view: { width: number; height: number }
): Box {
  const w = Math.min(card.width, Math.max(0, view.width - EDGE * 2))
  const h = Math.min(card.height, Math.max(0, view.height - EDGE * 2))
  const centre = (): Box => ({
    top: Math.max(EDGE, Math.round((view.height - h) / 2)),
    left: Math.max(EDGE, Math.round((view.width - w) / 2)),
    placement: 'center'
  })
  if (!anchor) return centre()

  const hole = {
    top: anchor.top - PAD,
    left: anchor.left - PAD,
    right: anchor.left + anchor.width + PAD,
    bottom: anchor.top + anchor.height + PAD
  }
  const midY = anchor.top + anchor.height / 2 - h / 2
  const midX = anchor.left + anchor.width / 2 - w / 2
  const candidates: Array<{ placement: Placement; top: number; left: number }> = [
    { placement: 'right', left: hole.right + GAP, top: midY },
    { placement: 'left', left: hole.left - GAP - w, top: midY },
    { placement: 'bottom', left: midX, top: hole.bottom + GAP },
    { placement: 'top', left: midX, top: hole.top - GAP - h }
  ]

  const clampX = (left: number): number => Math.min(Math.max(left, EDGE), Math.max(EDGE, view.width - EDGE - w))
  const clampY = (top: number): number => Math.min(Math.max(top, EDGE), Math.max(EDGE, view.height - EDGE - h))
  const fits = (c: { top: number; left: number }): boolean =>
    c.left >= EDGE && c.top >= EDGE && c.left + w <= view.width - EDGE && c.top + h <= view.height - EDGE
  const overlap = (c: { top: number; left: number }): number => {
    const x = Math.min(c.left + w, hole.right) - Math.max(c.left, hole.left)
    const y = Math.min(c.top + h, hole.bottom) - Math.max(c.top, hole.top)
    return x > 0 && y > 0 ? x * y : 0
  }

  const best = candidates.find((c) => fits(c) && overlap(c) === 0)
  if (best) return { top: Math.round(best.top), left: Math.round(best.left), placement: best.placement }

  // Nothing fits cleanly: take the placement that loses the least and pull it inside the margins.
  const scored = candidates
    .map((c) => ({ c, score: overlap(c) * 2 + Math.abs(clampX(c.left) - c.left) + Math.abs(clampY(c.top) - c.top) }))
    .sort((a, b) => a.score - b.score)
  const chosen = scored[0].c
  return { top: Math.round(clampY(chosen.top)), left: Math.round(clampX(chosen.left)), placement: chosen.placement }
}

/** A target scrolled half out of its container is not a target. Bring it back before measuring it. */
function ensureVisible(el: Element): void {
  if (typeof el.scrollIntoView !== 'function') return
  const r = el.getBoundingClientRect()
  const outside = r.top < EDGE || r.left < EDGE || r.bottom > window.innerHeight - EDGE || r.right > window.innerWidth - EDGE
  if (outside) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function readRect(el: Element | null): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** A key row built from the app's live keymap, so the guide can never disagree with the binding. */
function Keys({ action }: { action: string }): ReactElement | null {
  const list = getShortcutKeys(action)
  if (!list.length) return null
  return (
    <span className="guide-keys" aria-label={`Shortcut: ${list.join(' plus ')}`}>
      {list.map((k, i) => (
        <kbd key={`${k}-${i}`}>{k}</kbd>
      ))}
    </span>
  )
}

export function GuideTour({
  isOpen,
  onClose,
  providers,
  containers,
  tabCount,
  settingsRevision,
  themeId,
  onOpenSettingsSection,
  onCloseSettingsSection,
  onOpenSettings,
  onReplayRequested
}: GuideTourProps): ReactElement | null {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [box, setBox] = useState<Box>({ top: 0, left: 0, placement: 'center' })
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<Element | null>(null)
  // The settings as they were on the way *into* the gated step. Navigation sets it, so it cannot drift
  // on an unrelated re-render, and nothing has to read a ref during render to decide the gate.
  const [gateBaseline, setGateBaseline] = useState<number | null>(null)
  const settingsStepOpen = useRef(false)

  const steps = useMemo<Step[]>(
    () => [
      {
        id: 'welcome',
        eyebrow: 'Nexus',
        title: 'Three things take learning. This is them.',
        body: (
          <>
            <p>
              Every control in Nexus has a label, so a tour of the buttons would waste your minute. What
              is worth showing is how to move between conversations, where the settings live, and how
              far the styling actually goes.
            </p>
            <p className="guide-quiet">
              Eight steps. <kbd>Esc</kbd> leaves at any point and <kbd>F1</kbd> brings it back. Signing in
              is part of the page, not of this tour: log in the normal way on the provider and the session
              stays in that tab.
            </p>
          </>
        ),
        cta: 'Start with navigation'
      },
      {
        id: 'tabs',
        eyebrow: 'Navigation',
        title: 'Jump between conversations by number.',
        body: (
          <>
            <p>
              Every chat is a tab, and the digit on each one is the key that goes there:{' '}
              <kbd>Ctrl</kbd>+<kbd>1</kbd> for the first, <kbd>Ctrl</kbd>+<kbd>9</kbd> for the ninth.{' '}
              <Keys action="tab-cycle" /> walks the recent ones with a heads-up list, and the digit is
              printed on the tab so you never have to count. <Keys action="tab-next" /> and{' '}
              <Keys action="tab-prev" /> step down and up the list in order, which is the one to learn
              first — it works without looking at the sidebar at all.
            </p>
            <p className="guide-quiet">
              Right-click a tab to pin it above the rest. Pinned tabs keep their place across restarts.
            </p>
          </>
        ),
        anchor: 'tabs',
        cta: 'Next: finding a page'
      },
      {
        id: 'finding',
        eyebrow: 'Navigation',
        title: 'Three ways back to something you lost.',
        body: (
          <>
            <p>
              <Keys action="tab-overview" /> turns every open tab into a card with a live thumbnail.{' '}
              <Keys action="history-open" /> searches everything you have visited.{' '}
              <Keys action="url-bar" /> puts the cursor in a bar that understands provider names — type
              the start of one and it offers the open tab, the site, and a new chat on it.
            </p>
            <p className="guide-quiet">
              All three work from anywhere, including from inside a page that has the keyboard.
            </p>
          </>
        ),
        anchor: 'navigation',
        cta: 'Next: settings'
      },
      {
        id: 'settings',
        eyebrow: 'Settings',
        title: 'Ten sections, and a search that knows all of them.',
        body: (
          <>
            <p>
              <Keys action="settings-open" /> opens the panel, and the rail on the left is the whole of
              Nexus: <strong>General</strong>, <strong>Diagnostics</strong>, <strong>Workspace</strong>,
              {' '}<strong>Shortcuts</strong>, <strong>Providers</strong>, <strong>Sessions</strong>,
              {' '}<strong>Features</strong>, <strong>Skills</strong>, <strong>Themes</strong>, and the{' '}
              <strong>Style Studio</strong>.
            </p>
            <p>
              The box above them searches every section by name — type “aura”, “retention”, “zoom” — so
              you never have to remember which one a setting lives under. Nothing that changes how Nexus
              behaves lives outside this panel.
            </p>
            <p className="guide-quiet">
              {tabCount} tab{tabCount === 1 ? '' : 's'}, {providers.length} provider
              {providers.length === 1 ? '' : 's'} and {containers.length} container
              {containers.length === 1 ? '' : 's'} in this profile; the next two steps open the two
              sections worth more than the rest.
            </p>
          </>
        ),
        openSettings: 'general',
        anchor: 'settings-sections',
        cta: 'Next: the studio'
      },
      {
        id: 'studio',
        eyebrow: 'Styling',
        title: 'The Style Studio is the deep end.',
        body: (
          <>
            <p>
              Interface & Style Studio is where the styling stops being a colour: aesthetic presets,
              accent and luminance, corner curvature and typography, glass and spring motion, the ambient
              aura around the page, chat-bubble widths, code-block treatment, icon packs.
            </p>
            <p className="guide-quiet">
              The right-hand column previews a change before it lands, and the provider tabs at the top
              give one provider a look of its own — Claude dark, Gemini light, whatever you want.
            </p>
          </>
        ),
        openSettings: 'style',
        anchor: 'settings-style-studio',
        cta: 'Next: try it yourself'
      },
      {
        id: 'palette',
        eyebrow: 'Your turn',
        title: 'Pick a palette.',
        body: (
          <>
            <p>
              Click any theme below. Palette, borders, glows and the aura colour change together, and the
              tour moves on once it has actually landed — no button to press to say you did.
            </p>
          </>
        ),
        openSettings: 'themes',
        anchor: 'settings-theme-grid',
        gate: 'theme',
        waiting: 'Pick a theme to continue…',
        cta: 'It changed — continue'
      },
      {
        id: 'containers',
        eyebrow: 'Styling',
        title: 'Styling that follows you into the page.',
        body: (
          <>
            <p>
              A container is a browser profile with a colour. The ring around the AI page takes that
              colour, and so does every tab inside it, so work and personal are told apart at a glance — in
              the sidebar and in the page.
            </p>
            {containers.length > 0 && (
              <div className="guide-chips">
                {containers.slice(0, 6).map((c) => (
                  <span key={c.id} className="guide-chip">
                    <span
                      className="guide-swatch"
                      style={{ background: c.color || 'transparent', borderColor: c.color || 'currentColor' }}
                    />
                    <span>{c.name}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="guide-quiet">
              <Keys action="tab-colours" /> paints a single tab, if you want one to stand out without a
              whole container.
            </p>
          </>
        ),
        anchor: 'containers',
        cta: 'Next: the recap'
      },
      {
        id: 'done',
        eyebrow: 'Finished',
        title: 'That is the whole app.',
        body: (
          <>
            <p>
              Navigation, settings, styling — the rest is labelled buttons and a footer that carries the
              six things worth a shortcut.
            </p>
            <div className="guide-recap">
              <span>
                <IconKeyboard size={13} /> <kbd>F1</kbd> this guide
              </span>
              <span>
                <IconZap size={13} /> <kbd>Ctrl</kbd>+<kbd>L</kbd> jump anywhere
              </span>
              <span>
                <IconGrid size={13} /> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> all tabs
              </span>
              <span>
                <IconPalette size={13} /> <kbd>Ctrl</kbd>+<kbd>,</kbd> settings
              </span>
            </div>
            <p className="guide-quiet">
              Theme: <strong>{themeId}</strong>. You can run this tour again from Settings, or with F1.
            </p>
          </>
        ),
        cta: 'Close the guide'
      }
    ],
    [containers, providers.length, tabCount, themeId]
  )

  const step = steps[Math.min(index, steps.length - 1)]
  const stepIndexLabel = `${Math.min(index + 1, steps.length)} / ${steps.length}`

  /**
   * Every move goes through here, because arriving on a step is the only moment a step's baseline can be
   * captured: the palette gate opens on a change made while it is on screen, not on any change at all.
   */
  const enter = useCallback(
    (target: number): void => {
      setIndex(target)
      setGateBaseline(steps[target]?.gate === 'theme' ? settingsRevision : null)
    },
    [steps, settingsRevision]
  )

  const go = useCallback(
    (delta: number): void => {
      const next = index + delta
      if (next < 0) return
      if (next >= steps.length) {
        onClose('done')
        return
      }
      enter(next)
    },
    [enter, index, onClose, steps.length]
  )

  const gateReady = step.gate === 'theme' ? gateBaseline !== null && settingsRevision !== gateBaseline : true

  // Settings belong to the step that asked for them: opened on arrival, closed on the way out.
  useEffect(() => {
    if (!isOpen) {
      if (settingsStepOpen.current) {
        settingsStepOpen.current = false
        onCloseSettingsSection()
      }
      return
    }
    if (step.openSettings) {
      settingsStepOpen.current = true
      onOpenSettingsSection(step.openSettings)
      return
    }
    if (settingsStepOpen.current) {
      settingsStepOpen.current = false
      onCloseSettingsSection()
    }
  }, [isOpen, step, onOpenSettingsSection, onCloseSettingsSection])

  // Geometry: follow the anchor through resize, scroll and layout changes.
  useEffect(() => {
    if (!isOpen) return undefined
    const selector = step.anchor ? `[data-guide="${step.anchor}"]` : null
    let frame = 0

    const measure = (): void => {
      const el = selector ? document.querySelector(selector) : null
      if (el) ensureVisible(el)
      const r = readRect(el)
      setRect(r)

      const cardEl = dialogRef.current
      const card = {
        width: cardEl?.offsetWidth || TOOLTIP_MAX,
        height: cardEl?.offsetHeight || 300
      }
      setBox(placeCard(r, card, { width: window.innerWidth, height: window.innerHeight }))
    }

    const schedule = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    measure()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const el = selector ? document.querySelector(selector) : null
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (el && ro) ro.observe(el)
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true })
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      ro?.disconnect()
      mo.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [isOpen, step, index])

  // Focus: into the dialog on open, trapped inside it, and back where it came from on close.
  useEffect(() => {
    if (!isOpen) return undefined
    returnFocusRef.current = document.activeElement
    const el = dialogRef.current
    if (!el) return undefined
    const first = el.querySelector<HTMLElement>('[data-guide-primary]:not([disabled])') ?? el
    first.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose('escape')
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(1)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(-1)
        return
      }
      if (event.key !== 'Tab') return
      const focusables = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const list = Array.from(focusables)
      const current = document.activeElement as HTMLElement | null
      const atStart = current === list[0]
      const atEnd = current === list[list.length - 1]
      if (!event.shiftKey && atEnd) {
        event.preventDefault()
        list[0].focus()
      } else if (event.shiftKey && atStart) {
        event.preventDefault()
        list[list.length - 1].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, go, onClose])

  useEffect(() => {
    if (isOpen) return
    const previous = returnFocusRef.current
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
  }, [isOpen])

  if (!isOpen) return null

  const passThrough = step.gate === 'theme' && !!rect
  const hole = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2
      }
    : null
  const reduced = prefersReducedMotion()

  // An explicit corner, clamped inside the window: no transform, so nothing can be pushed off-screen by
  // half its own height.
  const tooltipStyle: React.CSSProperties = { top: box.top, left: box.left }

  return createPortal(
    <div
      className={`guide-root${reduced ? ' is-reduced' : ''}`}
      data-guide-open="true"
      data-guide-passthrough={passThrough ? 'true' : 'false'}
      data-guide-step={step.id}
    >
      {/*
        The palette step asks the user to press a real control inside Settings, so the scrim becomes four
        panels around the hole and the hole itself stays open to the app underneath.
      */}
      {passThrough && hole ? (
        <>
          <div className="guide-block" aria-hidden="true" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div
            className="guide-block"
            aria-hidden="true"
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="guide-block"
            aria-hidden="true"
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
          />
          <div
            className="guide-block"
            aria-hidden="true"
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
          />
        </>
      ) : (
        <div className="guide-scrim" aria-hidden="true" />
      )}

      {rect && (
        <div
          className={`guide-spot${passThrough ? ' is-open' : ''}`}
          aria-hidden="true"
          style={
            hole
              ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height, borderRadius: 12 }
              : undefined
          }
        />
      )}

      <div
        ref={dialogRef}
        className={`guide-card is-${box.placement}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-desc"
        style={tooltipStyle}
      >
        <div className="guide-head">
          <span className="guide-eyebrow">
            {step.eyebrow}
            <span className="guide-counter">{stepIndexLabel}</span>
          </span>
          <button
            type="button"
            className="guide-close"
            onClick={() => onClose('skipped')}
            aria-label="Close the guide"
            title="Close (Esc)"
          >
            <IconX size={14} />
          </button>
        </div>

        <h2 id="guide-title" className="guide-title">
          {step.title}
        </h2>
        <div id="guide-desc" className="guide-body">
          {step.body}
        </div>

        <div className="guide-progress" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={`guide-dot${i <= index ? ' is-on' : ''}${i === index ? ' is-current' : ''}`} />
          ))}
        </div>

        <div className="guide-actions">
          <div className="guide-actions-left">
            {index > 0 && (
              <button type="button" className="guide-ghost" onClick={() => go(-1)}>
                <IconChevronLeft size={13} /> Back
              </button>
            )}
            {step.id !== 'done' && (
              <button type="button" className="guide-ghost" onClick={() => onClose('skipped')}>
                Skip
              </button>
            )}
          </div>
          <div className="guide-actions-right">
            {step.id === 'done' ? (
              <>
                <button
                  type="button"
                  className="guide-ghost"
                  onClick={() => {
                    onReplayRequested?.()
                    enter(0)
                  }}
                >
                  Tour again
                </button>
                <button
                  type="button"
                  className="guide-primary"
                  data-guide-primary
                  onClick={() => {
                    onClose('done')
                    onOpenSettings()
                  }}
                >
                  <IconCheck size={14} /> Open settings
                </button>
              </>
            ) : (
              <button
                type="button"
                className="guide-primary"
                data-guide-primary
                disabled={!gateReady}
                onClick={() => go(1)}
                title={gateReady ? undefined : step.waiting}
              >
                {gateReady ? step.cta ?? 'Next' : step.waiting ?? 'Waiting…'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
}

export default GuideTour
