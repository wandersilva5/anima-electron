import { readFileSync } from 'fs'
import type { GenerationParams, WorkflowJSON } from '@shared/types'

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

export class WorkflowManager {
  private workflow: WorkflowJSON
  private defaults: WorkflowDefaults

  constructor(workflowPath: string) {
    const raw = readFileSync(workflowPath, 'utf-8')
    this.workflow = JSON.parse(raw)
    this.defaults = this.extractDefaults()
  }

  private extractDefaults(): WorkflowDefaults {
    const nodes = this.workflow.nodes

    const ksampler = nodes.find(n => n.type === 'KSampler')
    const emptyLatent = nodes.find(n => n.type === 'EmptyLatentImage')
    const clipTextEncodes = nodes.filter(n => n.type === 'CLIPTextEncode')
    const positiveEncode = clipTextEncodes[0]
    const negativeEncode = clipTextEncodes[1]
    const loraLoader = nodes.find(n => n.type === 'LoraLoader')
    const unetLoader = nodes.find(n => n.type === 'UNETLoader')

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
      loraStrengthClip: (loraLoader?.widgets_values?.[2] as number) ?? 0.5,
      modelName: (unetLoader?.widgets_values?.[0] as string) ?? 'anima/JANIMA_v10.safetensors'
    }
  }

  getDefaults(): WorkflowDefaults {
    return { ...this.defaults }
  }

  buildPrompt(params: GenerationParams): Record<string, unknown> {
    const nodes = structuredClone(this.workflow.nodes)
    const prompt: Record<string, unknown> = {}

    let clipEncodeIndex = 0

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
        case 'EmptyLatentImage': {
          widgetValues[0] = params.width
          widgetValues[1] = params.height
          break
        }
        case 'CLIPTextEncode': {
          if (clipEncodeIndex === 0) {
            widgetValues[0] = params.prompt
          } else if (clipEncodeIndex === 1) {
            widgetValues[0] = params.negativePrompt
          }
          clipEncodeIndex++
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
        case 'UNETLoader': {
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
            const link = this.workflow.links.find(l => l[0] === input.link)
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
