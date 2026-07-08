import { readFileSync } from 'fs'
import { join } from 'path'
import type { GenerationParams, WorkflowJSON, DiffusionModelId } from '@shared/types'
import { MODEL_PROFILES } from '../shared/modelProfiles'

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
  defaults: WorkflowDefaults
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

  constructor(workflowsDir: string) {
    for (const [modelId, profile] of Object.entries(MODEL_PROFILES)) {
      try {
        const filePath = join(workflowsDir, profile.workflowFile)
        const raw = readFileSync(filePath, 'utf-8')
        const workflow: WorkflowJSON = JSON.parse(raw)

        let positiveNodeId: number | null = null
        let negativeNodeId: number | null = null

        const ksampler = workflow.nodes.find(n => n.type === 'KSampler')
        if (ksampler) {
          const posNode = findOriginNode(workflow, ksampler.id, 'positive')
          if (posNode && posNode.type === 'CLIPTextEncode') {
            positiveNodeId = posNode.id
          }
          const negNode = findOriginNode(workflow, ksampler.id, 'negative')
          if (negNode && negNode.type === 'CLIPTextEncode') {
            negativeNodeId = negNode.id
          }
        }

        const defaults = this.extractDefaults(workflow, positiveNodeId, negativeNodeId)

        this.workflows[modelId] = {
          workflow,
          positiveNodeId,
          negativeNodeId,
          defaults
        }
      } catch (err) {
        console.error(`[WorkflowManager] Erro ao carregar workflow para ${modelId}:`, err)
      }
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
    if (!data) {
      throw new Error(`Workflow defaults not found for model: ${modelId}`)
    }
    return { ...data.defaults }
  }

  buildPrompt(params: GenerationParams): Record<string, unknown> {
    const modelId = params.diffusionModel || 'anima'
    const data = this.workflows[modelId]
    if (!data) {
      throw new Error(`Workflow not loaded for model: ${modelId}`)
    }

    const nodes = structuredClone(data.workflow.nodes)
    const prompt: Record<string, unknown> = {}

    for (const node of nodes) {
      const widgetValues = [...(node.widgets_values ?? [])]

      switch (node.type) {
        case 'KSampler': {
          widgetValues[0] = params.seed
          widgetValues[2] = params.steps
          widgetValues[3] = params.cfg
          widgetValues.splice(1, 1) // remove control_after_generate (não vira input)
          break
        }
        case 'EmptyLatentImage':
        case 'EmptySD3LatentImage': {
          widgetValues[0] = params.width
          widgetValues[1] = params.height
          break
        }
        case 'CLIPTextEncode': {
          if (node.id === data.positiveNodeId) {
            widgetValues[0] = params.prompt
          } else if (node.id === data.negativeNodeId) {
            widgetValues[0] = params.negativePrompt
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
        case 'UNETLoader':
        case 'UnetLoaderGGUF': {
          widgetValues[0] = params.modelName
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
            const link = data.workflow.links.find(l => l[0] === input.link)
            if (link) {
              inputs[input.name] = [String(link[1]), link[2]]
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
      prompt[String(node.id)] = nodeEntry
    }

    return prompt
  }
}
