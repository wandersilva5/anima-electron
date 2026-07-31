import { useCallback, useRef, useState } from 'react'

interface UseRefreshLorasOptions {
  refreshFn: () => Promise<void>
}

interface UseRefreshLorasReturn {
  refreshing: boolean
  refreshed: boolean
  handleRefresh: () => Promise<void>
}

export function useRefreshLoras({ refreshFn }: UseRefreshLorasOptions): UseRefreshLorasReturn {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshFn()
      setRefreshed(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setRefreshed(false), 1500)
    } finally {
      setRefreshing(false)
    }
  }, [refreshFn, refreshing])

  return { refreshing, refreshed, handleRefresh }
}
