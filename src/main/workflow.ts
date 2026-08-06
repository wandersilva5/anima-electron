import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { GenerationParams, WorkflowJSON, DiffusionModelId } from '@shared/types'
import { MODEL_PROFILES } from '@shared/modelProfiles'

interface WorkflowDefaults {
  steps: number
  cfg: number
  width: number
  height: number
  seed: number
  sampler: string
  scheduler: string
  denoise: number
  positivePrompt: string
  negativePrompt: string
  loraName: string
  loraStrengthModel: number
  loraStrengthClip: number
  modelName: string
}

interface WorkflowData {
  workflow: WorkflowJSON
  positiveNodeId: number | null
  negativeNodeId: number | null
  vaeNodeId: number | null
  ksamplerNodeId: number | null
  emptyLatentNodeId: number | null
  defaults: WorkflowDefaults
}

function mapGGUFClipToSafetensors(ggufPath: string): string {
  const knownMappings: Record<string, string> = {
    'Qwen3-4B-Q6_K.gguf': 'qwen\\qwen3_4b_fp8_scaled.safetensors',
    'Qwen3-4B-Q8_0.gguf': 'qwen\\qwen3_4b_fp8_scaled.safetensors',
    'Qwen3-4B-Q4_K_M.gguf': 'qwen\\qwen3_4b_fp8_scaled.safetensors',
    'Qwen3-4B-Q4_K_S.gguf': 'qwen\\qwen3_4b_fp8_scaled.safetensors',
  }
  const filename = ggufPath.split('\\').pop() || ggufPath
  if (knownMappings[filename]) {
    return knownMappings[filename]
  }
  // Fallback: strip quantization suffix (e.g. -Q6_K) and change .gguf to .safetensors
  const folder = ggufPath.includes('\\') ? ggufPath.substring(0, ggufPath.lastIndexOf('\\') + 1) : ''
  const baseName = filename.replace(/-(?:[A-Z0-9]+_?)+\.gguf$/i, '').replace(/\.gguf$/i, '')
  return folder + baseName + '.safetensors'
}

function findOriginNode(workflow: WorkflowJSON, targetNodeId: number, inputName: string): any {
  const node = workflow.nodes.find(n => n.id === targetNodeId)
  if (!node || !node.inputs) return undefined
  const input = node.inputs.find(i => i.name === inputName)
  if (!input || input.link === null) return undefined
  const link = workflow.links.find(l => l[0] === input.link)
  if (!link) return undefined
  const originNodeId = link[1]
  return workflow.nodes.find(n => n.id === originNodeId)
}

export class WorkflowManager {
  private workflows: Record<string, WorkflowData> = {}
  private comfyUIPath: string

  constructor(workflowsDir: string, comfyUIPath?: string) {
    this.comfyUIPath = comfyUIPath || ''
    if (this.comfyUIPath) {
      this.patchGGUFPlugin()
    }
    for (const [modelId, profile] of Object.entries(MODEL_PROFILES)) {
      try {
        const filePath = join(workflowsDir, profile.workflowFile)
        const raw = readFileSync(filePath, 'utf-8')
        const workflow: WorkflowJSON = JSON.parse(raw)

        let positiveNodeId: number | null = null
        let negativeNodeId: number | null = null
        let vaeNodeId: number | null = null
        let ksamplerNodeId: number | null = null
        let emptyLatentNodeId: number | null = null

        const ksampler = workflow.nodes.find(n => n.type === 'KSampler')
        if (ksampler) {
          ksamplerNodeId = ksampler.id
          const posNode = findOriginNode(workflow, ksampler.id, 'positive')
          if (posNode && posNode.type === 'CLIPTextEncode') {
            positiveNodeId = posNode.id
          }
          const negNode = findOriginNode(workflow, ksampler.id, 'negative')
          if (negNode && negNode.type === 'CLIPTextEncode') {
            negativeNodeId = negNode.id
          }
        }

        const vaeDecode = workflow.nodes.find(n => n.type === 'VAEDecode')
        if (vaeDecode) {
          const vaeSrc = findOriginNode(workflow, vaeDecode.id, 'vae')
          if (vaeSrc) {
            vaeNodeId = vaeSrc.id
          }
        }

        const emptyLatent = workflow.nodes.find(
          n => n.type === 'EmptyLatentImage' || n.type === 'EmptySD3LatentImage'
        )
        if (emptyLatent) {
          emptyLatentNodeId = emptyLatent.id
        }

        const defaults = this.extractDefaults(workflow, positiveNodeId, negativeNodeId)

        this.workflows[modelId] = {
          workflow,
          positiveNodeId,
          negativeNodeId,
          vaeNodeId,
          ksamplerNodeId,
          emptyLatentNodeId,
          defaults
        }
      } catch (err) {
        console.error(`[WorkflowManager] Erro ao carregar workflow para ${modelId}:`, err)
      }
    }
  }

