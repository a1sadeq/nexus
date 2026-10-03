export interface SkillVariable {
  name: string
  label?: string
  type: 'input' | 'file' | 'clipboard' | 'command'
  defaultValue?: string
  placeholder?: string
}

export interface SkillDef {
  id: string
  name: string
  description: string
  category: string
  type: 'base' | 'action'
  command: string
  autoSend?: boolean
  variables?: SkillVariable[]
  content: string
  filePath?: string
  isBuiltIn?: boolean
  usageCount?: number
  isPinned?: boolean
}

export interface NexusSkills {
  list: () => Promise<SkillDef[]>
  save: (skill: SkillDef) => Promise<{ success: boolean; filePath?: string; error?: string }>
  delete: (skillId: string) => Promise<{ success: boolean; error?: string }>
  readFile: (
    filePath: string,
    projectDir?: string
  ) => Promise<{ success: boolean; content?: string; error?: string }>
  executeCommand: (
    command: string,
    projectDir?: string,
    requireSecurityCheck?: boolean
  ) => Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string; needsApproval?: boolean }>
  scanProjectFiles: (projectDir: string) => Promise<string[]>
  chooseProjectDir: () => Promise<string | null>
  getSkillsDir: () => Promise<string>
  openSkillsDir: () => Promise<boolean>
  getSafeCommands: () => Promise<string[]>
  addSafeCommand: (cmd: string) => Promise<boolean>
  removeSafeCommand: (cmd: string) => Promise<boolean>
  injectPrompt: (tabId: string, promptText: string, autoSend?: boolean) => Promise<boolean>
  onUpdated?: (callback: () => void) => () => void
  incrementUsage: (skillId: string) => Promise<boolean>
  togglePin: (skillId: string) => Promise<boolean>
}
