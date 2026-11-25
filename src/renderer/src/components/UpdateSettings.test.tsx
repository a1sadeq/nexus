// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { UpdateSettings } from './UpdateSettings'
import type { UpdateStatus } from '../../../shared/updateStatus'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const READY: UpdateStatus = {
  phase: 'ready',
  currentVersion: '1.1.0',
  targetVersion: '1.2.0',
  percent: 100,
  message: 'Nexus 1.2.0 is ready. Restart to install it, or let it install when you quit.',
  lastCheckedAt: Date.now() - 60_000,
  autoInstallAt: Date.now() + 300_000
}

const DOWNLOADING: UpdateStatus = {
  phase: 'downloading',
  currentVersion: '1.1.0',
  targetVersion: '1.2.0',
  percent: 42,
  bytesPerSecond: 1024 * 1024 * 2,
  message: 'Downloading Nexus 1.2.0.'
}

function installFakeIpc(status: unknown) {
  const listeners: Array<(event: unknown, value: unknown) => void> = []
  const invoke = vi.fn((channel: string) => {
    if (channel === 'nexus-update-status') return Promise.resolve(status)
    return Promise.resolve(status)
  })
  ;(window as any).electron = {
    ipcRenderer: {
      on: (_channel: string, listener: (event: unknown, value: unknown) => void) => {
        listeners.push(listener)
        return () => undefined
      },
      invoke
    }
  }
  return { invoke, listeners }
}

let container: HTMLDivElement
let root: any

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as any).electron
})

async function render(status: unknown) {
  const fake = installFakeIpc(status)
  await act(async () => {
    root.render(<UpdateSettings />)
  })
  await act(async () => { await Promise.resolve() })
  return fake
}

const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text)) as
    | HTMLButtonElement
    | undefined

describe('UpdateSettings', () => {
  it('offers "Restart & install" and "Later" once an update is downloaded', async () => {
    const { invoke } = await render(READY)
    const install = button('Restart & install')
    const later = button('Later')
    expect(install).toBeTruthy()
    expect(install?.textContent).toContain('1.2.0')
    expect(later).toBeTruthy()
    // The old panel could only say "checking" — there was nothing to act on.
    expect(button('Check for updates')?.disabled).toBe(true)

    await act(async () => { install?.click() })
    expect(invoke).toHaveBeenCalledWith('nexus-update-install')

    await act(async () => { later?.click() })
    expect(invoke).toHaveBeenCalledWith('nexus-update-defer')
  })

  it('says that choosing Later keeps the update', async () => {
    await render(READY)
    expect(container.textContent).toContain('on any quit')
  })

  it('shows progress and speed while downloading, and cannot be re-checked', async () => {
    await render(DOWNLOADING)
    const progress = container.querySelector('progress') as HTMLProgressElement | null
    expect(progress?.getAttribute('value')).toBe('42')
    expect(container.textContent).toContain('42%')
    expect(container.textContent).toContain('2.0 MB/s')
    expect(button('Check for updates')?.disabled).toBe(true)
    expect(button('Restart & install')).toBeUndefined()
  })

  it('reports the schedule so "it never checks" is answerable', async () => {
    await render({
      phase: 'up-to-date',
      currentVersion: '1.2.0',
      message: 'Nexus is up to date.',
      lastCheckedAt: Date.now() - 5 * 60_000,
      nextCheckAt: Date.now() + 10 * 60_000
    })
    expect(container.textContent).toContain('Checked ')
    expect(container.textContent).toContain('next ')
    expect(button('Check for updates')?.disabled).toBe(false)
  })

  it('renders a status pushed from the main process', async () => {
    const { listeners } = await render({ phase: 'checking', currentVersion: '1.2.0', message: 'Checking for updates.' })
    await act(async () => {
      listeners.forEach((listener) => listener({}, READY))
    })
    expect(button('Restart & install')).toBeTruthy()
  })
})
