import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { GenerationParams, WorkflowJSON, DiffusionModelId, RegionalLoraSlot } from '@shared/types'
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

  buildPrompt(
    params: GenerationParams,
    opts: { availableNodes?: Set<string>; warnings?: string[] } = {}
  ): Record<string, unknown> {
    const modelId = params.diffusionModel || 'anima'
    const data = this.workflows[modelId]
    const warnings = opts.warnings ?? []
    if (!data) {
      throw new Error(`Workflow not loaded for model: ${modelId}`)
    }

    const nodes = structuredClone(data.workflow.nodes)
    const prompt: Record<string, unknown> = {}
    const skipNodeIds = new Set<number>()

    const isImg2Img = !!params.imagePath
    const loraSelections = Array.isArray(params.loras)
      ? params.loras.filter(l => l && typeof l.name === 'string' && l.name !== 'None')
      : []
    const hasLora = loraSelections.length > 0

    if (!hasLora) {
      for (const n of nodes) {
        if (n.type === 'LoraLoader' || n.type === 'LoraLoaderModelOnly') {
          skipNodeIds.add(n.id)
        }
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
          const first = loraSelections[0]
          widgetValues[0] = first ? first.name : 'None'
          widgetValues[1] = first ? first.strengthModel : 0.5
          widgetValues[2] = first ? first.strengthClip : 0.5
          break
        }
        case 'LoraLoaderModelOnly': {
          const first = loraSelections[0]
          widgetValues[0] = first ? first.name : 'None'
          widgetValues[1] = first ? first.strengthModel : 0.5
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

    // Multi-LoRA: encadeia os LoRAs adicionais (a partir do segundo) em série
    // após o nó template do workflow. O primeiro preenche o próprio nó
    // LoraLoader/LoraLoaderModelOnly do JSON; cada nó extra recebe model/clip
    // do anterior, e todos os consumidores do template são redirecionados para
    // o último elo da cadeia.
    if (hasLora && loraSelections.length > 1) {
      const templateLoraNode = nodes.find(n => n.type === 'LoraLoader' || n.type === 'LoraLoaderModelOnly')
      if (!templateLoraNode) {
        console.warn('[WorkflowManager] Múltiplos LoRAs solicitados mas o workflow não tem nó LoraLoader')
      } else {
        const isModelOnly = templateLoraNode.type === 'LoraLoaderModelOnly'
        const clampStrength = (v: number) => Math.min(2, Math.max(0, Number.isFinite(v) ? v : 0.5))

        let prevId: number = templateLoraNode.id
        const chainIds = new Set<string>()
        loraSelections.slice(1).forEach((lora, idx) => {
          const chainId = 87000 + idx
          const inputs: Record<string, unknown> = {
            lora_name: lora.name,
            strength_model: clampStrength(lora.strengthModel)
          }
          if (isModelOnly) {
            inputs.model = [String(prevId), 0]
          } else {
            inputs.strength_clip = clampStrength(lora.strengthClip)
            inputs.model = [String(prevId), 0]
            inputs.clip = [String(prevId), 1]
          }
          prompt[String(chainId)] = {
            class_type: templateLoraNode.type,
            _meta: { title: `${templateLoraNode.type} (${idx + 2}º LoRA)` },
            inputs
          }
          chainIds.add(String(chainId))
          prevId = chainId
        })

        // Redireciona model/clip que apontavam para o template para o fim da
        // cadeia (exceto os próprios nós da cadeia, que já estão ligados em série)
        for (const [nodeKey, entry] of Object.entries(prompt)) {
          if (chainIds.has(nodeKey)) continue
          const e = entry as { inputs?: Record<string, unknown> }
          if (!e.inputs) continue
          for (const [inputName, val] of Object.entries(e.inputs)) {
            if (
              (inputName === 'model' || inputName === 'clip') &&
              Array.isArray(val) && val[0] === String(templateLoraNode.id)
            ) {
              e.inputs[inputName] = [String(prevId), val[1] as number]
            }
          }
        }
        console.log(`[Anima] Cadeia de ${loraSelections.length} LoRAs montada (template + ${loraSelections.length - 1} nós extra)`)
      }
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
        const requiredNodes = ['ModelPatchLoader', 'AnimaLLLiteApply']
        const available = opts.availableNodes
        const missing = available
          ? requiredNodes.filter(n => !available.has(n))
          : []

        if (missing.length > 0) {
          warnings.push(
            `Controle de pose indisponível: nós necessários ausentes no ComfyUI (${missing.join(', ')}). ` +
            'A imagem será gerada sem aplicar a pose.'
          )
          console.warn(`[WorkflowManager] Pose LLLite pipeline skipped, missing nodes: ${missing.join(', ')}`)
        } else {
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
      } else if (!llliteName) {
        warnings.push(
          'Controle de pose indisponível: pesos Anima LLLite não encontrados (anima\\anima-lllite-pose-1.safetensors). ' +
          'A imagem será gerada sem aplicar a pose.'
        )
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

    this.injectRegionalPrompt(prompt, params, data, opts, warnings)

    return prompt
  }

  /**
   * Teste de regional prompting: aplica LoRAs diferentes por região da imagem
   * (rosto/seios) usando SimpleSyrup + Prompt Control:
   *
   * - ScheduleAndEncodePromptsWithPromptControl: prompt positivo segmentado com
   *   [SEP|rosto]/[SEP|seios]; tags <lora:> dentro de um segmento viram LoRAs
   *   daquela região (via hooks na conditioning); o texto global preenche os
   *   segmentos negativos ausentes.
   * - DetectSEGSWithUltralytics: máscara de rosto (face_yolov8m) e de seios
   *   (Anzhc Breasts Seg, baixado sob demanda) a partir da imagem de entrada.
   * - KSamplerAttentionCoupling: amostrador com atenção acoplada por máscara;
   *   substitui o KSampler do template (mesmo id) preservando seed/steps/etc.
   *
   * Restrito ao perfil anima (única família de modelo admitida pelo pack) e
   * falha de forma graciosa com warning quando os nós não estão instalados.
   */
  private injectRegionalPrompt(
    prompt: Record<string, unknown>,
    params: GenerationParams,
    data: WorkflowData,
    opts: { availableNodes?: Set<string>; warnings?: string[] },
    warnings: string[]
  ): void {
    const regional = params.regional
    if (!regional) return

    const slots: Array<{ sepLabel: string; slot: RegionalLoraSlot }> = []
    if (regional.face) slots.push({ sepLabel: 'rosto', slot: regional.face })
    if (regional.breasts) slots.push({ sepLabel: 'seios', slot: regional.breasts })
    if (slots.length === 0) return

    const skip = (message: string): void => {
      warnings.push(message)
      console.warn(`[WorkflowManager] Regional ignorado: ${message}`)
    }

    if (params.diffusionModel !== 'anima') {
      skip('LoRAs por região disponíveis apenas no modelo anima. Geração segue sem regional.')
      return
    }
    if (!params.imagePath || !prompt['99990']) {
      skip('LoRAs por região exigem geração img2img. Geração segue sem regional.')
      return
    }

    const requiredNodes = [
      'SimpleSyrup.ScheduleAndEncodePromptsWithPromptControl',
      'SimpleSyrup.KSamplerAttentionCoupling',
      'SimpleSyrup.LoadUltralyticsModel',
      'SimpleSyrup.DetectSEGSWithUltralytics',
      'MaskBatchMulti'
    ]
    if (opts.availableNodes) {
      const missing = requiredNodes.filter(n => !opts.availableNodes!.has(n))
      if (missing.length > 0) {
        skip(
          `LoRAs por região indisponíveis: nós ausentes no ComfyUI (${missing.join(', ')}). ` +
          'A imagem será gerada sem aplicar LoRAs regionais.'
        )
        return
      }
    }

    const ksamplerEntry = prompt[String(data.ksamplerNodeId)] as Record<string, unknown> | undefined
    if (!ksamplerEntry || ksamplerEntry.class_type !== 'KSampler') {
      skip('Workflow sem KSampler padrão; não é possível montar o sampler regional.')
      return
    }
    const kInputs = ksamplerEntry.inputs as Record<string, unknown>

    // clip resolvido pelo loop principal (já encadeado nos LoRAs globais)
    const posEntry = data.positiveNodeId !== null
      ? prompt[String(data.positiveNodeId)] as Record<string, unknown> | undefined
      : undefined
    let clipSource = posEntry ? (posEntry.inputs as Record<string, unknown>)?.clip : undefined

    for (let guard = 0; guard < 10 && Array.isArray(clipSource); guard++) {
      const src = prompt[clipSource[0] as string] as Record<string, unknown> | undefined
      if (src && (src.class_type === 'LoraLoader' || src.class_type === 'LoraLoaderModelOnly')) {
        clipSource = (src.inputs as Record<string, unknown>)?.clip
      } else {
        break
      }
    }
    if (!Array.isArray(clipSource)) {
      skip('Entrada de CLIP não encontrada no workflow; sem regional.')
      return
    }

    // Pula o AnimaTeaCache: caches que pulam evals do denoiser conflitam com
    // Attention Coupling (a mesma razão pela qual LazyCache é rejeitado).
    let modelSource: unknown = kInputs.model
    for (let guard = 0; guard < 5 && Array.isArray(modelSource); guard++) {
      const src = prompt[modelSource[0] as string] as Record<string, unknown> | undefined
      if (src && src.class_type === 'AnimaTeaCache') {
        modelSource = (src.inputs as Record<string, unknown>)?.model
      } else {
        break
      }
    }
    if (!Array.isArray(modelSource)) {
      skip('Fonte de MODEL não encontrada; sem regional.')
      return
    }

    const clamp = (v: number, fallback: number): number =>
      Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : fallback

    // Prompt positivo segmentado: cada região repete a descrição global e carrega
    // seu próprio LoRA; o negativo fica só com o texto global (o alinhamento do
    // SimpleSyrup sintetiza as entradas regionais negativas a partir dele).
    const caption = params.prompt
    let positivePrompt = caption
    for (const { sepLabel, slot } of slots) {
      const sModel = clamp(slot.strengthModel, 0.8)
      const sClip = 0
      positivePrompt += ` [SEP|${sepLabel}] ${caption} <lora:${slot.name}:${sModel}:${sClip}>`
    }

    const scheduleId = 86001
    prompt[String(scheduleId)] = {
      class_type: 'SimpleSyrup.ScheduleAndEncodePromptsWithPromptControl',
      _meta: { title: 'Schedule & Encode (regional)' },
      inputs: {
        model: modelSource,
        clip: clipSource,
        positive_prompt: positivePrompt,
        negative_prompt: params.negativePrompt || ''
      }
    }

    const detectInputs = (detectorRef: [string, number]): Record<string, unknown> => ({
      image: ['99990', 0],
      detector_model: detectorRef,
      confidence_threshold: 0.5,
      size_threshold: 10,
      keep_only: 0,
      keep_by: 'highest confidence',
      bbox_dilation: 0,
      sub_dilation: 0,
      post_dilation: 0,
      crop_factor: 3.0,
      sort_order: 'largest to smallest',
      combine_segs: true
    })

    // Ordem das máscaras = ordem dos segmentos [SEP] (rosto, depois seios)
    const maskRefs: Array<[string, number]> = []
    if (regional.face) {
      prompt['86010'] = {
        class_type: 'SimpleSyrup.LoadUltralyticsModel',
        _meta: { title: 'Ultralytics (rosto)' },
        inputs: { model_name: 'bbox/face_yolov8m.pt' }
      }
      prompt['86011'] = {
        class_type: 'SimpleSyrup.DetectSEGSWithUltralytics',
        _meta: { title: 'Detecção de rosto' },
        inputs: detectInputs(['86010', 0])
      }
      maskRefs.push(['86011', 1])
    }
    if (regional.breasts) {
      prompt['86012'] = {
        class_type: 'SimpleSyrup.LoadUltralyticsModel',
        _meta: { title: 'Ultralytics (seios)' },
        inputs: { model_name: 'Anzhc Breasts Seg v1 1024n (6.58MB)' }
      }
      prompt['86013'] = {
        class_type: 'SimpleSyrup.DetectSEGSWithUltralytics',
        _meta: { title: 'Detecção de seios' },
        inputs: detectInputs(['86012', 0])
      }
      maskRefs.push(['86013', 1])
    }

    let regionMasksRef: [string, number]
    if (maskRefs.length === 1) {
      regionMasksRef = maskRefs[0]
    } else {
      prompt['86014'] = {
        class_type: 'MaskBatchMulti',
        _meta: { title: 'Batch de máscaras regionais' },
        inputs: {
          inputcount: maskRefs.length,
          mask_1: maskRefs[0],
          mask_2: maskRefs[1]
        }
      }
      regionMasksRef = ['86014', 0]
    }

    // Encoding e cache antigos não são mais consumidos pelo sampler
    if (data.positiveNodeId !== null) delete prompt[String(data.positiveNodeId)]
    if (data.negativeNodeId !== null) delete prompt[String(data.negativeNodeId)]
    for (const key of Object.keys(prompt)) {
      const entry = prompt[key] as { class_type?: string }
      if (entry.class_type === 'AnimaTeaCache') delete prompt[key]
    }

    ksamplerEntry.class_type = 'SimpleSyrup.KSamplerAttentionCoupling'
    kInputs.model = [String(scheduleId), 0]
    kInputs.positive = [String(scheduleId), 1]
    kInputs.negative = [String(scheduleId), 2]
    kInputs.region_masks = regionMasksRef
    kInputs.regional_prompt_weight = 1.0
    kInputs.region_mask_feather = 16

    console.log(
      `[Anima] Regional injetado: ${slots.map(s => s.sepLabel).join('+')} | ` +
      `prompt segmentado (${slots.length + 1} entradas), máscaras em ${regionMasksRef[0]}`
    )
  }

  /**
   * Constrói o prompt da API do ComfyUI para o workflow Krea2-Pose.
   * O workflow usa TextEncodeQwenImageEditPlus com duas imagens:
   *   image1 = personagem (identidade) → nó LoadImage id 4
   *   image2 = referência de pose      → nó LoadImage id 5
   * Não usa DWPose nem ControlNet.
   */
  buildPosePrompt(
    charFilename: string,
    poseFilename: string,
    seed: number,
    poseWorkflowPath: string
  ): Record<string, unknown> {
    return this.buildTwoImagePrompt(poseWorkflowPath, charFilename, poseFilename, seed)
  }

  /**
   * Constrói o prompt da API do ComfyUI para o workflow Krea2-Outfit.
   * O workflow usa TextEncodeQwenImageEditPlus com duas imagens:
   *   image1 = personagem (identidade)   → nó LoadImage id 4
   *   image2 = referência de roupa       → nó LoadImage id 5
   * Mantém identidade e pose da imagem 1, transfere apenas a roupa da imagem 2.
   */
  buildOutfitPrompt(
    charFilename: string,
    outfitFilename: string,
    seed: number,
    outfitWorkflowPath: string
  ): Record<string, unknown> {
    return this.buildTwoImagePrompt(outfitWorkflowPath, charFilename, outfitFilename, seed)
  }

  /**
   * Conversão genérica UI → API para workflows de duas imagens (Krea2-Pose/Krea2-Outfit).
   * Layout fixo: LoadImage 4 (imagem 1), LoadImage 5 (imagem 2), KSampler 9 (seed).
   */
  private buildTwoImagePrompt(
    workflowPath: string,
    image1Filename: string,
    image2Filename: string,
    seed: number
  ): Record<string, unknown> {
    const raw = readFileSync(workflowPath, 'utf-8')
    const workflow: WorkflowJSON = JSON.parse(raw)
    const controlAfterGenValues = new Set(['randomize', 'fixed', 'increment', 'decrement', 'comfy'])

    // Converte formato UI → formato API do ComfyUI
    const prompt: Record<string, unknown> = {}
    for (const node of workflow.nodes) {
      const inputs: Record<string, unknown> = {}

      // Inputs conectados via links
      if (node.inputs) {
        for (const inp of node.inputs) {
          if (inp.link !== null && inp.link !== undefined) {
            const link = workflow.links.find((l) => l[0] === inp.link)
            if (link) {
              inputs[inp.name] = [String(link[1]), link[2] ?? 0]
            }
          }
        }
      }

      // Widget values: apenas inputs sem link (widgets)
      // KSampler UI export inclui control_after_generate (valor como "randomize",
      // "fixed") que não é um input da API — precisa ser pulado para não deslocar
      // os demais valores (steps, cfg, sampler_name, etc.).
      // Inputs com shape=7 (optional/hidden) também são pulados pois não possuem
      // widget values correspondentes no export da UI.
      if (node.widgets_values && node.widgets_values.length > 0) {
        const isKSampler = node.type === 'KSampler' || node.type === 'KSamplerAdvanced'
        const widgetInputs = (node.inputs ?? []).filter(
          (i) => (i.link === null || i.link === undefined) && i.shape !== 7
        )
        let wIdx = 0
        for (const val of node.widgets_values) {
          if (wIdx >= widgetInputs.length) break
          // No KSampler, pula control_after_generate (UI-only widget)
          if (isKSampler && typeof val === 'string' && controlAfterGenValues.has(val)) continue
          inputs[widgetInputs[wIdx].name] = val
          wIdx++
        }
      }

      // Remove inputs que só existem na UI (não fazem parte da API do ComfyUI)
      delete inputs['upload'] // widget IMAGEUPLOAD do LoadImage

      prompt[String(node.id)] = {
        class_type: node.type,
        _meta: { title: (node as any).title || node.type },
        inputs
      }
    }

    // Substitui filenames nos LoadImage
    const charNode = prompt['4'] as { inputs: Record<string, unknown> } | undefined
    if (charNode?.inputs) charNode.inputs['image'] = image1Filename

    const refNode = prompt['5'] as { inputs: Record<string, unknown> } | undefined
    if (refNode?.inputs) refNode.inputs['image'] = image2Filename

    // Substitui semente no KSampler (nó 9)
    const ksamplerNode = prompt['9'] as { inputs: Record<string, unknown> } | undefined
    if (ksamplerNode?.inputs) ksamplerNode.inputs['seed'] = seed

    return prompt
  }
}
