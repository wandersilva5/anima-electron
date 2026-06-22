export interface GenerationParams {
  prompt: string
  negativePrompt: string
  seed: number
  steps: number
  cfg: number
  width: number
  height: number
  loraName: string | null
  loraStrengthModel: number
  loraStrengthClip: number
  modelName: string
}

export interface GenerationResult {
  id: string
  imageBase64: string
  filename: string
  params: GenerationParams
  timestamp: number
}

export interface ComfyUIStatus {
  online: boolean
  queueSize: number
  launching?: boolean
}

export interface LoraInfo {
  name: string
  path: string
  previewUrl?: string
}

export interface ModelInfo {
  name: string
  path: string
  type: 'checkpoints' | 'diffusion_models' | 'unet'
  previewUrl?: string
}

export interface WorkflowNode {
  id: number
  type: string
  color?: string
  bgcolor?: string
  widgets_values?: unknown[]
  inputs?: { name: string; link: number | null }[]
  outputs?: { name: string; links?: (number | null)[] }[]
}

export interface WorkflowJSON {
  id: string
  last_node_id: number
  last_link_id: number
  nodes: WorkflowNode[]
  links: (number | null)[][]
  groups: unknown[]
  config: Record<string, unknown>
  extra: Record<string, unknown>
  version: number
}

export interface ComfyUIPromptResponse {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface AppSettings {
  comfyUIPath: string
  modelsPath: string
  lorasPath: string
}

export interface ComfyUIHistoryItem {
  prompt: unknown[]
  outputs: Record<string, {
    images: { filename: string; subfolder: string; type: string }[]
  }>
  status: { status_str: string; completed: boolean }
}
