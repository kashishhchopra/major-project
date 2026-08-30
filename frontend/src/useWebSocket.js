import { useEffect, useRef, useState } from 'react'
import { WS_PATH } from './config'

const RECONNECT_DELAY_MS = 3000

// Subscribes to a backend live-push channel, token-authenticated.
// `path` defaults to the admin alert feed (/ws/alerts); pass an explicit
// path (e.g. `/ws/tourist/{id}`) to use the per-tourist channel instead.
export default function useWebSocket(onEvent, path = WS_PATH) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!path) return undefined
    let cancelled = false
    let reconnectTimer = null

    const open = () => {
      const token = localStorage.getItem('token')
      if (!token || cancelled) return

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      // Token passed as a query param so the server can authorize the socket.
      const url = `${proto}://${location.host}${path}?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => {
        try {
          cbRef.current?.(JSON.parse(e.data))
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        setConnected(false)
        if (cancelled) return
        // Access tokens now expire in ~30 minutes (see backend refresh-token
        // change); a socket open longer than that gets closed by the server
        // and needs a fresh token to reconnect. `api.js`'s interceptor keeps
        // localStorage's token current as long as REST calls keep happening,
        // so re-reading it here picks up a refreshed token automatically.
        reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS)
      }
    }

    open()
    return () => {
      cancelled = true
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [path])

  return { connected }
}
