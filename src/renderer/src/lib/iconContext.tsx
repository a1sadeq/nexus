import React, { createContext, useContext, useMemo } from 'react'

export type IconPack = 'lucide-line' | 'cyber-hud' | 'duotone-glow' | 'solid-silhouette' | 'retro-monoline'
export type IconStrokeWeight = 'thin' | 'standard' | 'bold'

export interface IconConfig {
  iconPack: IconPack
  strokeWeight: IconStrokeWeight
  glowEffect: boolean
  strokeWidth: number
}

const DEFAULT_ICON_CONFIG: IconConfig = {
  iconPack: 'lucide-line',
  strokeWeight: 'standard',
  glowEffect: false,
  strokeWidth: 1.75
}

export const IconConfigContext = createContext<IconConfig>(DEFAULT_ICON_CONFIG)

export function useIconConfig(): IconConfig {
  return useContext(IconConfigContext)
}

interface ProviderProps {
  iconPack?: IconPack
  strokeWeight?: IconStrokeWeight
  glowEffect?: boolean
  children: React.ReactNode
}

export function IconConfigProvider({
  iconPack = 'lucide-line',
  strokeWeight = 'standard',
  glowEffect = false,
  children
}: ProviderProps) {
  const strokeWidth = useMemo(() => {
    switch (strokeWeight) {
      case 'thin':
        return 1.25
      case 'bold':
        return 2.5
      case 'standard':
      default:
        return 1.75
    }
  }, [strokeWeight])

  const value = useMemo(
    () => ({
      iconPack,
      strokeWeight,
      glowEffect,
      strokeWidth
    }),
    [iconPack, strokeWeight, glowEffect, strokeWidth]
  )

  return <IconConfigContext.Provider value={value}>{children}</IconConfigContext.Provider>
}
