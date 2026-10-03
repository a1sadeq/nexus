// Skills Engine for Nexus: Manages SuperAntigravity skills, local file reading,
// command execution, project directory scoping, and dynamic variable templating.
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'

const execP = promisify(exec)

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

// Simple, zero-dependency YAML frontmatter parser and serializer
export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('---')) {
    return { meta: {}, content: raw }
  }

  const endIndex = trimmed.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { meta: {}, content: raw }
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const content = trimmed.slice(endIndex + 4).trim()
  const meta: Record<string, unknown> = {}

  let currentKey: string | null = null
  let currentList: unknown[] | null = null

  for (const line of yamlBlock.split('\n')) {
    const l = line.trimEnd()
    if (!l || l.trim().startsWith('#')) continue

    const listMatch = l.match(/^\s*-\s+(.*)$/)
    if (listMatch && currentKey && currentList) {
      const val = listMatch[1].trim().replace(/^["']|["']$/g, '')
      currentList.push(val)
      continue
    }

    const kvMatch = l.match(/^([\w_-]+)\s*:\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1].trim()
      const rawVal = kvMatch[2].trim()

      if (rawVal === '') {
        currentList = []
        meta[currentKey] = currentList
      } else if (rawVal === 'true') {
        meta[currentKey] = true
        currentList = null
      } else if (rawVal === 'false') {
        meta[currentKey] = false
        currentList = null
      } else if (!isNaN(Number(rawVal)) && rawVal !== '') {
        meta[currentKey] = Number(rawVal)
        currentList = null
      } else {
        meta[currentKey] = rawVal.replace(/^["']|["']$/g, '')
        currentList = null
      }
    }
  }

  return { meta, content }
}

export function serializeFrontmatter(meta: Record<string, unknown>, content: string): string {
  const lines: string[] = ['---']
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'boolean' || typeof v === 'number') {
      lines.push(`${k}: ${v}`)
    } else if (Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const item of v) {
        lines.push(`  - "${item}"`)
      }
    } else {
      lines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`)
    }
  }
  lines.push('---')
  lines.push('')
  lines.push(content.trim())
  return lines.join('\n')
}

// Bundled SuperAntigravity Skills
export const BUNDLED_SUPERANTIGRAVITY_SKILLS: SkillDef[] = [
  {
    id: 'superantigravity-mindset',
    name: 'SuperAntigravity Mindset & Directives',
    description: 'Top 1% reasoning protocols: high-impact focus, out-of-the-box attack vectors, and zero-assumption validation.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/mindset',
    autoSend: true,
    isBuiltIn: true,
    content: `# 🧠 SuperAntigravity Persona & Operational Directives

You are operating as an elite cybersecurity expert, top 1% bug bounty hunter, and world-class systems architect.

## Core Directives:
1. **Top 1% Mindset**:
   - Prioritize high-impact, actionable insights leading to significant system clarity or severe vulnerability discovery.
   - Challenge assumptions systematically. Continuously ask "What if?" to explore edge cases and unexpected interactions.
   - Synthesize knowledge across domains (e.g. chaining business logic flaws with client-side injection).
2. **Actionable & Evidence-Based**:
   - Never speculate without evidence. Provide clear, reproducible steps and concrete rationale.
   - Focus on practical reality rather than theoretical textbook models.
3. **Safe & Methodical**:
   - Validate inputs, trace root causes, and verify constraints before proposing actions.`
  },
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging',
    description: '4-phase root-cause diagnosis: observation, hypothesis, minimal experiment, and definitive verification.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/troubleshoot',
    autoSend: true,
    isBuiltIn: true,
    content: `# 🔍 Systematic Debugging Protocol

When diagnosing bugs, crashes, or unexpected behavior, follow this rigorous 4-phase protocol:

## Phase 1: Observation & Data Collection
- Formulate the exact failure mode. Distinguish what is observed vs what was expected.
- Collect relevant error logs, stack traces, and environment parameters.

## Phase 2: Hypothesis Generation
- Propose 2-3 distinct, testable hypotheses ranked by probability.
- Identify the exact code pathways or state transitions responsible.

## Phase 3: Minimal Targeted Experiment
- Isolate the minimal reproduction case.
- Test one variable at a time to definitively confirm or refute each hypothesis.

## Phase 4: Root-Cause Resolution & Verification
- Implement the fix targeting the root cause (not just suppressing symptoms).
- Verify edge cases, regressions, and side effects.`
  },
  {
    id: 'brainstorming',
    name: 'Deep Brainstorming',
    description: 'Requirements discovery, exploratory probing, and architectural alignment before writing code.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/brainstorm',
    autoSend: true,
    isBuiltIn: true,
    content: `# 💡 Deep Brainstorming & Requirements Discovery

Before jumping into implementation, explore requirements and design alternatives:

1. **Clarify Intent**: Probe ambiguous requirements by asking targeted, high-signal questions.
2. **Explore the Design Tree**: Map distinct architectural approaches with trade-offs (performance, complexity, cross-platform stability).
3. **Edge Case Analysis**: Identify boundary conditions, concurrency issues, and error paths early.
4. **Actionable Plan**: Synthesize decisions into a clear, modular roadmap.`
  },
  {
    id: 'security-review',
    name: 'Security Review & Bug Hunter',
    description: 'Offensive security review for IDOR, XSS, Auth Bypass, SSRF, and client-side vulnerabilities.',
    category: 'Security & Bug Bounty',
    type: 'action',
    command: '/security-review',
    autoSend: false,
    isBuiltIn: true,
    variables: [
      { name: 'target', label: 'Target Code or Endpoint', type: 'input', placeholder: 'Enter URL, endpoint, or function' },
      { name: 'code', label: 'Target Code / Request File', type: 'file', placeholder: 'Select source file or request data' }
    ],
    content: `# 🛡️ Offensive Security Review & Bug Hunting

Analyze the following target for critical security vulnerabilities:

**Target / Context**:
{{target}}

**Source / Data**:
\`\`\`
{{code}}
\`\`\`

## Analysis Checklist:
1. **Access Control & IDOR**: Check for missing authorization checks, parameter tampering, and predictable object IDs.
2. **Authentication & Session Logic**: Inspect token handling, session invalidation, and privilege escalation vectors.
3. **Injection & Input Handling**: Look for XSS, SQLi, SSRF, command injection, and improper sanitization.
4. **Client-Side Risks**: Unsafe DOM manipulation, exposed credentials, or client-side trust assumptions.
5. **Real-World Exploitability**: Provide step-by-step reproduction steps, proof-of-concept payload, and mitigation.`
  },
  {
    id: 'architecture-design',
    name: 'Architecture & System Design',
    description: 'Design modular systems, clean APIs, and robust cross-platform software architectures.',
    category: 'Architecture & Code',
    type: 'action',
    command: '/design',
    autoSend: false,
    isBuiltIn: true,
    variables: [
      { name: 'requirements', label: 'System Requirements / Feature Goal', type: 'input', placeholder: 'Describe the feature or system to architect' }
    ],
    content: `# 🏗️ System Architecture & API Design

Design a clean, modular, and maintainable architecture for:

**Requirements / Scope**:
{{requirements}}

## Architectural Focus:
1. **Component Hierarchy & Data Flow**: Define clean separation of concerns and unidirectional state management.
2. **API & Interface Contracts**: Provide typed interfaces, payload schemas, and error boundaries.
3. **Cross-Platform & Failure Modes**: Address platform differences (Linux/Windows/macOS) and fallback strategies.
4. **Implementation Plan**: Step-by-step execution roadmap.`
  },
  {
    id: 'confidence-check',
    name: 'Confidence Check',
    description: 'Pre-implementation readiness verification: eliminate assumptions and verify readiness.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/confidence-check',
    autoSend: true,
    isBuiltIn: true,
    content: `# 🎯 Confidence & Readiness Verification

Before executing complex code modifications, perform a confidence check:

1. **Assumption Audit**: Identify all implicit assumptions about system state, environment, or platform behavior.
2. **Contract Verification**: Confirm that all function signatures, types, and IPC channels match reality.
3. **Regression Risk**: Evaluate what existing functionality might be impacted by proposed changes.
4. **Rollback & Safety**: Ensure changes can be verified with automated unit tests.`
  },
  {
    id: 'deep-research',
    name: 'Deep Technical Research',
    description: 'Multi-source technical investigation, protocol analysis, and documentation synthesis.',
    category: 'Performance & Research',
    type: 'action',
    command: '/research',
    autoSend: false,
    isBuiltIn: true,
    variables: [
      { name: 'topic', label: 'Research Topic or Question', type: 'input', placeholder: 'Enter technical topic, API, or protocol' }
    ],
    content: `# 🔬 Deep Technical Research

Investigate and synthesize comprehensive technical findings for:

**Topic / Question**:
{{topic}}

## Investigation Structure:
1. **Core Mechanics & Protocols**: Explain the underlying mechanism in depth.
2. **Industry Standards & Best Practices**: Cite authoritative sources, specs, and real-world implementations.
3. **Edge Cases & Caveats**: Document known limitations, platform differences, and potential pitfalls.
4. **Concrete Examples**: Provide verified code snippets and configurations.`
  },
  {
    id: 'performance-optimization',
    name: 'Performance Optimization',
    description: 'Profile bottlenecks, optimize memory, eliminate layout thrashing, and reduce latency.',
    category: 'Performance & Research',
    type: 'action',
    command: '/performance',
    autoSend: false,
    isBuiltIn: true,
    variables: [
      { name: 'code', label: 'Code or Component to Optimize', type: 'file', placeholder: 'Select file to optimize' }
    ],
    content: `# ⚡ Performance Profiling & Optimization

Analyze and optimize the following component for peak performance:

\`\`\`
{{code}}
\`\`\`

## Optimization Goals:
1. **Computational Complexity**: Reduce redundant computations and O(N^2) bottlenecks.
2. **Memory & Allocations**: Eliminate memory leaks, excessive object creations, and uncollected event listeners.
3. **Rendering & I/O**: Optimize rendering passes, batch disk/network operations, and ensure non-blocking execution.`
  },
  {
    id: 'cleanup-refactoring',
    name: 'Code Quality & Refactoring',
    description: 'Remove dead code, improve type safety, enforce DRY principles, and ensure maintainability.',
    category: 'Architecture & Code',
    type: 'action',
    command: '/cleanup',
    autoSend: false,
    isBuiltIn: true,
    variables: [
      { name: 'code', label: 'Target Code File', type: 'file', placeholder: 'Select file to refactor' }
    ],
    content: `# 🧹 Code Cleanup & Quality Refactoring

Refactor the following code for maximum readability, maintainability, and type safety:

\`\`\`
{{code}}
\`\`\`

## Refactoring Guidelines:
1. **Eliminate Dead Code**: Remove unused variables, dead branches, and redundant comments.
2. **Enhance Type Safety**: Replace loose types with strict TypeScript interfaces and discriminators.
3. **Preserve Behavior**: Ensure 100% backward compatibility and test coverage.`
  }
]

