import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join, resolve, normalize, sep, dirname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync, copyFileSync } from 'fs'
import { ComfyUIClient } from './comfyui'
import { ComfyLauncher } from './comfyLauncher'
import { WorkflowManager } from './workflow'
import { LoraScanner } from './loraScanner'
import { ModelScanner } from './modelScanner'
import { SettingsManager } from './settings'
import { getThumbnailDataUrl, deleteThumbnail } from './thumbnails'
import type { GenerationParams, DiffusionModelId } from '@shared/types'
import { MAX_LORAS } from '@shared/types'
import { MODEL_PROFILES } from '@shared/modelProfiles'

let mainWindow: BrowserWindow | null = null
let comfyClient: ComfyUIClient
let comfyLauncher: ComfyLauncher
let workflowManager: WorkflowManager
let loraScanner: LoraScanner
let modelScanner: ModelScanner

let statusPollInterval: ReturnType<typeof setInterval> | null = null
let statusPollActive = false
let statusPollOnline = false

function getHistoryBaseDir(): string {
  const projectRoot = resolve(dirname(__dirname), '..')
  return join(projectRoot, 'history')
}

// Migração única: versões antigas gravavam o histórico em %APPDATA%/anima-electron/history
function migrateLegacyHistory(): void {
  try {
    const target = getHistoryBaseDir()
    if (existsSync(target)) return
    const { app } = require('electron')
    const legacyAppData = join(app.getPath('userData'), 'history')
    if (!existsSync(legacyAppData)) return

    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(legacyAppData)) {
      const src = join(legacyAppData, entry)
      const dest = join(target, entry)
      if (statSync(src).isDirectory()) {
        mkdirSync(dest, { recursive: true })
        for (const file of readdirSync(src)) {
          copyFileSync(join(src, file), join(dest, file))
        }
      } else {
        copyFileSync(src, dest)
      }
    }
    console.log('[Anima] Histórico migrado de AppData para:', target)
  } catch (err) {
    console.warn('[Anima] Falha ao migrar histórico antigo:', err)
  }
}

function buildTimestamp(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
}

function getImageExt(filename: string): string {
  if (filename.endsWith('.png')) return 'png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'jpg'
  return 'png'
}

const HISTORY_PARAM_BLOCKLIST = new Set([
  'imageBase64',
  'maskBase64',
  'poseImageBase64',
  'poseData',
  'imagePath',
  'maskFilename',
  'poseImageFilename'
])
const HISTORY_PARAM_MAX_STRING = 100 * 1024

function sanitizeHistoryParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (HISTORY_PARAM_BLOCKLIST.has(key)) continue
    if (typeof value === 'string' && value.length > HISTORY_PARAM_MAX_STRING) continue
    clean[key] = value
  }
  return clean
}

function historyParamsHasBloat(params: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(params ?? {}).some(
    ([key, value]) =>
      HISTORY_PARAM_BLOCKLIST.has(key) ||
      (typeof value === 'string' && value.length > HISTORY_PARAM_MAX_STRING)
  )
}

function saveImagesToHistory(
  promptId: string,
  images: { filename: string; data: string }[],
  params: Record<string, unknown>,
  prefix = 'anima'
): { filename: string; data: string; filePath: string }[] {
  const historyBaseDir = getHistoryBaseDir()
  const historyDir = join(historyBaseDir, promptId)
  const savedImages: { filename: string; data: string; filePath: string }[] = []

  try {
    if (!existsSync(historyBaseDir)) {
      mkdirSync(historyBaseDir, { recursive: true })
      console.log(`[Anima] Pasta de histórico criada: ${historyBaseDir}`)
    }
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true })
    }

    const metadata: { params: Record<string, unknown>; timestamp: number; images: { filename: string }[] } = {
      params: sanitizeHistoryParams(params),
      timestamp: Date.now(),
      images: []
    }
    for (const img of images) {
      const timestamp = buildTimestamp()
      const ext = getImageExt(img.filename)
      const newFilename = `${prefix}_${timestamp}.${ext}`
      const imgPath = join(historyDir, newFilename)
      writeFileSync(imgPath, Buffer.from(img.data, 'base64'))
      savedImages.push({ ...img, filePath: imgPath, filename: newFilename })

      metadata.images.push({ filename: newFilename })
    }

    writeFileSync(join(historyDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    console.log(`[Anima] Imagens salvas em: ${historyDir}`)
  } catch (err) {
    console.warn(`[Anima] Erro ao salvar histórico em ${historyDir}:`, err)
  }

  return savedImages
}

async function uploadImageToComfyUI(
  base64: string,
  filename: string,
  comfyInputDir: string,
  baseUrl: string
): Promise<void> {
  const imageData = base64.replace(/^data:image\/\w+;base64,/, '')
  const imageBuffer = Buffer.from(imageData, 'base64')

  const destPath = join(comfyInputDir, filename)
  try {
    writeFileSync(destPath, imageBuffer)
    console.log(`[Anima] Arquivo salvo em: ${destPath}`)
  } catch {
    console.warn('[Anima] Não foi possível salvar localmente, tentando upload via API...')
    const ext = filename.split('.').pop() || 'png'
    const blob = new Blob([imageBuffer], { type: `image/${ext}` })
    const formData = new FormData()
    formData.append('image', blob, filename)
    formData.append('type', 'input')
    const uploadRes = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: formData })
    if (!uploadRes.ok) {
      throw new Error(`Falha ao enviar arquivo para ComfyUI: ${uploadRes.status}`)
    }
    console.log('[Anima] Upload realizado com sucesso')
  }
}

