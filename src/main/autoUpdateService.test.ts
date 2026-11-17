import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { AutoUpdateService, type UpdateEngine } from './autoUpdateService'
import { supportsAutomaticUpdates } from './autoUpdatePlatform'

class FakeEngine extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn(async () => {})
  quitAndInstall = vi.fn()
}

function fixture() {
  const engine = new FakeEngine()
  const publish = vi.fn()
  const prepareInstall = vi.fn(async () => undefined)
  const installFailed = vi.fn()
  const notifyRestart = vi.fn()
  const service = new AutoUpdateService({ engine: engine as UpdateEngine, version: '1.0.7', publish, prepareInstall, installFailed, notifyRestart })
  return { engine, service, publish, prepareInstall, installFailed, notifyRestart }
}

afterEach(() => { vi.useRealTimers() })

describe('automatic updater', () => {
  it('only enables installed Windows and Linux AppImage formats', () => {
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'win32' })).toBe(true)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'win32', portableExecutable: 'x' })).toBe(false)
    expect(supportsAutomaticUpdates({ packaged: false, platform: 'win32' })).toBe(false)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'linux', appImage: '/a.AppImage' })).toBe(true)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'linux', appImage: '/a.AppImage', packageType: 'pacman' })).toBe(false)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'linux', snap: '/snap/a', appImage: '/a' })).toBe(false)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'linux', packageType: 'deb' })).toBe(false)
    expect(supportsAutomaticUpdates({ packaged: true, platform: 'darwin' })).toBe(false)
  })

  it('checks on startup, avoids overlapping checks and disallows prereleases and downgrades', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    expect(engine.autoDownload).toBe(true)
    expect(engine.allowPrerelease).toBe(false)
    expect(engine.allowDowngrade).toBe(false)
    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('does not start a second concurrent check', async () => {
    const { engine, service } = fixture()
    let resolve!: () => void
    engine.checkForUpdates.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const first = service.check()
    await service.check()
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
    resolve()
    await first
    service.stop()
  })

  it('flushes before installing and ignores duplicate downloaded events', async () => {
    const { engine, service, prepareInstall, notifyRestart } = fixture()
    engine.emit('update-downloaded')
    engine.emit('update-downloaded')
    await Promise.resolve()
    expect(prepareInstall).toHaveBeenCalledTimes(1)
    expect(notifyRestart).toHaveBeenCalledTimes(1)
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(prepareInstall.mock.invocationCallOrder[0]).toBeLessThan(engine.quitAndInstall.mock.invocationCallOrder[0])
    service.stop()
  })

  it('reports failures without claiming success and restores quit handling', async () => {
    const { engine, service, installFailed } = fixture()
    engine.emit('update-downloaded')
    await Promise.resolve()
    engine.emit('error', new Error('private path'))
    expect(service.getStatus().phase).toBe('error')
    expect(service.getStatus().message).not.toContain('private path')
    expect(installFailed).toHaveBeenCalledTimes(1)
    service.stop()
  })
})
