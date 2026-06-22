import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'

export interface ComfyLaunchResult {
  success: boolean
  message: string
}

export class ComfyLauncher {
  private process: ChildProcess | null = null
  private _running = false
  private comfyDir: string

  constructor(comfyDir: string) {
    this.comfyDir = comfyDir
  }

  updatePath(comfyDir: string): void {
    this.comfyDir = comfyDir
  }

  get running(): boolean {
    return this._running
  }

  async start(): Promise<ComfyLaunchResult> {
    if (this._running) {
      return { success: true, message: 'ComfyUI já está em execução' }
    }

    try {
      const python = join(this.comfyDir, 'python_embeded', 'python.exe')
      const mainPy = join(this.comfyDir, 'ComfyUI', 'main.py')
      this.process = spawn(python, [
        '-s', mainPy,
        '--disable-smart-memory',
        '--lowvram',
        '--force-fp16',
        '--windows-standalone-build',
        '--use-pytorch-cross-attention',
        '--async-offload',
        '--preview-method', 'none'
      ], {
        cwd: this.comfyDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      this._running = true

      this.process.stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n').filter(Boolean)) {
          console.log(`[ComfyUI] ${line}`)
        }
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n').filter(Boolean)) {
          // ComfyUI often logs to stderr for normal messages
          console.log(`[ComfyUI] ${line}`)
        }
      })

      this.process.on('exit', (code) => {
        this._running = false
        this.process = null
        if (code !== 0 && code !== null) {
          console.error(`[Anima] ComfyUI fechou inesperadamente (código ${code})`)
        }
      })

      this.process.on('error', (err) => {
        this._running = false
        this.process = null
        console.error(`[Anima] Erro ao iniciar ComfyUI:`, err.message)
      })

      return { success: true, message: 'ComfyUI iniciado' }
    } catch (err) {
      this._running = false
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error(`[Anima] Falha ao iniciar ComfyUI:`, message)
      return { success: false, message }
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process) {
          try { this.process.kill('SIGKILL') } catch {}
        }
      }, 5000)
      this.process = null
      this._running = false
      console.log('[Anima] ComfyUI finalizado')
    }
  }
}
