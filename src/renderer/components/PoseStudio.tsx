import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Play, Clock, RefreshCw } from 'lucide-react'
import type { GenerationResult } from '@shared/types'
import { useGenerationProgress } from '../hooks/useGenerationProgress'

/** Elemento <webview> do Electron (tipado manualmente) */
type WebViewElement = HTMLElement & {
  executeJavaScript: <T = unknown>(code: string) => Promise<T>
}

/** Grafo serializado da sessão atual (sobrevive à recriação do webview) */
let editorGraphCache: string | null = null

/** Centraliza a câmera no nó VNCCS Pose Studio (id 488) dentro do ComfyUI */
const ZOOM_TO_POSE_NODE = `(() => {
  try {
    const app = window.app
    if (!app || !app.graph) return 'no-app'
    const node = app.graph.getNodeById ? app.graph.getNodeById(488) : null
    if (!node) return 'no-node'
    for (const c of [app.canvas, app]) {
      if (c && typeof c.centerOnNode === 'function') {
        c.centerOnNode(node)
        if (typeof c.setDirty === 'function') c.setDirty(true, true)
        return 'centered'
      }
    }
    const ds = app.canvas && app.canvas.ds
    const el = app.canvas && app.canvas.canvas
    if (ds && node.pos && el) {
      ds.offset[0] = -node.pos[0] - (node.size ? node.size[0] : 210) * 0.5 + el.width * 0.5 / ds.scale
      ds.offset[1] = -node.pos[1] - (node.size ? node.size[1] : 320) * 0.5 + el.height * 0.5 / ds.scale
      return 'offset'
    }
    return 'no-canvas'
  } catch (e) {
    return 'error'
  }
})()`

type PromptApi = NonNullable<import('@shared/types').PoseGenerationParams['promptApi']>

/** Dimensões reais da tela de pose (view_width/view_height no pose_data) */
function readPoseViewSize(promptApi?: PromptApi): { width: number; height: number } {
  const fallback = { width: 1024, height: 1024 }
  if (!promptApi) return fallback
  try {
    const node = Object.values(promptApi)
      .find((n): n is { class_type?: string; inputs?: Record<string, unknown> } =>
        !!n && typeof n === 'object' && (n as { class_type?: string }).class_type === 'VNCCS_PoseStudio')
    const raw = node?.inputs?.pose_data
    const poseData = typeof raw === 'string' ? JSON.parse(raw) : null
    const width = Number(poseData?.export?.view_width)
    const height = Number(poseData?.export?.view_height)
    return {
      width: Number.isFinite(width) && width > 0 ? width : fallback.width,
      height: Number.isFinite(height) && height > 0 ? height : fallback.height
    }
  } catch {
    return fallback
  }
}

interface DropPanelProps {
  title: string
  hint: string
  src: string | null
  dragOver: boolean
  onDragOver: (v: boolean) => void
  onFile: (file: File) => void
  onClear: () => void
  inputRef: React.RefObject<HTMLInputElement>
}

