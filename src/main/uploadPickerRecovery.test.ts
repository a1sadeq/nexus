import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) }
}))

const {
  handleFilesUpload,
  handleFolderUpload,
  isUploadPickerBusy,
  recoverAbandonedPicker,
  releaseUploadPicker,
  withTimeout,
  buildSelectionScanResult
} = await import('./uploadManager')

function makeWindow(sent: unknown[] = [], focused = true): unknown {
  return {
    isDestroyed: () => false,
    isFocused: () => focused,
    isMinimized: () => false,
    isVisible: () => true,
    show: () => undefined,
    focus: () => undefined,
    restore: () => undefined,
    webContents: { send: (_channel: string, payload: unknown) => sent.push(payload) }
  }
}

function makeView(toasts: string[] = []): unknown {
  return {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async (script: string) => {
        const match = /t\.textContent = (".*?");/.exec(script)
        if (match) toasts.push(JSON.parse(match[1]))
        return undefined
      }
    }
  }
}

beforeEach(() => {
  showOpenDialog.mockReset()
  releaseUploadPicker()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('upload picker lock', () => {
  it('recovers from a native dialog that never settles instead of wedging uploads', async () => {
    vi.useFakeTimers()
    // The reported symptom: picker opens, promise never resolves.
    showOpenDialog.mockImplementation(() => new Promise(() => {}))
    const view = makeView()
    const window = makeWindow()

    void handleFilesUpload(view as never, window as never)
    await vi.advanceTimersByTimeAsync(10)
    expect(isUploadPickerBusy()).toBe(true)
    // A second attempt while a dialog is genuinely open must not stack dialogs.
    await handleFilesUpload(view as never, window as never)
    expect(showOpenDialog).toHaveBeenCalledTimes(1)

    // The picker watchdog fires: the lock is released without a restart.
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(isUploadPickerBusy()).toBe(false)

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handleFilesUpload(view as never, window as never)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('releases the lock after a failed dialog so the next attempt still works', async () => {
    vi.useFakeTimers()
    showOpenDialog.mockRejectedValueOnce(new Error('dialog crashed'))
    const view = makeView()
    const window = makeWindow()

    await handleFilesUpload(view as never, window as never)
    expect(isUploadPickerBusy()).toBe(false)
    // Past the 600ms double-open cooldown.
    await vi.advanceTimersByTimeAsync(1000)

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handleFilesUpload(view as never, window as never)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('recovers instantly when the window has focus and takes the shortcut again', async () => {
    vi.useFakeTimers()
    // The reported symptom: the picker never appears, so BOTH shortcuts stay dead.
    showOpenDialog.mockImplementation(() => new Promise(() => {}))
    const view = makeView()
    const window = makeWindow()

    void handleFilesUpload(view as never, window as never)
    await vi.advanceTimersByTimeAsync(10)
    expect(isUploadPickerBusy()).toBe(true)

    // A focused window receiving the shortcut proves no visible dialog is in front of it.
    await vi.advanceTimersByTimeAsync(3000)
    expect(recoverAbandonedPicker(window)).toBe(true)
    expect(isUploadPickerBusy()).toBe(false)

    // Ctrl+Shift+O (folder) now works again without restarting.
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handleFolderUpload(view as never, window as never)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('does not steal a genuinely open dialog that just appeared', async () => {
    vi.useFakeTimers()
    showOpenDialog.mockImplementation(() => new Promise(() => {}))
    const view = makeView()
    const window = makeWindow()

    void handleFilesUpload(view as never, window as never)
    await vi.advanceTimersByTimeAsync(200)
    // Inside the grace window a double-tap must not open a second dialog.
    expect(recoverAbandonedPicker(window)).toBe(false)
    expect(isUploadPickerBusy()).toBe(true)
  })

  it('never recovers while the window is unfocused (a real dialog owns focus)', async () => {
    vi.useFakeTimers()
    showOpenDialog.mockImplementation(() => new Promise(() => {}))
    const view = makeView()
    const unfocused = makeWindow([], false)

    void handleFilesUpload(view as never, unfocused as never)
    await vi.advanceTimersByTimeAsync(5000)
    expect(recoverAbandonedPicker(unfocused)).toBe(false)
    expect(isUploadPickerBusy()).toBe(true)
  })

  it('applies the same recovery to the folder picker', async () => {
    vi.useFakeTimers()
    showOpenDialog.mockImplementation(() => new Promise(() => {}))
    const view = makeView()
    const window = makeWindow()

    void handleFolderUpload(view as never, window as never)
    await vi.advanceTimersByTimeAsync(10)
    expect(isUploadPickerBusy()).toBe(true)

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    expect(isUploadPickerBusy()).toBe(false)

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handleFolderUpload(view as never, window as never)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })
})

describe('Ctrl+O picker properties', () => {
  it('uses a files-only multi-select picker', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handleFilesUpload(makeView() as never, makeWindow() as never)
    const options = showOpenDialog.mock.calls[0][1] as { properties: string[] }
    // openFile + openDirectory cannot be combined in one native dialog on Linux/Windows.
    expect(options.properties).toEqual(['openFile', 'multiSelections'])
    expect(options.properties).not.toContain('openDirectory')
  })
})

describe('withTimeout', () => {
  it('rejects instead of hanging forever', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'Attachment dispatch')).rejects.toThrow(
      /Attachment dispatch timed out/
    )
  })

  it('passes through a resolved value', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok')
  })
})

describe('buildSelectionScanResult', () => {
  it('builds review data for several files picked at once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pick-test-'))
    try {
      const a = path.join(dir, 'alpha.ts')
      const b = path.join(dir, 'beta.ts')
      fs.writeFileSync(a, 'export const a = 1\n')
      fs.writeFileSync(b, 'export const b = 2\n')

      const result = await buildSelectionScanResult([a, b])
      expect(result.totalFiles).toBe(2)
      expect(result.folderPath).toBe(dir)
      expect(result.files.map((f) => f.relativePath).sort()).toEqual(['alpha.ts', 'beta.ts'])
      expect(result.files.every((f) => !f.isSuggestedRemoval)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores paths that cannot be stat-ed instead of aborting the selection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pick-test-'))
    try {
      const good = path.join(dir, 'good.ts')
      fs.writeFileSync(good, 'const good = true\n')
      const result = await buildSelectionScanResult([path.join(dir, 'missing.ts'), good])
      expect(result.totalFiles).toBe(1)
      expect(result.files[0].relativePath).toBe('good.ts')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
