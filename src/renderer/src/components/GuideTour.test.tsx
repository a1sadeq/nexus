// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import GuideTour, { type GuideTourProps } from './GuideTour'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseProps: GuideTourProps = {
  isOpen: true,
  onClose: vi.fn(),
  providers: [
    { key: 'gemini', label: 'Gemini' },
    { key: 'glm', label: 'GLM' }
  ],
  containers: [
    { id: 'default', name: 'Default' },
    { id: 'work', name: 'Work', color: '#f43f5e' }
  ],
  tabCount: 3,
  settingsRevision: 0,
  themeId: 'midnight',
  onOpenSettingsSection: vi.fn(),
  onCloseSettingsSection: vi.fn(),
  onOpenSettings: vi.fn(),
  onReplayRequested: vi.fn()
}

/** Anchors the tour rings, with a box, since jsdom lays nothing out. */
function addAnchor(id: string, box = { top: 120, left: 40, width: 120, height: 32 }): void {
  const el = document.createElement('div')
  el.setAttribute('data-guide', id)
  el.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({})
    }) as DOMRect
  document.body.appendChild(el)
}

const STEP_IDS = ['welcome', 'tabs', 'finding', 'settings', 'studio', 'palette', 'containers', 'done']

describe('build 37 — the guide covers navigation, settings and styling', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    document.body.innerHTML = ''
  })

  const pump = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  const press = async (key: string): Promise<void> => {
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    await pump()
  }

  const open = async (overrides: Partial<GuideTourProps> = {}): Promise<void> => {
    await act(async () => {
      root.render(<GuideTour {...baseProps} {...overrides} />)
    })
    await pump()
  }

  it('renders nothing when it is closed', async () => {
    await act(async () => {
      root.render(<GuideTour {...baseProps} isOpen={false} />)
    })
    await pump()
    expect(document.querySelector('[data-guide-open]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens as a modal dialog, with the scope of the tour stated up front', async () => {
    addAnchor('tabs')
    await open()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('guide-title')
    expect(document.getElementById('guide-title')?.textContent).toContain('Three things take learning')
    expect(dialog.textContent).toContain('1 / 8')
    // It says what it is not: a tour of the buttons.
    expect(dialog.textContent?.toLowerCase()).toContain('a tour of the buttons would waste your minute')
  })

  it('walks the three subjects in order, and never leaves the first step backwards', async () => {
    for (const id of ['tabs', 'navigation', 'settings-sections', 'settings-style-studio', 'settings-theme-grid', 'containers']) {
      addAnchor(id)
    }
    await open()
    const seen: string[] = []
    const current = (): string => document.querySelector('[data-guide-open]')?.getAttribute('data-guide-step') ?? ''
    const all: string[] = [current()]
    await press('ArrowLeft')
    expect(current()).toBe('welcome')
    for (let i = 0; i < STEP_IDS.length - 1; i += 1) {
      await press('ArrowRight')
      all.push(current())
    }
    seen.push(...all)
    expect(seen).toEqual(STEP_IDS)
  })

  it('asks the app to open the settings section a step needs, and closes it again on the way out', async () => {
    for (const id of ['tabs', 'navigation', 'settings-sections', 'settings-style-studio', 'settings-theme-grid']) {
      addAnchor(id)
    }
    const onOpenSettingsSection = vi.fn()
    const onCloseSettingsSection = vi.fn()
    await open({ onOpenSettingsSection, onCloseSettingsSection })

    // Steps 1-3 are in the workspace: nothing is opened for them.
    for (let i = 0; i < 2; i += 1) await press('ArrowRight')
    expect(onOpenSettingsSection).not.toHaveBeenCalled()

    // Step 4 is the sections themselves: the panel opens so the rail can be pointed at.
    await press('ArrowRight')
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('settings')
    expect(onOpenSettingsSection).toHaveBeenLastCalledWith('general')

    // Step 5 is the Style Studio: same panel, different section.
    await press('ArrowRight')
    expect(onOpenSettingsSection).toHaveBeenCalledWith('style')

    // Step 6 is the palette: same panel, different section.
    await press('ArrowRight')
    expect(onOpenSettingsSection).toHaveBeenLastCalledWith('themes')

    // Step 7 is back in the window, so the panel the tour opened is closed.
    await press('ArrowRight')
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('containers')
    expect(onCloseSettingsSection).toHaveBeenCalled()
  })

  it('will not leave the palette step until the theme really changed', async () => {
    addAnchor('settings-theme-grid')
    await open({ settingsRevision: 4 })
    for (let i = 0; i < 5; i += 1) await press('ArrowRight')
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('palette')

    const primary = document.querySelector('[data-guide-primary]') as HTMLButtonElement
    expect(primary.disabled).toBe(true)
    expect(primary.textContent?.toLowerCase()).toContain('pick a theme')

    // The user clicks a palette in the settings panel underneath; the app reports the change.
    await act(async () => {
      root.render(<GuideTour {...baseProps} settingsRevision={5} />)
    })
    await pump()
    const after = document.querySelector('[data-guide-primary]') as HTMLButtonElement
    expect(after.disabled).toBe(false)
    expect(after.textContent).toContain('It changed')
  })

  it('opens the scrim around the palette grid so the click reaches it', async () => {
    addAnchor('settings-theme-grid', { top: 300, left: 200, width: 600, height: 300 })
    await open()
    for (let i = 0; i < 5; i += 1) await press('ArrowRight')
    const rootEl = document.querySelector('[data-guide-open]') as HTMLElement
    expect(rootEl.getAttribute('data-guide-passthrough')).toBe('true')
    expect(document.querySelectorAll('.guide-block').length).toBe(4)
    expect(document.querySelectorAll('.guide-scrim').length).toBe(0)
    expect(document.querySelector('.guide-spot.is-open')).toBeTruthy()
  })

  it('keeps the card fully inside the window, wherever its anchor sits', async () => {
    // A control in the bottom-right corner: the card cannot hang off the right or the bottom edge.
    addAnchor('tabs', { top: 700, left: 900, width: 100, height: 40 })
    await open()
    const card = document.querySelector('.guide-card') as HTMLElement
    const top = Number.parseFloat(card.style.top)
    const left = Number.parseFloat(card.style.left)
    // jsdom reports no size, so the tour falls back to its own measure for the layout sums.
    const [w, h] = [400, 300]
    expect(top).toBeGreaterThanOrEqual(12)
    expect(left).toBeGreaterThanOrEqual(12)
    expect(top + h).toBeLessThanOrEqual(window.innerHeight - 12)
    expect(left + w).toBeLessThanOrEqual(window.innerWidth - 12)
  })

  it('scrolls a half-hidden anchor into view before pointing at it', async () => {
    addAnchor('tabs', { top: window.innerHeight + 200, left: 40, width: 120, height: 32 })
    const spy = vi.fn()
    ;(document.querySelector('[data-guide="tabs"]') as HTMLElement).scrollIntoView = spy
    await open()
    // The first step is centred; the anchor is only looked for once a step points at one.
    await press('ArrowRight')
    expect(spy).toHaveBeenCalled()
  })

  it('falls back to a centred card when a control is not on screen', async () => {
    // No anchors at all: every step still reads, nothing points at nothing.
    await open()
    expect(document.querySelector('.guide-card.is-center')).toBeTruthy()
    expect(document.querySelector('.guide-spot')).toBeNull()
  })

  it('closes on Escape and reports why', async () => {
    const onClose = vi.fn()
    await open({ onClose })
    await press('Escape')
    expect(onClose).toHaveBeenCalledWith('escape')
  })

  it('takes focus into the dialog and gives it back on close', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'F1'
    document.body.appendChild(opener)
    opener.focus()
    await open()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.contains(document.activeElement)).toBe(true)

    await act(async () => {
      root.render(<GuideTour {...baseProps} isOpen={false} />)
    })
    await pump()
    expect(document.activeElement).toBe(opener)
  })
})

