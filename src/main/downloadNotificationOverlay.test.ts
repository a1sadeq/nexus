import { describe, expect, it } from 'vitest'
import { downloadOverlayBounds } from './downloadNotificationOverlay'

describe('download overlay bounds', () => {
  it('places the complete stack at bottom-right', () => {
    expect(downloadOverlayBounds(1200,800,2)).toEqual({x:760,y:518,width:420,height:262})
  })
  it('clamps small-window dimensions and coordinates', () => {
    expect(downloadOverlayBounds(300,180,3)).toEqual({x:20,y:20,width:260,height:140})
  })
  it('uses zero bounds when hidden', () => {
    expect(downloadOverlayBounds(1200,800,0)).toEqual({x:760,y:780,width:420,height:0})
  })
})
