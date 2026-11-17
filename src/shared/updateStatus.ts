export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'downloading' | 'installing' | 'up-to-date' | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  targetVersion?: string
  percent?: number
  message: string
}
