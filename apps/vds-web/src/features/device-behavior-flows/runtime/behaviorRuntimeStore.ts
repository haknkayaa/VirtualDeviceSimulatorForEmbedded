import { create } from 'zustand'

import type { DomainEvent } from '../../../types/events'
import type { FlowRuntimeStatus } from '../../flows/types/flow'
import { mapDeviceEvent, type BehaviorRuntimeMap } from './deviceEventMapper'

interface BehaviorRuntimeState {
  deviceId: string
  map: BehaviorRuntimeMap
  currentState: string
  lastTransitionEdgeId: string | null
  lastProcessedEventId: number
  statuses: Record<string, FlowRuntimeStatus>
  configure: (deviceId: string, map: BehaviorRuntimeMap) => void
  hydrate: (state: string | undefined) => void
  applyEvents: (events: DomainEvent[]) => void
  clear: () => void
}

const emptyMap: BehaviorRuntimeMap = { stateNodeMap: {}, transitionEdgeMap: {}, pendingEdgeMap: {}, initialState: '' }
const initial = { deviceId: '', map: emptyMap, currentState: '', lastTransitionEdgeId: null, lastProcessedEventId: 0, statuses: {} as Record<string, FlowRuntimeStatus> }

export const useBehaviorRuntimeStore = create<BehaviorRuntimeState>((set, get) => ({
  ...initial,
  configure: (deviceId, map) => set((state) => state.deviceId === deviceId && JSON.stringify(state.map) === JSON.stringify(map) ? state : { ...initial, deviceId, map }),
  hydrate: (currentState) => {
    if (!currentState) return
    const nodeId = get().map.stateNodeMap[currentState]
    set({ currentState, statuses: nodeId ? {
      [nodeId]: 'active',
      ...Object.fromEntries((get().map.pendingEdgeMap?.[currentState] ?? []).map((edgeId) => [edgeId, 'pending' as const])),
    } : {} })
  },
  applyEvents: (events) => {
    const state = get()
    if (!state.deviceId) return
    let cursor = state.lastProcessedEventId
    let statuses = { ...state.statuses }
    let currentState = state.currentState
    let lastTransitionEdgeId = state.lastTransitionEdgeId
    events.filter((event) => event.device_id === state.deviceId && event.event_id > cursor).sort((a, b) => a.event_id - b.event_id).forEach((event) => {
      const update = mapDeviceEvent(event, state.map)
      if (update) {
        statuses = {
          ...Object.fromEntries(Object.values(state.map.stateNodeMap).map((nodeId) => [nodeId, 'idle' as const])),
          ...Object.fromEntries(Object.values(state.map.transitionEdgeMap).map((edgeId) => [edgeId, 'idle' as const])),
          ...update.statuses,
        }
        currentState = update.currentState ?? currentState
        lastTransitionEdgeId = update.lastTransitionEdgeId ?? lastTransitionEdgeId
      }
      cursor = Math.max(cursor, event.event_id)
    })
    if (cursor !== state.lastProcessedEventId) set({ lastProcessedEventId: cursor, statuses, currentState, lastTransitionEdgeId })
  },
  clear: () => set(initial),
}))
