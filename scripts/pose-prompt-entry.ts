import { WorkflowManager } from '../src/main/workflow'
import { join } from 'path'

const workflowsDir = process.env.WORKFLOWS_DIR || join(process.cwd(), 'workflows')
const wm = new WorkflowManager(workflowsDir)
const prompt = wm.buildPosePrompt(
  join(workflowsDir, 'VNCCS-PoseStudio-QI21.json'),
  'anima-pose-char-1700000000000.png',
  'anima-pose-track-1700000000000.png',
  123456
)
console.log(JSON.stringify(prompt))