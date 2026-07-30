import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join, sep } from "path";
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync, statSync, rmSync } from "fs";
import { WebSocket } from "ws";
import { spawn } from "child_process";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
function extractAnyString(obj, depth = 0) {
  if (depth > 5) return null;
  if (typeof obj === "string" && obj.trim()) return obj.trim();
  if (typeof obj === "number") return String(obj);
  if (typeof obj !== "object" || obj === null) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractAnyString(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const val of Object.values(obj)) {
    const found = extractAnyString(val, depth + 1);
    if (found) return found;
  }
  return null;
}
class ComfyUIClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  getBaseUrl() {
    return this.baseUrl;
  }
  setUrl(url) {
    this.baseUrl = url;
  }
  async getStatus() {
    const endpoints = ["/system_stats", "/queue", "/"];
    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3e3);
        const res = await fetch(`${this.baseUrl}${ep}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          let queueSize = 0;
          if (ep === "/queue") {
            try {
              const q = await res.json();
              queueSize = q.queue_running?.length ?? 0;
            } catch {
            }
          }
          return { online: true, queueSize };
        }
      } catch {
        continue;
      }
    }
    return { online: false, queueSize: 0 };
  }
  async sendPrompt(prompt) {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ComfyUI error ${res.status}: ${text}`);
    }
    return res.json();
  }
  async waitForResult(promptId, onProgress, timeoutMs = 3e5) {
    let wsError = null;
    const ws = onProgress ? this.connectProgress(promptId, onProgress, (err) => {
      wsError = err;
    }) : null;
    const startTime = Date.now();
    const pollInterval = 1e3;
    try {
      while (Date.now() - startTime < timeoutMs) {
        if (wsError) {
          throw new Error(wsError);
        }
        const res = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (res.ok) {
          const data = await res.json();
          const item = data[promptId];
          if (item) {
            const statusStr = item.status?.status_str;
            if (statusStr === "error" || item.status?.completed) {
              if (statusStr === "error") {
                console.error("[ComfyUIClient] Erro retornado no histórico:", JSON.stringify(item.status));
                const messages = item.status?.messages;
                let details = "";
                if (Array.isArray(messages)) {
                  for (const msg of messages) {
                    if (Array.isArray(msg) && msg[1]) {
                      const msgType = String(msg[0] ?? "").toLowerCase();
                      const info = msg[1];
                      if (msgType.includes("error") || typeof info === "object") {
                        const nodeType = info.node_type ? `${info.node_type}` : "";
                        const nodeId = info.node_id ? ` (#${info.node_id})` : "";
                        const excMsg = info.exception_message || info.exception_type || info.message;
                        if (excMsg) {
                          details += ` [Nó: ${nodeType}${nodeId}]: ${excMsg}`;
                        } else if (typeof info === "string") {
                          details += ` ${info}`;
                        }
                      }
                    }
                  }
                }
                if (!details && item.status?.exception_message) {
                  details = `: ${item.status.exception_message}`;
                }
                throw new Error(`Erro na execução do ComfyUI${details || ": Verifique se os modelos e nós exigidos estão instalados."}`);
              }
              const images = [];
              for (const nodeId of Object.keys(item.outputs)) {
                const output = item.outputs[nodeId];
                if (output.images) {
                  for (const img of output.images) {
                    const imgRes = await fetch(
                      `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
                    );
                    if (imgRes.ok) {
                      const buffer = await imgRes.arrayBuffer();
                      const base64 = Buffer.from(buffer).toString("base64");
                      images.push({ filename: img.filename, data: base64 });
                    }
                  }
                }
              }
              return images;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      throw new Error("Timeout esperando resultado do ComfyUI");
    } finally {
      ws?.close();
    }
  }
  async captionImage(inputFilename) {
    let allNodesInfo = {};
    try {
      const infoRes = await fetch(`${this.baseUrl}/object_info`);
      if (infoRes.ok) {
        allNodesInfo = await infoRes.json();
        const types = Object.keys(allNodesInfo);
        console.log(`[ComfyUIClient] Total de nós disponíveis: ${types.length}`);
      }
    } catch (err) {
      console.warn("[ComfyUIClient] Falha ao buscar nós disponíveis:", err);
      return { text: "" };
    }
    const allNodeTypes = Object.keys(allNodesInfo);
    const knownCaptioningPrefixes = ["wdtagger", "wd14tagger", "florence2", "joycaption", "joy_caption"];
    const captionNodeKeywords = ["tagger", "florence", "joycaption", "joy_caption"];
    const excludeKeywords = [
      "switcher",
      "merger",
      "merge",
      "combine",
      "split",
      "replace",
      "manager",
      "filter",
      "sort",
      "edit",
      "selector",
      "picker",
      "switch"
    ];
    const possibleCaptionNodes = [];
    for (const name of allNodeTypes) {
      const lower = name.toLowerCase();
      const isCaptionNode = knownCaptioningPrefixes.some((p) => lower.startsWith(p) || lower.includes(p)) || captionNodeKeywords.some((kw) => lower.includes(kw)) && !excludeKeywords.some((kw) => lower.includes(kw));
      if (!isCaptionNode) continue;
      const nodeInfo = allNodesInfo[name];
      if (!nodeInfo) continue;
      const required = nodeInfo?.input?.required;
      const captionInputs = {};
      let hasImageInput = false;
      if (required) {
        for (const [inputName, inputDef] of Object.entries(required)) {
          const def = Array.isArray(inputDef) ? inputDef : [inputDef];
          const typeOrOptions = def[0];
          const config = def[1] || {};
          if (typeOrOptions === "IMAGE" || typeOrOptions === "MASK") {
            captionInputs[inputName] = ["1", 0];
            hasImageInput = true;
          } else if (typeOrOptions === "LATENT" || typeOrOptions === "MODEL" || typeOrOptions === "CLIP" || typeOrOptions === "VAE") {
            continue;
          } else if (Array.isArray(typeOrOptions)) {
            captionInputs[inputName] = config?.default ?? typeOrOptions[0] ?? "";
          } else if (typeOrOptions === "FLOAT") {
            captionInputs[inputName] = config?.default ?? 0.5;
          } else if (typeOrOptions === "INT") {
            captionInputs[inputName] = config?.default ?? 1;
          } else if (typeOrOptions === "BOOLEAN") {
            captionInputs[inputName] = config?.default ?? false;
          } else if (typeOrOptions === "STRING") {
            captionInputs[inputName] = config?.default ?? (config?.multiline ? "" : "");
          }
        }
      }
      if (!hasImageInput) continue;
      possibleCaptionNodes.push({ nodeType: name, inputs: captionInputs });
    }
    console.log("[ComfyUIClient] Nós de captioning encontrados:", possibleCaptionNodes.map((n) => `${n.nodeType} (${JSON.stringify(n.inputs).slice(0, 120)})`));
    if (possibleCaptionNodes.length === 0) {
      console.warn("[ComfyUIClient] Nenhum nó de captioning instalado");
      console.warn("[ComfyUIClient] Instale WD14Tagger, Florence2 ou JoyCaption no ComfyUI Manager");
      return { text: "" };
    }
    for (const { nodeType, inputs: captionInputs } of possibleCaptionNodes) {
      console.log(`[ComfyUIClient] Tentando nó: ${nodeType}`);
      try {
        const prompt = {
          "1": {
            class_type: "LoadImage",
            _meta: { title: "LoadImage" },
            inputs: { image: inputFilename }
          },
          "2": {
            class_type: nodeType,
            _meta: { title: nodeType },
            inputs: captionInputs
          }
        };
        const response = await this.sendPrompt(prompt);
        const promptId = response.prompt_id;
        await this.waitForResult(promptId);
        const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (historyRes.ok) {
          const data = await historyRes.json();
          const item = data[promptId];
          if (item?.outputs) {
            for (const nodeId of Object.keys(item.outputs)) {
              const output = item.outputs[nodeId];
              if (nodeId === "1") continue;
              console.log(`[ComfyUIClient] Output do nó ${nodeId}:`, JSON.stringify(output).slice(0, 300));
              const found = extractAnyString(output);
              if (found) {
                console.log(`[ComfyUIClient] Caption extraído do nó ${nodeType}: ${found.slice(0, 200)}`);
                return { text: found };
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ComfyUIClient] Falha ao executar nó ${nodeType}:`, err);
        continue;
      }
    }
    console.warn("[ComfyUIClient] Nenhum nó de captioning produziu resultado");
    return { text: "" };
  }
  connectProgress(promptId, onProgress, onError) {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ prompt_id: promptId }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "progress" && msg.data?.prompt_id === promptId) {
          onProgress(msg.data.value, msg.data.max);
        } else if (msg.type === "execution_error" && msg.data?.prompt_id === promptId) {
          const d = msg.data;
          const errStr = `Erro de execução no ComfyUI [Nó: ${d.node_type} (#${d.node_id})]: ${d.exception_message || d.exception_type}`;
          onError?.(errStr);
        }
      } catch {
      }
    });
    ws.on("error", () => {
    });
    return ws;
  }
}
class ComfyLauncher {
  constructor(comfyDir) {
    this.process = null;
    this._running = false;
    this.comfyDir = comfyDir;
  }
  updatePath(comfyDir) {
    this.comfyDir = comfyDir;
  }
  get running() {
    return this._running;
  }
  async start() {
    if (this._running) {
      return { success: true, message: "ComfyUI já está em execução" };
    }
    try {
      const python = join(this.comfyDir, "python_embeded", "python.exe");
      const mainPy = join(this.comfyDir, "ComfyUI", "main.py");
      this.process = spawn(python, [
        "-s",
        mainPy,
        "--disable-smart-memory",
        "--lowvram",
        "--force-fp16",
        "--windows-standalone-build",
        "--use-pytorch-cross-attention",
        "--async-offload",
        "--preview-method",
        "none"
      ], {
        cwd: this.comfyDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      this._running = true;
      this.process.stdout?.on("data", (data) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          console.log(`[ComfyUI] ${line}`);
        }
      });
      this.process.stderr?.on("data", (data) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          console.log(`[ComfyUI] ${line}`);
        }
      });
      this.process.on("exit", (code) => {
        this._running = false;
        this.process = null;
        if (code !== 0 && code !== null) {
          console.error(`[Anima] ComfyUI fechou inesperadamente (código ${code})`);
        }
      });
      this.process.on("error", (err) => {
        this._running = false;
        this.process = null;
        console.error(`[Anima] Erro ao iniciar ComfyUI:`, err.message);
      });
      return { success: true, message: "ComfyUI iniciado" };
    } catch (err) {
      this._running = false;
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      console.error(`[Anima] Falha ao iniciar ComfyUI:`, message);
      return { success: false, message };
    }
  }
  stop() {
    if (this.process) {
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process) {
          try {
            this.process.kill("SIGKILL");
          } catch {
          }
        }
      }, 5e3);
      this.process = null;
      this._running = false;
      console.log("[Anima] ComfyUI finalizado");
    }
  }
}
const MODEL_PROFILES = {
  anima: {
    id: "anima",
    label: "Anima",
    description: "Modelo Anima — estilo anime detalhado",
    workflowFile: "anima-simples.json",
    loraFolder: "Anima",
    hasNegativePrompt: true,
    hasLoraClipStrength: true,
    defaults: {
      steps: 20,
      cfg: 5,
      width: 648,
      height: 1152,
      sampler: "er_sde",
      scheduler: "simple"
    }
  },
  krea2: {
    id: "krea2",
    label: "Krea2",
    description: "Krea2 Turbo — geração rápida, sem prompt negativo",
    workflowFile: "Krea2 - Simples.json",
    loraFolder: "Krea2",
    hasNegativePrompt: false,
    hasLoraClipStrength: true,
    defaults: {
      steps: 8,
      cfg: 1,
      width: 512,
      height: 1024,
      sampler: "euler",
      scheduler: "simple"
    }
  },
  "z-image": {
    id: "z-image",
    label: "Z-Image",
    description: "Z-Image Turbo — GGUF quantizado, rápido",
    workflowFile: "Z-Image Turbo.json",
    loraFolder: "z-image",
    hasNegativePrompt: true,
    hasLoraClipStrength: false,
    defaults: {
      steps: 9,
      cfg: 1,
      width: 704,
      height: 1024,
      sampler: "euler",
      scheduler: "normal"
    }
  }
};
function mapGGUFClipToSafetensors(ggufPath) {
  const knownMappings = {
    "Qwen3-4B-Q6_K.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q8_0.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q4_K_M.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q4_K_S.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors"
  };
  const filename = ggufPath.split("\\").pop() || ggufPath;
  if (knownMappings[filename]) {
    return knownMappings[filename];
  }
  const folder = ggufPath.includes("\\") ? ggufPath.substring(0, ggufPath.lastIndexOf("\\") + 1) : "";
  const baseName = filename.replace(/-(?:[A-Z0-9]+_?)+\.gguf$/i, "").replace(/\.gguf$/i, "");
  return folder + baseName + ".safetensors";
}
function findOriginNode(workflow, targetNodeId, inputName) {
  const node = workflow.nodes.find((n) => n.id === targetNodeId);
  if (!node || !node.inputs) return void 0;
  const input = node.inputs.find((i) => i.name === inputName);
  if (!input || input.link === null) return void 0;
  const link = workflow.links.find((l) => l[0] === input.link);
  if (!link) return void 0;
  const originNodeId = link[1];
  return workflow.nodes.find((n) => n.id === originNodeId);
}
class WorkflowManager {
  constructor(workflowsDir, comfyUIPath) {
    this.workflows = {};
    this.comfyUIPath = comfyUIPath || "";
    if (this.comfyUIPath) {
      this.patchGGUFPlugin();
    }
    for (const [modelId, profile] of Object.entries(MODEL_PROFILES)) {
      try {
        const filePath = join(workflowsDir, profile.workflowFile);
        const raw = readFileSync(filePath, "utf-8");
        const workflow = JSON.parse(raw);
        let positiveNodeId = null;
        let negativeNodeId = null;
        let vaeNodeId = null;
        let ksamplerNodeId = null;
        let emptyLatentNodeId = null;
        const ksampler = workflow.nodes.find((n) => n.type === "KSampler");
        if (ksampler) {
          ksamplerNodeId = ksampler.id;
          const posNode = findOriginNode(workflow, ksampler.id, "positive");
          if (posNode && posNode.type === "CLIPTextEncode") {
            positiveNodeId = posNode.id;
          }
          const negNode = findOriginNode(workflow, ksampler.id, "negative");
          if (negNode && negNode.type === "CLIPTextEncode") {
            negativeNodeId = negNode.id;
          }
        }
        const vaeDecode = workflow.nodes.find((n) => n.type === "VAEDecode");
        if (vaeDecode) {
          const vaeSrc = findOriginNode(workflow, vaeDecode.id, "vae");
          if (vaeSrc) {
            vaeNodeId = vaeSrc.id;
          }
        }
        const emptyLatent = workflow.nodes.find(
          (n) => n.type === "EmptyLatentImage" || n.type === "EmptySD3LatentImage"
        );
        if (emptyLatent) {
          emptyLatentNodeId = emptyLatent.id;
        }
        const defaults = this.extractDefaults(workflow, positiveNodeId, negativeNodeId);
        this.workflows[modelId] = {
          workflow,
          positiveNodeId,
          negativeNodeId,
          vaeNodeId,
          ksamplerNodeId,
          emptyLatentNodeId,
          defaults
        };
      } catch (err) {
        console.error(`[WorkflowManager] Erro ao carregar workflow para ${modelId}:`, err);
      }
    }
  }
  patchGGUFPlugin() {
    try {
      const loaderPath = join(this.comfyUIPath, "ComfyUI", "custom_nodes", "ComfyUI-GGUF", "loader.py");
      if (!existsSync(loaderPath)) {
        console.warn("[WorkflowManager] ComfyUI-GGUF loader.py not found");
        return;
      }
      const content = readFileSync(loaderPath, "utf-8");
      if (content.includes("qwen3")) {
        console.log("[WorkflowManager] ComfyUI-GGUF loader.py already supports qwen3");
        return;
      }
      const patched = content.replace('"qwen2vl"', '"qwen2vl", "qwen3"').replace("'qwen2vl'", "'qwen2vl', 'qwen3'").replace(
        /(if\s+arch\s+in\s+\{[^}]*?)(qwen2vl)([^}]*?\}:)/g,
        '$1$2, "qwen3"$3'
      );
      if (patched === content) {
        console.warn("[WorkflowManager] Could not patch ComfyUI-GGUF loader.py (unrecognized format)");
        return;
      }
      writeFileSync(loaderPath, patched, "utf-8");
      console.log("[WorkflowManager] ComfyUI-GGUF loader.py patched for qwen3 support");
    } catch (err) {
      console.warn("[WorkflowManager] Failed to patch ComfyUI-GGUF loader.py:", err);
    }
  }
  extractDefaults(workflow, positiveNodeId, negativeNodeId) {
    const nodes = workflow.nodes;
    const ksampler = nodes.find((n) => n.type === "KSampler");
    const emptyLatent = nodes.find((n) => n.type === "EmptyLatentImage" || n.type === "EmptySD3LatentImage");
    const positiveEncode = positiveNodeId !== null ? nodes.find((n) => n.id === positiveNodeId) : null;
    const negativeEncode = negativeNodeId !== null ? nodes.find((n) => n.id === negativeNodeId) : null;
    const loraLoader = nodes.find((n) => n.type === "LoraLoader" || n.type === "LoraLoaderModelOnly");
    const unetLoader = nodes.find((n) => n.type === "UNETLoader" || n.type === "UnetLoaderGGUF");
    return {
      steps: ksampler?.widgets_values?.[2] ?? 20,
      cfg: ksampler?.widgets_values?.[3] ?? 5,
      width: emptyLatent?.widgets_values?.[0] ?? 648,
      height: emptyLatent?.widgets_values?.[1] ?? 1152,
      seed: ksampler?.widgets_values?.[0] ?? 0,
      sampler: ksampler?.widgets_values?.[4] ?? "er_sde",
      scheduler: ksampler?.widgets_values?.[5] ?? "simple",
      denoise: ksampler?.widgets_values?.[6] ?? 1,
      positivePrompt: positiveEncode?.widgets_values?.[0] ?? "",
      negativePrompt: negativeEncode?.widgets_values?.[0] ?? "",
      loraName: loraLoader?.widgets_values?.[0] ?? "None",
      loraStrengthModel: loraLoader?.widgets_values?.[1] ?? 0.5,
      loraStrengthClip: loraLoader?.type === "LoraLoader" ? loraLoader.widgets_values?.[2] : 0.5,
      modelName: unetLoader?.widgets_values?.[0] ?? ""
    };
  }
  getDefaults(modelId = "anima") {
    const data = this.workflows[modelId];
    if (!data) {
      throw new Error(`Workflow defaults not found for model: ${modelId}`);
    }
    return { ...data.defaults };
  }
  buildPrompt(params) {
    const modelId = params.diffusionModel || "anima";
    const data = this.workflows[modelId];
    if (!data) {
      throw new Error(`Workflow not loaded for model: ${modelId}`);
    }
    const nodes = structuredClone(data.workflow.nodes);
    const prompt = {};
    const skipNodeIds = /* @__PURE__ */ new Set();
    const isImg2Img = !!params.imagePath;
    const hasLora = !!params.loraName;
    if (!hasLora) {
      const loraNode = nodes.find((n) => n.type === "LoraLoader" || n.type === "LoraLoaderModelOnly");
      if (loraNode) {
        skipNodeIds.add(loraNode.id);
      }
    }
    for (const node of nodes) {
      if (node.type === "Note" || node.type === "Reroute") continue;
      if (skipNodeIds.has(node.id)) continue;
      const widgetValues = [...node.widgets_values ?? []];
      switch (node.type) {
        case "KSampler": {
          widgetValues[0] = params.seed;
          widgetValues[2] = params.steps;
          widgetValues[3] = params.cfg;
          widgetValues.splice(1, 1);
          if (isImg2Img && params.denoise !== void 0) {
            widgetValues[widgetValues.length - 1] = params.denoise;
          }
          break;
        }
        case "EmptyLatentImage":
        case "EmptySD3LatentImage": {
          if (!isImg2Img) {
            widgetValues[0] = params.width;
            widgetValues[1] = params.height;
          }
          break;
        }
        case "CLIPTextEncode": {
          if (node.id === data.positiveNodeId) {
            widgetValues[0] = params.prompt;
          } else if (node.id === data.negativeNodeId) {
            widgetValues[0] = params.negativePrompt;
          }
          break;
        }
        case "LoraLoader": {
          if (params.loraName) {
            widgetValues[0] = params.loraName;
          } else {
            widgetValues[0] = "None";
          }
          widgetValues[1] = params.loraStrengthModel;
          widgetValues[2] = params.loraStrengthClip;
          break;
        }
        case "LoraLoaderModelOnly": {
          if (params.loraName) {
            widgetValues[0] = params.loraName;
          } else {
            widgetValues[0] = "None";
          }
          widgetValues[1] = params.loraStrengthModel;
          break;
        }
        case "UNETLoader": {
          widgetValues[0] = params.modelName || (node.widgets_values?.[0] ?? "");
          break;
        }
        case "UnetLoaderGGUF": {
          widgetValues[0] = params.modelName?.endsWith(".gguf") ? params.modelName : node.widgets_values?.[0] ?? params.modelName;
          widgetValues[1] = "default";
          widgetValues[2] = "default";
          widgetValues[3] = false;
          break;
        }
        case "CLIPLoaderGGUF": {
          const clipName = widgetValues[0];
          if (clipName?.toLowerCase().includes("qwen")) {
            widgetValues[1] = "qwen_image";
          }
          break;
        }
        case "SaveImage": {
          const now = /* @__PURE__ */ new Date();
          const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
          widgetValues[0] = `[${params.filenamePrefix || "anima"}][${ts}]`;
          break;
        }
      }
      const nodeEntry = {
        class_type: node.type,
        _meta: { title: node.type }
      };
      const inputs = {};
      if (node.inputs) {
        let widgetIndex = 0;
        for (const input of node.inputs) {
          if (input.link !== null) {
            const link = data.workflow.links.find((l) => l && l[0] === input.link);
            if (link) {
              let fromNodeId = link[1];
              let fromSlot = link[2];
              while (fromNodeId !== null && skipNodeIds.has(fromNodeId)) {
                const skippedNode = nodes.find((n) => n.id === fromNodeId);
                const inputName = fromSlot === 0 ? "model" : "clip";
                const skippedInput = skippedNode?.inputs?.find((i) => i.name === inputName);
                const skippedLink = skippedInput?.link;
                if (skippedLink !== null && skippedLink !== void 0) {
                  const sourceLink = data.workflow.links.find((l) => l && l[0] === skippedLink);
                  if (sourceLink) {
                    fromNodeId = sourceLink[1];
                    fromSlot = sourceLink[2];
                  } else {
                    break;
                  }
                } else {
                  break;
                }
              }
              inputs[input.name] = [String(fromNodeId), fromSlot];
            }
          } else {
            if (widgetIndex < widgetValues.length) {
              inputs[input.name] = widgetValues[widgetIndex];
              widgetIndex++;
            }
          }
        }
      }
      nodeEntry.inputs = inputs;
      if (node.type === "UnetLoaderGGUF") {
        nodeEntry.class_type = "UnetLoaderGGUFAdvanced";
        const ggufInputs = nodeEntry.inputs;
        ggufInputs.dequant_dtype = "default";
        ggufInputs.patch_dtype = "default";
        ggufInputs.patch_on_device = false;
      }
      if (node.type === "CLIPLoaderGGUF") {
        const clipName = node.widgets_values?.[0];
        if (clipName?.toLowerCase().includes("qwen3")) {
          console.log(`[WorkflowManager] Swapping CLIPLoaderGGUF node ${node.id} (${clipName}) to CLIPLoader`);
          nodeEntry.class_type = "CLIPLoader";
          const clipInputs = nodeEntry.inputs;
          if (typeof clipInputs.clip_name === "string") {
            const originalPath = clipInputs.clip_name;
            clipInputs.clip_name = mapGGUFClipToSafetensors(clipInputs.clip_name);
            console.log(`[WorkflowManager] CLIP path: ${originalPath} -> ${clipInputs.clip_name}`);
          }
          if (!("device" in clipInputs)) {
            clipInputs.device = "default";
          }
          console.log("[WorkflowManager] CLIPLoaderGGUF inputs:", JSON.stringify(clipInputs));
        }
      }
      prompt[String(node.id)] = nodeEntry;
    }
    if (params.poseData) {
      const poseNode = nodes.find((n) => n.type === "VNCCS_PoseGenerator");
      if (poseNode) {
        const poseEntry = prompt[String(poseNode.id)];
        if (poseEntry) {
          const inputs = poseEntry.inputs;
          inputs["pose_data"] = params.poseData;
          inputs["line_thickness"] = params.lineThickness ?? 3;
          inputs["safe_zone"] = params.safeZone ?? 100;
          console.log("[Anima] Pose data injected into VNCCS_PoseGenerator");
        }
      }
    }
    if (isImg2Img && params.imagePath && data.vaeNodeId && data.ksamplerNodeId) {
      const loadImageId = 99990;
      const vaeEncodeId = 99991;
      prompt[String(loadImageId)] = {
        class_type: "LoadImage",
        _meta: { title: "LoadImage (img2img)" },
        inputs: {
          image: params.imagePath
        }
      };
      prompt[String(vaeEncodeId)] = {
        class_type: "VAEEncode",
        _meta: { title: "VAEEncode (img2img)" },
        inputs: {
          pixels: [String(loadImageId), 0],
          vae: [String(data.vaeNodeId), 0]
        }
      };
      const hasMask = !!params.maskBase64;
      if (hasMask) {
        const setMaskId = 99992;
        const loadMaskId = 99993;
        prompt[String(loadMaskId)] = {
          class_type: "LoadImage",
          _meta: { title: "LoadImage (mask)" },
          inputs: {
            image: params.maskFilename || "mask.png"
          }
        };
        prompt[String(setMaskId)] = {
          class_type: "SetLatentNoiseMask",
          _meta: { title: "SetLatentNoiseMask (inpaint)" },
          inputs: {
            samples: [String(vaeEncodeId), 0],
            mask: [String(loadMaskId), 1]
          }
        };
        const ksamplerEntry = prompt[String(data.ksamplerNodeId)];
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs;
          if (kInputs) {
            kInputs.latent_image = [String(setMaskId), 0];
          }
        }
      } else {
        const ksamplerEntry = prompt[String(data.ksamplerNodeId)];
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs;
          if (kInputs) {
            kInputs.latent_image = [String(vaeEncodeId), 0];
          }
        }
      }
    }
    return prompt;
  }
}
class LoraScanner {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }
  updatePath(settingsManager) {
    this.settingsManager = settingsManager;
  }
  scan(subfolder) {
    const baseLoraDir = this.settingsManager.resolvedLorasPath;
    const scanDir = subfolder ? join(baseLoraDir, subfolder) : baseLoraDir;
    try {
      if (!existsSync(scanDir)) return [];
      return this.scanRecursive(scanDir, "", subfolder || "");
    } catch {
      return [];
    }
  }
  scanRecursive(dir, prefix, subfolder) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}\\${entry.name}` : entry.name;
        results.push(...this.scanRecursive(fullPath, subPrefix, subfolder));
      } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt")) {
        const relativeName = prefix ? `${prefix}\\${entry.name}` : entry.name;
        const loraName = subfolder ? `${subfolder}\\${relativeName}` : relativeName;
        results.push({
          name: loraName,
          path: fullPath,
          previewUrl: this.findPreview(entry.name, dir)
        });
      }
    }
    return results;
  }
  findPreview(filename, dir) {
    const baseName = filename.replace(/\.(safetensors|ckpt)$/, "");
    const exts = [".png", ".jpg", ".jpeg", ".webp"];
    const loraDir = this.settingsManager.resolvedLorasPath;
    const paths = [
      ...exts.map((e) => join(dir, "previews", `${baseName}${e}`)),
      ...exts.map((e) => join(dir, `${baseName}${e}`)),
      ...exts.map((e) => join(loraDir, "previews", `${baseName}${e}`))
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return void 0;
  }
}
class ModelScanner {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }
  updatePath(settingsManager) {
    this.settingsManager = settingsManager;
  }
  scan() {
    const baseDir = this.settingsManager.resolvedModelsPath;
    const modelDirs = [
      { dir: "diffusion_models", type: "diffusion_models" },
      { dir: "unet", type: "unet" }
    ];
    const results = [];
    for (const { dir: subdir, type } of modelDirs) {
      const fullPath = join(baseDir, subdir);
      if (!existsSync(fullPath)) continue;
      results.push(...this.scanRecursive(fullPath, type, subdir, baseDir));
    }
    return results;
  }
  scanRecursive(dir, type, typeDir, baseDir) {
    const results = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.scanRecursive(fullPath, type, typeDir, baseDir));
        } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt") || entry.name.endsWith(".gguf")) {
          const typePath = join(baseDir, typeDir);
          const relative = dir === typePath ? entry.name : join(dir.replace(typePath + sep, ""), entry.name);
          const name = relative;
          results.push({
            name,
            path: fullPath,
            type,
            previewUrl: this.findPreview(entry.name, dir, baseDir)
          });
        }
      }
    } catch {
    }
    return results;
  }
  findPreview(filename, dir, baseDir) {
    const baseName = filename.replace(/\.(safetensors|ckpt)$/, "");
    const exts = [".png", ".jpg", ".jpeg", ".webp"];
    const paths = [
      ...exts.map((e) => join(dir, "previews", `${baseName}${e}`)),
      ...exts.map((e) => join(dir, `${baseName}${e}`)),
      ...exts.map((e) => join(baseDir, "previews", `${baseName}${e}`))
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return void 0;
  }
}
const DEFAULTS = {
  comfyUIPath: "D:\\ComfyUI_windows_portable",
  modelsPath: "",
  lorasPath: ""
};
class SettingsManager {
  constructor() {
    const userDataPath = app.getPath("userData");
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    this.filePath = join(userDataPath, "settings.json");
    this.settings = this.load();
  }
  load() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch {
    }
    return { ...DEFAULTS };
  }
  save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (err) {
      console.error("[Settings] Failed to save:", err);
    }
  }
  get() {
    return { ...this.settings };
  }
  set(partial) {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.get();
  }
  get resolvedModelsPath() {
    return this.settings.modelsPath || join(this.settings.comfyUIPath, "ComfyUI", "models");
  }
  get resolvedLorasPath() {
    return this.settings.lorasPath || join(this.settings.comfyUIPath, "ComfyUI", "models", "loras");
  }
}
let mainWindow = null;
let comfyClient;
let comfyLauncher;
let workflowManager;
let loraScanner;
let modelScanner;
let statusPollInterval = null;
function startStatusPoll() {
  if (statusPollInterval) clearInterval(statusPollInterval);
  statusPollInterval = setInterval(async () => {
    const status = await comfyClient.getStatus();
    mainWindow?.webContents.send("comfyui:statusUpdate", {
      ...status,
      launching: comfyLauncher.running && !status.online
    });
    if (status.online && statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = setInterval(async () => {
        const s = await comfyClient.getStatus();
        mainWindow?.webContents.send("comfyui:statusUpdate", { ...s, launching: false });
      }, 15e3);
    }
  }, 2e3);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: "#0f0f13",
    titleBarStyle: "hiddenInset"
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
function setupIPC() {
  const settingsManager = new SettingsManager();
  const settings = settingsManager.get();
  comfyClient = new ComfyUIClient("http://127.0.0.1:8188");
  comfyLauncher = new ComfyLauncher(settings.comfyUIPath);
  workflowManager = new WorkflowManager(join(__dirname, "../../workflows"), settings.comfyUIPath);
  loraScanner = new LoraScanner(settingsManager);
  modelScanner = new ModelScanner(settingsManager);
  ipcMain.handle("comfyui:status", async () => {
    return comfyClient.getStatus();
  });
  ipcMain.handle("comfyui:generate", async (_event, params) => {
    console.log("[Anima] Iniciando geração...");
    console.log("[Anima] Modelo:", params.modelName, "| LoRA:", params.loraName ?? "nenhum");
    console.log("[Anima] Prompt:", (params.prompt ?? "").slice(0, 80) + "...");
    console.log("[Anima] Seed:", params.seed, "Steps:", params.steps, "CFG:", params.cfg);
    const prompt = workflowManager.buildPrompt(params);
    console.log("[Anima] Prompt construído, nós:", Object.keys(prompt).length);
    const response = await comfyClient.sendPrompt(prompt);
    console.log("[Anima] Prompt enviado, ID:", response.prompt_id);
    if (Object.keys(response.node_errors ?? {}).length > 0) {
      console.error("[Anima] Erros nos nós:", JSON.stringify(response.node_errors));
      throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
    }
    const images = await comfyClient.waitForResult(
      response.prompt_id,
      (current, max) => {
        mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
      }
    );
    console.log(`[Anima] Geração concluída, ${images.length} imagem(ns)`);
    if (images.length === 0) {
      throw new Error("ComfyUI não retornou imagens");
    }
    const historyBaseDir = join(app.getPath("userData"), "history");
    const historyDir = join(historyBaseDir, response.prompt_id);
    let savedImages = images.map((img) => ({ ...img, filePath: "" }));
    try {
      if (!existsSync(historyBaseDir)) {
        mkdirSync(historyBaseDir, { recursive: true });
        console.log(`[Anima] Pasta de histórico criada: ${historyBaseDir}`);
      }
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true });
      }
      savedImages = [];
      for (const img of images) {
        const now = /* @__PURE__ */ new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const prefix = params.filenamePrefix || "anima";
        const ext = img.filename.endsWith(".png") ? "png" : img.filename.endsWith(".jpg") || img.filename.endsWith(".jpeg") ? "jpg" : "png";
        const newFilename = `[${prefix}][${timestamp}].${ext}`;
        const imgPath = join(historyDir, newFilename);
        writeFileSync(imgPath, Buffer.from(img.data, "base64"));
        savedImages.push({ ...img, filePath: imgPath, filename: newFilename });
        const metadata = {
          params,
          filename: newFilename,
          timestamp: Date.now()
        };
        writeFileSync(join(historyDir, "metadata.json"), JSON.stringify(metadata, null, 2));
      }
      console.log(`[Anima] Imagens salvas em: ${historyDir}`);
    } catch (err) {
      console.warn(`[Anima] Erro ao salvar histórico em ${historyDir}:`, err);
    }
    return { promptId: response.prompt_id, images: savedImages };
  });
  ipcMain.handle("comfyui:generateImprove", async (_event, params) => {
    console.log("[Anima] Iniciando melhoria de imagem (img2img)...");
    console.log("[Anima] Modelo:", params.diffusionModel, "| Prompt:", (params.prompt ?? "").slice(0, 80) + "...");
    if (!params.imageBase64) {
      throw new Error("Imagem não fornecida");
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/);
    const imgExt = imageMatch ? imageMatch[1] : "png";
    const inputFilename = `anima-improve-${Date.now()}.${imgExt === "jpeg" ? "jpg" : imgExt}`;
    const imageData = params.imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(imageData, "base64");
    const destPath = join(comfyInputDir, inputFilename);
    let savedLocally = false;
    try {
      writeFileSync(destPath, imageBuffer);
      console.log(`[Anima] Imagem salva em: ${destPath}`);
      savedLocally = true;
    } catch {
      console.warn("[Anima] Não foi possível salvar localmente, tentando upload via API...");
    }
    if (!savedLocally) {
      const blob = new Blob([imageBuffer], { type: `image/${imgExt}` });
      const formData = new FormData();
      formData.append("image", blob, inputFilename);
      formData.append("type", "input");
      const uploadRes = await fetch(`${comfyClient.getBaseUrl()}/upload/image`, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        throw new Error(`Falha ao enviar imagem para ComfyUI: ${uploadRes.status}`);
      }
      console.log("[Anima] Upload da imagem realizado com sucesso");
    }
    let maskFilename;
    if (params.maskBase64) {
      maskFilename = `anima-mask-${Date.now()}.png`;
      const maskData = params.maskBase64.replace(/^data:image\/\w+;base64,/, "");
      const maskBuffer = Buffer.from(maskData, "base64");
      const maskDestPath = join(comfyInputDir, maskFilename);
      try {
        writeFileSync(maskDestPath, maskBuffer);
        console.log(`[Anima] Máscara salva em: ${maskDestPath}`);
      } catch {
        console.warn("[Anima] Não foi possível salvar máscara localmente, tentando upload via API...");
        const maskBlob = new Blob([maskBuffer], { type: "image/png" });
        const maskFormData = new FormData();
        maskFormData.append("image", maskBlob, maskFilename);
        maskFormData.append("type", "input");
        const maskUploadRes = await fetch(`${comfyClient.getBaseUrl()}/upload/image`, { method: "POST", body: maskFormData });
        if (!maskUploadRes.ok) {
          throw new Error(`Falha ao enviar máscara para ComfyUI: ${maskUploadRes.status}`);
        }
        console.log("[Anima] Upload da máscara realizado com sucesso");
      }
    }
    const improveParams = {
      ...params,
      imagePath: inputFilename,
      filenamePrefix: params.filenamePrefix || "anima-improve",
      maskFilename
    };
    const prompt = workflowManager.buildPrompt(improveParams);
    console.log("[Anima] Prompt img2img construído, nós:", Object.keys(prompt).length);
    const response = await comfyClient.sendPrompt(prompt);
    console.log("[Anima] Prompt enviado, ID:", response.prompt_id);
    if (Object.keys(response.node_errors ?? {}).length > 0) {
      console.error("[Anima] Erros nos nós:", JSON.stringify(response.node_errors));
      throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
    }
    const images = await comfyClient.waitForResult(
      response.prompt_id,
      (current, max) => {
        mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
      }
    );
    console.log(`[Anima] Melhoria concluída, ${images.length} imagem(ns)`);
    const historyBaseDir = join(app.getPath("userData"), "history");
    const historyDir = join(historyBaseDir, response.prompt_id);
    let savedImages = images.map((img) => ({ ...img, filePath: "" }));
    try {
      if (!existsSync(historyBaseDir)) mkdirSync(historyBaseDir, { recursive: true });
      if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
      savedImages = [];
      for (const img of images) {
        const now = /* @__PURE__ */ new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const prefix = params.filenamePrefix || "anima-improve";
        const ext2 = img.filename.endsWith(".png") ? "png" : img.filename.endsWith(".jpg") || img.filename.endsWith(".jpeg") ? "jpg" : "png";
        const newFilename = `[${prefix}][${timestamp}].${ext2}`;
        const imgPath = join(historyDir, newFilename);
        writeFileSync(imgPath, Buffer.from(img.data, "base64"));
        savedImages.push({ ...img, filePath: imgPath, filename: newFilename });
        const metadata = {
          params: improveParams,
          filename: newFilename,
          timestamp: Date.now()
        };
        writeFileSync(join(historyDir, "metadata.json"), JSON.stringify(metadata, null, 2));
      }
    } catch (err) {
      console.warn("[Anima] Erro ao salvar histórico:", err);
    }
    return { promptId: response.prompt_id, images: savedImages };
  });
  ipcMain.handle("comfyui:captionImage", async (_event, params) => {
    console.log("[Anima] Iniciando captioning de imagem...");
    if (!params.imageBase64) {
      throw new Error("Imagem não fornecida");
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/);
    const imgExt = imageMatch ? imageMatch[1] : "png";
    const inputFilename = `anima-caption-${Date.now()}.${imgExt === "jpeg" ? "jpg" : imgExt}`;
    const imageData = params.imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(imageData, "base64");
    const destPath = join(comfyInputDir, inputFilename);
    try {
      writeFileSync(destPath, imageBuffer);
      console.log(`[Anima] Imagem para caption salva em: ${destPath}`);
    } catch {
      console.warn("[Anima] Não foi possível salvar localmente, tentando upload via API...");
      const blob = new Blob([imageBuffer], { type: `image/${imgExt}` });
      const formData = new FormData();
      formData.append("image", blob, inputFilename);
      formData.append("type", "input");
      const uploadRes = await fetch(`${comfyClient.getBaseUrl()}/upload/image`, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        throw new Error(`Falha ao enviar imagem para ComfyUI: ${uploadRes.status}`);
      }
      console.log("[Anima] Upload da imagem realizado com sucesso");
    }
    const result = await comfyClient.captionImage(inputFilename);
    console.log("[Anima] Caption gerado:", result.text ? result.text.slice(0, 100) + "..." : "vazio");
    return result;
  });
  ipcMain.handle("loras:list", async (_event, subfolder) => {
    const loras = loraScanner.scan(subfolder);
    console.log(`[Anima] LoRAs encontrados: ${loras.length} para a subpasta: ${subfolder ?? "todas"}`);
    if (loras.length > 0) console.log(`[Anima] Primeiro LoRA: ${loras[0].name}, preview: ${loras[0].previewUrl ?? "nenhum"}`);
    return loras;
  });
  ipcMain.handle("models:list", async () => {
    const models = modelScanner.scan();
    console.log(`[Anima] Modelos encontrados: ${models.length}`);
    if (models.length > 0) console.log(`[Anima] Primeiro modelo: ${models[0].name}, type: ${models[0].type}`);
    return models;
  });
  ipcMain.handle("comfyui:setUrl", async (_event, url) => {
    comfyClient.setUrl(url);
  });
  ipcMain.handle("comfyui:launch", async () => {
    const status = await comfyClient.getStatus();
    if (status.online) {
      startStatusPoll();
      return { success: true, message: "ComfyUI já está online" };
    }
    const result = await comfyLauncher.start();
    if (result.success) {
      startStatusPoll();
    }
    return result;
  });
  ipcMain.handle("settings:get", async () => {
    return settingsManager.get();
  });
  ipcMain.handle("settings:set", async (_event, newSettings) => {
    const updated = settingsManager.set(newSettings);
    const s = settingsManager.get();
    comfyLauncher.updatePath(s.comfyUIPath);
    loraScanner.updatePath(settingsManager);
    modelScanner.updatePath(settingsManager);
    return updated;
  });
  ipcMain.handle("settings:selectDir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Selecionar pasta"
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("app:getWorkflowDefaults", async (_event, diffusionModel) => {
    return workflowManager.getDefaults(diffusionModel);
  });
  ipcMain.handle("app:getModelProfiles", async () => {
    return MODEL_PROFILES;
  });
  ipcMain.handle("file:readImage", async (_event, filePath) => {
    try {
      const buffer = readFileSync(filePath);
      const ext = filePath.endsWith(".png") ? "png" : "jpeg";
      return `data:image/${ext};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  });
  ipcMain.handle("file:loadHistory", async () => {
    const historyBaseDir = join(app.getPath("userData"), "history");
    if (!existsSync(historyBaseDir)) return [];
    const dirs = readdirSync(historyBaseDir);
    const items = [];
    for (const dir of dirs) {
      const dirPath = join(historyBaseDir, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        const metaPath = join(dirPath, "metadata.json");
        if (!existsSync(metaPath)) continue;
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const imgPath = join(dirPath, meta.filename);
        if (!existsSync(imgPath)) continue;
        items.push({
          id: dir,
          filePath: imgPath,
          filename: meta.filename,
          params: meta.params,
          timestamp: meta.timestamp
        });
      } catch (err) {
        console.warn(`[Anima] Erro ao ler histórico ${dir}:`, err);
      }
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  });
  ipcMain.handle("file:deleteHistoryItems", async (_event, items) => {
    for (const { id, filePath } of items) {
      if (filePath && existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
      const dirPath = join(app.getPath("userData"), "history", id);
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true });
      }
      console.log(`[Anima] Histórico excluído: ${id}`);
    }
  });
}
app.whenReady().then(async () => {
  setupIPC();
  createWindow();
  const status = await comfyClient.getStatus();
  if (status.online) {
    console.log("[Anima] ComfyUI já está online, conectando...");
    startStatusPoll();
  } else {
    console.log("[Anima] ComfyUI não está online, iniciando...");
    comfyLauncher.start().then((result) => {
      if (result.success) {
        console.log("[Anima] ComfyUI iniciado em background");
        startStatusPoll();
      } else {
        console.error("[Anima] Falha ao iniciar ComfyUI:", result.message);
        mainWindow?.webContents.send("comfyui:launchError", result.message);
      }
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", () => {
  comfyLauncher.stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    comfyLauncher.stop();
    app.quit();
  }
});
