// src/main/bootstrap.ts
// MUST be the very first import in src/main/index.ts (import order is load-bearing).
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// 1. Force lowercase app name to prevent ~/.config/Nexus creation
app.name = 'nexus'

// 2. Ensure userData directory exists before setPath (setPath throws if directory is missing)
const userData = join(app.getPath('appData'), 'nexus')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

// 3. Pin sessionData explicitly for Electron >= 34 so Chromium session storage follows userData
try {
  app.setPath('sessionData', userData)
} catch {
  // Graceful fallback for older Electron versions where sessionData is derived lazily
}

export {}
