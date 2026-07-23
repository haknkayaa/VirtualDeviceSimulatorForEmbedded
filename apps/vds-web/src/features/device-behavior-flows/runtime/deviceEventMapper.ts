import type { DomainEvent } from '../../../types/events'
import type { FlowRuntimeStatus } from '../../flows/types/flow'

export interface BehaviorRuntimeMap {
  stateNodeMap: Record<string, string>
  transitionEdgeMap: Record<string, string>
  pendingEdgeMap?: Record<string, string[]>
  initialState: string
}

export interface BehaviorRuntimeUpdate {
  statuses: Record<string, FlowRuntimeStatus>
  currentState?: string
  lastTransitionEdgeId?: string
}

export function transitionRuntimeKey(source: string, trigger: string, target: string) {
  return `${source}\u0000${trigger}\u0000${target}`
}

export function mapDeviceEvent(event: DomainEvent, map: BehaviorRuntimeMap): BehaviorRuntimeUpdate | null {
  if (event.payload.kind === 'device_reset') {
    const nodeId = map.stateNodeMap[map.initialState]
    return nodeId ? {
      currentState: map.initialState,
      statuses: {
        [nodeId]: 'reset',
        ...Object.fromEntries((map.pendingEdgeMap?.[map.initialState] ?? []).map((edgeId) => [edgeId, 'pending' as const])),
      },
    } : null
  }
  if (event.payload.kind !== 'state_transition') return null
  const targetNodeId = map.stateNodeMap[event.payload.to_state]
  const edgeId = map.transitionEdgeMap[transitionRuntimeKey(event.payload.from_state, event.payload.trigger, event.payload.to_state)]
  const status: FlowRuntimeStatus = event.payload.result === 'applied' ? 'transitioned' : 'rejected'
  return {
    currentState: event.payload.to_state,
    lastTransitionEdgeId: edgeId,
    statuses: {
      ...(targetNodeId ? { [targetNodeId]: event.payload.result === 'applied' ? 'active' : 'error' } : {}),
      ...(edgeId ? { [edgeId]: status } : {}),
      ...(event.payload.result === 'applied' ? Object.fromEntries((map.pendingEdgeMap?.[event.payload.to_state] ?? []).map((pendingEdgeId) => [pendingEdgeId, 'pending' as const])) : {}),
    },
  }
}
