// @vitest-environment jsdom
import * as React from 'react'
const { act } = React
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderUploadModal } from './FolderUploadModal'
import type { FolderScanResult } from '../../../shared/folderUpload'

const scan: FolderScanResult = {
  folderPath: '/project',
  folderName: 'project',
  totalFiles: 1,
  totalBytes: 3,
  files: [
    {
      path: '/project/a.txt',
      relativePath: 'a.txt',
      size: 3,
      extension: '.txt',
      isSuggestedRemoval: false
    }
  ]
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>).electron
})
describe('folder upload modal lifecycle', () => {
  it('opens, closes, and reopens without changing hook order', async () => {
    const error = vi.spyOn(console, 'error')
    const onClose = vi.fn(),
      onConfirm = vi.fn()
    const render = async (open: boolean): Promise<void> =>
      act(async () => {
        root.render(
          <FolderUploadModal
            isOpen={open}
            data={open ? scan : null}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        )
      })
    await render(false)
    expect(container.textContent).toBe('')
    await render(true)
    expect(container.textContent).toContain('a.txt')
    await render(false)
    expect(container.textContent).toBe('')
    await render(true)
    expect(container.textContent).toContain('a.txt')
    expect(error).not.toHaveBeenCalled()
  })
})

describe('partition request races', () => {
  it('ignores an old rejection and keeps the latest request loading until it completes', async () => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
    const invoke = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { on: () => () => {}, invoke } }
    })
    const error = vi.spyOn(console, 'error')
    await act(async () =>
      root.render(<FolderUploadModal isOpen data={scan} onClose={() => {}} onConfirm={() => {}} />)
    )
    const click = async (text: string): Promise<void> => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === text
      )
      expect(button).toBeTruthy()
      await act(async () => button!.click())
    }
    await click('Chunks & Parts')
    expect(pending).toHaveLength(1)
    await click('5 MB')
    expect(pending).toHaveLength(2)
    await act(async () => pending[0].reject(new Error('old request failed')))
    expect(container.textContent).toContain('Computing optimal chunks')
    expect(error).not.toHaveBeenCalled()
    const result = {
      chunks: [{ index: 1, totalChunks: 1, byteSize: 3, fileCount: 1, files: [], content: 'abc' }],
      totalBytes: 3,
      totalFiles: 1,
      originalBytes: 3,
      savedBytes: 0,
      reductionPercent: 0
    }
    await act(async () => pending[1].resolve(result))
    expect(container.textContent).toContain('Part 1 of 1')
    expect(container.textContent).not.toContain('Computing optimal chunks')
  })
  it('invalidates an in-flight request when the drawer closes and ignores a late success', async () => {
    let resolve!: (value: unknown) => void
    const invoke = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { on: () => () => {}, invoke } }
    })
    await act(async () =>
      root.render(<FolderUploadModal isOpen data={scan} onClose={() => {}} onConfirm={() => {}} />)
    )
    const open = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Chunks & Parts'
    )!
    await act(async () => open.click())
    const close = container.querySelector<HTMLButtonElement>('button[title="Close drawer"]')!
    await act(async () => close.click())
    await act(async () =>
      resolve({
        chunks: [
          { index: 1, totalChunks: 1, byteSize: 3, fileCount: 1, files: [], content: 'abc' }
        ],
        totalBytes: 3,
        totalFiles: 1,
        originalBytes: 3,
        savedBytes: 0,
        reductionPercent: 0
      })
    )
    await act(async () => open.click())
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Computing optimal chunks')
    expect(container.textContent).not.toContain('Part 1 of 1')
  })
})
