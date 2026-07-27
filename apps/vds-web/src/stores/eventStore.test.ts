import { describe, expect, it } from 'vitest'

import { useEventStore } from './eventStore'
import type { DomainEvent } from '../types/events'

function event(eventId: number): DomainEvent {
  return {
    event_id: eventId,
    event_type: 'device_reset',
    timestamp_virtual_ns: eventId,
    timestamp_wall_ns: eventId,
    payload: { kind: 'device_reset', result: 'success' },
  }
}

describe('event replay cursor', () => {
  it('advances monotonically and rejects replay duplicates', () => {
    const store = useEventStore.getState()
    store.acceptEvent(event(4))
    useEventStore.getState().acceptEvent(event(4))
    useEventStore.getState().acceptEvent(event(3))
    useEventStore.getState().acceptEvent(event(5))
    expect(useEventStore.getState().lastEventId).toBe(5)
    expect(useEventStore.getState().events.map((item) => item.event_id)).toEqual([4, 5])
  })

  it('owns connection and event selection UI state', () => {
    useEventStore.getState().setConnection('reconnecting', 3)
    useEventStore.getState().selectEvent(42)
    expect(useEventStore.getState()).toMatchObject({
      connectionStatus: 'reconnecting',
      reconnectAttempt: 3,
      selectedEventId: 42,
    })
  })

  it('commits a high-volume event batch with one store update', () => {
    useEventStore.getState().reset()
    let updates = 0
    const unsubscribe = useEventStore.subscribe(() => { updates += 1 })
    useEventStore.getState().acceptEvents(Array.from({ length: 1_000 }, (_, index) => event(index + 1)))
    unsubscribe()

    expect(updates).toBe(1)
    expect(useEventStore.getState().events).toHaveLength(1_000)
    expect(useEventStore.getState().lastEventId).toBe(1_000)
  })
})
