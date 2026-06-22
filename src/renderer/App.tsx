import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from './stores/sessionStore'
import { HistoryPanel } from './components/HistoryPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { PromptPanel } from './components/PromptPanel'
import { StatusBar } from './components/StatusBar'
import { SettingsModal } from './components/SettingsModal'
import { Sun, Moon, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

function ChibiLogo() {
  return (
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none">
      <circle cx="10.5" cy="13" r="3" fill="white" />
      <circle cx="21.5" cy="13" r="3" fill="white" />
      <circle cx="10.5" cy="13" r="1.5" fill="#1a1a2e" />
      <circle cx="21.5" cy="13" r="1.5" fill="#1a1a2e" />
      <circle cx="11.5" cy="12" r="0.6" fill="white" />
      <circle cx="22.5" cy="12" r="0.6" fill="white" />
      <path d="M10 20C12 22 20 22 22 20" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="18" r="1.8" fill="white" opacity="0.25" />
      <circle cx="25" cy="18" r="1.8" fill="white" opacity="0.25" />
    </svg>
  )
}

export default function App() {
  const { status, setStatus, selectImage, theme, toggleTheme, requestGenerate, setLoras, setModels, loras, models } = useSessionStore()
  const [initialized, setInitialized] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(() => {
    const stored = localStorage.getItem('anima-history-open')
    return stored !== null ? stored === 'true' : true
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadResources = useCallback(async () => {
    try {
      const [loras, models] = await Promise.all([
        window.electronAPI.loras.list(),
        window.electronAPI.models.list()
      ])
      setLoras(loras)
      setModels(models)
    } catch {
      // resources will be empty
    }
  }, [setLoras, setModels])

  useEffect(() => {
    const unsubStatus = window.electronAPI.comfyui.onStatusUpdate((data) => {
      setStatus({ online: data.online, queueSize: data.queueSize, launching: data.launching })
    })

    const unsubError = window.electronAPI.comfyui.onLaunchError((message) => {
      console.error('[Anima] Erro ao iniciar ComfyUI:', message)
    })

    const init = async () => {
      await loadResources()
      setInitialized(true)
    }
    init()

    return () => { unsubStatus(); unsubError() }
  }, [setStatus, loadResources])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      selectImage(null)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      requestGenerate()
    }
  }, [selectImage, requestGenerate])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface" data-theme={theme}>
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-surface text-text-primary overflow-hidden">
      <header className="h-12 flex items-center px-4 border-b border-border bg-surface-secondary shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const next = !historyOpen; setHistoryOpen(next); localStorage.setItem('anima-history-open', String(next)) }}
            className="p-1.5 rounded-lg hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
            title={historyOpen ? 'Ocultar histórico' : 'Mostrar histórico'}
          >
            {historyOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <ChibiLogo />
          </div>
          <span className="font-semibold text-sm">Anima</span>
          <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-surface-tertiary">v2</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
            title="Configurações"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {loras.length > 0 && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-surface-tertiary" title="LoRAs disponíveis">
              {loras.length} LoRAs
            </span>
          )}
          {models.length > 0 && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-surface-tertiary" title="Modelos disponíveis">
              {models.length} modelos
            </span>
          )}
          <StatusBar status={status} />
        </div>
      </header>

      <div className="flex-1 flex gap-0 overflow-hidden">
        <aside className={`${historyOpen ? 'w-72' : 'w-0'} hidden lg:block border-r border-border bg-surface-secondary overflow-hidden shrink-0 transition-all duration-300`}>
          <div className="w-72 overflow-y-auto h-full">
            <HistoryPanel />
          </div>
        </aside>

        <main className="flex-1 flex items-center justify-center bg-surface overflow-hidden min-w-0">
          <PreviewPanel />
        </main>

        <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
          <PromptPanel />
        </aside>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
