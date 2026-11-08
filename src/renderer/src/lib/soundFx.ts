// ============================================================================
// Web Audio API Synthesizer (Zero dependencies, crisp haptic-like sound)
// ============================================================================
export class SoundFX {
  private ctx: AudioContext | null = null
  private enabled = true

  constructor() {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('nexus.settings_sfx')
        this.enabled = saved !== 'false'
      }
    } catch {}
  }

  get isEnabled() {
    return this.enabled
  }

  toggle() {
    this.enabled = !this.enabled
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('nexus.settings_sfx', String(this.enabled))
      }
    } catch {}
    if (this.enabled) this.pop()
    return this.enabled
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) this.ctx = new AudioCtx()
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  click() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(800, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.035)
      gain.gain.setValueAtTime(0.05, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.035)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.04)
    } catch {}
  }

  pop() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(520, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1040, this.ctx.currentTime + 0.06)
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.06)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.065)
    } catch {}
  }

  chime() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      ;[523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = this.ctx!.createOscillator()
        const gain = this.ctx!.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + i * 0.04)
        gain.gain.setValueAtTime(0.04, this.ctx!.currentTime + i * 0.04)
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx!.currentTime + i * 0.04 + 0.15)
        osc.connect(gain)
        gain.connect(this.ctx!.destination)
        osc.start(this.ctx!.currentTime + i * 0.04)
        osc.stop(this.ctx!.currentTime + i * 0.04 + 0.16)
      })
    } catch {}
  }

  /**
   * Alert tone for when AI finishes and is waiting for user choice/input.
   */
  aiPromptAlert() {
    if (!this.enabled) return
    try {
      this.initCtx()
      if (!this.ctx) return
      ;[587.33, 880.0].forEach((freq, i) => {
        const osc = this.ctx!.createOscillator()
        const gain = this.ctx!.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + i * 0.08)
        gain.gain.setValueAtTime(0.045, this.ctx!.currentTime + i * 0.08)
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx!.currentTime + i * 0.08 + 0.22)
        osc.connect(gain)
        gain.connect(this.ctx!.destination)
        osc.start(this.ctx!.currentTime + i * 0.08)
        osc.stop(this.ctx!.currentTime + i * 0.08 + 0.24)
      })
    } catch {}
  }
}

export const sfx = new SoundFX()
