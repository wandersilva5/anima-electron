import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { ComfyUIClient } from './comfyui'
import { ComfyLauncher } from './comfyLauncher'
import { WorkflowManager } from './workflow'
import { LoraScanner } from './loraScanner'
import { ModelScanner } from './modelScanner'
import { SettingsManager } from './settings'
import { MODEL_PROFILES } from '../shared/modelProfiles'

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

  comfyClient = new ComfyUIClient('http://127.0.0.1:8188')
  comfyLauncher = new ComfyLauncher(settings.comfyUIPath)
  workflowManager = new WorkflowManager(join(__dirname, '../../workflows'), settings.comfyUIPath)
  loraScanner = new LoraScanner(settingsManager)
  modelScanner = new ModelScanner(settingsManager)

  ipcMain.handle('comfyui:status', async () => {
    return comfyClient.getStatus()
  })

  ipcMain.handle('comfyui:generate', async (_event, params) => {
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

    const savedImages = saveImagesToHistory(response.prompt_id, images, params, params.filenamePrefix || 'anima')
    return { promptId: response.prompt_id, images: savedImages }
  })

  ipcMain.handle('comfyui:generateImprove', async (_event, params) => {
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
      maskFilename
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

    const savedImages = saveImagesToHistory(response.prompt_id, images, improveParams, params.filenamePrefix || 'anima-improve')
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
    return updated
  })

  ipcMain.handle('settings:selectDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecionar pasta'
    })
    return result.canceled ? null : result.filePaths[0]
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
      if (!isPathSafe(filePath, historyBaseDir)) {
        console.warn('[Anima] Tentativa de leitura de arquivo fora do histórico:', filePath)
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
