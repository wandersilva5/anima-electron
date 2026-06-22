import type { ComfyUIStatus } from '@shared/types'
import { Wifi, WifiOff, Loader } from 'lucide-react'

export function StatusBar({ status }: { status: ComfyUIStatus }) {
  const isLaunching = status.launching && !status.online
  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${
          isLaunching
            ? 'bg-warning/10 text-warning'
            : status.online
              ? 'bg-success/10 text-success'
              : 'bg-error/10 text-error'
        }`}
      >
        {isLaunching ? (
          <Loader size={12} className="animate-spin" />
        ) : status.online ? (
          <Wifi size={12} />
        ) : (
          <WifiOff size={12} />
        )}
        <span>
          {isLaunching ? 'Iniciando ComfyUI...' : status.online ? 'ComfyUI Online' : 'ComfyUI Offline'}
        </span>
      </div>
    </div>
  )
}