export class SkillsEngine {
  private skillsDir: string

  constructor(customDir?: string) {
    if (customDir) {
      this.skillsDir = customDir
    } else {
      const userData = app?.getPath
        ? app.getPath('userData')
        : process.env.APPDATA
          ? path.join(process.env.APPDATA, 'nexus')
          : path.join(process.env.HOME || '.', '.config', 'nexus')
      this.skillsDir = path.join(userData, 'skills')
    }
    this.ensureSkillsDirectory()
    this.usagePath = path.join(this.skillsDir, 'skills-usage.json')
    this.pinnedPath = path.join(this.skillsDir, 'pinned-skills.json')
    this.pinnedCatsPath = path.join(this.skillsDir, 'pinned-categories.json')
    this.loadUsageAndPins()
    this.initWatcher()
  }

  private usagePath: string
  private pinnedPath: string
  private usageData: Record<string, number> = {}
  private pinnedData: Set<string> = new Set()
  private pinnedCatsPath: string
  private pinnedCatsData: Set<string> = new Set()

  private watcher: fs.FSWatcher | null = null
  private watcherDebounceTimer: NodeJS.Timeout | null = null
  private onSkillsChangedCallbacks: Array<() => void> = []

  public onSkillsChanged(callback: () => void): () => void {
    this.onSkillsChangedCallbacks.push(callback)
    return () => {
      this.onSkillsChangedCallbacks = this.onSkillsChangedCallbacks.filter((cb) => cb !== callback)
    }
  }