function removeTempFiles(files: (string | undefined)[], dir: string): void {
  for (const file of files) {
    if (!file) continue
    try {
      rmSync(join(dir, file), { force: true })
    } catch { /* cleanup best-effort */ }
  }
}

function isPathSafe(targetPath: string, allowedBase: string): boolean {
  const resolvedTarget = normalize(resolve(targetPath)).toLowerCase()
  const resolvedBase = normalize(resolve(allowedBase)).toLowerCase()
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep)
}

function isMainWindowSender(event: Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

function requireMainWindow(event: Electron.IpcMainInvokeEvent): void {
  if (!isMainWindowSender(event)) {
    throw new Error('IPC não autorizado: remetente inválido')
  }
}

const VNCCS_CANVAS = { width: 512, height: 1536 }

const COCO_TO_VNCCS: Record<string, number> = {
  nose: 0,
  l_eye: 1,
  r_eye: 2,
  l_ear: 3,
  r_ear: 4,
  l_shoulder: 5,
  r_shoulder: 6,
  l_elbow: 7,
  r_elbow: 8,
  l_wrist: 9,
  r_wrist: 10,
  l_hip: 11,
  r_hip: 12,
  l_knee: 13,
  r_knee: 14,
  l_ankle: 15,
  r_ankle: 16,
}

function convertOpenPoseToVnccs(openposeJson: string): Record<string, [number, number]> | null {
  try {
    const data = JSON.parse(openposeJson)
    const entries = Array.isArray(data) ? data : [data]
    for (const entry of entries) {
      const people = entry?.people
      if (!Array.isArray(people) || people.length === 0) continue
      const kp = people[0]?.pose_keypoints_2d
      if (!Array.isArray(kp) || kp.length < 17 * 3) continue

      const points: Record<string, [number, number]> = {}
      for (const [vnccsName, idx] of Object.entries(COCO_TO_VNCCS)) {
        const x = kp[idx * 3]
        const y = kp[idx * 3 + 1]
        const c = kp[idx * 3 + 2]
        if (typeof x === 'number' && typeof y === 'number' && c > 0) {
          points[vnccsName] = [x, y]
        }
      }

      if (points.r_shoulder && points.l_shoulder) {
        points.neck = [
          (points.r_shoulder[0] + points.l_shoulder[0]) / 2,
          (points.r_shoulder[1] + points.l_shoulder[1]) / 2,
        ]
      }

      if (Object.keys(points).length < 5) return null

      const xs = Object.values(points).map(p => p[0])
      const ys = Object.values(points).map(p => p[1])
      let minX = Math.min(...xs)
      let maxX = Math.max(...xs)
      let minY = Math.min(...ys)
      let maxY = Math.max(...ys)

      const padX = (maxX - minX) * 0.1 || 20
      const padY = (maxY - minY) * 0.1 || 20
      minX -= padX
      maxX += padX
      minY -= padY
      maxY += padY

      const bw = maxX - minX
      const bh = maxY - minY
      const scale = Math.min(VNCCS_CANVAS.width / bw, VNCCS_CANVAS.height / bh)
      const ox = (VNCCS_CANVAS.width - bw * scale) / 2 - minX * scale
      const oy = (VNCCS_CANVAS.height - bh * scale) / 2 - minY * scale

      const result: Record<string, [number, number]> = {}
      for (const [name, p] of Object.entries(points)) {
        result[name] = [Math.round(p[0] * scale + ox), Math.round(p[1] * scale + oy)]
      }
      return result
    }
  } catch (err) {
    console.warn('[Anima] Erro ao converter pose DWPose para VNCCS:', err)
  }
  return null
}

function sanitizeGenerationParams(raw: unknown): Record<string, unknown> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

  // Valida o modelo de difusão contra os IDs conhecidos (evita "Workflow not loaded")
  const validModels = new Set(Object.keys(MODEL_PROFILES))
  const requestedModel = str(p.diffusionModel, 'anima')
  const diffusionModel: DiffusionModelId = validModels.has(requestedModel)
    ? (requestedModel as DiffusionModelId)
    : 'anima'

  // Whitelist: apenas campos conhecidos são repassados (sem spread do objeto bruto)
  return {
    diffusionModel,
    prompt: str(p.prompt),
    negativePrompt: str(p.negativePrompt),
    modelName: str(p.modelName),
    filenamePrefix: str(p.filenamePrefix, 'anima'),
    seed: Math.max(0, Math.floor(num(p.seed, 0, 0, 2147483647))),
    steps: Math.floor(num(p.steps, 20, 1, 50)),
    cfg: num(p.cfg, 5, 1, 20),
    width: Math.floor(num(p.width, 648, 64, 4096)),
    height: Math.floor(num(p.height, 1152, 64, 4096)),
    loras: (() => {
      const arr = Array.isArray(p.loras) ? p.loras : []
      const seen = new Set<string>()
      const out: Array<{ name: string; strengthModel: number; strengthClip: number }> = []
      for (const item of arr.slice(0, MAX_LORAS)) {
        if (!item || typeof item !== 'object') continue
        const name = strOrNull((item as Record<string, unknown>).name)
        if (!name || seen.has(name)) continue
        seen.add(name)
        out.push({
          name,
          strengthModel: num((item as Record<string, unknown>).strengthModel, 0.5, 0, 2),
          strengthClip: num((item as Record<string, unknown>).strengthClip, 0.5, 0, 2)
        })
      }
      return out
    })(),
    denoise: p.denoise !== undefined ? num(p.denoise, 1, 0.05, 1) : undefined,
    imageBase64: typeof p.imageBase64 === 'string' ? p.imageBase64 : undefined,
    maskBase64: typeof p.maskBase64 === 'string' ? p.maskBase64 : undefined,
    poseImageBase64: typeof p.poseImageBase64 === 'string' ? p.poseImageBase64 : undefined,
    poseData: typeof p.poseData === 'string' ? p.poseData : undefined,
    poseStrength: p.poseStrength !== undefined ? num(p.poseStrength, 1, 0.05, 2) : undefined,
    lineThickness: p.lineThickness !== undefined ? Math.floor(num(p.lineThickness, 2, 1, 10)) : undefined,
    safeZone: p.safeZone !== undefined ? Math.floor(num(p.safeZone, 0, 0, 100)) : undefined
  }
}

