import { describe, it, expect } from 'vitest'

import {
  OVERLAY_KEYS,
  describeOverlays,
  dismissibleOverlayKeys,
  isAnyOverlayOpen,
  isOverlayOpen,
  openOverlayKeys
} from './overlays'

describe('overlay list', () => {
  it('knows nothing is open by default', () => {
    expect(isAnyOverlayOpen({})).toBe(false)
    expect(openOverlayKeys({})).toEqual([])
    expect(describeOverlays({})).toBe('none')
  })

  it('counts an overlay whose flag is present but false as closed', () => {
    const flags = Object.fromEntries(OVERLAY_KEYS.map((key) => [key, false]))
    expect(isAnyOverlayOpen(flags)).toBe(false)
  })

  it('sees any single overlay, including the switcher and the upload dialog', () => {
    expect(isAnyOverlayOpen({ showSettings: true })).toBe(true)
    expect(isAnyOverlayOpen({ showContainerMenu: true })).toBe(true)
    expect(isOverlayOpen({ folderUploadData: true }, 'folderUploadData')).toBe(true)
    expect(describeOverlays({ showSettings: true, showContainerMenu: true })).toBe(
      'showSettings, showContainerMenu'
    )
  })

  it('offers every open overlay to Escape except the boot sequence', () => {
    const flags = { showBootSequence: true, showSettings: true, showContainerMenu: true }
    expect(dismissibleOverlayKeys(flags)).toEqual(['showSettings', 'showContainerMenu'])
    // The boot overlay still counts as an overlay, so the AI view stays hidden behind it.
    expect(isAnyOverlayOpen(flags)).toBe(true)
  })

  it('is the single list both answers come from, so a new panel cannot be half-added', () => {
    // Guards against the regression this module exists for: a panel that opens (so the native view is
    // hidden) but which Escape does not know about.
    for (const key of OVERLAY_KEYS) {
      if (key === 'showBootSequence') continue
      expect(dismissibleOverlayKeys({ [key]: true })).toEqual([key])
    }
  })
})