  private patchGGUFPlugin(): void {
    try {
      const loaderPath = join(this.comfyUIPath, 'ComfyUI', 'custom_nodes', 'ComfyUI-GGUF', 'loader.py')
      if (!existsSync(loaderPath)) {
        console.warn('[WorkflowManager] ComfyUI-GGUF loader.py not found')
        return
      }
      const content = readFileSync(loaderPath, 'utf-8')
      if (content.includes('qwen3')) {
        console.log('[WorkflowManager] ComfyUI-GGUF loader.py already supports qwen3')
        return
      }

      // Backup antes de modificar
      const backupPath = loaderPath + '.anima.bak'
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, content, 'utf-8')
      }

      // Patch apenas linhas que contêm qwen2vl (evita regex frágil no arquivo inteiro)
      const lines = content.split('\n')
      const patchedLines = lines.map(line => {
        if (line.includes('qwen2vl') && !line.includes('qwen3')) {
          return line
            .replace('"qwen2vl"', '"qwen2vl", "qwen3"')
            .replace("'qwen2vl'", "'qwen2vl', 'qwen3'")
        }
        return line
      })
      const patched = patchedLines.join('\n')

      if (patched === content) {
        console.warn('[WorkflowManager] Could not patch ComfyUI-GGUF loader.py (no qwen2vl line found)')
        return
      }

