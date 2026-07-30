import { WebSocket } from 'ws'
import type { ComfyUIStatus, ComfyUIPromptResponse, ComfyUIHistoryItem } from '@shared/types'

function extractAnyString(obj: unknown, depth = 0): string | null {
  if (depth > 5) return null
  if (typeof obj === 'string' && obj.trim()) return obj.trim()
  if (typeof obj === 'number') return String(obj)
  if (typeof obj !== 'object' || obj === null) return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractAnyString(item, depth + 1)
      if (found) return found
    }
    return null
  }
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = extractAnyString(val, depth + 1)
    if (found) return found
  }
  return null
}

export class ComfyUIClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setUrl(url: string): void {
    this.baseUrl = url
  }

  async getStatus(): Promise<ComfyUIStatus> {
    const endpoints = ['/system_stats', '/queue', '/']
    for (const ep of endpoints) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        const res = await fetch(`${this.baseUrl}${ep}`, { signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) {
          let queueSize = 0
          if (ep === '/queue') {
            try { const q = await res.json(); queueSize = q.queue_running?.length ?? 0 } catch {}
          }
          return { online: true, queueSize }
        }
      } catch {
        continue
      }
    }
    return { online: false, queueSize: 0 }
  }

  async sendPrompt(prompt: Record<string, unknown>): Promise<ComfyUIPromptResponse> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ComfyUI error ${res.status}: ${text}`)
    }
    return res.json()
  }

  async waitForResult(
    promptId: string,
    onProgress?: (current: number, max: number) => void,
    timeoutMs = 300000
  ): Promise<{ filename: string; data: string }[]> {
    let wsError: string | null = null
    const ws = onProgress ? this.connectProgress(promptId, onProgress, (err) => { wsError = err }) : null
    const startTime = Date.now()
    const pollInterval = 1000

    try {
      while (Date.now() - startTime < timeoutMs) {
        if (wsError) {
          throw new Error(wsError)
        }
        const res = await fetch(`${this.baseUrl}/history/${promptId}`)
        if (res.ok) {
          const data: Record<string, ComfyUIHistoryItem> = await res.json()
          const item = data[promptId]
          if (item) {
            const statusStr = item.status?.status_str
            if (statusStr === 'error' || item.status?.completed) {
              if (statusStr === 'error') {
                console.error('[ComfyUIClient] Erro retornado no histórico:', JSON.stringify(item.status))
                const messages = (item.status as any)?.messages
                let details = ''
                if (Array.isArray(messages)) {
                  for (const msg of messages) {
                    if (Array.isArray(msg) && msg[1]) {
                      const msgType = String(msg[0] ?? '').toLowerCase()
                      const info = msg[1]
                      if (msgType.includes('error') || typeof info === 'object') {
                        const nodeType = info.node_type ? `${info.node_type}` : ''
                        const nodeId = info.node_id ? ` (#${info.node_id})` : ''
                        const excMsg = info.exception_message || info.exception_type || info.message
                        if (excMsg) {
                          details += ` [Nó: ${nodeType}${nodeId}]: ${excMsg}`
                        } else if (typeof info === 'string') {
                          details += ` ${info}`
                        }
                      }
                    }
                  }
                }
                if (!details && (item.status as any)?.exception_message) {
                  details = `: ${(item.status as any).exception_message}`
                }
                throw new Error(`Erro na execução do ComfyUI${details || ': Verifique se os modelos e nós exigidos estão instalados.'}`)
              }
              const images: { filename: string; data: string }[] = []
              for (const nodeId of Object.keys(item.outputs)) {
                const output = item.outputs[nodeId]
                if (output.images) {
                  for (const img of output.images) {
                    const imgRes = await fetch(
                      `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
                    )
                    if (imgRes.ok) {
                      const buffer = await imgRes.arrayBuffer()
                      const base64 = Buffer.from(buffer).toString('base64')
                      images.push({ filename: img.filename, data: base64 })
                    }
                  }
                }
              }
              return images
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }
      throw new Error('Timeout esperando resultado do ComfyUI')
    } finally {
      ws?.close()
    }
  }

  async captionImage(
    inputFilename: string
  ): Promise<{ text: string }> {
    // Fetch ALL available node types from ComfyUI
    let allNodesInfo: Record<string, any> = {}
    try {
      const infoRes = await fetch(`${this.baseUrl}/object_info`)
      if (infoRes.ok) {
        allNodesInfo = await infoRes.json()
        const types = Object.keys(allNodesInfo)
        console.log(`[ComfyUIClient] Total de nós disponíveis: ${types.length}`)
      }
    } catch (err) {
      console.warn('[ComfyUIClient] Falha ao buscar nós disponíveis:', err)
      return { text: '' }
    }

    const allNodeTypes = Object.keys(allNodesInfo)

    // Filter actual captioning nodes using their input structure from object_info
    const knownCaptioningPrefixes = ['wdtagger', 'wd14tagger', 'florence2', 'joycaption', 'joy_caption']
    const captionNodeKeywords = ['tagger', 'florence', 'joycaption', 'joy_caption']
    const excludeKeywords = ['switcher', 'merger', 'merge', 'combine', 'split', 'replace',
      'manager', 'filter', 'sort', 'edit', 'selector', 'picker', 'switch']

    const possibleCaptionNodes: { nodeType: string; inputs: Record<string, unknown> }[] = []
    for (const name of allNodeTypes) {
      const lower = name.toLowerCase()
      const isCaptionNode = knownCaptioningPrefixes.some(p => lower.startsWith(p) || lower.includes(p)) ||
        (captionNodeKeywords.some(kw => lower.includes(kw)) &&
         !excludeKeywords.some(kw => lower.includes(kw)))
      if (!isCaptionNode) continue

      // Build the node inputs using the object_info structure
      const nodeInfo = allNodesInfo[name]
      if (!nodeInfo) continue
      const required = nodeInfo?.input?.required as Record<string, any> | undefined
      const captionInputs: Record<string, unknown> = {}
      let hasImageInput = false

      if (required) {
        for (const [inputName, inputDef] of Object.entries(required)) {
          const def = Array.isArray(inputDef) ? inputDef : [inputDef]
          const typeOrOptions = def[0]
          const config = (def[1] || {}) as Record<string, any>

          // Determine if this is an image link or a widget value
          if (typeOrOptions === 'IMAGE' || typeOrOptions === 'MASK') {
            captionInputs[inputName] = ['1', 0]
            hasImageInput = true
          } else if (typeOrOptions === 'LATENT' || typeOrOptions === 'MODEL' ||
                     typeOrOptions === 'CLIP' || typeOrOptions === 'VAE') {
            // Skip non-image complex inputs that can't be auto-provided
            continue
          } else if (Array.isArray(typeOrOptions)) {
            // COMBO type: use the default or first option
            captionInputs[inputName] = config?.default ?? typeOrOptions[0] ?? ''
          } else if (typeOrOptions === 'FLOAT') {
            captionInputs[inputName] = config?.default ?? 0.5
          } else if (typeOrOptions === 'INT') {
            captionInputs[inputName] = config?.default ?? 1
          } else if (typeOrOptions === 'BOOLEAN') {
            captionInputs[inputName] = config?.default ?? false
          } else if (typeOrOptions === 'STRING') {
            captionInputs[inputName] = config?.default ?? (config?.multiline ? '' : '')
          }
        }
      }

      if (!hasImageInput) continue

      possibleCaptionNodes.push({ nodeType: name, inputs: captionInputs })
    }

    console.log('[ComfyUIClient] Nós de captioning encontrados:', possibleCaptionNodes.map(n => `${n.nodeType} (${JSON.stringify(n.inputs).slice(0, 120)})`))

    if (possibleCaptionNodes.length === 0) {
      console.warn('[ComfyUIClient] Nenhum nó de captioning instalado')
      console.warn('[ComfyUIClient] Instale WD14Tagger, Florence2 ou JoyCaption no ComfyUI Manager')
      return { text: '' }
    }

    // Try each available captioning node
    for (const { nodeType, inputs: captionInputs } of possibleCaptionNodes) {
      console.log(`[ComfyUIClient] Tentando nó: ${nodeType}`)
      try {
        const prompt: Record<string, unknown> = {
          '1': {
            class_type: 'LoadImage',
            _meta: { title: 'LoadImage' },
            inputs: { image: inputFilename }
          },
          '2': {
            class_type: nodeType,
            _meta: { title: nodeType },
            inputs: captionInputs
          }
        }

        const response = await this.sendPrompt(prompt)
        const promptId = response.prompt_id
        await this.waitForResult(promptId)

        // Extract text from node outputs
        const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`)
        if (historyRes.ok) {
          const data: Record<string, any> = await historyRes.json()
          const item = data[promptId]
          if (item?.outputs) {
            for (const nodeId of Object.keys(item.outputs)) {
              const output = item.outputs[nodeId]
              // Skip the LoadImage output (node 1), only look at tagger output
              if (nodeId === '1') continue
              console.log(`[ComfyUIClient] Output do nó ${nodeId}:`, JSON.stringify(output).slice(0, 300))
              // Recursively find any string value in the output
              const found = extractAnyString(output)
              if (found) {
                console.log(`[ComfyUIClient] Caption extraído do nó ${nodeType}: ${found.slice(0, 200)}`)
                return { text: found }
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ComfyUIClient] Falha ao executar nó ${nodeType}:`, err)
        continue
      }
    }

    console.warn('[ComfyUIClient] Nenhum nó de captioning produziu resultado')
    return { text: '' }
  }

  private connectProgress(
    promptId: string,
    onProgress: (current: number, max: number) => void,
    onError?: (errorMsg: string) => void
  ): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws'
    const ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      ws.send(JSON.stringify({ prompt_id: promptId }))
    })

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
          onProgress(msg.data.value, msg.data.max)
        } else if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
          const d = msg.data
          const errStr = `Erro de execução no ComfyUI [Nó: ${d.node_type} (#${d.node_id})]: ${d.exception_message || d.exception_type}`
          onError?.(errStr)
        }
      } catch {
        // ignore parse errors
      }
    })

    ws.on('error', () => {
      // WebSocket errors are non-fatal; progress just won't update
    })

    return ws
  }
}
