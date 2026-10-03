// Swap-decision logic for keyed insertCSS management. Kept pure (no Electron
// imports) so the "when to remove+reinsert a theme stylesheet" rule is unit-testable.

export interface ThemeSwapState {
  css: string
  key: string
}

export type ThemeSwapDecision = { swap: false } | { swap: true; oldKey?: string; css: string }

export function nextThemeSwap(prev: ThemeSwapState | null, css: string): ThemeSwapDecision {
  if (prev && prev.css === css) return { swap: false }
  return { swap: true, oldKey: prev?.key, css }
}
