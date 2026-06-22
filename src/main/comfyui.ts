import { WebSocket } from 'ws'
import type { ComfyUIStatus, ComfyUIPromptResponse, ComfyUIHistoryItem } from '@shared/types'

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
    const ws = onProgress ? this.connectProgress(promptId, onProgress) : null
    const startTime = Date.now()
    const pollInterval = 1000

    try {
      while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${this.baseUrl}/history/${promptId}`)
        if (res.ok) {
          const data: Record<string, ComfyUIHistoryItem> = await res.json()
          const item = data[promptId]
          if (item) {
            if (item.status.completed) {
              if (item.status.status_str === 'error') {
                throw new Error(`ComfyUI execution error for prompt ${promptId}`)
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
      throw new Error('Timeout waiting for ComfyUI result')
    } finally {
      ws?.close()
    }
  }

  private connectProgress(promptId: string, onProgress: (current: number, max: number) => void): WebSocket {
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