function stopStatusPoll(): void {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
  statusPollActive = false
  statusPollOnline = false
}

function startStatusPoll(): void {
  if (statusPollActive) return
  statusPollActive = true

  const poll = async (): Promise<void> => {
    if (!statusPollActive) return
    let status
    try {
      status = await comfyClient.getStatus()
    } catch (err) {
      console.warn('[Anima] Falha ao consultar status do ComfyUI:', err)
      return
    }
    if (!statusPollActive || !mainWindow || mainWindow.isDestroyed()) return

    mainWindow.webContents.send('comfyui:statusUpdate', {
      ...status,
      launching: comfyLauncher.running && !status.online
    })

    // Transição para poll lento quando ficar online (com guarda contra duplicatas)
    if (status.online && !statusPollOnline) {
      statusPollOnline = true
      if (statusPollInterval) clearInterval(statusPollInterval)
      statusPollInterval = setInterval(poll, 15000)
    } else if (!status.online) {
      statusPollOnline = false
    }
  }

  statusPollInterval = setInterval(poll, 2000)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: '#0f0f13',
    titleBarStyle: 'hiddenInset'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupIPC(): void {
  const settingsManager = new SettingsManager()
  const settings = settingsManager.get()

  comfyClient = new ComfyUIClient(settings.comfyUrl || 'http://127.0.0.1:8188')
  comfyLauncher = new ComfyLauncher(settings.comfyUIPath)
  const workflowsDir = app.isPackaged
    ? join(process.resourcesPath, 'workflows')
    : join(__dirname, '../../workflows')
  workflowManager = new WorkflowManager(workflowsDir, settings.comfyUIPath)
  loraScanner = new LoraScanner(settingsManager)
  modelScanner = new ModelScanner(settingsManager)

  ipcMain.handle('comfyui:status', async () => {
    return comfyClient.getStatus()
  })

  ipcMain.handle('comfyui:generate', async (event, rawParams) => {
    requireMainWindow(event)
    const params = sanitizeGenerationParams(rawParams) as unknown as GenerationParams
    console.log('[Anima] Iniciando geração...')
    console.log('[Anima] Modelo:', params.modelName, '| LoRAs:', params.loras.length > 0
      ? params.loras.map((l) => l.name).join(', ')
      : 'nenhum')
    console.log('[Anima] Prompt:', (params.prompt ?? '').slice(0, 80) + '...')
    console.log('[Anima] Seed:', params.seed, 'Steps:', params.steps, 'CFG:', params.cfg)
    const availableNodes = await comfyClient.getAvailableNodes()
    const prompt = workflowManager.buildPrompt(params, { availableNodes })
    console.log('[Anima] Prompt construído, nós:', Object.keys(prompt).length)
    const response = await comfyClient.sendPrompt(prompt)
    console.log('[Anima] Prompt enviado, ID:', response.prompt_id)
    if (Object.keys(response.node_errors ?? {}).length > 0) {
      console.error('[Anima] Erros nos nós:', JSON.stringify(response.node_errors))
      throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`)
    }
    const images = await comfyClient.waitForResult(
      response.prompt_id,
      (current, max) => {
        mainWindow?.webContents.send('comfyui:progress', { current, max, promptId: response.prompt_id })
      }
    )
    console.log(`[Anima] Geração concluída, ${images.length} imagem(ns)`)
    if (images.length === 0) {
      throw new Error('ComfyUI não retornou imagens')
    }

    const savedImages = saveImagesToHistory(response.prompt_id, images, params as unknown as Record<string, unknown>, params.filenamePrefix || 'anima')
    return { promptId: response.prompt_id, images: savedImages }
  })

  ipcMain.handle('comfyui:generateImprove', async (event, rawParams) => {
    requireMainWindow(event)
    const params = sanitizeGenerationParams(rawParams) as unknown as GenerationParams & { imageBase64?: string; maskBase64?: string; poseImageBase64?: string }
    console.log('[Anima] Iniciando melhoria de imagem (img2img)...')
    console.log('[Anima] Modelo:', params.diffusionModel, '| Prompt:', (params.prompt ?? '').slice(0, 80) + '...')

    if (!params.imageBase64) {
      throw new Error('Imagem não fornecida')
    }

    const settings = settingsManager.get()
    const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
    const baseUrl = comfyClient.getBaseUrl()

    // Upload image to ComfyUI input
    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/)
    const imgExt = imageMatch ? imageMatch[1] : 'png'
    const inputFilename = `anima-improve-${Date.now()}.${imgExt === 'jpeg' ? 'jpg' : imgExt}`
    await uploadImageToComfyUI(params.imageBase64, inputFilename, comfyInputDir, baseUrl)

    // Upload rendered pose image (single-pose OpenPose canvas) for the LLLite
    let poseImageFilename: string | undefined
    if (params.poseImageBase64) {
      poseImageFilename = `anima-pose-${Date.now()}.png`
      await uploadImageToComfyUI(params.poseImageBase64, poseImageFilename, comfyInputDir, baseUrl)
      console.log('[Anima] Pose renderizada enviada para ComfyUI:', poseImageFilename)
    }

    // Handle mask upload for inpainting
    let maskFilename: string | undefined
    if (params.maskBase64) {
      maskFilename = `anima-mask-${Date.now()}.png`
      await uploadImageToComfyUI(params.maskBase64, maskFilename, comfyInputDir, baseUrl)
    }

    const improveParams = {
      ...params,
      imagePath: inputFilename,
      filenamePrefix: params.filenamePrefix || 'anima-improve',
      maskFilename,
      poseImageFilename
    }

    try {
      const availableNodes = await comfyClient.getAvailableNodes()
      const warnings: string[] = []
      const prompt = workflowManager.buildPrompt(improveParams, { availableNodes, warnings })
      console.log('[Anima] Prompt img2img construído, nós:', Object.keys(prompt).length)
      const response = await comfyClient.sendPrompt(prompt)
      console.log('[Anima] Prompt enviado, ID:', response.prompt_id)
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        console.error('[Anima] Erros nos nós:', JSON.stringify(response.node_errors))
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`)
      }
      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send('comfyui:progress', { current, max, promptId: response.prompt_id })
        }
      )
      console.log(`[Anima] Melhoria concluída, ${images.length} imagem(ns)`)

      const savedImages = saveImagesToHistory(response.prompt_id, images, improveParams as unknown as Record<string, unknown>, params.filenamePrefix || 'anima-improve')
      return { promptId: response.prompt_id, images: savedImages, warning: warnings.join(' ') || undefined }
    } finally {
      // Remove arquivos temporários enviados ao ComfyUI para não acumular em input/
      removeTempFiles([inputFilename, poseImageFilename, maskFilename], comfyInputDir)
    }
  })

  ipcMain.handle('comfyui:generatePose', async (event, rawParams) => {
    requireMainWindow(event)

    const p = (rawParams && typeof rawParams === 'object' ? rawParams : {}) as Record<string, unknown>
    const charImageBase64 = typeof p.charImageBase64 === 'string' ? p.charImageBase64 : null
    const poseImageBase64 = typeof p.poseImageBase64 === 'string' ? p.poseImageBase64 : null
    const seed = typeof p.seed === 'number' ? Math.floor(p.seed) : Math.floor(Math.random() * 2147483647)
    const filenamePrefix = typeof p.filenamePrefix === 'string' ? p.filenamePrefix : 'anima-pose'

    if (!charImageBase64) throw new Error('Imagem da personagem não fornecida')
    if (!poseImageBase64) throw new Error('Imagem de pose não fornecida')

    // Resolve o caminho do workflow de pose via profile (mesma resolução do WorkflowManager)
    const poseWorkflowFile = MODEL_PROFILES.krea2.poseWorkflowFile
    if (!poseWorkflowFile) {
      throw new Error('Perfil krea2 não define poseWorkflowFile')
    }
    const poseWorkflowPath = join(workflowsDir, poseWorkflowFile)
    if (!existsSync(poseWorkflowPath)) {
      throw new Error(`Workflow de pose não encontrado: ${poseWorkflowPath}`)
    }

    const settings = settingsManager.get()
    const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
    const baseUrl = comfyClient.getBaseUrl()

    const charMatch = charImageBase64.match(/^data:image\/(\w+);base64,/)
    const charExt = charMatch ? (charMatch[1] === 'jpeg' ? 'jpg' : charMatch[1]) : 'png'
    const charFilename = `anima-pose-char-${Date.now()}.${charExt}`

    const poseMatch = poseImageBase64.match(/^data:image\/(\w+);base64,/)
    const poseExt = poseMatch ? (poseMatch[1] === 'jpeg' ? 'jpg' : poseMatch[1]) : 'png'
    const poseFilename = `anima-pose-ref-${Date.now()}.${poseExt}`

    await uploadImageToComfyUI(charImageBase64, charFilename, comfyInputDir, baseUrl)
    await uploadImageToComfyUI(poseImageBase64, poseFilename, comfyInputDir, baseUrl)
    console.log('[Anima] Pose: personagem=%s, referência=%s', charFilename, poseFilename)

    try {
      const prompt = workflowManager.buildPosePrompt(charFilename, poseFilename, seed, poseWorkflowPath)
      console.log('[Anima] Pose prompt construído, nós:', Object.keys(prompt).length)

      // Extrai steps/cfg/dimensões reais do workflow para o histórico
      const readNumInput = (nodeId: string, inputName: string, fallback: number): number => {
        const node = prompt[nodeId] as { inputs?: Record<string, unknown> } | undefined
        const val = node?.inputs?.[inputName]
        return typeof val === 'number' ? val : fallback
      }
      const poseParams = {
        diffusionModel: 'krea2' as DiffusionModelId,
        prompt: '',
        negativePrompt: '',
        seed,
        steps: readNumInput('9', 'steps', 12),
        cfg: readNumInput('9', 'cfg', 2.5),
        width: readNumInput('8', 'width', 1024),
        height: readNumInput('8', 'height', 1024),
        loras: [],
        modelName: ''
      }

      const response = await comfyClient.sendPrompt(prompt)
      console.log('[Anima] Pose prompt enviado, ID:', response.prompt_id)
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`)
      }

      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send('comfyui:progress', { current, max, promptId: response.prompt_id })
        }
      )
      console.log(`[Anima] Pose concluída, ${images.length} imagem(ns)`)

      const savedImages = saveImagesToHistory(response.prompt_id, images, poseParams as unknown as Record<string, unknown>, filenamePrefix)
      return { promptId: response.prompt_id, images: savedImages }
    } finally {
      removeTempFiles([charFilename, poseFilename], comfyInputDir)
    }
  })

  ipcMain.handle('comfyui:generateOutfit', async (event, rawParams) => {
    requireMainWindow(event)

    const p = (rawParams && typeof rawParams === 'object' ? rawParams : {}) as Record<string, unknown>
    const charImageBase64 = typeof p.charImageBase64 === 'string' ? p.charImageBase64 : null
    const outfitImageBase64 = typeof p.outfitImageBase64 === 'string' ? p.outfitImageBase64 : null
    const seed = typeof p.seed === 'number' ? Math.floor(p.seed) : Math.floor(Math.random() * 2147483647)
    const filenamePrefix = typeof p.filenamePrefix === 'string' ? p.filenamePrefix : 'anima-outfit'

    if (!charImageBase64) throw new Error('Imagem da personagem não fornecida')
    if (!outfitImageBase64) throw new Error('Imagem de roupa não fornecida')

    // Resolve o caminho do workflow de roupa via profile (mesma resolução do WorkflowManager)
    const outfitWorkflowFile = MODEL_PROFILES.krea2.outfitWorkflowFile
    if (!outfitWorkflowFile) {
      throw new Error('Perfil krea2 não define outfitWorkflowFile')
    }
    const outfitWorkflowPath = join(workflowsDir, outfitWorkflowFile)
    if (!existsSync(outfitWorkflowPath)) {
      throw new Error(`Workflow de roupa não encontrado: ${outfitWorkflowPath}`)
    }

    const settings = settingsManager.get()
    const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
    const baseUrl = comfyClient.getBaseUrl()

    const charMatch = charImageBase64.match(/^data:image\/(\w+);base64,/)
    const charExt = charMatch ? (charMatch[1] === 'jpeg' ? 'jpg' : charMatch[1]) : 'png'
    const charFilename = `anima-outfit-char-${Date.now()}.${charExt}`

    const outfitMatch = outfitImageBase64.match(/^data:image\/(\w+);base64,/)
    const outfitExt = outfitMatch ? (outfitMatch[1] === 'jpeg' ? 'jpg' : outfitMatch[1]) : 'png'
    const outfitFilename = `anima-outfit-ref-${Date.now()}.${outfitExt}`

    await uploadImageToComfyUI(charImageBase64, charFilename, comfyInputDir, baseUrl)
    await uploadImageToComfyUI(outfitImageBase64, outfitFilename, comfyInputDir, baseUrl)
    console.log('[Anima] Outfit: personagem=%s, referência=%s', charFilename, outfitFilename)

    try {
      const prompt = workflowManager.buildOutfitPrompt(charFilename, outfitFilename, seed, outfitWorkflowPath)
      console.log('[Anima] Outfit prompt construído, nós:', Object.keys(prompt).length)

      // Extrai steps/cfg/dimensões reais do workflow para o histórico
      const readNumInput = (nodeId: string, inputName: string, fallback: number): number => {
        const node = prompt[nodeId] as { inputs?: Record<string, unknown> } | undefined
        const val = node?.inputs?.[inputName]
        return typeof val === 'number' ? val : fallback
      }
      const outfitParams = {
        diffusionModel: 'krea2' as DiffusionModelId,
        prompt: '',
        negativePrompt: '',
        seed,
        steps: readNumInput('9', 'steps', 12),
        cfg: readNumInput('9', 'cfg', 2.5),
        width: readNumInput('8', 'width', 1024),
        height: readNumInput('8', 'height', 1024),
        loras: [],
        modelName: ''
      }

      const response = await comfyClient.sendPrompt(prompt)
      console.log('[Anima] Outfit prompt enviado, ID:', response.prompt_id)
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`)
      }

      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send('comfyui:progress', { current, max, promptId: response.prompt_id })
        }
      )
      console.log(`[Anima] Outfit concluída, ${images.length} imagem(ns)`)

      const savedImages = saveImagesToHistory(response.prompt_id, images, outfitParams as unknown as Record<string, unknown>, filenamePrefix)
      return { promptId: response.prompt_id, images: savedImages }
    } finally {
      removeTempFiles([charFilename, outfitFilename], comfyInputDir)
    }
  })

  ipcMain.handle('comfyui:captionImage', async (event, params: { imageBase64: string }) => {
    requireMainWindow(event)
    console.log('[Anima] Iniciando captioning de imagem...')

    if (!params.imageBase64) {
      throw new Error('Imagem não fornecida')
    }

    const settings = settingsManager.get()
    const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
    const baseUrl = comfyClient.getBaseUrl()

    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/)
    const imgExt = imageMatch ? imageMatch[1] : 'png'
    const inputFilename = `anima-caption-${Date.now()}.${imgExt === 'jpeg' ? 'jpg' : imgExt}`
    await uploadImageToComfyUI(params.imageBase64, inputFilename, comfyInputDir, baseUrl)

    try {
      const result = await comfyClient.captionImage(inputFilename)
      console.log('[Anima] Caption gerado:', result.text ? result.text.slice(0, 100) + '...' : 'vazio')
      return result
    } finally {
      removeTempFiles([inputFilename], comfyInputDir)
    }
  })

  ipcMain.handle('loras:list', async (event, subfolder?: string) => {
    requireMainWindow(event)
    const loras = loraScanner.scan(subfolder)
    console.log(`[Anima] LoRAs encontrados: ${loras.length} para a subpasta: ${subfolder ?? 'todas'}`)
    if (loras.length > 0) console.log(`[Anima] Primeiro LoRA: ${loras[0].name}, preview: ${loras[0].previewUrl ?? 'nenhum'}`)
    return loras
  })

  ipcMain.handle('models:list', async (event) => {
    requireMainWindow(event)
    const models = modelScanner.scan()
    console.log(`[Anima] Modelos encontrados: ${models.length}`)
    if (models.length > 0) console.log(`[Anima] Primeiro modelo: ${models[0].name}, type: ${models[0].type}`)
    return models
  })

  ipcMain.handle('comfyui:clearCache', async (event) => {
    requireMainWindow(event)
    return comfyClient.clearCache()
  })

  ipcMain.handle('comfyui:setUrl', async (event, url: string) => {
    requireMainWindow(event)
    comfyClient.setUrl(url)
  })

  ipcMain.handle('comfyui:launch', async (event) => {
    requireMainWindow(event)
    // First check if ComfyUI is already online
    const status = await comfyClient.getStatus()
    if (status.online) {
      startStatusPoll()
      return { success: true, message: 'ComfyUI já está online' }
    }
    const result = await comfyLauncher.start()
    if (result.success) {
      startStatusPoll()
    }
    return result
  })

  ipcMain.handle('settings:get', async (event) => {
    requireMainWindow(event)
    return settingsManager.get()
  })

  ipcMain.handle('settings:set', async (event, newSettings) => {
    requireMainWindow(event)
    const clean: Partial<import('@shared/types').AppSettings> = {}
    if (newSettings && typeof newSettings === 'object') {
      const s = newSettings as Record<string, unknown>
      if (typeof s.comfyUIPath === 'string') clean.comfyUIPath = s.comfyUIPath
      if (typeof s.modelsPath === 'string') clean.modelsPath = s.modelsPath
      if (typeof s.lorasPath === 'string') clean.lorasPath = s.lorasPath
      if (typeof s.comfyUrl === 'string' && /^https?:\/\//.test(s.comfyUrl)) clean.comfyUrl = s.comfyUrl
    }
    const updated = settingsManager.set(clean)
    const s = settingsManager.get()
    comfyLauncher.updatePath(s.comfyUIPath)
    loraScanner.updatePath(settingsManager)
    modelScanner.updatePath(settingsManager)
    if (s.comfyUrl) {
      comfyClient.setUrl(s.comfyUrl)
    }
    return updated
  })

  ipcMain.handle('settings:selectDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar pasta'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('file:selectImage', async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      title: 'Selecionar imagem de referência',
      filters: [
        { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }
      ]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('clipboard:readImage', () => {
    const { clipboard } = require('electron') as typeof import('electron')
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    // PNG é o formato canônico do nativeImage — preserva alpha e evita conversões com perda
    const png = img.toPNG()
    return `data:image/png;base64,${png.toString('base64')}`
  })

  ipcMain.handle('pose:extractFromImage', async (event, imagePath: string) => {
    requireMainWindow(event)
    try {
      if (!imagePath || typeof imagePath !== 'string') {
        throw new Error('Caminho de imagem inválido')
      }
      if (!existsSync(imagePath)) {
        throw new Error('Arquivo de imagem não encontrado')
      }
      // Apenas arquivos de imagem, evitando leitura de arquivos arbitrários grandes
      const extMatch = /\.([a-z0-9]+)$/i.exec(imagePath)
      const ext = extMatch ? extMatch[1].toLowerCase() : ''
      const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
      if (!ALLOWED_EXTS.includes(ext)) {
        throw new Error('Tipo de arquivo não suportado para extração de pose')
      }
      const size = statSync(imagePath).size
      if (size > 50 * 1024 * 1024) {
        throw new Error('Imagem muito grande para extração de pose')
      }
      const buffer = readFileSync(imagePath)
      const inputFilename = `anima-pose-ref-${Date.now()}.${ext}`
      const settings = settingsManager.get()
      const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
      await uploadImageToComfyUI(buffer.toString('base64'), inputFilename, comfyInputDir, comfyClient.getBaseUrl())
      console.log('[Anima] Extraindo pose da imagem:', imagePath)

      const { openposeJson } = await comfyClient.extractPose(inputFilename)
      const joints = convertOpenPoseToVnccs(openposeJson)

      try {
        rmSync(join(comfyInputDir, inputFilename), { force: true })
      } catch { /* cleanup best-effort */ }

      if (!joints) {
        throw new Error('Não foi possível detectar uma pose na imagem. Verifique se o modelo DWPose foi baixado e tente outra imagem.')
      }
      return joints
    } catch (err) {
      console.warn('[Anima] Falha ao extrair pose:', err)
      throw err
    }
  })

  ipcMain.handle('pose:extractFromBase64', async (event, imageBase64: string) => {
    requireMainWindow(event)
    try {
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        throw new Error('Imagem inválida')
      }
      const imageMatch = imageBase64.match(/^data:image\/(\w+);base64,/)
      const imgExt = imageMatch ? (imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1]) : 'png'
      const inputFilename = `anima-pose-ref-${Date.now()}.${imgExt}`
      const settings = settingsManager.get()
      const comfyInputDir = join(settings.comfyUIPath, 'ComfyUI', 'input')
      await uploadImageToComfyUI(imageBase64, inputFilename, comfyInputDir, comfyClient.getBaseUrl())
      console.log('[Anima] Extraindo pose da imagem enviada...')

      const { openposeJson } = await comfyClient.extractPose(inputFilename)
      const joints = convertOpenPoseToVnccs(openposeJson)

      try {
        rmSync(join(comfyInputDir, inputFilename), { force: true })
      } catch { /* cleanup best-effort */ }

      if (!joints) {
        throw new Error('Não foi possível detectar uma pose na imagem. Verifique se o modelo DWPose foi baixado e tente outra imagem.')
      }
      return joints
    } catch (err) {
      console.warn('[Anima] Falha ao extrair pose:', err)
      throw err
    }
  })

  ipcMain.handle('app:getWorkflowDefaults', async (event, diffusionModel?: unknown) => {
    requireMainWindow(event)
    const validModels = new Set(Object.keys(MODEL_PROFILES))
    const model = typeof diffusionModel === 'string' && validModels.has(diffusionModel)
      ? (diffusionModel as import('@shared/types').DiffusionModelId)
      : 'anima'
    return workflowManager.getDefaults(model)
  })

  ipcMain.handle('app:getModelProfiles', async () => {
    return MODEL_PROFILES
  })

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

  ipcMain.handle('file:readImage', async (event, filePath: string) => {
    requireMainWindow(event)
    try {
      const historyBaseDir = getHistoryBaseDir()
      const allowedBases = [historyBaseDir, settingsManager.resolvedModelsPath, settingsManager.resolvedLorasPath]
      if (!allowedBases.some(base => isPathSafe(filePath, base))) {
        console.warn('[Anima] Tentativa de leitura de arquivo fora das pastas permitidas:', filePath)
        return null
      }

      // Apenas extensões de imagem (evita ler .safetensors/.gguf multi-GB)
      const ALLOWED_EXTS: Record<string, string> = {
        png: 'png',
        jpg: 'jpeg',
        jpeg: 'jpeg',
        webp: 'webp',
        bmp: 'bmp'
      }
      const extMatch = /\.([a-z0-9]+)$/i.exec(filePath)
      const ext = extMatch ? extMatch[1].toLowerCase() : ''
      const mime = ALLOWED_EXTS[ext]
      if (!mime) {
        console.warn('[Anima] Extensão de arquivo não permitida para leitura:', filePath)
        return null
      }

      // Limite de tamanho (50MB) para evitar OOM com arquivos grandes
      const size = statSync(filePath).size
      if (size > 50 * 1024 * 1024) {
        console.warn('[Anima] Arquivo muito grande para leitura:', filePath, size)
        return null
      }

      const buffer = readFileSync(filePath)
      return `data:image/${mime};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('file:readThumbnail', async (event, filePath: string) => {
    requireMainWindow(event)
    try {
      const historyBaseDir = getHistoryBaseDir()
      const allowedBases = [historyBaseDir, settingsManager.resolvedModelsPath, settingsManager.resolvedLorasPath]
      if (!allowedBases.some(base => isPathSafe(filePath, base))) {
        console.warn('[Anima] Tentativa de leitura de arquivo fora das pastas permitidas:', filePath)
        return null
      }

      // Apenas extensões de imagem
      const extMatch = /\.([a-z0-9]+)$/i.exec(filePath)
      const ext = extMatch ? extMatch[1].toLowerCase() : ''
      if (!['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return null

      const size = statSync(filePath).size
      if (size > 50 * 1024 * 1024) return null

      return getThumbnailDataUrl(filePath, join(historyBaseDir, '.thumbs'))
    } catch {
      return null
    }
  })

  ipcMain.handle('file:loadHistory', async (event) => {
    requireMainWindow(event)
    const historyBaseDir = getHistoryBaseDir()
    if (!existsSync(historyBaseDir)) return []

    const dirs = readdirSync(historyBaseDir)
    const items: { id: string; filePath: string; filename: string; params: unknown; timestamp: number }[] = []

    for (const dir of dirs) {
      const dirPath = join(historyBaseDir, dir)
      try {
        if (!statSync(dirPath).isDirectory()) continue
        const metaPath = join(dirPath, 'metadata.json')
        if (!existsSync(metaPath)) continue

        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))

        // Limpa params inchados (base64 de imagens) em históricos antigos,
        // reescrevendo o arquivo em disco para reclamar o espaço
        if (historyParamsHasBloat(meta.params)) {
          try {
            meta.params = sanitizeHistoryParams(meta.params)
            writeFileSync(metaPath, JSON.stringify(meta))
          } catch (err) {
            console.warn(`[Anima] Falha ao regravar histórico enxuto ${dir}:`, err)
          }
        }

        // Novo formato: array de imagens. Antigo: campo `filename` único.
        const filenames: string[] = Array.isArray(meta.images)
          ? meta.images.map((i: { filename: string }) => i.filename).filter(Boolean)
          : meta.filename ? [meta.filename] : []

        for (const filename of filenames) {
          const imgPath = join(dirPath, filename)
          if (!existsSync(imgPath)) continue
          items.push({
            id: dir,
            filePath: imgPath,
            filename,
            params: meta.params,
            timestamp: meta.timestamp
          })
        }
      } catch (err) {
        console.warn(`[Anima] Erro ao ler histórico ${dir}:`, err)
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp)
    return items
  })

  ipcMain.handle('file:deleteHistoryItems', async (event, items: { id: string; filePath: string }[]) => {
    requireMainWindow(event)
    const historyBaseDir = getHistoryBaseDir()
    for (const { id, filePath } of items) {
      if (filePath && existsSync(filePath)) {
        if (!isPathSafe(filePath, historyBaseDir)) {
          console.warn('[Anima] Tentativa de exclusão de arquivo fora do histórico:', filePath)
          continue
        }
        // Remove a miniatura antes da imagem (o hash usa stat do arquivo original)
        deleteThumbnail(filePath, join(historyBaseDir, '.thumbs'))
        rmSync(filePath, { force: true })
      }
      const dirPath = join(historyBaseDir, id)
      if (!isPathSafe(dirPath, historyBaseDir)) {
        console.warn('[Anima] Tentativa de exclusão de diretório fora do histórico:', dirPath)
        continue
      }
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true })
      }
      console.log(`[Anima] Histórico excluído: ${id}`)
    }
  })
}

app.whenReady().then(async () => {
  migrateLegacyHistory()
  setupIPC()
  createWindow()

  // Check if ComfyUI is already online before starting a new instance
  const status = await comfyClient.getStatus()
  if (status.online) {
    console.log('[Anima] ComfyUI já está online, conectando...')
    startStatusPoll()
  } else {
    console.log('[Anima] ComfyUI não está online, iniciando...')
    comfyLauncher.start().then((result) => {
      if (result.success) {
        console.log('[Anima] ComfyUI iniciado em background')
        startStatusPoll()
      } else {
        console.error('[Anima] Falha ao iniciar ComfyUI:', result.message)
        mainWindow?.webContents.send('comfyui:launchError', result.message)
      }
    }).catch((err) => {
      console.error('[Anima] Erro ao iniciar ComfyUI:', err)
      mainWindow?.webContents.send('comfyui:launchError', err instanceof Error ? err.message : 'Erro desconhecido')
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopStatusPoll()
  comfyLauncher.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopStatusPoll()
    comfyLauncher.stop()
    app.quit()
  }
})