      writeFileSync(loaderPath, patched, 'utf-8')
      console.log('[WorkflowManager] ComfyUI-GGUF loader.py patched for qwen3 support (backup criado em loader.py.anima.bak)')
    } catch (err) {
      console.warn('[WorkflowManager] Failed to patch ComfyUI-GGUF loader.py:', err)
    }
  }

  // Ensure the Anima pose LLLite weights are available in the model_patches
  // folder (where ModelPatchLoader reads from), copying from controlnet when
  // only that copy exists. Returns the relative name used by ModelPatchLoader,
  // or null when the file could not be located.
  private ensureAnimaLLLite(relativePath: string): string | null {
    try {
      if (!this.comfyUIPath) return null
      const modelsDir = join(this.comfyUIPath, 'ComfyUI', 'models')
      const modelPatchesFile = join(modelsDir, 'model_patches', relativePath)
      const controlnetFile = join(modelsDir, 'controlnet', relativePath)
      if (existsSync(modelPatchesFile)) {
        return relativePath
      }
      if (existsSync(controlnetFile)) {
        mkdirSync(dirname(modelPatchesFile), { recursive: true })
        copyFileSync(controlnetFile, modelPatchesFile)
        console.log('[WorkflowManager] Anima pose LLLite copied to model_patches')
        return relativePath
      }
      console.warn(`[WorkflowManager] Anima pose LLLite not found: ${relativePath}`)
      return null
    } catch (err) {
      console.warn('[WorkflowManager] Failed to ensure Anima pose LLLite:', err)
      return null
    }
  }

  private extractDefaults(
    workflow: WorkflowJSON,
    positiveNodeId: number | null,
    negativeNodeId: number | null
  ): WorkflowDefaults {
    const nodes = workflow.nodes

    const ksampler = nodes.find(n => n.type === 'KSampler')
    const emptyLatent = nodes.find(n => n.type === 'EmptyLatentImage' || n.type === 'EmptySD3LatentImage')
    const positiveEncode = positiveNodeId !== null ? nodes.find(n => n.id === positiveNodeId) : null
    const negativeEncode = negativeNodeId !== null ? nodes.find(n => n.id === negativeNodeId) : null
    const loraLoader = nodes.find(n => n.type === 'LoraLoader' || n.type === 'LoraLoaderModelOnly')
    const unetLoader = nodes.find(n => n.type === 'UNETLoader' || n.type === 'UnetLoaderGGUF')

    return {
      steps: (ksampler?.widgets_values?.[2] as number) ?? 20,
      cfg: (ksampler?.widgets_values?.[3] as number) ?? 5,
      width: (emptyLatent?.widgets_values?.[0] as number) ?? 648,
      height: (emptyLatent?.widgets_values?.[1] as number) ?? 1152,
      seed: (ksampler?.widgets_values?.[0] as number) ?? 0,
      sampler: (ksampler?.widgets_values?.[4] as string) ?? 'er_sde',
      scheduler: (ksampler?.widgets_values?.[5] as string) ?? 'simple',
      denoise: (ksampler?.widgets_values?.[6] as number) ?? 1,
      positivePrompt: (positiveEncode?.widgets_values?.[0] as string) ?? '',
      negativePrompt: (negativeEncode?.widgets_values?.[0] as string) ?? '',
      loraName: (loraLoader?.widgets_values?.[0] as string) ?? 'None',
      loraStrengthModel: (loraLoader?.widgets_values?.[1] as number) ?? 0.5,
      loraStrengthClip: (loraLoader?.type === 'LoraLoader' ? (loraLoader.widgets_values?.[2] as number) : 0.5),
      modelName: (unetLoader?.widgets_values?.[0] as string) ?? ''
    }
  }

  getDefaults(modelId: DiffusionModelId = 'anima'): WorkflowDefaults {
    const data = this.workflows[modelId]
    if (data) {
      return { ...data.defaults }
    }
    console.warn(`[WorkflowManager] Workflow defaults não encontrados para ${modelId}, usando fallback`)
    const profile = MODEL_PROFILES[modelId]
    return {
      steps: profile.defaults.steps,
      cfg: profile.defaults.cfg,
      width: profile.defaults.width,
      height: profile.defaults.height,
      seed: 0,
      sampler: profile.defaults.sampler,
      scheduler: profile.defaults.scheduler,
      denoise: 1,
      positivePrompt: '',
      negativePrompt: '',
      loraName: 'None',
      loraStrengthModel: 0.5,
      loraStrengthClip: 0.5,
      modelName: ''
    }
  }

  buildPrompt(params: GenerationParams): Record<string, unknown> {
    const modelId = params.diffusionModel || 'anima'
    const data = this.workflows[modelId]
    if (!data) {
      throw new Error(`Workflow not loaded for model: ${modelId}`)
    }

    const nodes = structuredClone(data.workflow.nodes)
    const prompt: Record<string, unknown> = {}
    const skipNodeIds = new Set<number>()

    const isImg2Img = !!params.imagePath
    const hasLora = !!params.loraName

    if (!hasLora) {
      const loraNode = nodes.find(n => n.type === 'LoraLoader' || n.type === 'LoraLoaderModelOnly')
      if (loraNode) {
        skipNodeIds.add(loraNode.id)
      }
    }

    for (const node of nodes) {
      if (node.type === 'Note' || node.type === 'Reroute') continue
      if (skipNodeIds.has(node.id)) continue
      const widgetValues = [...(node.widgets_values ?? [])]

      switch (node.type) {
        case 'KSampler': {
          widgetValues[0] = params.seed
          widgetValues[2] = params.steps
          widgetValues[3] = params.cfg
          widgetValues.splice(1, 1) // remove control_after_generate (não vira input)
          if (isImg2Img && params.denoise !== undefined) {
            widgetValues[widgetValues.length - 1] = params.denoise
          }
          break
        }
        case 'EmptyLatentImage':
        case 'EmptySD3LatentImage': {
          if (!isImg2Img) {
            widgetValues[0] = params.width
            widgetValues[1] = params.height
          }
          break
        }
        case 'CLIPTextEncode': {
          if (node.id === data.positiveNodeId) {
            widgetValues[0] = params.prompt
          } else if (node.id === data.negativeNodeId) {
            if (params.negativePrompt) {
              widgetValues[0] = params.negativePrompt
            }
          }
          break
        }
        case 'LoraLoader': {
          if (params.loraName) {
            widgetValues[0] = params.loraName
          } else {
            widgetValues[0] = 'None'
          }
          widgetValues[1] = params.loraStrengthModel
          widgetValues[2] = params.loraStrengthClip
          break
        }
        case 'LoraLoaderModelOnly': {
          if (params.loraName) {
            widgetValues[0] = params.loraName
          } else {
            widgetValues[0] = 'None'
          }
          widgetValues[1] = params.loraStrengthModel
          break
        }
        case 'UNETLoader': {
          widgetValues[0] = params.modelName || (node.widgets_values?.[0] as string ?? '')
          break
        }
        case 'UnetLoaderGGUF': {
          widgetValues[0] = params.modelName?.endsWith('.gguf') ? params.modelName : (node.widgets_values?.[0] as string ?? params.modelName)
          widgetValues[1] = 'default' // dequant_dtype
          widgetValues[2] = 'default' // patch_dtype
          widgetValues[3] = false     // patch_on_device
          break
        }
        case 'CLIPLoaderGGUF': {
          const clipName = widgetValues[0] as string
          if (clipName?.toLowerCase().includes('qwen')) {
            widgetValues[1] = 'qwen_image'
          }
          break
        }
        case 'SaveImage': {
          const now = new Date()
          const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
          widgetValues[0] = `${params.filenamePrefix || 'anima'}_${ts}`
          break
        }
      }

      const nodeEntry: Record<string, unknown> = {
        class_type: node.type,
        _meta: { title: node.type }
      }

      const inputs: Record<string, unknown> = {}
      if (node.inputs) {
        let widgetIndex = 0
        for (const input of node.inputs) {
          if (input.link !== null) {
            const link = data.workflow.links.find(l => l && l[0] === input.link)
            if (link) {
              let fromNodeId = link[1]
              let fromSlot = link[2]

              // Trace recursively through any skipped nodes (LoraLoader, ApplyKrea2NegPiP, etc.)
              while (fromNodeId !== null && skipNodeIds.has(fromNodeId)) {
                const skippedNode = nodes.find(n => n.id === fromNodeId)
                const inputName = fromSlot === 0 ? 'model' : 'clip'
                const skippedInput = skippedNode?.inputs?.find(i => i.name === inputName)
                const skippedLink = skippedInput?.link
                if (skippedLink !== null && skippedLink !== undefined) {
                  const sourceLink = data.workflow.links.find(l => l && l[0] === skippedLink)
                  if (sourceLink) {
                    fromNodeId = sourceLink[1]
                    fromSlot = sourceLink[2]
                  } else {
                    break
                  }
                } else {
                  break
                }
              }
              inputs[input.name] = [String(fromNodeId), fromSlot as number]
            }
          } else {
            if (widgetIndex < widgetValues.length) {
              inputs[input.name] = widgetValues[widgetIndex]
              widgetIndex++
            }
          }
        }
      }

      nodeEntry.inputs = inputs

      // UnetLoaderGGUF outputs WANVIDEOMODEL in ComfyUI 0.26+, incompatible
      // with standard nodes. Swap to UnetLoaderGGUFAdvanced which outputs MODEL.
      if (node.type === 'UnetLoaderGGUF') {
        nodeEntry.class_type = 'UnetLoaderGGUFAdvanced'
        const ggufInputs = nodeEntry.inputs as Record<string, unknown>
        ggufInputs.dequant_dtype = 'default'
        ggufInputs.patch_dtype = 'default'
        ggufInputs.patch_on_device = false
      }

      // CLIPLoaderGGUF doesn't support 'qwen3' GGUF architecture.
      // Swap to standard CLIPLoader with safetensors model.
      if (node.type === 'CLIPLoaderGGUF') {
        const clipName = node.widgets_values?.[0] as string
        if (clipName?.toLowerCase().includes('qwen3')) {
          console.log(`[WorkflowManager] Swapping CLIPLoaderGGUF node ${node.id} (${clipName}) to CLIPLoader`)
          nodeEntry.class_type = 'CLIPLoader'
          const clipInputs = nodeEntry.inputs as Record<string, unknown>
          if (typeof clipInputs.clip_name === 'string') {
            const originalPath = clipInputs.clip_name
            clipInputs.clip_name = mapGGUFClipToSafetensors(clipInputs.clip_name)
            console.log(`[WorkflowManager] CLIP path: ${originalPath} -> ${clipInputs.clip_name}`)
          }
          if (!('device' in clipInputs)) {
            clipInputs.device = 'default'
          }
          console.log('[WorkflowManager] CLIPLoaderGGUF inputs:', JSON.stringify(clipInputs))
        }
      }

      prompt[String(node.id)] = nodeEntry
    }

    // Inject pose data into VNCCS_PoseGenerator node if the workflow already has one.
    // When a rendered single-pose image is available (poseImageFilename), skip the
    // VNCCS grid entirely and let the dynamic pipeline below feed the image instead.
    if ((params as any).poseData && !(params as any).poseImageFilename) {
      const poseNode = nodes.find(n => n.type === 'VNCCS_PoseGenerator')
      if (poseNode) {
        const poseEntry = prompt[String(poseNode.id)]
        if (poseEntry) {
          const inputs = (poseEntry as any).inputs as Record<string, unknown>
          inputs['pose_data'] = (params as any).poseData
          inputs['line_thickness'] = (params as any).lineThickness ?? 3
          inputs['safe_zone'] = (params as any).safeZone ?? 100
          console.log('[Anima] Pose data injected into VNCCS_PoseGenerator')
        }
      }
    }

    // Build pose conditioning pipeline dynamically when the workflow lacks a VNCCS node.
    // VNCCS_PoseGenerator renders the OpenPose grid from joints JSON, ModelPatchLoader
    // loads the Anima-format LLLite weights, then AnimaLLLiteApply patches the model
    // feeding the KSampler with the pose image. When a rendered single-pose image is
    // available (poseImageFilename), LoadImage feeds it directly to AnimaLLLiteApply
    // avoiding the 12-pose VNCCS grid whose center-crop loses the reference pose.
    if ((params as any).poseData && !nodes.some(n => n.type === 'VNCCS_PoseGenerator') && data.ksamplerNodeId) {
      const llliteName = modelId === 'anima' ? this.ensureAnimaLLLite('anima\\anima-lllite-pose-1.safetensors') : null
      const ksamplerEntry = prompt[String(data.ksamplerNodeId)] as Record<string, unknown> | undefined
      const modelSource = ksamplerEntry && (ksamplerEntry.inputs as Record<string, unknown>)?.model

      if (llliteName && ksamplerEntry && Array.isArray(modelSource)) {
        const poseSourceId = 88800
        const modelPatchId = 88802
        const applyId = 88803
        const poseImageFilename = (params as any).poseImageFilename as string | undefined

        if (poseImageFilename) {
          prompt[String(poseSourceId)] = {
            class_type: 'LoadImage',
            _meta: { title: 'LoadImage (pose única)' },
            inputs: {
              image: poseImageFilename
            }
          }
        } else {
          prompt[String(poseSourceId)] = {
            class_type: 'VNCCS_PoseGenerator',
            _meta: { title: 'VNCCS_PoseGenerator (pose)' },
            inputs: {
              pose_data: (params as any).poseData,
              line_thickness: (params as any).lineThickness ?? 3,
              safe_zone: (params as any).safeZone ?? 100
            }
          }
        }

        prompt[String(modelPatchId)] = {
          class_type: 'ModelPatchLoader',
          _meta: { title: 'ModelPatchLoader (pose LLLite)' },
          inputs: {
            name: llliteName
          }
        }

        prompt[String(applyId)] = {
          class_type: 'AnimaLLLiteApply',
          _meta: { title: 'AnimaLLLiteApply (pose)' },
          inputs: {
            model: modelSource,
            model_patch: [String(modelPatchId), 0],
            image: [String(poseSourceId), 0],
            strength: (params as any).poseStrength ?? 1,
            start_percent: 0,
            end_percent: 1
          }
        }

        const kInputs = ksamplerEntry.inputs as Record<string, unknown>
        kInputs.model = [String(applyId), 0]
        console.log(`[Anima] Pose pipeline injected (${poseImageFilename ? 'LoadImage' : 'VNCCS_PoseGenerator'} -> ModelPatchLoader -> AnimaLLLiteApply)`)
      }
    }

    if (isImg2Img && params.imagePath && data.vaeNodeId && data.ksamplerNodeId) {
      const loadImageId = 99990
      const vaeEncodeId = 99991

      prompt[String(loadImageId)] = {
        class_type: 'LoadImage',
        _meta: { title: 'LoadImage (img2img)' },
        inputs: {
          image: params.imagePath
        }
      }

      prompt[String(vaeEncodeId)] = {
        class_type: 'VAEEncode',
        _meta: { title: 'VAEEncode (img2img)' },
        inputs: {
          pixels: [String(loadImageId), 0],
          vae: [String(data.vaeNodeId), 0]
        }
      }

      const hasMask = !!params.maskBase64

      if (hasMask) {
        // Inpainting mode: add SetLatentNoiseMask + LoadImage for mask
        const setMaskId = 99992
        const loadMaskId = 99993

        prompt[String(loadMaskId)] = {
          class_type: 'LoadImage',
          _meta: { title: 'LoadImage (mask)' },
          inputs: {
            image: params.maskFilename || 'mask.png'
          }
        }

        prompt[String(setMaskId)] = {
          class_type: 'SetLatentNoiseMask',
          _meta: { title: 'SetLatentNoiseMask (inpaint)' },
          inputs: {
            samples: [String(vaeEncodeId), 0],
            mask: [String(loadMaskId), 1]
          }
        }

        const ksamplerEntry = prompt[String(data.ksamplerNodeId)] as Record<string, unknown> | undefined
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs as Record<string, unknown>
          if (kInputs) {
            kInputs.latent_image = [String(setMaskId), 0]
          }
        }
      } else {
        const ksamplerEntry = prompt[String(data.ksamplerNodeId)] as Record<string, unknown> | undefined
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs as Record<string, unknown>
          if (kInputs) {
            kInputs.latent_image = [String(vaeEncodeId), 0]
          }
        }
      }
    }

    return prompt
  }
}
