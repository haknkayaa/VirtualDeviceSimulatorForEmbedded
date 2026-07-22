import type { DomainEvent, EventConnectionStatus } from '../types/events'

interface SocketLike {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

interface EventStreamOptions {
  getCursor: () => number
  onEvent: (event: DomainEvent) => void
  onStatus: (status: EventConnectionStatus, attempt: number) => void
  createSocket?: (url: string) => SocketLike
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void
  getLocation?: () => Pick<Location, 'protocol' | 'host'>
}

export interface EventStreamController {
  start: () => void
  stop: () => void
}

export function buildEventSocketUrl(cursor: number, location: Pick<Location, 'protocol' | 'host'>) {
  const configured = import.meta.env.VITE_WS_ROOT as string | undefined
  const root =
    configured ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/events`
  const url = new URL(root)
  url.searchParams.set('after_event_id', String(cursor))
  return url.toString()
}

export function createEventStream(options: EventStreamOptions): EventStreamController {
  const createSocket: (url: string) => SocketLike =
    options.createSocket ?? ((url) => new WebSocket(url))
  const schedule = options.schedule ?? setTimeout
  const cancelSchedule = options.cancelSchedule ?? clearTimeout
  const getLocation = options.getLocation ?? (() => window.location)
  let socket: SocketLike | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true
  let attempt = 0

  const connect = () => {
    if (stopped) return
    options.onStatus(attempt === 0 ? 'connecting' : 'reconnecting', attempt)
    const currentSocket = createSocket(buildEventSocketUrl(options.getCursor(), getLocation()))
    socket = currentSocket
    currentSocket.onopen = () => {
      attempt = 0
      options.onStatus('connected', 0)
    }
    currentSocket.onmessage = (message: MessageEvent<string>) => {
      try {
        options.onEvent(JSON.parse(message.data) as DomainEvent)
      } catch {
        // Malformed events are isolated from the live stream.
      }
    }
    currentSocket.onerror = () => currentSocket.close()
    currentSocket.onclose = () => {
      if (socket === currentSocket) socket = null
      if (stopped) return
      attempt += 1
      options.onStatus('reconnecting', attempt)
      const delay = Math.min(10_000, 500 * 2 ** (attempt - 1))
      timer = schedule(connect, delay)
    }
  }

  return {
    start: () => {
      if (!stopped) return
      stopped = false
      connect()
    },
    stop: () => {
      stopped = true
      if (timer !== null) cancelSchedule(timer)
      timer = null
      socket?.close()
      socket = null
      options.onStatus('disconnected', 0)
    },
  }
}