function DropPanel({ title, hint, src, dragOver, onDragOver, onFile, onClear, inputRef }: DropPanelProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    onDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onDragOver, onFile])

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{title}</span>

      {!src ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); onDragOver(true) }}
          onDragLeave={() => onDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`
            w-full aspect-[3/4] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2
            cursor-pointer transition-all duration-200
            ${dragOver
              ? 'border-accent bg-accent/5 scale-[1.02]'
              : 'border-border hover:border-text-muted hover:bg-surface-secondary'
            }
          `}
        >
          <Upload size={32} className="text-text-muted" />
          <span className="text-sm text-text-secondary font-medium px-4 text-center">
            {hint}
          </span>
          <span className="text-[10px] text-text-muted">Clique ou arraste · PNG, JPG, WebP</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
            }}
          />
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-surface-secondary border border-border">
          <img
            src={src}
            alt={title}
            className="w-full h-full object-contain"
            draggable={false}
          />
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <button
              onClick={() => inputRef.current?.click()}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Trocar imagem"
            >
              <Upload size={14} />
            </button>
            <button
              onClick={onClear}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-secondary hover:text-error hover:bg-surface transition-colors"
              title="Remover imagem"
            >
              <Trash2 size={14} />
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function PoseStudio() {
  const { status, addToHistory } = useSessionStore()

  const [charSrc, setCharSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [dragOverChar, setDragOverChar] = useState(false)
  const { progress, elapsed, eta, startProgress } = useGenerationProgress()

  const [comfyUrl, setComfyUrl] = useState<string | null>(null)
  const [editorState, setEditorState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)

  const charInputRef = useRef<HTMLInputElement>(null)
  const webviewRef = useRef<HTMLWebViewElement | null>(null)

  useEffect(() => {
    window.electronAPI.settings.get()
      .then((s) => setComfyUrl(s.comfyUrl || 'http://127.0.0.1:8188'))
      .catch(() => setComfyUrl('http://127.0.0.1:8188'))
  }, [])

  // Imagem escolhida no histórico (sidebar) vira a referência de personagem
  const pendingPick = useSessionStore((s) => s.pendingHistoryPick)
  const requestHistoryPick = useSessionStore((s) => s.requestHistoryPick)
  useEffect(() => {
    if (!pendingPick) return
    const picked = pendingPick
    requestHistoryPick(null)
    const apply = (src: string) => {
      setCharSrc(src)
      setResultSrc(null)
      setError(null)
    }
    if (picked.imageBase64) {
      apply(picked.imageBase64)
    } else if (picked.filePath) {
      window.electronAPI.file.readImage(picked.filePath).then((data) => {
        if (data) apply(data)
      })
    }
  }, [pendingPick, requestHistoryPick])

  const handleCharFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharSrc(e.target?.result as string)
      setResultSrc(null)
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const clearChar = useCallback(() => {
    setCharSrc(null)
    setResultSrc(null)
    if (charInputRef.current) charInputRef.current.value = ''
  }, [])

  const execGuest = useCallback(async <T,>(code: string): Promise<T> => {
    const wv = webviewRef.current as WebViewElement | null
    if (!wv || typeof wv.executeJavaScript !== 'function') {
      throw new Error('Editor do ComfyUI não está disponível')
    }
    return wv.executeJavaScript<T>(code)
  }, [])

  // Recarrega o webview preservando o grafo atual (pose montada)
  const reloadEditor = useCallback(async () => {
    try {
      const wv = webviewRef.current as WebViewElement | null
      if (wv) {
        const json = await wv
          .executeJavaScript<string>('JSON.stringify(window.app && window.app.graph ? window.app.graph.serialize() : null)')
          .catch(() => null)
        if (json && json !== 'null') editorGraphCache = json
      }
    } catch { /* webview já destruído */ }
    setEditorState('loading')
    setEditorError(null)
    setEditorEpoch((e) => e + 1)
  }, [])

  // O ComfyUI voltou? Recria o editor que falhou ao carregar
  const wasOnlineRef = useRef(false)
  useEffect(() => {
    const cameOnline = status.online && !wasOnlineRef.current
    wasOnlineRef.current = status.online
    if (cameOnline && editorState === 'error') void reloadEditor()
  }, [status.online, editorState, reloadEditor])

  // Monta o webview: carrega o workflow da pose e espera o app do ComfyUI
  useEffect(() => {
    if (!comfyUrl) return
    const wv = webviewRef.current as WebViewElement | null
    if (!wv) return

    let cancelled = false
    let initStarted = false

    setEditorState('loading')
    setEditorError(null)

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const exec = async <T,>(code: string): Promise<T | null> => {
      if (cancelled) return null
      try {
        return await wv.executeJavaScript<T>(code)
      } catch {
        return null
      }
    }

    // Dispara uma única vez por montagem (dom-ready + did-finish-load)
    const initEditor = async () => {
      if (initStarted || cancelled) return
      initStarted = true

      // Espera o app do ComfyUI terminar de inicializar
      let appReady = false
      for (let i = 0; i < 100; i++) {
        const ok = await exec<boolean>('!!(window.app && typeof window.app.loadGraphData === "function")')
        if (ok) { appReady = true; break }
        await delay(400)
      }
      if (!appReady) {
        if (!cancelled) {
          setEditorState('error')
          setEditorError('O editor do ComfyUI não respondeu. Verifique se o servidor está rodando e recarregue.')
        }
        return
      }

      // Payloads: grafo salvo da sessão, depois o workflow do perfil
      const payloads: string[] = []
      if (editorGraphCache) payloads.push(editorGraphCache)
      const workflow = await window.electronAPI.app.getPoseStudioWorkflow()
      if (cancelled) return
      if (workflow) payloads.push(JSON.stringify(workflow))
      if (payloads.length === 0) {
        setEditorState('error')
        setEditorError('Workflow VNCCS-PoseStudio-QI21.json não encontrado na pasta workflows/.')
        return
      }

      let loaded = false
      for (const payload of payloads) {
        if (cancelled) return
        // O app pode sobrescrever o grafo durante o bootstrap — tenta 3x
        for (let attempt = 0; attempt < 3 && !cancelled && !loaded; attempt++) {
          await exec(`window.app.loadGraphData(${payload})`)
          await delay(700)
          const has = await exec<boolean>('!!(window.app.graph && window.app.graph.getNodeById && window.app.graph.getNodeById(488))')
          loaded = !!has
        }
        if (loaded) break
      }
      if (cancelled) return
      if (!loaded) {
        setEditorState('error')
        setEditorError('Não foi possível carregar o workflow de pose no editor. Recarregue o editor.')
        return
      }

      await exec(ZOOM_TO_POSE_NODE)
      if (!cancelled) setEditorState('ready')
    }

    const onDomReady = () => { void initEditor() }
    const onDidFailLoad = (ev: Event) => {
      const e = ev as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (e.isMainFrame === false || e.errorCode === -3 || cancelled) return
      setEditorState('error')
      setEditorError(`Não foi possível conectar ao ComfyUI (${e.errorCode ?? '?'}). Inicie o servidor e recarregue o editor.`)
    }

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-finish-load', onDomReady)
    wv.addEventListener('did-fail-load', onDidFailLoad)

    return () => {
      cancelled = true
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-finish-load', onDomReady)
      wv.removeEventListener('did-fail-load', onDidFailLoad)
      try {
        void wv
          .executeJavaScript<string>('JSON.stringify(window.app && window.app.graph ? window.app.graph.serialize() : null)')
          .then((json) => { if (json && json !== 'null') editorGraphCache = json })
          .catch(() => {})
      } catch { /* webview já destruído */ }
    }
  }, [comfyUrl, editorEpoch])

  const handleGenerate = useCallback(async () => {
    if (!charSrc || generating || !status.online) return
    if (editorState !== 'ready') {
      setError('O editor de pose ainda não está pronto.')
      return
    }

    setGenerating(true)
    setError(null)
    setWarning(null)
    setResultSrc(null)

    const stopProgress = startProgress()

    try {
      // Serializa o grafo atual no formato da API do ComfyUI (no próprio webview)
      const outputJson = await execGuest<string>(
        'window.app.graphToPrompt().then(r => JSON.stringify(r.output))'
      )
      const promptApi = JSON.parse(outputJson) as PromptApi | null
      if (!promptApi || Object.keys(promptApi).length === 0) {
        throw new Error('O editor não retornou o workflow — recarregue o editor e tente novamente.')
      }

      const { width, height } = readPoseViewSize(promptApi)
      const seed = Math.floor(Math.random() * 2147483647)
      const result = await window.electronAPI.comfyui.generatePose({
        charImageBase64: charSrc,
        promptApi,
        seed,
        filenamePrefix: 'anima-pose'
      })

      const image = result.images?.[0]
      if (image) {
        if (result.warning) setWarning(result.warning)
        const src = `data:image/png;base64,${image.data}`
        setResultSrc(src)
        const entry: GenerationResult = {
          id: result.promptId,
          imageBase64: src,
          filePath: image.filePath,
          filename: image.filename,
          params: {
            diffusionModel: 'krea2',
            prompt: '',
            negativePrompt: '',
            seed,
            steps: 25,
            cfg: 1,
            width,
            height,
            modelName: 'qwen-image-2.1',
            loras: [],
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar com pose')
    } finally {
      stopProgress()
      setGenerating(false)
    }
  }, [charSrc, generating, status.online, editorState, execGuest, startProgress, addToHistory])

  const generateDisabled = !charSrc || generating || !status.online || editorState !== 'ready'

  return (
    <div className="flex-1 flex gap-0 overflow-hidden">
      <main className="flex-1 flex flex-col bg-surface overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-secondary shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            Editor de Pose — VNCCS Pose Studio · ComfyUI
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`
                px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide
                ${editorState === 'ready'
                  ? 'bg-success/20 text-success'
                  : editorState === 'loading'
                    ? 'bg-surface-tertiary text-text-muted'
                    : 'bg-error/20 text-error'
                }
              `}
            >
              {editorState === 'ready' ? 'Pronto' : editorState === 'loading' ? 'Carregando…' : 'Erro'}
            </span>
            <button
              onClick={() => void reloadEditor()}
              className="p-1.5 rounded-lg hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
              title="Recarregar editor"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0">
          {comfyUrl && (
            <webview
              key={`pose-editor-${editorEpoch}`}
              ref={webviewRef}
              src={comfyUrl}
              className="w-full h-full block"
            />
          )}

          {(editorState === 'loading' || editorState === 'error' || !comfyUrl) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface z-10 px-8 text-center">
              {editorState === 'error' ? (
                <>
                  <Wand2 size={28} className="text-text-muted" />
                  <span className="text-sm text-text-secondary max-w-md">{editorError}</span>
                  <button
                    onClick={() => void reloadEditor()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
                  >
                    <RefreshCw size={14} />
                    Recarregar editor
                  </button>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-sm text-text-muted">
                    {status.online ? 'Carregando o editor do ComfyUI…' : 'Aguardando o ComfyUI ficar online…'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="flex flex-col h-full">
          <div className="p-4 space-y-4">
            <DropPanel
              title="Personagem (identidade)"
              hint="Arraste ou selecione a imagem da personagem"
              src={charSrc}
              dragOver={dragOverChar}
              onDragOver={setDragOverChar}
              onFile={handleCharFile}
              onClear={clearChar}
              inputRef={charInputRef}
            />

            <div className="flex flex-col gap-2 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                Resultado
              </span>
              <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-surface border border-border flex items-center justify-center">
                {resultSrc ? (
                  <img
                    src={resultSrc}
                    alt="Resultado"
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <Wand2 size={28} className="text-text-muted" />
                    <span className="text-sm text-text-muted">
                      {generating ? 'Gerando...' : 'A personagem com a pose aparecerá aqui'}
                    </span>
                  </div>
                )}
                {resultSrc && (
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-success/90 text-white text-[9px] font-semibold uppercase tracking-wider">
                    Gerado
                  </div>
                )}
                {generating && (
                  <div className="absolute inset-0 bg-surface/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      <span className="text-xs text-text-secondary">Gerando...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-border text-xs text-text-muted space-y-1">
              <p className="font-medium text-text-secondary">Como funciona:</p>
              <p>1. Monte a pose no <strong className="text-text-primary">VNCCS Pose Studio</strong> (personagem 3D, câmera, poses e iluminação).</p>
              <p>2. Escolha a <strong className="text-text-primary">personagem</strong> à direita — identidade, rosto e roupa a preservar.</p>
              <p>3. Ao gerar, o <strong className="text-text-primary">Qwen-Image 2.1 + LoRA PoseStudio</strong> aplica a pose capturada na personagem.</p>
              <p className="pt-1 text-[11px]">Mantenha este editor aberto durante a geração — a captura da pose é sincronizada pelo navegador.</p>
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-border space-y-3">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
                {error}
              </div>
            )}
            {warning && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs">
                {warning}
              </div>
            )}

            {generating && (
              <div className="space-y-2">
                {progress ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary flex items-center gap-1">
                        <Clock size={12} />
                        {elapsed < 60
                          ? `${elapsed.toFixed(0)}s`
                          : `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toFixed(0)}s`}
                      </span>
                      <span className="text-text-muted font-mono">{progress.current}/{progress.max}</span>
                      {eta !== null && eta > 0 && (
                        <span className="text-text-muted">
                          ~{eta < 60
                            ? `${eta.toFixed(0)}s`
                            : `${Math.floor(eta / 60)}m ${(eta % 60).toFixed(0)}s`}
                        </span>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress.max > 0 ? (progress.current / progress.max) * 100 : 0}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
                    <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Aguardando ComfyUI...
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => void handleGenerate()}
              disabled={generateDisabled}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${generateDisabled
                  ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
                }
              `}
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Gerar com Pose
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
