import { describe, expect, it } from 'vitest'
import { chromeCompatibleUserAgent, linuxDisplaySwitches, windowChrome } from './platformConfig'

describe('platform window and startup behavior', () => {
  it('uses native Windows caption buttons but preserves Linux and macOS frame behavior', () => {
    expect(windowChrome('win32')).toMatchObject({ frame: true, titleBarStyle: 'hidden', titleBarOverlay: { height: 36 } })
    expect(windowChrome('linux')).toEqual({ frame: true })
    expect(windowChrome('darwin')).toEqual({ frame: false, titleBarStyle: 'hidden' })
  })
  it('scopes Wayland flags to Linux and never forces a GPU blocklist bypass', () => {
    expect(linuxDisplaySwitches('win32')).toEqual([])
    expect(linuxDisplaySwitches('darwin')).toEqual([])
    expect(linuxDisplaySwitches('linux').map(([name]) => name)).toEqual(['ozone-platform-hint', 'enable-wayland-ime', 'wayland-text-input-version'])
    expect(linuxDisplaySwitches('linux').map(([name]) => name)).not.toContain('ignore-gpu-blocklist')
  })
  it('reports the correct supported platform and runtime Chromium version', () => {
    expect(chromeCompatibleUserAgent('win32', 'x64', '150.0.0.1')).toContain('(Windows NT 10.0; Win64; x64)')
    expect(chromeCompatibleUserAgent('linux', 'arm64', '150.0.0.1')).toContain('(X11; Linux aarch64)')
    expect(chromeCompatibleUserAgent('linux', 'x64', '150.0.0.1')).toContain('Chrome/150.0.0.1')
    expect(chromeCompatibleUserAgent('darwin', 'arm64', '150.0.0.1')).toContain('Macintosh')
  })
})
