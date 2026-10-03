import { useEffect, type RefObject } from 'react'

/**
 * Keeps a modal's primary input focused while the modal is open, gently:
 * - Focuses (and selects) the input when the modal opens.
 * - If focus falls back to <body> / nothing (e.g. clicking empty backdrop,
 *   or the focused element unmounts), it returns focus to the input.
 * It never steals focus from real interactive elements (buttons, other
 * inputs, selects, contenteditables), so clicking list rows, filter pills
 * and Tab-key navigation keep working while the modal is open.
 */
export function useFocusLock(inputRef: RefObject<HTMLElement | null>, isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return

    const focusInput = (select: boolean) => {
      const el = inputRef.current
      if (!el || !el.isConnected) return
      el.focus({ preventScroll: true })
      if (select && el instanceof HTMLInputElement) el.select()
    }

    focusInput(true)
    const rafId = requestAnimationFrame(() => focusInput(true))
    const t1 = setTimeout(() => focusInput(true), 50)
    const t2 = setTimeout(() => focusInput(true), 150)

    const handleFocusOut = () => {
      // Let the browser finish the focus transition, then only recover focus
      // if it landed nowhere (body/null). Focus on any interactive element is
      // intentional and must be left alone.
      setTimeout(() => {
        if (!isOpen || !inputRef.current) return
        const active = document.activeElement
        if (!active || active === document.body) {
          focusInput(false)
        }
      }, 0)
    }

    window.addEventListener('focusout', handleFocusOut)

    return () => {
      window.removeEventListener('focusout', handleFocusOut)
      cancelAnimationFrame(rafId)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [isOpen, inputRef])
}