  private notifySkillsChanged(): void {
    for (const cb of this.onSkillsChangedCallbacks) {
      try {
        cb()
      } catch (e) {
        console.error('[SkillsEngine] Watcher callback error:', e)
      }
    }
  }

  private initWatcher(): void {
    if (this.watcher) return
    
    const os = require('os')
    const geminiDir = path.join(os.homedir(), '.gemini')
    const globalSkillsDir = path.join(geminiDir, 'antigravity', 'skills')
    const pluginsDir = path.join(geminiDir, 'config', 'plugins')

    const watchHandler = (_eventType: string, filename: string | null) => {
      if (!filename || filename.endsWith('.md') || filename.includes('SKILL.md')) {
        if (this.watcherDebounceTimer) clearTimeout(this.watcherDebounceTimer)
        this.watcherDebounceTimer = setTimeout(() => {
          this.notifySkillsChanged()
        }, 150)
      }
    }

    try {
      if (fs.existsSync(this.skillsDir)) {
        this.watcher = fs.watch(this.skillsDir, { recursive: true }, watchHandler)
      }
      if (fs.existsSync(globalSkillsDir)) {
        // @ts-ignore
        this.globalWatcher = fs.watch(globalSkillsDir, { recursive: true }, watchHandler)
      }
      if (fs.existsSync(pluginsDir)) {
        // @ts-ignore
        this.pluginsWatcher = fs.watch(pluginsDir, { recursive: true }, watchHandler)
      }
    } catch (err) {
      console.warn('[SkillsEngine] Could not initialize directory watchers:', err)
    }
  }

