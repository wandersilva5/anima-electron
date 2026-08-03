import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { ComfyUIClient } from './comfyui'
import { ComfyLauncher } from './comfyLauncher'
import { WorkflowManager } from './workflow'
import { LoraScanner } from './loraScanner'
import { ModelScanner } from './modelScanner'
import { SettingsManager } from './settings'
import type { GenerationParams } from '@shared/types'
import { MODEL_PROFILES } from '@shared/modelProfiles'

let mainWindow: BrowserWindow | null = null
let comfyClient: ComfyUIClient
let comfyLauncher: ComfyLauncher
let workflowManager: WorkflowManager
let loraScanner: LoraScanner
let modelScanner: ModelScanner

let statusPollInterval: ReturnType<typeof setInterval> | null = null
let statusPollActive = false

function buildTimestamp(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
}

function getImageExt(filename: string): string {
  if (filename.endsWith('.png')) return 'png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'jpg'
  return 'png'
}

function saveImagesToHistory(
  promptId: string,
  images: { filename: string; data: string }[],
  params: Record<string, unknown>,
  prefix = 'anima'
): { filename: string; data: string; filePath: string }[] {
  const historyBaseDir = join(app.getPath('userData'), 'history')
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

    let metadata: Record<string, unknown> | null = null
    for (const img of images) {
      const timestamp = buildTimestamp()
      const ext = getImageExt(img.filename)
      const newFilename = `[${prefix}][${timestamp}].${ext}`
      const imgPath = join(historyDir, newFilename)
      writeFileSync(imgPath, Buffer.from(img.data, 'base64'))
      savedImages.push({ ...img, filePath: imgPath, filename: newFilename })

      metadata = { params, filename: newFilename, timestamp: Date.now() }
    }

    if (metadata) {
      writeFileSync(join(historyDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
    }

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

function isPathSafe(targetPath: string, allowedBase: string): boolean {
  const normalized = join(targetPath)
  const base = join(allowedBase)
  return normalized.startsWith(base)
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
  return {
    ...p,
    prompt: str(p.prompt),
    negativePrompt: str(p.negativePrompt),
    modelName: str(p.modelName),
    loraName: p.loraName ? str(p.loraName) : null,
    filenamePrefix: str(p.filenamePrefix, 'anima'),
    seed: Math.max(0, Math.floor(num(p.seed, 0, 0, 2147483647))),
    steps: Math.floor(num(p.steps, 20, 1, 50)),
    cfg: num(p.cfg, 5, 1, 20),
    width: Math.floor(num(p.width, 648, 64, 4096)),
    height: Math.floor(num(p.height, 1152, 64, 4096)),
    loraStrengthModel: num(p.loraStrengthModel, 0.5, 0, 2),
    loraStrengthClip: num(p.loraStrengthClip, 0.5, 0, 2),
    denoise: p.denoise !== undefined ? num(p.denoise, 1, 0.05, 1) : undefined
  }
}

function stopStatusPoll(): void {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
  statusPollActive = false
}

function startStatusPoll(): void {
  if (statusPollActive) return
  statusPollActive = true

  statusPollInterval = setInterval(async () => {
    const status = await comfyClient.getStatus()
    mainWindow?.webContents.send('comfyui:statusUpdate', {
      ...status,
      launching: comfyLauncher.running && !status.online
    })
    if (status.online && statusPollInterval) {
      clearInterval(statusPollInterval)
      statusPollInterval = setInterval(async () => {
        const s = await comfyClient.getStatus()
        mainWindow?.webContents.send('comfyui:statusUpdate', { ...s, launching: false })
      }, 15000)
    }
  }, 2000)
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
  workflowManager = new WorkflowManager(join(__dirname, '../../workflows'), settings.comfyUIPath)
  loraScanner = new LoraScanner(settingsManager)
  modelScanner = new ModelScanner(settingsManager)

  ipcMain.handle('comfyui:status', async () => {
    return comfyClient.getStatus()
  })

  ipcMain.handle('comfyui:generate', async (_event, rawParams) => {
    const params = sanitizeGenerationParams(rawParams) as unknown as GenerationParams
    console.log('[Anima] Iniciando geração...')
    console.log('[Anima] Modelo:', params.modelName, '| LoRA:', params.loraName ?? 'nenhum')
    console.log('[Anima] Prompt:', (params.prompt ?? '').slice(0, 80) + '...')
    console.log('[Anima] Seed:', params.seed, 'Steps:', params.steps, 'CFG:', params.cfg)
    const prompt = workflowManager.buildPrompt(params)
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

  ipcMain.handle('comfyui:generateImprove', async (_event, rawParams) => {
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
    const prompt = workflowManager.buildPrompt(improveParams)
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
    return { promptId: response.prompt_id, images: savedImages }
  })

  ipcMain.handle('comfyui:captionImage', async (_event, params: { imageBase64: string }) => {
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

    const result = await comfyClient.captionImage(inputFilename)
    console.log('[Anima] Caption gerado:', result.text ? result.text.slice(0, 100) + '...' : 'vazio')

    return result
  })

  ipcMain.handle('loras:list', async (_event, subfolder?: string) => {
    const loras = loraScanner.scan(subfolder)
    console.log(`[Anima] LoRAs encontrados: ${loras.length} para a subpasta: ${subfolder ?? 'todas'}`)
    if (loras.length > 0) console.log(`[Anima] Primeiro LoRA: ${loras[0].name}, preview: ${loras[0].previewUrl ?? 'nenhum'}`)
    return loras
  })

  ipcMain.handle('models:list', async () => {
    const models = modelScanner.scan()
    console.log(`[Anima] Modelos encontrados: ${models.length}`)
    if (models.length > 0) console.log(`[Anima] Primeiro modelo: ${models[0].name}, type: ${models[0].type}`)
    return models
  })

  ipcMain.handle('comfyui:setUrl', async (_event, url: string) => {
    comfyClient.setUrl(url)
  })

  ipcMain.handle('comfyui:launch', async () => {
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

  ipcMain.handle('settings:get', async () => {
    return settingsManager.get()
  })

  ipcMain.handle('settings:set', async (_event, newSettings) => {
    const updated = settingsManager.set(newSettings)
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

  ipcMain.handle('pose:extractFromImage', async (_event, imagePath: string) => {
    try {
      if (!imagePath || typeof imagePath !== 'string') {
        throw new Error('Caminho de imagem inválido')
      }
      if (!existsSync(imagePath)) {
        throw new Error('Arquivo de imagem não encontrado')
      }
      const buffer = readFileSync(imagePath)
      const ext = imagePath.endsWith('.png') ? 'png' : imagePath.endsWith('.webp') ? 'webp' : 'jpg'
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

  ipcMain.handle('pose:extractFromBase64', async (_event, imageBase64: string) => {
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

  ipcMain.handle('app:getWorkflowDefaults', async (_event, diffusionModel?: any) => {
    return workflowManager.getDefaults(diffusionModel)
  })

  ipcMain.handle('app:getModelProfiles', async () => {
    return MODEL_PROFILES
  })

  ipcMain.handle('file:readImage', async (_event, filePath: string) => {
    try {
      const historyBaseDir = join(app.getPath('userData'), 'history')
      const allowedBases = [historyBaseDir, settingsManager.resolvedModelsPath, settingsManager.resolvedLorasPath]
      if (!allowedBases.some(base => isPathSafe(filePath, base))) {
        console.warn('[Anima] Tentativa de leitura de arquivo fora das pastas permitidas:', filePath)
        return null
      }
      const buffer = readFileSync(filePath)
      const ext = filePath.endsWith('.png') ? 'png' : 'jpeg'
      return `data:image/${ext};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('file:loadHistory', async () => {
    const historyBaseDir = join(app.getPath('userData'), 'history')
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
        const imgPath = join(dirPath, meta.filename)
        if (!existsSync(imgPath)) continue

        items.push({
          id: dir,
          filePath: imgPath,
          filename: meta.filename,
          params: meta.params,
          timestamp: meta.timestamp
        })
      } catch (err) {
        console.warn(`[Anima] Erro ao ler histórico ${dir}:`, err)
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp)
    return items
  })

  ipcMain.handle('file:deleteHistoryItems', async (_event, items: { id: string; filePath: string }[]) => {
    const historyBaseDir = join(app.getPath('userData'), 'history')
    for (const { id, filePath } of items) {
      if (filePath && existsSync(filePath)) {
        if (!isPathSafe(filePath, historyBaseDir)) {
          console.warn('[Anima] Tentativa de exclusão de arquivo fora do histórico:', filePath)
          continue
        }
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
