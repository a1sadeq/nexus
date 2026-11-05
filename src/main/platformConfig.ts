// Pure policy helpers so platform behavior can be tested without launching Electron.
export function chromeCompatibleUserAgent(platform: string, arch: string, chromium: string): string {
  const os = platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : platform === 'linux' ? (arch === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64')
      : 'Macintosh; Intel Mac OS X 10_15_7'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromium} Safari/537.36`
}

export function windowChrome(platform: string) {
  if (platform === 'win32') return {
    frame: true,
    titleBarStyle: 'hidden' as const,
    titleBarOverlay: { color: '#11151e', symbolColor: '#e9edf4', height: 36 }
  }
  if (platform === 'darwin') return { frame: false, titleBarStyle: 'hidden' as const }
  return { frame: true }
}

export function linuxDisplaySwitches(platform: string): ReadonlyArray<readonly [string, string?]> {
  return platform === 'linux'
    ? [['ozone-platform-hint', 'auto'], ['enable-wayland-ime'], ['wayland-text-input-version', '3']]
    : []
}
