# Anima

Gerador de imagens com **ComfyUI** (backend) + interface desktop elegante em Electron.

Suporta modelos **Anima**, **Krea2** e **Z-Image** com funcionalidades de geração, melhoria de imagens e controle de poses via **VNCCS** (Visual Novel Character Creation Suite).

## Requisitos

- Node.js 18+
- NPM
- ComfyUI instalado (portable ou custom)
- VNCCS (opcional, para funcionalidades de pose)

## Estrutura do Projeto

```
anima-electron/
├── src/
│   ├── main/                 # Processo principal Electron
│   │   ├── index.ts          # Janela, IPC handlers
│   │   ├── comfyui.ts        # Cliente HTTP/WS do ComfyUI
│   │   ├── comfyLauncher.ts  # Iniciar/parar processo ComfyUI
│   │   ├── workflow.ts       # Construir prompt a partir do workflow JSON
│   │   ├── loraScanner.ts    # Escanear LoRAs do disco
│   │   ├── modelScanner.ts   # Escanear modelos do disco
│   │   └── settings.ts       # Config persistente (settings.json)
│   ├── preload/
│   │   └── index.ts          # Ponte de contexto (IPC)
│   ├── renderer/             # Interface React
│   │   ├── index.html        # Entry HTML
│   │   ├── main.tsx          # Bootstrap React
│   │   ├── App.tsx           # Layout principal (3 abas: Gerar, Melhorar, Pose)
│   │   ├── components/       # Componentes da UI
│   │   │   ├── PromptPanel.tsx    # Inputs, modelos, LoRAs com busca
│   │   │   ├── PreviewPanel.tsx   # Preview lado a lado + metadados
│   │   │   ├── HistoryPanel.tsx   # Histórico com seleção/exclusão
│   │   │   ├── SettingsModal.tsx  # Configurações de paths
│   │   │   ├── StatusBar.tsx      # Status do ComfyUI
│   │   │   ├── SafeImage.tsx      # Imagem lazy-load do disco
│   │   │   ├── ImageImprove.tsx   # Melhoria de imagens (img2img)
│   │   │   ├── PoseStudio.tsx     # Editor visual de poses VNCCS
│   │   │   └── BrushCanvas.tsx    # Canvas para pintura de máscaras
│   │   ├── stores/
│   │   │   └── sessionStore.ts # Estado global (Zustand)
│   │   ├── hooks/
│   │   │   └── useGenerator.ts # Hook de geração
│   │   └── styles/
│   │       └── global.css      # CSS (Tailwind + variáveis)
│   └── shared/
│       ├── types.ts          # Tipos TypeScript compartilhados
│       ├── electron-api.d.ts # Tipos da API exposta ao renderer
│       └── modelProfiles.ts  # Perfis dos modelos de difusão
├── workflows/                # Workflows ComfyUI (JSON)
├── electron.vite.config.ts
├── tailwind.config.ts
├── electron-builder.yml      # Config de build/empacotamento
├── tsconfig.json
└── package.json
```

## Começando

```bash
# Instalar dependências
npm install

# Iniciar em modo dev
npx electron-vite dev

# Ou pelo script
.\launch-anima.bat
```

## Configuração Inicial

Na primeira execução, vá em **Configurações** (ícone de engrenagem no cabeçalho) e aponte:

| Campo | Descrição |
|-------|-----------|
| **Pasta do ComfyUI** | Raiz da instalação do ComfyUI (ex: `%%\ComfyUI_windows_portable`) |
| **Pasta de Modelos** | Opcional. Se vazio, deriva do ComfyUI: `{comfyUI}/ComfyUI/models` |
| **Pasta de LoRAs** | Opcional. Se vazio, deriva do ComfyUI: `{comfyUI}/ComfyUI/models/loras` |

As configurações ficam salvas em `%APPDATA%/anima-electron/settings.json`.

## Funcionalidades

### Aba Gerar
- Inicia/para o ComfyUI automaticamente
- Monitora status do ComfyUI (online/offline/iniciando)
- Lista modelos e LoRAs disponíveis com preview visual
- Busca/filtro de LoRAs com botão limpar
- Parâmetros de geração: seed, steps, CFG, resolução, força do LoRA
- Histórico persistente com imagens salvas em disco
- Metadados completos salvos junto com cada imagem
- Exclusão de itens do histórico individual ou múltipla
- Preview lado a lado com painel de metadados
- Atalho **Ctrl+Enter** para gerar
- Download de imagens

