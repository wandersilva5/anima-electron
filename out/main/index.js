import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join, sep } from "path";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { WebSocket } from "ws";
import { spawn } from "child_process";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
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
    const ws = onProgress ? this.connectProgress(promptId, onProgress) : null;
    const startTime = Date.now();
    const pollInterval = 1e3;
    try {
      while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (res.ok) {
          const data = await res.json();
          const item = data[promptId];
          if (item) {
            if (item.status.completed) {
              if (item.status.status_str === "error") {
                throw new Error(`ComfyUI execution error for prompt ${promptId}`);
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
      throw new Error("Timeout waiting for ComfyUI result");
    } finally {
      ws?.close();
    }
  }
  connectProgress(promptId, onProgress) {
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
class WorkflowManager {
  constructor(workflowPath) {
    const raw = readFileSync(workflowPath, "utf-8");
    this.workflow = JSON.parse(raw);
    this.defaults = this.extractDefaults();
  }
  extractDefaults() {
    const nodes = this.workflow.nodes;
    const ksampler = nodes.find((n) => n.type === "KSampler");
    const emptyLatent = nodes.find((n) => n.type === "EmptyLatentImage");
    const clipTextEncodes = nodes.filter((n) => n.type === "CLIPTextEncode");
    const positiveEncode = clipTextEncodes[0];
    const negativeEncode = clipTextEncodes[1];
    const loraLoader = nodes.find((n) => n.type === "LoraLoader");
    const unetLoader = nodes.find((n) => n.type === "UNETLoader");
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
      loraStrengthClip: loraLoader?.widgets_values?.[2] ?? 0.5,
      modelName: unetLoader?.widgets_values?.[0] ?? "anima/JANIMA_v10.safetensors"
    };
  }
  getDefaults() {
    return { ...this.defaults };
  }
  buildPrompt(params) {
    const nodes = structuredClone(this.workflow.nodes);
    const prompt = {};
    let clipEncodeIndex = 0;
    for (const node of nodes) {
      const widgetValues = [...node.widgets_values ?? []];
      switch (node.type) {
        case "KSampler": {
          widgetValues[0] = params.seed;
          widgetValues[2] = params.steps;
          widgetValues[3] = params.cfg;
          widgetValues.splice(1, 1);
          break;
        }
        case "EmptyLatentImage": {
          widgetValues[0] = params.width;
          widgetValues[1] = params.height;
          break;
        }
        case "CLIPTextEncode": {
          if (clipEncodeIndex === 0) {
            widgetValues[0] = params.prompt;
          } else if (clipEncodeIndex === 1) {
            widgetValues[0] = params.negativePrompt;
          }
          clipEncodeIndex++;
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
        case "UNETLoader": {
          widgetValues[0] = params.modelName;
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
            const link = this.workflow.links.find((l) => l[0] === input.link);
            if (link) {
              inputs[input.name] = [String(link[1]), link[2]];
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
      prompt[String(node.id)] = nodeEntry;
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
  scan() {
    const loraDir = this.settingsManager.resolvedLorasPath;
    try {
      if (!existsSync(loraDir)) return [];
      return this.scanRecursive(loraDir, "");
    } catch {
      return [];
    }
  }
  scanRecursive(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}\\${entry.name}` : entry.name;
        results.push(...this.scanRecursive(fullPath, subPrefix));
      } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt")) {
        const relativeName = prefix ? `${prefix}\\${entry.name}` : entry.name;
        results.push({
          name: relativeName,
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
    return results.filter((m) => this.isAnimaModel(m.name));
  }
  isAnimaModel(name) {
    return /(?:^|[\\/])anima(?=$|[\\/])/i.test(name);
  }
  scanRecursive(dir, type, typeDir, baseDir) {
    const results = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.scanRecursive(fullPath, type, typeDir, baseDir));
        } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt")) {
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
  workflowManager = new WorkflowManager(join(__dirname, "../../workflows/anima-simples.json"));
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
    return { promptId: response.prompt_id, images };
  });
  ipcMain.handle("loras:list", async () => {
    const loras = loraScanner.scan();
    console.log(`[Anima] LoRAs encontrados: ${loras.length}`);
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
  ipcMain.handle("app:getWorkflowDefaults", async () => {
    return workflowManager.getDefaults();
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
