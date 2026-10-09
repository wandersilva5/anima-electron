/**
 * Valida buildPosePrompt sem gastar uma geração:
 *  1. monta o prompt da aba Pose;
 *  2. checa que toda referência [nodeId, slot] aponta para nó existente;
 *  3. checa que todo class_type existe no /object_info do ComfyUI.
 *
 * Uso: node scripts/test-pose-prompt.mjs
 */
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const repoRoot = process.cwd()
const tmp = mkdtempSync(join(tmpdir(), 'pose-prompt-'))
const outFile = join(tmp, 'bundle.mjs')

await build({
  entryPoints: [join(repoRoot, 'scripts', 'pose-prompt-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outFile,
  external: ['electron', 'ws'],
  alias: { '@shared': join(repoRoot, 'src', 'shared') },
  logLevel: 'silent'
})

let prompt
try {
  prompt = JSON.parse(execFileSync(process.execPath, [outFile], { encoding: 'utf8' }))
} finally {
  // mantém o bundle para depuração se falhar — apagado só no sucesso
}

const problems = []

// 1. Referências [nodeId, slot] resolvem para nós do prompt?
const nodeKeys = new Set(Object.keys(prompt))
for (const [id, entry] of Object.entries(prompt)) {
  for (const [inputName, val] of Object.entries(entry.inputs ?? {})) {
    if (Array.isArray(val) && typeof val[0] === 'string' && Number.isFinite(Number(val[1]))) {
      if (!nodeKeys.has(val[0])) {
        problems.push(`nó ${id} input "${inputName}" aponta para nó inexistente ${val[0]}`)
      }
    }
  }
}

// 2. class_types existem no ComfyUI?
const comfyUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188'
let available = null
try {
  const res = await fetch(`${comfyUrl}/object_info`)
  if (res.ok) available = new Set(Object.keys(await res.json()))
} catch {
  console.warn(`[aviso] ComfyUI fora do ar em ${comfyUrl} — pulando checagem de class_type`)
}

if (available) {
  for (const [id, entry] of Object.entries(prompt)) {
    if (!available.has(entry.class_type)) {
      problems.push(`nó ${id}: class_type "${entry.class_type}" não existe no ComfyUI`)
    }
  }
}

// 3. Guardas específicas da conversão do nó 488
const te = prompt['484']
if (!te) problems.push('nó 484 (TextEncodeQwenImage21) ausente')
else {
  if (te.inputs?.prompt !== 'replace the pose of <image 2> with the pose of <image 1>. keep the character of <image 2>') {
    problems.push(`484.prompt errado: ${JSON.stringify(te.inputs?.prompt)}`)
  }
  const img1 = te.inputs?.['images.image_1']
  if (!Array.isArray(img1)) problems.push('484.images.image_1 não é referência de nó')
  else if (prompt[img1[0]]?.class_type !== 'LoadImage') {
    problems.push(`484.images.image_1 aponta para ${img1[0]} (${prompt[img1[0]]?.class_type}), esperado LoadImage`)
  }
  if ('prompt' in te.inputs && Array.isArray(te.inputs.prompt)) {
    problems.push('484.prompt ainda é link (488 não removido)')
  }
}
for (const id of ['488', '504']) {
  if (nodeKeys.has(id)) problems.push(`nó ${id} ainda presente no prompt`)
}
const size = prompt['505']
if (Array.isArray(size?.inputs?.image) && prompt[size.inputs.image[0]]?.class_type !== 'LoadImage') {
  problems.push('505.GetImageSize não lê o LoadImage da pose')
}
const hasPoseLoad = Object.values(prompt).some((e) => e.class_type === 'LoadImage' && String(e.inputs?.image ?? '').startsWith('anima-pose-track-'))
const hasCharLoad = Object.values(prompt).some((e) => e.class_type === 'LoadImage' && String(e.inputs?.image ?? '').startsWith('anima-pose-char-'))
if (!hasPoseLoad) problems.push('LoadImage da pose (anima-pose-track-*) ausente')
if (!hasCharLoad) problems.push('LoadImage da personagem (anima-pose-char-*) ausente')

// 4. widgets de UI não vazaram para a API
for (const [id, entry] of Object.entries(prompt)) {
  if (entry.class_type === 'KSampler' && 'control_after_generate' in (entry.inputs ?? {})) {
    problems.push(`nó ${id}: control_after_generate vazou para a API`)
  }
  if ('upload' in (entry.inputs ?? {})) problems.push(`nó ${id}: input "upload" vazou para a API`)
}

console.log(`nós no prompt: ${nodeKeys.size}`)
if (problems.length) {
  console.error('\nPROBLEMAS:')
  for (const p of problems) console.error(' -', p)
  rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
}
console.log('OK: prompt estruturalmente válido')
writeFileSync(join(repoRoot, '.pose-prompt-test.json'), JSON.stringify(prompt, null, 2))
rmSync(tmp, { recursive: true, force: true })