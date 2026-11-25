import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Build 35 — "the pasting (focus) issue remains the exact same".
 *
 * Two separate defects shared one report:
 *
 *   1. Ctrl+V with the shell focused never reached the composer, because the composer is in the tab's
 *      `WebContentsView` and the clipboard event was delivered to a renderer with nothing editable in
 *      it. Nothing happened at all; you had to click the page first.
 *   2. When the composer *was* focused, `focusPromptInView` wrote `selectionStart = selectionEnd =
 *      value.length` on every call, so the caret jumped to the end of a half-written prompt.
 *
 * These assertions pin the shape of both fixes, because neither can be exercised in a unit test: one
 * is an Electron IPC path and the other is a script that runs inside a provider's page.
 */
const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const app = readFileSync(join(__dirname, '../renderer/src/App.tsx'), 'utf8')

describe('build 35 — paste routing', () => {
  it('routes Ctrl+V from the shell to the composer, and only when the shell owns the keyboard', () => {
    const handler = main.slice(main.indexOf("mainWindow.webContents.on('before-input-event'"), main.indexOf("mainWindow.webContents.on('before-input-event'") + 1200)
    expect(handler).toContain("(input.key || '').toLowerCase() === 'v'")
    expect(handler).toContain("input.control || input.meta")
    // An overlay's own fields keep their paste, and a page that already has the keyboard keeps its own.
    expect(handler).toContain('!overlaysOpen')
    // Asked of the webContents, not of the remembered owner: clicking the sidebar takes the keyboard
    // away from the page without necessarily flipping that flag.
    expect(handler).toContain('!activeViewHasKeyboard()')
    expect(main).toContain('function activeViewHasKeyboard(): boolean {')
    expect(handler).toContain('event.preventDefault()')
    expect(handler).toContain("pasteIntoActiveView('shell key')")
  })

  it('does the three things a paste into the page needs, in this order', () => {
    const fn = main.slice(main.indexOf('function pasteIntoActiveView'), main.indexOf("ipcMain.handle('clipboard_write'"))
    const keyboard = fn.indexOf("giveKeyboardToView(view, 'paste', tabId)")
    const focus = fn.indexOf('focusPromptInView(view, viewModelKeys.get(tabId))')
    const paste = fn.indexOf('view.webContents.paste()')
    expect(keyboard).toBeGreaterThan(-1)
    // The keyboard has to move before the composer can be focused, and the paste has to come after the
    // focus script has resolved — a frame later, not in the same tick.
    expect(keyboard).toBeLessThan(focus)
    expect(focus).toBeLessThan(paste)
    expect(fn).toContain('setTimeout(')
    expect(fn).toContain('}, 60)')
  })

  it('cannot paste twice when both the key and the DOM event fire', () => {
    expect(main).toContain('let lastPasteRouteAt = 0')
    expect(main).toContain('if (now - lastPasteRouteAt < 300)')
    expect(main).toContain("ipcMain.on('paste_to_active_view', () => pasteIntoActiveView('renderer'))")
  })

  it('leaves a paste alone when it is going somewhere editable', () => {
    const listener = app.slice(app.indexOf('const onPaste = (event: ClipboardEvent)'), app.indexOf("document.removeEventListener('paste'"))
    expect(app).toContain("document.addEventListener('paste', onPaste, true)")
    expect(listener).toContain("target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA'")
    expect(listener).toContain('if (anyOverlayOpenRef.current) return')
    expect(listener).toContain("send?.('paste_to_active_view')")
  })
})

describe('build 35 — the caret stays where the user put it', () => {
  const focusFn = main.slice(main.indexOf('const tryFocus = () => {'), main.indexOf('if (!tryFocus())'))

  it('does nothing at all when the composer is already focused', () => {
    expect(focusFn).toContain('if (document.activeElement === el) return true;')
  })

  it('only moves the caret into a composer that is empty', () => {
    expect(focusFn).toContain('const empty =')
    expect(focusFn).toContain('if (!empty) return true;')
    // The move itself now happens once, inside the empty branch — not on every call.
    expect(focusFn.match(/el\.selectionStart = el\.selectionEnd = el\.value\.length/g) ?? []).toHaveLength(1)
    const emptyGuard = focusFn.indexOf('if (!empty) return true;')
    const caretWrite = focusFn.indexOf('el.selectionStart = el.selectionEnd = el.value.length;')
    expect(caretWrite).toBeGreaterThan(emptyGuard)
  })
})
