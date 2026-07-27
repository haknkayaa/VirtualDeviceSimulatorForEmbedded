import { describe, expect, it, vi } from 'vitest'

import { createEventStream } from './eventSocket'
import type { DomainEvent, EventConnectionStatus } from '../types/events'

class FakeSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close() { this.emit('close') }
  emit(type: string, event?: MessageEvent<string>) {
    if (type === 'open') this.onopen?.(new Event('open'))
    if (type === 'message' && event) this.onmessage?.(event)
    if (type === 'close') this.onclose?.(new CloseEvent('close'))
    if (type === 'error') this.onerror?.(new Event('error'))
  }
}

const domainEvent: DomainEvent = {
  event_id: 8,
  event_type: 'device_reset',
  timestamp_virtual_ns: 5,
  timestamp_wall_ns: 6,
  device_id: 'spi-flash-0',
  payload: { kind: 'device_reset', result: 'success' },
}

describe('event stream reconnect', () => {
  it('reconnects using the latest accepted replay cursor', () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const scheduled: Array<() => void> = []
    const statuses: Array<[EventConnectionStatus, number]> = []
    let cursor = 7
    const onEvent = vi.fn((event: DomainEvent) => { cursor = event.event_id })
    const stream = createEventStream({
      getCursor: () => cursor,
      onEvent,
      onStatus: (status, attempt) => statuses.push([status, attempt]),
      createSocket: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      schedule: (callback) => {
        scheduled.push(callback)
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      getLocation: () => ({ protocol: 'http:', host: 'localhost:5173' }),
    })

    stream.start()
    expect(urls[0]).toContain('after_event_id=7')
    sockets[0].emit('open')
    sockets[0].emit('message', { data: JSON.stringify(domainEvent) } as MessageEvent<string>)
    expect(onEvent).toHaveBeenCalledWith(domainEvent)
    sockets[0].emit('message', {
      data: JSON.stringify([{ ...domainEvent, event_id: 9 }, { ...domainEvent, event_id: 10 }]),
    } as MessageEvent<string>)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event_id: 9 }))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event_id: 10 }))
    sockets[0].emit('close')
    expect(statuses).toContainEqual(['reconnecting', 1])
    scheduled[0]()
    expect(urls[1]).toContain('after_event_id=10')
    stream.stop()
    expect(statuses.at(-1)).toEqual(['disconnected', 0])
  })
})
