export type ThemeAppearance = 'dark' | 'light' | 'system'

export const DEFAULT_THEME_APPEARANCE: ThemeAppearance = 'dark'

export function isValidThemeAppearance(val: unknown): val is ThemeAppearance {
  return val === 'dark' || val === 'light' || val === 'system'
}

export function resolveEffectiveColorScheme(
  appearance: ThemeAppearance,
  systemIsDark: boolean
): 'dark' | 'light' {
  if (appearance === 'system') {
    return systemIsDark ? 'dark' : 'light'
  }
  return appearance
}

export function getColorSchemeCss(colorScheme: 'dark' | 'light' = 'dark'): string {
  return `:root, html { color-scheme: ${colorScheme} !important; }`
}

export function applyColorSchemeEmulation(
  webContents: any,
  _colorScheme: 'dark' | 'light' = 'dark'
): void {
  if (!webContents) return
  try {
    if (typeof webContents.emulateMediaType === 'function') {
      webContents.emulateMediaType('screen')
    }
  } catch (err) {
    // Non-fatal if webContents is transitioning or destroyed
  }
}