### Aba Melhorar (Img2Img)
- Upload de imagem via drag-and-drop ou clique
- Modo pincel para seleção de áreas (inpainting)
- Controles de força de modificação (denoise)
- Comparação antes/depois
- Seleção de modelo, checkpoint e LoRA

### Aba Pose (VNCCS)
- Editor visual de poses em canvas (formato OpenPose 512x1536)
- 6 presets de poses: Standing, Sitting, Walking, Running, Waving, Fighting, Dancing
- Seleção e movimentação de junções (joints) no canvas
- Controles de zoom, espessura das linhas e safe zone
- Exportação de pose como JSON compatível com VNCCS
- Geração de imagem com pose aplicada

### Geral
- Temas dark e light
- Blur de segurança nas imagens

## Modelos Suportados

| Modelo | Tipo | Descrição |
|--------|------|-----------|
| **Anima** | Anime | Estilo anime detalhado, 20 steps, CFG 5 |
| **Krea2** | Turbo | Geração rápida, 8 steps, CFG 1 |
| **Z-Image** | GGUF | Quantizado, 9 steps, CFG 1 |

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Iniciar em desenvolvimento |
| `npm run build` | Buildar para produção |
| `npm run preview` | Preview do build |
| `npm run dist:win` | Empacotar instalador Windows |
| `npm run dist:mac` | Empacotar DMG macOS |
| `npm run dist:linux` | Empacotar AppImage Linux |
| `npm run typecheck` | Verificar tipos TypeScript |
| `npm run lint` | Verificar código com ESLint |

## Histórico Persistente

As imagens geradas e seus metadados são salvos automaticamente em disco:

```
{userData}/history/
├── {promptId}/
│   ├── image.png
│   └── metadata.json
├── {promptId}/
│   ├── image.png
│   └── metadata.json
└── ...
```

Onde `{userData}` no Windows é `%APPDATA%/anima-electron`.

### metadata.json

```json
{
  "params": {
    "prompt": "...",
    "negativePrompt": "...",
    "seed": 123456,
    "steps": 20,
    "cfg": 5,
    "width": 648,
    "height": 1152,
    "modelName": "anima/JANIMA_v10.safetensors",
    "loraName": null,
    "loraStrengthModel": 0.5,
    "loraStrengthClip": 0.5,
    "poseData": "{...}",
    "lineThickness": 3,
    "safeZone": 100
  },
  "filename": "ComfyUI_00001_.png",
  "timestamp": 1719000000000
}
```

Ao iniciar o app, o histórico é carregado do disco. Imagens são carregadas sob demanda (lazy loading) para preservar memória.

## IPC Channels

| Canal | Descrição |
|-------|-----------|
| `comfyui:generate` | Envia prompt ao ComfyUI (geração txt2img) |
| `comfyui:generateImprove` | Envia prompt com imagem (img2img/inpainting) |
| `comfyui:generatePose` | Envia prompt com dados de pose (VNCCS) |
| `comfyui:status` | Verifica status do ComfyUI |
| `comfyui:setUrl` | Define URL do ComfyUI |
| `comfyui:launch` | Inicia instância do ComfyUI |
| `loras:list` | Lista LoRAs disponíveis |
| `models:list` | Lista modelos disponíveis |
| `settings:get` | Obtém configurações |
| `settings:set` | Salva configurações |
| `file:loadHistory` | Carrega histórico do disco |
| `file:deleteHistoryItems` | Exclui itens do histórico |
| `file:readImage` | Lê imagem do disco |

## Stack

| Tecnologia | Uso |
|------------|-----|
| Electron 33 | Desktop |
| React 18 + TypeScript | Interface |
| Zustand | Estado global |
| Tailwind CSS 3 | Estilização |
| Lucide React | Ícones |
| electron-vite | Build/bundler |
| electron-builder | Empacotamento |
| VNCCS | Controle de poses (opcional) |
