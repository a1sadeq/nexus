import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { AutoUpdateService, type UpdateEngine } from './autoUpdateService'
import { supportsAutomaticUpdates } from './autoUpdatePlatform'
import { UPDATE_CADENCE, intervalDelayMs, jittered, retryDelayMs } from './updateCadence'

class FakeEngine extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn(async () => {})
  quitAndInstall = vi.fn()
}

/** No jitter, so a timer test can reason about exact milliseconds. */
const noJitter = () => 0.5

function fixture(overrides: { version?: string } = {}) {
  const engine = new FakeEngine()
  const publish = vi.fn()
  const prepareInstall = vi.fn(async () => undefined)
  const installFailed = vi.fn()
  const notifyRestart = vi.fn()
  const notifyReady = vi.fn()
  const service = new AutoUpdateService({
    engine: engine as UpdateEngine,
    version: overrides.version ?? '1.0.7',
    publish,
    prepareInstall,
    installFailed,
    notifyRestart,
    notifyReady,
    random: noJitter
  })
  return { engine, service, publish, prepareInstall, installFailed, notifyRestart, notifyReady }
}

afterEach(() => {
  vi.useRealTimers()
})

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

  it('checks soon after launch, then on the steady cadence, without overlapping', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    expect(engine.autoDownload).toBe(true)
    expect(engine.autoInstallOnAppQuit).toBe(true)
    expect(engine.allowPrerelease).toBe(false)
    expect(engine.allowDowngrade).toBe(false)

    service.start()
    service.start()
    expect(engine.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.firstCheckDelayMs)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(intervalDelayMs(noJitter))
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(intervalDelayMs(noJitter))
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(3)
    service.stop()
  })

  it('reports when it last checked and when it will check again', async () => {
    vi.useFakeTimers()
    const { service } = fixture()
    service.start()
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.firstCheckDelayMs)
    const status = service.getStatus()
    expect(status.phase).toBe('up-to-date')
    expect(typeof status.lastCheckedAt).toBe('number')
    expect(status.nextCheckAt).toBeGreaterThan(status.lastCheckedAt as number)
    expect(status.message).not.toContain('https://')
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

  it('retries with backoff after a failure instead of waiting for the next interval', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    engine.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    service.start()
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.firstCheckDelayMs)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getStatus().phase).toBe('error')
    expect(service.getStatus().message).not.toContain('offline')

    // Five minutes, not fifteen: an update is not worth losing a day over one lost packet.
    await vi.advanceTimersByTimeAsync(retryDelayMs(1, noJitter))
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('a manual check ignores the schedule and a past failure', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    engine.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    service.start()
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.firstCheckDelayMs)
    expect(service.getStatus().phase).toBe('error')

    await service.check()
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(service.getStatus().phase).toBe('up-to-date')
    service.stop()
  })

  it('a nudge checks once, and not again inside the throttle', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    service.start()
    service.nudge('the machine woke up')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)

    service.nudge('the window gained focus')
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.nudgeThrottleMs)
    // Throttled: a user alt-tabbing between windows is not a reason to talk to GitHub again.
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)

    // The steady cadence is untouched by any of that, and is what fires next.
    await vi.advanceTimersByTimeAsync(intervalDelayMs(noJitter))
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('a downloaded update waits, is announced, and then installs itself', async () => {
    vi.useFakeTimers()
    const { engine, service, publish, prepareInstall, notifyRestart, notifyReady } = fixture()

    engine.emit('update-available', { version: '1.1.0' })
    engine.emit('download-progress', { percent: 40, bytesPerSecond: 2_048_000 })
    expect(service.getStatus().phase).toBe('downloading')
    expect(service.getStatus().percent).toBe(40)
    expect(service.getStatus().bytesPerSecond).toBe(2_048_000)

    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    expect(service.getStatus().phase).toBe('ready')
    expect(service.getStatus().targetVersion).toBe('1.1.0')
    expect(notifyReady).toHaveBeenCalledTimes(1)
    // Not the old behaviour: a finished download used to quit the app immediately.
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.autoInstallDelayMs)
    expect(prepareInstall).toHaveBeenCalledTimes(1)
    expect(notifyRestart).toHaveBeenCalledTimes(1)
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(prepareInstall.mock.invocationCallOrder[0]).toBeLessThan(
      engine.quitAndInstall.mock.invocationCallOrder[0]
    )
    service.stop()
  })

  it('ignores duplicate downloaded events', async () => {
    vi.useFakeTimers()
    const { engine, service, notifyReady } = fixture()
    engine.emit('update-downloaded', { version: '1.1.0' })
    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    expect(notifyReady).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.autoInstallDelayMs)
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('"Later" pushes the restart out but keeps the update for the next quit', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    service.defer()
    const deferred = service.getStatus()
    expect(deferred.phase).toBe('ready')
    expect(deferred.deferred).toBe(true)
    expect(deferred.message).toContain('quit')

    // The five-minute timer is gone; the deferred hour is what remains.
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.autoInstallDelayMs)
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.deferMs)
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('"Restart and install" from Settings installs straight away', async () => {
    const { engine, service } = fixture()
    service.installNow()
    // Nothing downloaded yet: the request is refused, not queued into a surprise restart.
    expect(engine.quitAndInstall).not.toHaveBeenCalled()

    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    service.installNow()
    await Promise.resolve()
    await Promise.resolve()
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('reports failures without claiming success and restores quit handling', async () => {
    const { engine, service, installFailed } = fixture()
    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    service.installNow()
    await Promise.resolve()
    engine.emit('error', new Error('private path'))
    expect(service.getStatus().phase).toBe('error')
    expect(service.getStatus().message).not.toContain('private path')
    expect(installFailed).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('stops everything when the app quits', async () => {
    vi.useFakeTimers()
    const { engine, service } = fixture()
    service.start()
    engine.emit('update-downloaded', { version: '1.1.0' })
    await Promise.resolve()
    service.stop()
    await vi.advanceTimersByTimeAsync(UPDATE_CADENCE.autoInstallDelayMs * 3)
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    expect(engine.listenerCount('update-downloaded')).toBe(0)
  })
})

describe('the cadence', () => {
  it('jitters without ever going negative or outside the band', () => {
    expect(jittered(60_000, () => 0.5)).toBe(60_000)
    expect(jittered(60_000, () => 0)).toBe(55_200)
    expect(jittered(60_000, () => 1)).toBe(64_800)
    expect(jittered(0, () => 0.5)).toBe(0)
    expect(jittered(Number.NaN, () => 0.5)).toBe(0)
    // A hostile random cannot produce a negative delay.
    expect(jittered(10_000, () => -5)).toBeGreaterThanOrEqual(1_000)
  })

  it('backs off five, ten, twenty, forty, then holds at an hour', () => {
    expect(retryDelayMs(1, noJitter)).toBe(UPDATE_CADENCE.retryBaseMs)
    expect(retryDelayMs(2, noJitter)).toBe(UPDATE_CADENCE.retryBaseMs * 2)
    expect(retryDelayMs(3, noJitter)).toBe(UPDATE_CADENCE.retryBaseMs * 4)
    expect(retryDelayMs(4, noJitter)).toBe(UPDATE_CADENCE.retryBaseMs * 8)
    expect(retryDelayMs(5, noJitter)).toBe(UPDATE_CADENCE.retryMaxMs)
    expect(retryDelayMs(99, noJitter)).toBe(UPDATE_CADENCE.retryMaxMs)
    // A nonsense count is the first retry, not a zero delay that turns into a request loop.
    expect(retryDelayMs(0, noJitter)).toBe(UPDATE_CADENCE.retryBaseMs)
  })

  it('checks every quarter of an hour, not every six', () => {
    expect(UPDATE_CADENCE.checkIntervalMs).toBe(15 * 60_000)
    expect(intervalDelayMs(noJitter)).toBe(15 * 60_000)
    expect(UPDATE_CADENCE.firstCheckDelayMs).toBeLessThanOrEqual(15_000)
  })
})
