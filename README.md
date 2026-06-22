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
│   │   ├── App.tsx           # Layout principal
│   │   ├── components/       # Componentes da UI
│   │   ├── stores/           # Estado global (Zustand)
│   │   ├── hooks/            # Hooks customizados
│   │   └── styles/           # CSS (Tailwind)
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
- Parâmetros de geração: seed, steps, CFG, resolução, força do LoRA
- Histórico de gerações com miniaturas
- Preview com blur de segurança e metadados
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
