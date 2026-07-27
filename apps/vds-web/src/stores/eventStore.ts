import { create } from 'zustand'

import type { DomainEvent, EventConnectionStatus } from '../types/events'

const MAX_EVENTS = 5_000

interface EventState {
  events: DomainEvent[]
  lastEventId: number
  connectionStatus: EventConnectionStatus
  reconnectAttempt: number
  selectedEventId: number | null
  acceptEvent: (event: DomainEvent) => void
  acceptEvents: (events: DomainEvent[]) => void
  setConnection: (status: EventConnectionStatus, reconnectAttempt?: number) => void
  selectEvent: (eventId: number | null) => void
  reset: () => void
}

const initialState = {
  events: [] as DomainEvent[],
  lastEventId: 0,
  connectionStatus: 'disconnected' as EventConnectionStatus,
  reconnectAttempt: 0,
  selectedEventId: null as number | null,
}

export const useEventStore = create<EventState>((set) => ({
  ...initialState,
  acceptEvent: (event) => useEventStore.getState().acceptEvents([event]),
  acceptEvents: (incoming) =>
    set((state) => {
      const accepted = incoming.filter((event) => event.event_id > state.lastEventId)
      if (accepted.length === 0) return state
      const combined = [...state.events, ...accepted]
      const events = combined.length > MAX_EVENTS ? combined.slice(-MAX_EVENTS) : combined
      return { events, lastEventId: accepted.at(-1)?.event_id ?? state.lastEventId }
    }),
  setConnection: (connectionStatus, reconnectAttempt = 0) =>
    set({ connectionStatus, reconnectAttempt }),
  selectEvent: (selectedEventId) => set({ selectedEventId }),
  reset: () => set(initialState),
}))