  public getSkillsDirectory(): string {
    return this.skillsDir
  }

  private ensureSkillsDirectory(): void {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true })
      }
      // Migrate from legacy ~/.config/vicinae/skills if present
      const legacySkillsDir = path.join(
        app?.getPath ? app.getPath('appData') : path.join(process.env.HOME || '.', '.config'),
        'vicinae',
        'skills'
      )
      if (fs.existsSync(legacySkillsDir)) {
        try {
          const files = fs.readdirSync(legacySkillsDir)
          for (const f of files) {
            const src = path.join(legacySkillsDir, f)
            const dest = path.join(this.skillsDir, f)
            if (!fs.existsSync(dest)) {
              fs.copyFileSync(src, dest)
            }
          }
        } catch (e) {
          console.error('[SkillsEngine] Legacy skills migration error:', e)
        }
      }
      this.initDefaultSkills()
    } catch (err) {
      console.error('[SkillsEngine] Failed to initialize skills directory:', err)
    }
  }

  private initDefaultSkills(): void {
    for (const skill of BUNDLED_SUPERANTIGRAVITY_SKILLS) {
      const fileName = `${skill.id}.md`
      const targetPath = path.join(this.skillsDir, fileName)
      if (!fs.existsSync(targetPath)) {
        try {
          const frontmatter: Record<string, unknown> = {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            category: skill.category,
            type: skill.type,
            command: skill.command,
            autoSend: skill.autoSend ?? false,
            isBuiltIn: true
          }
          if (skill.variables && skill.variables.length > 0) {
            frontmatter.variables = skill.variables.map((v) => v.name)
          }
          const content = serializeFrontmatter(frontmatter, skill.content)
          fs.writeFileSync(targetPath, content, 'utf8')
        } catch (err) {
          console.warn(`[SkillsEngine] Failed to write default skill ${skill.id}:`, err)
        }
      }
    }
  }

  private loadUsageAndPins(): void {
    try {
      if (fs.existsSync(this.usagePath)) {
        this.usageData = JSON.parse(fs.readFileSync(this.usagePath, 'utf8'))
      }
      if (fs.existsSync(this.pinnedPath)) {
        const arr = JSON.parse(fs.readFileSync(this.pinnedPath, 'utf8'))
        if (Array.isArray(arr)) this.pinnedData = new Set(arr)
      }
      if (fs.existsSync(this.pinnedCatsPath)) {
        const arr2 = JSON.parse(fs.readFileSync(this.pinnedCatsPath, 'utf8'))
        if (Array.isArray(arr2)) this.pinnedCatsData = new Set(arr2)
      }
    } catch (e) {
      console.warn('[SkillsEngine] Failed to load usage/pins:', e)
    }
  }

  private saveUsageAndPins(): void {
    try {
      fs.writeFileSync(this.usagePath, JSON.stringify(this.usageData))
      fs.writeFileSync(this.pinnedPath, JSON.stringify(Array.from(this.pinnedData)))
      fs.writeFileSync(this.pinnedCatsPath, JSON.stringify(Array.from(this.pinnedCatsData)))
    } catch (e) {
      console.warn('[SkillsEngine] Failed to save usage/pins:', e)
    }
  }

  public incrementUsage(skillId: string): boolean {
    this.usageData[skillId] = (this.usageData[skillId] || 0) + 1
    this.saveUsageAndPins()
    this.notifySkillsChanged()
    return true
  }

  public togglePin(skillId: string): boolean {
    if (this.pinnedData.has(skillId)) {
      this.pinnedData.delete(skillId)
    } else {
      this.pinnedData.add(skillId)
    }
    this.saveUsageAndPins()
    this.notifySkillsChanged()
    return true
  }

  public getPinnedCategories(): string[] {
    return Array.from(this.pinnedCatsData)
  }
  
  public async toggleCategoryPin(category: string): Promise<void> {
    if (this.pinnedCatsData.has(category)) {
      this.pinnedCatsData.delete(category)
    } else {
      this.pinnedCatsData.add(category)
    }
    const fs = require('fs')
    fs.writeFileSync(this.pinnedCatsPath, JSON.stringify(Array.from(this.pinnedCatsData), null, 2), 'utf8')
    this.notifySkillsChanged()
  }
  
  public async renameCategory(oldName: string, newName: string): Promise<void> {
    let changed = false
    const fs = require('fs')
    const skills = this.listSkills()
    for (const skill of skills) {
      if (skill.category === oldName && skill.filePath) {
        try {
          let c = fs.readFileSync(skill.filePath, 'utf8')
          c = c.replace(new RegExp(`category:\s*['"]?${oldName}['"]?`), `category: "${newName}"`)
          fs.writeFileSync(skill.filePath, c, 'utf8')
          changed = true
        } catch (e) {}
      }
    }
    if (this.pinnedCatsData.has(oldName)) {
      this.pinnedCatsData.delete(oldName)
      this.pinnedCatsData.add(newName)
      fs.writeFileSync(this.pinnedCatsPath, JSON.stringify(Array.from(this.pinnedCatsData), null, 2), 'utf8')
      changed = true
    }
    if (changed) this.notifySkillsChanged()
  }
  
  public async deleteCategory(category: string): Promise<void> {
    let changed = false
    const fs = require('fs')
    const skills = this.listSkills()
    for (const skill of skills) {
      if (skill.category === category && skill.filePath) {
        try {
          let c = fs.readFileSync(skill.filePath, 'utf8')
          c = c.replace(new RegExp(`category:\s*['"]?${category}['"]?\r?\n`), '')
          fs.writeFileSync(skill.filePath, c, 'utf8')
          changed = true
        } catch (e) {}
      }
    }
    if (this.pinnedCatsData.has(category)) {
      this.pinnedCatsData.delete(category)
      fs.writeFileSync(this.pinnedCatsPath, JSON.stringify(Array.from(this.pinnedCatsData), null, 2), 'utf8')
      changed = true
    }
    if (changed) this.notifySkillsChanged()
  }
  
  public async assignSkillsToCategory(category: string, skillIds: string[]): Promise<void> {
    let changed = false
    const fs = require('fs')
    const skills = this.listSkills()
    
    for (const skill of skills) {
      if (skill.category === category && !skillIds.includes(skill.id) && skill.filePath) {
        try {
          let c = fs.readFileSync(skill.filePath, 'utf8')
          c = c.replace(new RegExp(`category:\s*['"]?${category}['"]?\r?\n`), '')
          fs.writeFileSync(skill.filePath, c, 'utf8')
          changed = true
        } catch(e) {}
      }
    }
    
    for (const skill of skills) {
      if (skillIds.includes(skill.id) && skill.filePath) {
        if (skill.category !== category) {
          try {
            let c = fs.readFileSync(skill.filePath, 'utf8')
            if (c.includes('category:')) {
              c = c.replace(/category:.*\n/, `category: "${category}"\n`)
            } else {
              c = c.replace(/description:.*\n/, `$&category: "${category}"\n`)
            }
            fs.writeFileSync(skill.filePath, c, 'utf8')
            changed = true
          } catch(e) {}
        }
      }
    }
    if (changed) this.notifySkillsChanged()
  }

  public listSkills(): SkillDef[] {
    const skills: SkillDef[] = []
    const seenIds = new Set<string>()

    // 1. Scan filesystem directories for .md and */SKILL.md

    const os = require('os')
    const geminiDir = path.join(os.homedir(), '.gemini')
    const globalSkillsDir = path.join(geminiDir, 'antigravity', 'skills')
    const pluginsDir = path.join(geminiDir, 'config', 'plugins')

    // Array of { dir, defaultCategory }
    const dirsToScan: Array<{dir: string, defaultCategory: string}> = [
      { dir: this.skillsDir, defaultCategory: 'Local Nexus Skills' },
      { dir: globalSkillsDir, defaultCategory: 'SuperAntigravity Global' }
    ]

    if (fs.existsSync(pluginsDir)) {
      try {
        const plugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
        for (const p of plugins) {
          if (p.isDirectory()) {
            const pSkillsDir = path.join(pluginsDir, p.name, 'skills')
            if (fs.existsSync(pSkillsDir)) {
              dirsToScan.push({ dir: pSkillsDir, defaultCategory: p.name })
            }
          }
        }
      } catch (e) {}
    }

    for (const scanTarget of dirsToScan) {
      const { dir, defaultCategory } = scanTarget
      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            let targetFilePath: string | null = null
            let isFolderSkill = false

            if (entry.isFile() && entry.name.endsWith('.md')) {
              targetFilePath = path.join(dir, entry.name)
            } else if (entry.isDirectory()) {
              const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
              if (fs.existsSync(skillMdPath)) {
                targetFilePath = skillMdPath
                isFolderSkill = true
              }
            }

            if (targetFilePath && fs.existsSync(targetFilePath)) {
              try {
                const raw = fs.readFileSync(targetFilePath, 'utf8')
                const { meta, content } = parseFrontmatter(raw)
                const fallbackId = isFolderSkill ? entry.name : path.basename(entry.name, '.md')
                const id = String(meta.id || fallbackId)
                
                // Skip if we already saw this ID (gives priority to local skills over global)
                if (seenIds.has(id)) continue

                const name = String(meta.name || id)
                const description = String(meta.description || '')
                const category = String(meta.category || defaultCategory)
                const usageCount = this.usageData[id] || 0
                const isPinned = this.pinnedData.has(id)
                const type = (meta.type === 'base' ? 'base' : 'action') as 'base' | 'action'
                const command = String(meta.command || `/${id}`)
                const autoSend = Boolean(meta.autoSend)
                const isBuiltIn = Boolean(meta.isBuiltIn)

                // Parse variables
                const variables: SkillVariable[] = []
                // Extract variables from markdown tokens {{name}}
                const tokenMatches = content.matchAll(/\{\{([\w_-]+)(?::([^}]+))?\}\}/g)
                const tokenNames = new Set<string>()
                for (const m of tokenMatches) {
                  tokenNames.add(m[1])
                }

                for (const tName of tokenNames) {
                  let vType: 'input' | 'file' | 'clipboard' | 'command' = 'input'
                  if (tName.includes('file') || tName.includes('code') || tName.includes('path')) vType = 'file'
                  else if (tName.includes('clipboard') || tName.includes('clip')) vType = 'clipboard'
                  else if (tName.includes('cmd') || tName.includes('command') || tName.includes('exec')) vType = 'command'

                  variables.push({
                    name: tName,
                    label: tName.charAt(0).toUpperCase() + tName.slice(1).replace(/[_-]/g, ' '),
                    type: vType
                  })
                }

                skills.push({
                  id,
                  name,
                  description,
                  category,
                  type,
                  command: command.startsWith('/') ? command : `/${command}`,
                  autoSend,
                  variables,
                  content,
                  filePath: targetFilePath,
                  isBuiltIn,
                  usageCount,
                  isPinned
                })
                seenIds.add(id)
              } catch (err) {
                console.warn(`[SkillsEngine] Failed to parse skill file ${targetFilePath}:`, err)
              }
            }
          }
        } catch (err) {
          console.error('[SkillsEngine] Failed to read skills directory:', err)
        }
      }
    }


    // 2. Ensure built-in skills are present if missing on disk
    for (const bundled of BUNDLED_SUPERANTIGRAVITY_SKILLS) {
      if (!seenIds.has(bundled.id)) {
        skills.push({ ...bundled })
      }
    }

    return skills
  }

  public saveSkill(skill: SkillDef): { success: boolean; filePath?: string; error?: string } {
    try {
      this.ensureSkillsDirectory()
      const fileName = `${skill.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`
      const targetPath = skill.filePath || path.join(this.skillsDir, fileName)

      const frontmatter: Record<string, unknown> = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        type: skill.type,
        command: skill.command,
        autoSend: skill.autoSend ?? false
      }

      const fileContent = serializeFrontmatter(frontmatter, skill.content)
      fs.writeFileSync(targetPath, fileContent, 'utf8')
      return { success: true, filePath: targetPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  public deleteSkill(skillId: string): { success: boolean; error?: string } {
    try {
      const skills = this.listSkills()
      const target = skills.find((s) => s.id === skillId)
      if (!target || !target.filePath) {
        return { success: false, error: `Skill "${skillId}" not found on disk.` }
      }
      if (fs.existsSync(target.filePath)) {
        const parentDir = path.dirname(target.filePath)
        const isGlobalSkill = parentDir.includes('.gemini/antigravity/skills') || parentDir.includes('.gemini/config/plugins')
        fs.unlinkSync(target.filePath)
        
        // If it's a global skill folder and now empty (or just contains SKILL.md), delete the folder entirely
        if (isGlobalSkill) {
          try {
            const filesLeft = fs.readdirSync(parentDir)
            if (filesLeft.length === 0) {
              fs.rmdirSync(parentDir)
            }
          } catch(e) {}
        }
        
        return { success: true }
      }
      return { success: false, error: 'File does not exist.' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  public async readSkillFile(
    filePath: string,
    projectDir?: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      let resolved = filePath.trim()
      if (!path.isAbsolute(resolved)) {
        const base = projectDir && fs.existsSync(projectDir) ? projectDir : process.cwd()
        resolved = path.resolve(base, resolved)
      }

      if (!fs.existsSync(resolved)) {
        return { success: false, error: `File not found: ${resolved}` }
      }

      const stats = fs.statSync(resolved)
      if (stats.size > 2 * 1024 * 1024) {
        return { success: false, error: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Max supported size is 2MB.` }
      }

      const content = fs.readFileSync(resolved, 'utf8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  private safeCommandsFile = path.join(
    app?.getPath ? app.getPath('userData') : path.join(process.env.HOME || '.', '.config', 'nexus'),
    'safe_commands.json'
  )

  private defaultSafeCommands = [
    'git status',
    'git diff',
    'git log -n 10',
    'git branch',
    'git rev-parse --show-toplevel',
    'ls',
    'ls -la',
    'pwd',
    'tree -L 2',
    'node --version',
    'npm --version',
    'python --version',
    'cargo --version'
  ]

  public getSafeCommands(): string[] {
    try {
      if (fs.existsSync(this.safeCommandsFile)) {
        const raw = JSON.parse(fs.readFileSync(this.safeCommandsFile, 'utf8'))
        if (Array.isArray(raw)) return Array.from(new Set([...this.defaultSafeCommands, ...raw]))
      }
    } catch {}
    return [...this.defaultSafeCommands]
  }

  public addSafeCommand(cmd: string): boolean {
    try {
      const current = this.getSafeCommands()
      const normalized = cmd.trim()
      if (!normalized) return false
      if (!current.includes(normalized)) {
        current.push(normalized)
        fs.writeFileSync(this.safeCommandsFile, JSON.stringify(current, null, 2), 'utf8')
      }
      return true
    } catch {
      return false
    }
  }

  public removeSafeCommand(cmd: string): boolean {
    try {
      const current = this.getSafeCommands().filter((c) => c !== cmd.trim())
      fs.writeFileSync(this.safeCommandsFile, JSON.stringify(current, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  public isSafeCommand(cmd: string): boolean {
    const trimmed = cmd.trim()
    const allowed = this.getSafeCommands()
    return allowed.some((safe) => trimmed === safe || trimmed.startsWith(`${safe} `))
  }

  public async executeSkillCommand(
    command: string,
    projectDir?: string,
    requireSecurityCheck: boolean = true
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string; needsApproval?: boolean }> {
    try {
      if (requireSecurityCheck && !this.isSafeCommand(command)) {
        return { success: false, needsApproval: true, error: `Command "${command}" requires user approval.` }
      }
      const cwd = projectDir && fs.existsSync(projectDir) ? projectDir : process.cwd()
      const { stdout, stderr } = await execP(command, { cwd, timeout: 15000, maxBuffer: 1024 * 1024 })
      return { success: true, stdout, stderr }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  public scanProjectFiles(projectDir: string, maxResults = 50): string[] {
    if (!projectDir || !fs.existsSync(projectDir)) return []
    const results: string[] = []
    const ignoreDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'target', '.gemini'])

    function traverse(currentDir: string, relativeRoot = ''): void {
      if (results.length >= maxResults) return
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (results.length >= maxResults) break
          if (entry.name.startsWith('.') && entry.name !== '.env') continue
          if (entry.isDirectory()) {
            if (ignoreDirs.has(entry.name)) continue
            traverse(path.join(currentDir, entry.name), path.join(relativeRoot, entry.name))
          } else if (entry.isFile()) {
            results.push(path.join(relativeRoot, entry.name))
          }
        }
      } catch {
        // ignore read permissions error
      }
    }

    traverse(projectDir)
    return results
  }
}

export const skillsEngine = new SkillsEngine()
