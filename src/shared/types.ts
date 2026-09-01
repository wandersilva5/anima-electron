// Identificador dos 3 modelos de difusão suportados
export type DiffusionModelId = 'anima' | 'krea2' | 'z-image'

// Perfil completo de um modelo de difusão
export interface ModelProfile {
  id: DiffusionModelId
  label: string
  description: string
  workflowFile: string
  /** Workflow alternativo usado pela aba POSE (transferência de pose por referência visual) */
  poseWorkflowFile?: string
  loraFolder: string
  hasNegativePrompt: boolean
  hasLoraClipStrength: boolean
  defaults: {
    steps: number
    cfg: number
    width: number
    height: number
    sampler: string
    scheduler: string
  }
}

/** Parâmetros para geração de pose via workflow dedicado (sem DWPose) */
export interface PoseGenerationParams {
  charImageBase64: string      // Imagem da personagem (identidade)
  poseImageBase64: string      // Imagem de referência de pose
  seed?: number
  filenamePrefix?: string
  modelName?: string           // Checkpoint opcional
}

// Um LoRA selecionado com suas forças aplicadas
export interface LoraSelection {
  name: string
  strengthModel: number
  strengthClip: number
}

// Limite de LoRAs encadeados por geração (proteção contra payloads absurdos)
export const MAX_LORAS = 10

export interface GenerationParams {
  diffusionModel: DiffusionModelId
  prompt: string
  negativePrompt: string
  seed: number
  steps: number
  cfg: number
  width: number
  height: number
  loras: LoraSelection[]
  modelName: string
  filenamePrefix?: string
  imagePath?: string
  denoise?: number
  maskBase64?: string
  maskFilename?: string
  // Pose parameters (VNCCS)
  poseData?: string
  poseImageBase64?: string
  poseImageFilename?: string
  lineThickness?: number
  safeZone?: number
}

export interface GenerationResult {
  id: string
  imageBase64: string | null
  filePath: string | null
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
  inputs?: { name: string; link: number | null; shape?: number }[]
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
  comfyUrl?: string
}

export interface ComfyUIHistoryItem {
  prompt: unknown[]
  outputs: Record<string, {
    images?: { filename: string; subfolder: string; type: string }[]
    tags?: string
    text?: string
    string?: string
  }>
  status: { status_str: string; completed: boolean }
}

