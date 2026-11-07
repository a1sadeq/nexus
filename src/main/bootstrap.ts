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

// 4. Bound Chromium cache and V8 heap early to prevent memory-mapped disk bloat
if (app.commandLine?.appendSwitch) {
  // Limit HTTP disk cache to 100MB (104857600 bytes)
  app.commandLine.appendSwitch('disk-cache-size', '104857600')
  // Limit media cache to 50MB (52428800 bytes)
  app.commandLine.appendSwitch('media-cache-size', '52428800')
  // Cap renderer V8 heap to 512MB to trigger timely GC
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512')
  // Consolidate duplicate renderer processes
  app.commandLine.appendSwitch('process-per-site')
}

export {}
