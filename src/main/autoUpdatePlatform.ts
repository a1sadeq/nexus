export function supportsAutomaticUpdates(options: {
  packaged: boolean
  platform: string
  appImage?: string
  snap?: string
  portableExecutable?: string
  packageType?: string
}): boolean {
  if (!options.packaged) return false
  if (options.platform === 'win32') return !options.portableExecutable
  if (options.platform !== 'linux' || options.snap) return false
  return Boolean(options.appImage) && !['deb', 'rpm', 'pacman'].includes((options.packageType || '').trim())
}
