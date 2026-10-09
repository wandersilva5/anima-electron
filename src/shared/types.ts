// Identificador dos modelos de difusão suportados
export type DiffusionModelId = 'anima' | 'krea2' | 'qwen-image' | 'z-image'

/**
 * Modo de edição da aba Melhoria (Qwen Image 2.1):
 * - edit: edição nativa do 2.1 (amostra no latent do TextEncodeQwenImage21,
 *   com a imagem de origem referenciada como <image1>)
 * - refine: img2img clássico com força (denoise) controlável
 * - inpaint: img2img com máscara (área marcada com o pincel)
 */
export type ImproveEditMode = 'edit' | 'refine' | 'inpaint'

// Perfil completo de um modelo de difusão
export interface ModelProfile {
  id: DiffusionModelId
  label: string
  description: string
  workflowFile: string
  /** Workflow da aba POSE (VNCCS Pose Studio QI2.1), carregado no webview do ComfyUI */
  poseWorkflowFile?: string
  /** Workflow alternativo usado pela aba ROUPA (transferência de roupa por referência visual) */
  outfitWorkflowFile?: string
  /** Workflow usado pela aba MELHORIA (edição img2img com imagem de referência opcional) */
  improveWorkflowFile?: string
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

/** Parâmetros para geração de pose via workflow VNCCS Pose Studio (Qwen-Image 2.1) */
export interface PoseGenerationParams {
  charImageBase64: string      // Imagem da personagem (identidade)
  /**
   * Render PNG do mannequin Three.js (fundo branco, mesh cinza clay, 1024×1024)
   * enviado como imagem de pose. Vira image_1 do pipeline Qwen.
   */
  poseImageBase64: string
  seed?: number
  filenamePrefix?: string
  modelName?: string           // Checkpoint opcional
}

/** Parâmetros para transferência de roupa via workflow dedicado (Krea2-Outfit) */
export interface OutfitGenerationParams {
  charImageBase64: string      // Imagem da personagem (identidade + pose a manter)
  outfitImageBase64: string    // Imagem de referência da roupa de outro personagem
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

// LoRA aplicado a uma região da imagem (teste de regional prompting).
// O nome é resolvido pelo Prompt Control dentro da pasta de LoRAs do perfil.
export interface RegionalLoraSlot {
  name: string
  strengthModel: number
  strengthClip: number
}

// Regiões suportadas pelo teste: rosto (detecção de face), seios e corpo (segmentação)
export interface RegionalParams {
  face?: RegionalLoraSlot | null
  breasts?: RegionalLoraSlot | null
  body?: RegionalLoraSlot | null
}

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
  // LoRAs por região (teste — apenas perfil anima)
  regional?: RegionalParams
  // Modo de edição (aba Melhoria, Qwen Image 2.1)
  editMode?: ImproveEditMode
  /** Arquivo da imagem de referência extra (slot <image2>) já enviado ao ComfyUI */
  refImagePath?: string
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

