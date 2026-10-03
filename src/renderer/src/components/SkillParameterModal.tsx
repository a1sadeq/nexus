import React, { useState, useEffect, useMemo } from 'react'
import type { SkillDef } from '../../../shared/skills'

export interface SkillParameterModalProps {
  isOpen: boolean
  skill: SkillDef | null
  projectDir?: string
  onClose: () => void
  onSubmit: (compiledPrompt: string, autoSend: boolean) => Promise<void>
}

export const SkillParameterModal: React.FC<SkillParameterModalProps> = ({
  isOpen,
  skill,
  projectDir,
  onClose,
  onSubmit
}) => {
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [autoSend, setAutoSend] = useState(false)
  const [activeTab, setActiveTab] = useState<'form' | 'preview'>('form')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [projectFiles, setProjectFiles] = useState<string[]>([])

  // Initialize values when skill changes
  useEffect(() => {
    if (!skill) return
    setAutoSend(skill.autoSend ?? false)
    const initial: Record<string, string> = {}

    // Auto-fill clipboard if present
    navigator.clipboard?.readText?.().then((clip) => {
      setFormValues((prev) => {
        const next = { ...prev }
        for (const v of skill.variables || []) {
          if (v.type === 'clipboard' && !next[v.name]) {
            next[v.name] = clip || ''
          }
        }
        return next
      })
    }).catch(() => {})

    for (const v of skill.variables || []) {
      initial[v.name] = v.defaultValue || ''
    }
    setFormValues(initial)
  }, [skill])

  // Load project files for file pickers
  useEffect(() => {
    if (!isOpen || !projectDir) return
    window.electron?.skills?.scanProjectFiles(projectDir).then((files) => {
      setProjectFiles(files || [])
    }).catch(() => {})
  }, [isOpen, projectDir])

  const [pendingApproval, setPendingApproval] = useState<{ varName: string; command: string } | null>(null)
  const [rememberCommand, setRememberCommand] = useState(false)

  const handleFileSelect = async (varName: string, relativePath: string): Promise<void> => {
    try {
      const res = await window.electron?.skills?.readFile(relativePath, projectDir)
      if (res && res.success && res.content !== undefined) {
        setFormValues((prev) => ({ ...prev, [varName]: res.content! }))
      }
    } catch (err) {
      console.error('Failed to read file:', err)
    }
  }

  const handleRunCommand = async (varName: string, commandStr: string): Promise<void> => {
    try {
      const res = await window.electron?.skills?.executeCommand(commandStr, projectDir)
      if (res) {
        if (res.needsApproval) {
          setPendingApproval({ varName, command: commandStr })
          return
        }
        if (res.success && res.stdout !== undefined) {
          setFormValues((prev) => ({ ...prev, [varName]: res.stdout! }))
        }
      }
    } catch (err) {
      console.error('Failed to execute command:', err)
    }
  }

  const handleConfirmApproval = async () => {
    if (!pendingApproval) return
    const { varName, command } = pendingApproval
    try {
      if (rememberCommand) {
        await window.electron?.skills?.addSafeCommand(command)
      }
      const res = await window.electron?.skills?.executeCommand(command, projectDir, false)
      if (res && res.success && res.stdout !== undefined) {
        setFormValues((prev) => ({ ...prev, [varName]: res.stdout! }))
      }
    } finally {
      setPendingApproval(null)
      setRememberCommand(false)
    }
  }

  // Compile final prompt
  const compiledPrompt = useMemo(() => {
    if (!skill) return ''
    let result = skill.content
    for (const [k, v] of Object.entries(formValues)) {
      const regex = new RegExp(`\\{\\{${k}(?::[^}]+)?\\}\\}`, 'g')
      result = result.replace(regex, v || `[${k}]`)
    }
    return result
  }, [skill, formValues])

  const handleExecute = async (): Promise<void> => {
    setIsSubmitting(true)
    try {
      await onSubmit(compiledPrompt, autoSend)
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault()
        if (!isSubmitting) {
          handleExecute()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, isSubmitting, compiledPrompt, autoSend])

  if (!isOpen || !skill) return null

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Security Approval Dialog */}
      {pendingApproval && (
        <div
          className="fixed inset-0 z-[100010] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setPendingApproval(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl p-5 flex flex-col gap-4 bg-(--surface) border-amber-500/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-sm text-(--text)">Execute Shell Command?</h3>
                <p className="text-xs text-(--text2)">This skill requests to run a shell command in your workspace.</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-(--border) font-mono text-xs text-amber-200 break-all select-all">
              {pendingApproval.command}
            </div>

            {projectDir && (
              <div className="text-[11px] text-(--text2) font-mono truncate">
                Directory: {projectDir}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-(--text) cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberCommand}
                onChange={(e) => setRememberCommand(e.target.checked)}
                className="accent-indigo-500 rounded cursor-pointer"
              />
              <span>Remember and add to safe commands list</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-(--border)">
              <button
                type="button"
                onClick={() => setPendingApproval(null)}
                className="px-3 py-1.5 rounded-lg border border-(--border) text-xs font-semibold text-(--text2) hover:text-(--text) hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
              >
                Allow & Run
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-(--border) flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-(--text)">{skill.name}</h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-(--surface2) text-(--text2) border border-(--border)">
                  {skill.command}
                </span>
              </div>
              <p className="text-xs text-(--text2)">{skill.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg bg-(--surface2) p-0.5 border border-(--border)">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'form' ? 'bg-(--surface) text-(--text) shadow-sm' : 'text-(--text2) hover:text-(--text)'
                }`}
              >
                Parameters
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'preview' ? 'bg-(--surface) text-(--text) shadow-sm' : 'text-(--text2) hover:text-(--text)'
                }`}
              >
                Live Preview
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--surface2) transition-colors ml-1"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 max-h-[55vh]">
          {activeTab === 'form' ? (
            <div className="space-y-4">
              {(skill.variables || []).map((v, index) => {
                const val = formValues[v.name] || ''
                return (
                  <div key={v.name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-(--text) flex items-center gap-1.5">
                        <span>{v.label || v.name}</span>
                        <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                          {`{{${v.name}}}`}
                        </span>
                      </label>

                      {v.type === 'clipboard' && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.readText().then((clip) => {
                              setFormValues((prev) => ({ ...prev, [v.name]: clip || '' }))
                            })
                          }}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                          </svg>
                          Paste Clipboard
                        </button>
                      )}
                    </div>

                    {v.type === 'file' ? (
                      <div className="space-y-2">
                        {projectDir && projectFiles.length > 0 && (
                          <div className="flex items-center gap-2">
                            <select
                              onChange={(e) => {
                                if (e.target.value) handleFileSelect(v.name, e.target.value)
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500 font-mono"
                              defaultValue=""
                            >
                              <option value="" disabled>
                                Select file from project ({projectFiles.length} files available)...
                              </option>
                              {projectFiles.map((file) => (
                                <option key={file} value={file}>
                                  {file}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <textarea
                          rows={4}
                          value={val}
                          autoFocus={index === 0}
                          onChange={(e) => setFormValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                          placeholder={v.placeholder || 'Paste or select file contents...'}
                          className="w-full p-2.5 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono focus:outline-none focus:border-indigo-500 leading-relaxed"
                        />
                      </div>
                    ) : v.type === 'command' ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="e.g. git diff, cat endpoints.txt, curl -s..."
                            value={v.defaultValue || ''}
                            autoFocus={index === 0}
                            id={`cmd-${v.name}`}
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const inputEl = document.getElementById(`cmd-${v.name}`) as HTMLInputElement
                              if (inputEl && inputEl.value) handleRunCommand(v.name, inputEl.value)
                            }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                          >
                            Run
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={val}
                          onChange={(e) => setFormValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                          placeholder="Command output will appear here..."
                          className="w-full p-2.5 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ) : (
                      <textarea
                        rows={3}
                        value={val}
                        autoFocus={index === 0}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                        placeholder={v.placeholder || `Enter ${v.label || v.name}...`}
                        className="w-full p-2.5 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500 leading-relaxed"
                      />
                    )}
                  </div>
                )
              })}

              {(!skill.variables || skill.variables.length === 0) && (
                <div className="p-4 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text2) text-center">
                  This skill has no dynamic parameters. Click <strong>Inject into Chat</strong> below to use it directly.
                </div>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono whitespace-pre-wrap leading-relaxed max-h-[45vh] overflow-y-auto select-all">
              {compiledPrompt}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-(--border) flex items-center justify-between bg-(--surface2)/40">
          <label className="flex items-center gap-2 text-xs text-(--text2) cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="accent-indigo-500 cursor-pointer"
            />
            <span>Auto-send prompt immediately</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-(--border) hover:bg-(--surface2) transition-colors text-(--text2) hover:text-(--text)"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecute}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-40 transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Injecting…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Inject into Chat <span className="opacity-60 font-normal ml-1 border-l border-white/20 pl-2">Alt+Enter</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
