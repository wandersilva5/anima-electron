import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { ComfyUIClient } from './comfyui'
import { ComfyLauncher } from './comfyLauncher'
import { WorkflowManager } from './workflow'
import { LoraScanner } from './loraScanner'
import { ModelScanner } from './modelScanner'
import { SettingsManager } from './settings'

let mainWindow: BrowserWindow | null = null
let comfyClient: ComfyUIClient
let comfyLauncher: ComfyLauncher
let workflowManager: WorkflowManager
let loraScanner: LoraScanner
let modelScanner: ModelScanner

let statusPollInterval: ReturnType<typeof setInterval> | null = null

function startStatusPoll(): void {
  // Poll ComfyUI status every 5 seconds and notify renderer
  if (statusPollInterval) clearInterval(statusPollInterval)
  statusPollInterval = setInterval(async () => {
    const status = await comfyClient.getStatus()
    mainWindow?.webContents.send('comfyui:statusUpdate', {
      ...status,
      launching: comfyLauncher.running && !status.online
    })
    // Once online, slow down polling
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
  workflowManager = new WorkflowManager(join(__dirname, '../../workflows/anima-simples.json'))
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

    const historyBaseDir = join(app.getPath('userData'), 'history')
    const historyDir = join(historyBaseDir, response.prompt_id)
    let savedImages = images.map((img) => ({ ...img, filePath: '' }))

    try {
      if (!existsSync(historyBaseDir)) {
        mkdirSync(historyBaseDir, { recursive: true })
        console.log(`[Anima] Pasta de histórico criada: ${historyBaseDir}`)
      }
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true })
      }

      savedImages = []
      for (const img of images) {
        const imgPath = join(historyDir, img.filename)
        writeFileSync(imgPath, Buffer.from(img.data, 'base64'))
        savedImages.push({ ...img, filePath: imgPath })

        const metadata = {
          params,
          filename: img.filename,
          timestamp: Date.now()
        }
        writeFileSync(join(historyDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
      }

      console.log(`[Anima] Imagens salvas em: ${historyDir}`)
    } catch (err) {
      console.warn(`[Anima] Erro ao salvar histórico em ${historyDir}:`, err)
    }

    return { promptId: response.prompt_id, images: savedImages }
  })

  ipcMain.handle('loras:list', async () => {
    const loras = loraScanner.scan()
    console.log(`[Anima] LoRAs encontrados: ${loras.length}`)
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

  ipcMain.handle('app:getWorkflowDefaults', async () => {
    return workflowManager.getDefaults()
  })

  ipcMain.handle('file:readImage', async (_event, filePath: string) => {
    try {
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

  ipcMain.handle('file:deleteHistoryItems', async (_event, ids: string[]) => {
    const historyBaseDir = join(app.getPath('userData'), 'history')
    for (const id of ids) {
      const dirPath = join(historyBaseDir, id)
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true })
        console.log(`[Anima] Histórico excluído: ${id}`)
      }
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
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  comfyLauncher.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    comfyLauncher.stop()
    app.quit()
  }
})
