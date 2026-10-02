import { WebSocket } from 'ws'
import type { ComfyUIStatus, ComfyUIPromptResponse, ComfyUIHistoryItem } from '@shared/types'

function extractAnyString(obj: unknown, depth = 0): string | null {
  if (depth > 5) return null
  if (typeof obj === 'string') {
    const trimmed = obj.trim()
    if (!trimmed) return null
    // Ignora números puros ("0", "1") que aparecem como índices de slot
    // nos outputs — não são caption. Tags reais como "1girl" passam.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return null
    if (trimmed.length < 2) return null
    return trimmed
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return null
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

// ————— Organização de captions (aba Recriar) —————

/** Tags de rating/qualidade que não descrevem a imagem e viram ruído no prompt */
const CAPTION_NOISE_PATTERNS: RegExp[] = [
  /^rating[:\s]/i,
  /^(safe|questionable|sensitive|explicit|nsfw|sfw)$/,
  /^score[\s_-]?\d+$/i,
  /^(general|ecchi|mature|adult)$/,
  /^(absurdres|highres|lowres)$/,
  /^(masterpiece|best quality|amazing quality|normal quality|low quality|worst quality)$/,
  /^\d+([.,]\d+)?$/
]

/** Ordem de leitura desejada: sujeito → aparência → rosto/expressão → roupa → pose → cenário */
const CAPTION_CATEGORY_ORDER: RegExp[] = [
  /^(\d+\+?(girl|boy|other)s?|multiple (girls|boys|views)|solo|couple|group|crowd|no humans)$/,
  /(hair|eyes|eye|skin|breast|body|ears|horn|tail|wing|freckle|mole|scar|muscle|navel|thigh|leg|arm|shoulder|neck|feet|foot)/,
  /(smile|blush|expression|face|mouth|tongue|lip|grin|frown|cry|crying|tears|sweat|glasses|makeup|eyepatch|forehead|nose)/,
  /(dress|shirt|skirt|pant|short|jacket|coat|bra|panties|lingerie|sock|shoe|boot|heel|hat|cap|glove|scarf|tie|ribbon|necklace|earring|jewelry|bracelet|ring|armor|helmet|uniform|costume|clothes|clothing|nude|topless|barefoot|bare|collar|leash|belt|bag|backpack|weapon|sword|staff)/,
  /(stand|sit|lying|lie|kneel|squat|crouch|walk|run|jump|crawl|bend|lean|stretch|hand|finger|pose|from behind|hug|kiss|hold|carry|pull|push|reach|wave|point|covering|pov|sitting|standing)/,
  /(background|outdoors|indoors|sky|beach|forest|city|room|water|nature|scenery|night|day|sunset|sunrise|building|street|window|door|bed|chair|table|floor|wall|grass|tree|flower|leaf|mountain|ocean|sea|river|lake|cloud|star|moon|sun|rain|snow|wind)/
]

function normalizeCaptionTag(raw: string): string | null {
  let t = raw.trim()
  if (!t) return null
  // Remove pesos "tag:1.2", parênteses e colchetes de escape
  t = t.replace(/\(([^()]*)(?::[0-9.]+)?\)/g, '$1')
  t = t.replace(/[[\]{}\\]/g, '')
  t = t.replace(/_/g, ' ')
  t = t.replace(/\s+/g, ' ').trim().toLowerCase()
  if (t.length < 2) return null
  return t
}

import { synthesizeDescriptiveCaption } from './captionSynthesizer'

/**
 * Organiza o texto cru de um tagger (ex.: WD14) ou VLM:
 * - Se mode === 'descriptive' (padrão): sintetiza uma descrição rica e estruturada em prosa natural.
 * - Se mode === 'tags': limpa ruídos, remove duplicatas e ordena por categoria.
 */
export function organizeCaptionText(raw: string, mode: 'descriptive' | 'tags' = 'descriptive'): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  if (mode === 'descriptive') {
    return synthesizeDescriptiveCaption(text)
  }

  // Modo 'tags': organiza lista limpa e ordenada
  const segments = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  // Poucos segmentos = caption em linguagem natural, não uma lista de tags
  if (segments.length < 3) return text

  const seen = new Set<string>()
  const unique: string[] = []
  for (const seg of segments) {
    const tag = normalizeCaptionTag(seg)
    if (!tag) continue
    if (CAPTION_NOISE_PATTERNS.some((p) => p.test(tag))) continue
    if (seen.has(tag)) continue
    seen.add(tag)
    unique.push(tag)
  }
  if (unique.length === 0) return text

  // Trava anti-duplicação no modo tags: sem marcador de contagem, o modelo
  // tende a gerar 2 personagens a partir de 1. Padrão = solo (caso mais
  // comum da aba Recriar); múltiplos reais já trazem 2girls/couple/group.
  const hasCountTag = unique.some((t) =>
    /^(solo|alone|single|1girl|1boy|2girls|3girls|4girls|2boys|3boys|multiple|couple|group|crowd|\d+\+?(girls|boys))$/i.test(t)
  )
  const hasMultipleTag = unique.some((t) =>
    /^(2girls|3girls|4girls|2boys|3boys|multiple|couple|group|crowd|\d+\+?(girls|boys))$/i.test(t) ||
    /^(multiple (girls|boys))$/i.test(t)
  )
  const hasNoHumans = unique.some((t) => /^(no humans|scenery|landscape)$/i.test(t))
  // "girl"+"boy" sem marcador de contagem = casal (não solo).
  const hasFemaleTag = unique.some((t) => /^(female|girl|woman|lady|heroine|waifu|1girl)$/i.test(t))
  const hasMaleTag = unique.some((t) => /^(male|boy|man|guy|hero|1boy)$/i.test(t))
  if (!hasCountTag && !hasNoHumans && !hasMultipleTag) {
    unique.unshift(hasFemaleTag && hasMaleTag ? 'couple' : 'solo')
  }

  const categorized = unique.map((tag, idx) => {
    const cat = CAPTION_CATEGORY_ORDER.findIndex((test) => test.test(tag))
    return { tag, idx, cat: cat === -1 ? CAPTION_CATEGORY_ORDER.length : cat }
  })
  categorized.sort((a, b) => a.cat - b.cat || a.idx - b.idx)

  return categorized.map((x) => x.tag).join(', ')
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

  private objectInfoCache: { nodes: Set<string> | null; at: number } = { nodes: null, at: 0 }

  async getAvailableNodes(): Promise<Set<string>> {
    const now = Date.now()
    if (this.objectInfoCache.nodes && now - this.objectInfoCache.at < 30000) {
      return this.objectInfoCache.nodes
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`${this.baseUrl}/object_info`, { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) return new Set()
      const data = await res.json() as Record<string, unknown>
      const nodes = new Set(Object.keys(data))
      this.objectInfoCache = { nodes, at: now }
      return nodes
    } catch {
      return new Set()
    }
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
                          const hint = regionalErrorHint(String(excMsg))
                          if (hint) details += ` — ${hint}`
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

  async clearCache(): Promise<{ success: boolean; message: string }> {
    try {
      // Limpa a fila pendente (se houver geração travada)
      await fetch(`${this.baseUrl}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true })
      }).catch(() => { /* best-effort */ })

      // Descarrega modelos da VRAM e libera o cache de execução do ComfyUI
      const res = await fetch(`${this.baseUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true })
      })
      if (!res.ok) {
        throw new Error(`ComfyUI /free retornou ${res.status}`)
      }
      console.log('[ComfyUIClient] Cache/buffer do ComfyUI limpo (fila + modelos descarregados)')
      return { success: true, message: 'Cache do ComfyUI limpo' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      console.warn('[ComfyUIClient] Falha ao limpar cache do ComfyUI:', err)
      return { success: false, message: msg }
    }
  }

  async captionImage(
    inputFilename: string,
    mode: 'descriptive' | 'tags' = 'descriptive'
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
      throw new Error('Não foi possível falar com o ComfyUI (/object_info). Verifique se o ComfyUI está online e tente de novo.')
    }

    const allNodeTypes = Object.keys(allNodesInfo)
    if (allNodeTypes.length === 0) {
      throw new Error('Não foi possível ler a lista de nós do ComfyUI (/object_info vazio). Verifique se o ComfyUI está online e tente de novo.')
    }

    // Filter actual captioning nodes using their input structure from object_info
    const knownCaptioningPrefixes = ['wdtagger', 'wd14tagger', 'florence2', 'joycaption', 'joy_caption']
    const captionNodeKeywords = ['tagger', 'florence', 'joycaption', 'joy_caption']
    const excludeKeywords = ['switcher', 'merger', 'merge', 'combine', 'split', 'replace',
      'manager', 'filter', 'sort', 'edit', 'selector', 'picker', 'switch']

    const possibleCaptionNodes: { nodeType: string; inputs: Record<string, unknown> }[] = []
    const skippedNodes: string[] = []
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
      let needsExternalModel = false

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
            // Florence2/JoyCaption pedem MODEL/CLIP externos: o prompt genérico
            // de 2 nós não consegue fornecer isso — marca para pular com motivo.
            needsExternalModel = true
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
      if (needsExternalModel) {
        skippedNodes.push(`${name} (pulado: exige MODEL/CLIP externo — use o workflow próprio do nó ou o WD14 Tagger)`)
        continue
      }

      possibleCaptionNodes.push({ nodeType: name, inputs: captionInputs })
    }

    // WD14/tagger simples primeiro (funcionam com o prompt genérico de 2 nós);
    // Florence/Joy por último, pois costumam exigir loader de modelo próprio.
    const rank = (n: string) => {
      const l = n.toLowerCase()
      if (l.includes('wd14') || l.includes('wdtagger')) return 0
      if (l.includes('tagger')) return 1
      if (l.includes('florence')) return 2
      return 3
    }
    possibleCaptionNodes.sort((a, b) => rank(a.nodeType) - rank(b.nodeType))

    console.log('[ComfyUIClient] Nós de captioning encontrados:', possibleCaptionNodes.map(n => `${n.nodeType} (${JSON.stringify(n.inputs).slice(0, 120)})`))

    if (possibleCaptionNodes.length === 0) {
      const detail = skippedNodes.length > 0
        ? ` Encontrados mas pulados: ${skippedNodes.join('; ')}.`
        : ''
      console.warn('[ComfyUIClient] Nenhum nó de captioning utilizável.' + detail)
      throw new Error(
        'Nenhum nó de captioning utilizável no ComfyUI.' + detail +
        ' Instale o "WD14 Tagger" pelo ComfyUI Manager (com o modelo, ex.: wd-vit-large) e reinicie o ComfyUI.'
      )
    }

    // Try each available captioning node
    const attemptErrors: string[] = []
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
                return { text: organizeCaptionText(found, mode) }
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'erro desconhecido'
        console.warn(`[ComfyUIClient] Falha ao executar nó ${nodeType}:`, err)
        attemptErrors.push(`${nodeType}: ${msg.slice(0, 220)}`)
        continue
      }
    }

    console.warn('[ComfyUIClient] Nenhum nó de captioning produziu resultado')
    throw new Error(
      `Extração falhou nos nós tentados (${possibleCaptionNodes.map((n) => n.nodeType).join(', ')}). ` +
      `Detalhes: ${attemptErrors.join(' | ').slice(0, 500) || 'sem detalhes'}. ` +
      'Abra o console do ComfyUI para ver o erro do nó (modelo do tagger ausente é a causa mais comum após update — baixe o modelo no Manager e reinicie).'
    )
  }

  async extractPose(inputFilename: string): Promise<{ openposeJson: string }> {
    const prompt: Record<string, unknown> = {
      '1': {
        class_type: 'LoadImage',
        _meta: { title: 'LoadImage (pose)' },
        inputs: { image: inputFilename }
      },
      '2': {
        class_type: 'DWPreprocessor',
        _meta: { title: 'DWPose (pose)' },
        inputs: {
          image: ['1', 0],
          detect_hand: 'disable',
          detect_body: 'enable',
          detect_face: 'disable',
          resolution: 512,
          bbox_detector: 'yolox_l.onnx',
          pose_estimator: 'dw-ll_ucoco_384_bs5.torchscript.pt',
          scale_stick_for_xinsr_cn: 'disable'
        }
      },
      '3': {
        class_type: 'SaveImage',
        _meta: { title: 'SaveImage (pose)' },
        inputs: {
          images: ['2', 0],
          filename_prefix: 'anima-pose-extract'
        }
      }
    }

    const response = await this.sendPrompt(prompt)
    const promptId = response.prompt_id
    console.log('[ComfyUIClient] Extraindo pose via DWPose, prompt:', promptId)
    await this.waitForResult(promptId)

    const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`)
    if (!historyRes.ok) {
      throw new Error('Falha ao obter resultado do DWPose')
    }
    const data: Record<string, ComfyUIHistoryItem> = await historyRes.json()
    const item = data[promptId]
    const outputs = (item?.outputs ?? {}) as Record<string, Record<string, unknown>>
    let openposeJson = ''
    for (const nodeId of Object.keys(outputs)) {
      const out = outputs[nodeId]
      if (!out) continue
      for (const [key, val] of Object.entries(out)) {
        if (key.toLowerCase().includes('openpose') || key.toLowerCase().includes('json')) {
          if (Array.isArray(val) && typeof val[0] === 'string') {
            openposeJson = val[0]
            break
          }
        }
      }
      if (openposeJson) break
    }
    if (!openposeJson) {
      throw new Error('DWPose não retornou dados de pose')
    }
    return { openposeJson }
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
          const baseMsg = d.exception_message || d.exception_type
          const hint = regionalErrorHint(String(baseMsg ?? ''))
          const errStr = `Erro de execução no ComfyUI [Nó: ${d.node_type} (#${d.node_id})]: ${baseMsg}${hint ? ` — ${hint}` : ''}`
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

/** Traduz erros conhecidos do regional prompting (SimpleSyrup) em dica acionável. */
function regionalErrorHint(msg: string): string | null {
  if (msg.includes('lifecycle owners cannot be empty')) {
    return 'Nenhuma região LoRA ficou ativa — a detecção não encontrou rosto/seios na imagem, ou a força do LoRA está em 0. Use uma imagem com o rosto visível e forças acima de zero.'
  }
  if (msg.includes('composition cannot be empty')) {
    return 'Os LoRAs regionais não foram carregados — confirme que os arquivos escolhidos ainda existem na pasta de LoRAs do modelo.'
  }
  return null
}
