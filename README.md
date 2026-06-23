# Anima

Gerador de imagens modelos Anima com **ComfyUI** (backend) + interface desktop elegante em Electron.

## Requisitos

- Node.js 18+
- NPM
- ComfyUI instalado (portable ou custom)

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
│   │   ├── App.tsx           # Layout principal (carrega histórico salvo)
│   │   ├── components/       # Componentes da UI
│   │   │   ├── PromptPanel.tsx    # Inputs, modelos, LoRAs com busca
│   │   │   ├── PreviewPanel.tsx   # Preview lado a lado + metadados
│   │   │   ├── HistoryPanel.tsx   # Histórico com seleção/exclusão
│   │   │   ├── SettingsModal.tsx  # Configurações de paths
│   │   │   ├── StatusBar.tsx      # Status do ComfyUI
│   │   │   └── SafeImage.tsx      # Imagem lazy-load do disco
│   │   ├── stores/
│   │   │   └── sessionStore.ts # Estado global (Zustand)
│   │   ├── hooks/
│   │   │   └── useGenerator.ts # Hook de geração
│   │   └── styles/
│   │       └── global.css      # CSS (Tailwind + variáveis)
│   └── shared/
│       ├── types.ts          # Tipos TypeScript compartilhados
│       └── electron-api.d.ts # Tipos da API exposta ao renderer
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

- Inicia/para o ComfyUI automaticamente
- Monitora status do ComfyUI (online/offline/iniciando)
- Lista modelos e LoRAs disponíveis com preview visual
- Busca/filtro de LoRAs com botão limpar
- Parâmetros de geração: seed, steps, CFG, resolução, força do LoRA
- Histórico persistente com imagens salvas em disco (`<userData>/history/`)
- Metadados completos salvos junto com cada imagem (prompt, modelo, LoRA, parâmetros)
- Exclusão de itens do histórico individual (hover) ou múltipla (modo seleção)
- Preview lado a lado: imagem 100% altura + painel de metadados
- Blur de segurança nas imagens
- Temas dark e light
- Atalho **Ctrl+Enter** para gerar
- Download de imagens

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
    "loraStrengthClip": 0.5
  },
  "filename": "ComfyUI_00001_.png",
  "timestamp": 1719000000000
}
```

Ao iniciar o app, o histórico é carregado do disco. Imagens são carregadas sob demanda (lazy loading) para preservar memória.

### IPC Channels

| Canal | Descrição |
|-------|-----------|
| `comfyui:generate` | Envia prompt ao ComfyUI, salva imagem + metadados em disco |
| `file:loadHistory` | Carrega lista de itens do histórico do disco |
| `file:deleteHistoryItems` | Exclui itens do histórico (disco + lista) |
| `file:readImage` | Lê imagem do disco e retorna como data URI |

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
