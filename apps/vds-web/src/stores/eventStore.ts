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
  acceptEvent: (event) =>
    set((state) => {
      if (event.event_id <= state.lastEventId) return state
      const events = [...state.events, event]
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
      return { events, lastEventId: event.event_id }
    }),
  setConnection: (connectionStatus, reconnectAttempt = 0) =>
    set({ connectionStatus, reconnectAttempt }),
  selectEvent: (selectedEventId) => set({ selectedEventId }),
  reset: () => set(initialState),
}))
