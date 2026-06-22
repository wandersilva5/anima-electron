# Plano — Tela de Configurações de Paths

## Hardcoded hoje

| Arquivo | Linha | Constante |
|---|---|---|
| `src/main/comfyLauncher.ts` | 4 | `COMFY_DIR = 'D:\\ComfyUI_windows_portable'` |
| `src/main/loraScanner.ts` | 5 | `LORA_DIR = '...\\ComfyUI\\models\\loras'` |
| `src/main/modelScanner.ts` | 5-9 | `BASE_DIR = '...\\ComfyUI\\models'` |

## O que configurar

- **ComfyUI Root** — raiz do ComfyUI
- **Modelos** — deriva do root, mas pode sobrescrever
- **LoRAs** — deriva do root, mas pode sobrescrever

## Persistência

Salvar em `app.getPath('userData')/settings.json` (sem dependência extra):

```json
{
  "comfyUIPath": "D:\\ComfyUI_windows_portable",
  "modelsPath": "",
  "lorasPath": ""
}
```

Se `modelsPath` ou `lorasPath` estiver vazio, deriva de `comfyUIPath`.

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/shared/types.ts` | + `interface AppSettings` |
| `src/main/settings.ts` | **Novo** — load/save settings |
| `src/main/comfyLauncher.ts` | usar `settings.comfyUIPath` |
| `src/main/loraScanner.ts` | usar `settings.lorasPath` |
| `src/main/modelScanner.ts` | usar `settings.modelsPath` |
| `src/main/index.ts` | + IPC handlers |
| `src/preload/index.ts` | expor settings API |
| `src/renderer/src/components/SettingsModal.tsx` | **Novo** — modal de config |
| `src/renderer/src/App.tsx` | + botão p/ abrir modal |
| `src/shared/electron-api.d.ts` | + tipos da API exposta |

## IPC

```
settings:get       → AppSettings
settings:set       ← AppSettings
settings:selectDir → abre dialog.showOpenDialog, retorna path | null
```

## Ordem

1. Criar `src/main/settings.ts`
2. + `AppSettings` em `types.ts`
3. IPC wiring (`index.ts` + `preload/index.ts`)
4. Refatorar `comfyLauncher`, `loraScanner`, `modelScanner`
5. Criar `SettingsModal.tsx`
6. Botão no header do `App.tsx`
7. Testar fluxo completo