describe('build 37 — the guide cannot drift away from the app', () => {
  const here = __dirname
  const guideSource = readFileSync(resolve(here, 'GuideTour.tsx'), 'utf8')
  const appSource = readFileSync(resolve(here, '../App.tsx'), 'utf8')
  const chatTabs = readFileSync(resolve(here, 'ChatTabs.tsx'), 'utf8')
  const verticalTabs = readFileSync(resolve(here, 'VerticalTabs.tsx'), 'utf8')
  const settings = readFileSync(resolve(here, 'SettingsOverlay.tsx'), 'utf8')

  it('every anchor the guide uses exists in the real UI', () => {
    const anchors = new Set(Array.from(guideSource.matchAll(/anchor: '([a-z-]+)'/g), (m) => m[1]))
    expect(anchors.size).toBeGreaterThanOrEqual(5)
    const surfaces = [appSource, chatTabs, verticalTabs, settings].join('\n')
    for (const anchor of anchors) {
      expect(surfaces, `no data-guide="${anchor}" in the UI`).toContain(`data-guide="${anchor}"`)
    }
  })

  it('is opened by F1 and by first run, and remembers that it was seen', () => {
    expect(appSource).toContain("case 'guide_open':")
    expect(appSource).toContain('onClose={closeGuide}')
    expect(appSource).toContain("const GUIDE_SEEN_KEY = 'vicinae.guide.seen.v1'")
    expect(appSource).toContain('if (seen) return')
    expect(appSource).toContain('localStorage.setItem(GUIDE_SEEN_KEY, reason)')
    expect(appSource).toContain('localStorage.removeItem(GUIDE_SEEN_KEY)')
    expect(appSource).toContain('key={guideRun}')
  })

  it('takes the settings panel from the step, and gives it back when the guide is done', () => {
    expect(appSource).toContain('initialSection={settingsRequestedTab as any}')
    expect(appSource).toContain("setSettingsRequestedTab(section)")
    expect(appSource).toContain('if (guideOwnsSettings.current) {')
    expect(appSource).toContain('setSettingsRevision((n) => n + 1)')
  })

  it('covers settings and styling rather than cataloguing the footer', () => {
    const text = guideSource.toLowerCase()
    // The subjects that are actually hard to discover…
    expect(text).toContain('ctrl')
    expect(guideSource).toContain("anchor: 'settings-sections'")
    expect(guideSource).toContain("openSettings: 'general'")
    expect(guideSource).toContain("anchor: 'settings-style-studio'")
    expect(guideSource).toContain("openSettings: 'style'")
    expect(settings).toContain('data-guide="settings-sections"')
    expect(settings).toContain('data-guide="settings-style-studio"')
    expect(text).toContain('style studio')
    expect(text).toContain('pick a palette')
    // …and not a walk through every button in the window.
    expect(text).not.toContain('quick-actions')
    expect(text).not.toContain('hand a conversation to another model')
    expect(text).not.toContain('six providers, one key press apart')
  })

  it('names the in-order tab keys, not only the numbered ones', () => {
    expect(guideSource).toContain('action="tab-next"')
    expect(guideSource).toContain('action="tab-prev"')
  })

  it('says nothing about importing from another browser', () => {
    for (const phrase of ['import from', 'session sync', 'import session', 'detected browser']) {
      expect(guideSource.toLowerCase()).not.toContain(phrase)
    }
    expect(guideSource).toContain('log in the normal way')
  })
})
