import { BrowserWindow, WebContentsView, clipboard, ipcMain, shell } from 'electron'

export interface DownloadToastItem {
  id: string
  filename: string
  fullPath: string
  size: number
  destination: string
}

interface VisibleItem extends DownloadToastItem {
  timer: NodeJS.Timeout
  expiresAt: number
}

interface ToastPalette {
  bg: string
  surface: string
  surface2: string
  accent: string
  text: string
  text2: string
  border: string
  radius: number
}

const DEFAULT_PALETTE: ToastPalette = {
  bg: '#090d14', surface: '#121824', surface2: '#1d2738', accent: '#5b9dff',
  text: '#f3f7ff', text2: '#a8b4c8', border: '#33415a', radius: 12
}

export function downloadOverlayBounds(width: number, height: number, cards: number): { x: number; y: number; width: number; height: number } {
  const w = Math.max(0, Math.min(420, width - 40))
  const h = Math.max(0, Math.min(cards * 126 + Math.max(0, cards - 1) * 10, height - 40))
  return { x: Math.max(0, width - w - 20), y: Math.max(0, height - h - 20), width: w, height: h }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]!)
const safeColor = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([0-9.,% /]+\))$/i.test(value.trim()) ? value.trim() : fallback
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`

export class DownloadNotificationOverlay {
  private view: WebContentsView | null = null
  private items: VisibleItem[] = []
  private palette = DEFAULT_PALETTE
  private themeRevision = 0

  constructor(private window: BrowserWindow, preload: string, private raise: () => void) {
    this.view = new WebContentsView({ webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true } })
    this.view.setBackgroundColor('#00000000')

    this.view.setVisible(false)
    this.view.setBounds({ x:0,y:0,width:0,height:0 })
    window.contentView.addChildView(this.view)
    const valid = (event: Electron.IpcMainEvent, id: unknown) => event.sender === this.view?.webContents && typeof id === 'string' ? this.items.find(i => i.id === id) : undefined
    ipcMain.on('download_toast_open_location', (e,id) => { const i=valid(e,id); if(i) shell.showItemInFolder(i.fullPath) })
    ipcMain.on('download_toast_open_file', async (e,id) => { const i=valid(e,id); if(i) { const error=await shell.openPath(i.fullPath); if(error) console.error('[download-toast] open failed:',error) } })
    ipcMain.on('download_toast_copy_path', (e,id) => { const i=valid(e,id); if(i) clipboard.writeText(i.fullPath) })
    ipcMain.on('download_toast_dismiss', (e,id) => { if(valid(e,id)) this.dismiss(id) })
    ipcMain.on('download_toast_hover', (e,id,hovered) => { const i=valid(e,id); if(!i) return; clearTimeout(i.timer); if(hovered) i.expiresAt=0; else this.arm(i,4000) })
    window.on('resize', this.layout)
  }

  show(item: DownloadToastItem) {
    this.dismiss(item.id)
    if(this.items.length===3) this.dismiss(this.items[this.items.length-1].id)
    const visible = { ...item, timer: setTimeout(()=>{},0), expiresAt: 0 }
    clearTimeout(visible.timer)
    this.items.unshift(visible)
    this.arm(visible,8000)
    void this.refreshTheme().finally(() => this.render())
  }

  /** Refresh from Nexus's configured CSS theme, never from the downloaded page. */
  async refreshTheme(): Promise<void> {
    const revision = ++this.themeRevision
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
    try {
      const value = await this.window.webContents.executeJavaScript(`(() => {
        const s = getComputedStyle(document.documentElement)
        return { bg:s.getPropertyValue('--bg'), surface:s.getPropertyValue('--surface'),
          surface2:s.getPropertyValue('--surface2'), accent:s.getPropertyValue('--accent'),
          text:s.getPropertyValue('--text'), text2:s.getPropertyValue('--text2'),
          border:s.getPropertyValue('--border'), radius:parseFloat(s.getPropertyValue('--radius')) }
      })()`, true) as Partial<ToastPalette>
      if (revision !== this.themeRevision) return
      this.palette = {
        bg:safeColor(value.bg,DEFAULT_PALETTE.bg), surface:safeColor(value.surface,DEFAULT_PALETTE.surface),
        surface2:safeColor(value.surface2,DEFAULT_PALETTE.surface2), accent:safeColor(value.accent,DEFAULT_PALETTE.accent),
        text:safeColor(value.text,DEFAULT_PALETTE.text), text2:safeColor(value.text2,DEFAULT_PALETTE.text2),
        border:safeColor(value.border,DEFAULT_PALETTE.border), radius:Number.isFinite(value.radius) ? Math.max(6,Math.min(24,value.radius!)) : DEFAULT_PALETTE.radius
      }
    } catch { /* Renderer may still be starting; retain the safe fallback. */ }
  }

  private arm(item: VisibleItem, ms: number) { item.expiresAt=Date.now()+ms; item.timer=setTimeout(()=>this.dismiss(item.id),ms) }
  dismiss(id: string) { const n=this.items.findIndex(i=>i.id===id); if(n<0)return; clearTimeout(this.items[n].timer); this.items.splice(n,1); this.render() }

  raiseToFront() {
    if (!this.view || this.view.webContents.isDestroyed() || this.items.length === 0) return
    try { this.window.contentView.removeChildView(this.view); this.window.contentView.addChildView(this.view) }
    catch (error) { console.error('[download-toast] Could not raise native overlay:', error) }
  }

  private layout = () => {
    if(!this.view||this.view.webContents.isDestroyed())return
    const b=this.window.getContentBounds()
    this.view.setBounds(downloadOverlayBounds(b.width,b.height,this.items.length))
    this.view.setVisible(this.items.length>0)
    if(this.items.length) { this.raise(); this.raiseToFront() }
  }

  private render() {
    if(!this.view||this.view.webContents.isDestroyed())return
    const p=this.palette
    const cards=this.items.map(i=>`<article data-id="${esc(i.id)}"><header><span class="icon"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg></span><div class="copy"><b>${esc(i.filename)}</b><small>${bytes(i.size)} · ${esc(i.destination)}</small></div></header><div class="actions"><button class="primary" data-a="open_file">Open file</button><button data-a="open_location">Open location</button><button data-a="copy_path">Copy path</button><button class="close" title="Dismiss" data-a="dismiss">×</button></div></article>`).join('')
    const html=`<!doctype html><html><head><meta charset="utf-8"></head><body><style>
      *{box-sizing:border-box}html,body{margin:0;background:transparent;pointer-events:auto;font:12px system-ui;color:${p.text}}
      article{padding:13px;margin-bottom:10px;border:1px solid ${p.border};border-top:2px solid ${p.accent};border-radius:${p.radius}px;background:linear-gradient(135deg,${p.surface} 0%,${p.bg} 130%);box-shadow:0 10px 34px #0008,0 0 22px ${p.accent}22;pointer-events:auto;overflow:hidden}
      header{display:flex;align-items:center;gap:10px}.icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:9px;color:${p.accent};background:${p.accent}20;border:1px solid ${p.accent}45}.copy{min-width:0;flex:1}b,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}b{font-size:12px;color:${p.text}}small{color:${p.text2};margin-top:5px;font-size:10px}
      .actions{display:flex;gap:6px;margin-top:11px}button{background:${p.surface2};color:${p.text};border:1px solid ${p.border};border-radius:7px;padding:6px 9px;cursor:pointer;font:11px system-ui;transition:filter .15s,border-color .15s}button:hover{filter:brightness(1.2);border-color:${p.accent}}button.primary{background:${p.accent};border-color:${p.accent};color:${p.bg};font-weight:700}.actions .close{margin-left:auto;padding:4px 9px;color:${p.text2};font-size:16px;line-height:16px}
    </style></head><body>${cards}<script>
      for(const c of document.querySelectorAll('article')){const id=c.dataset.id;c.onmouseenter=()=>window.electron.ipcRenderer.send('download_toast_hover',id,true);c.onmouseleave=()=>window.electron.ipcRenderer.send('download_toast_hover',id,false)}
      document.onclick=e=>{const target=e.target;if(!(target instanceof HTMLElement))return;const button=target.closest('button');const card=target.closest('article');if(!button||!card)return;window.electron.ipcRenderer.send('download_toast_'+button.dataset.a,card.dataset.id)}
    </script></body></html>`
    this.view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(error=>console.error('[download-toast] Render failed:',error))
    this.layout()
  }

  destroy() {
    this.themeRevision++
    this.items.forEach(i => clearTimeout(i.timer))
    this.items = []
    if (this.view) {
      this.view.setBounds({ x:0,y:0,width:0,height:0 }); this.view.setVisible(false)
      try { this.window.contentView.removeChildView(this.view) } catch {}
      this.view.webContents.close(); this.view = null
    }
  }
}
