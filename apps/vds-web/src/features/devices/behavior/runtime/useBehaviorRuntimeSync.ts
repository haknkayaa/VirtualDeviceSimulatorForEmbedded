import { useEffect, useMemo } from 'react'

import { useDeviceState } from '../../../../api/queries'
import { useEventStore } from '../../../../stores/eventStore'
import { useFlowStore } from '../../../flows/store/flowStore'
import type { BehaviorCompileResult } from '../types/deviceBehaviorFlow'
import { useBehaviorRuntimeStore } from './behaviorRuntimeStore'

/**
 * Projects the observed device runtime (REST state snapshot + replayed domain
 * events) onto the canvas while observation is enabled. Lives in the editor
 * shell so highlighting keeps working whichever bottom-panel tab is visible.
 */
export function useBehaviorRuntimeSync(deviceId: string, compiled: BehaviorCompileResult | null, enabled: boolean) {
  const events = useEventStore((state) => state.events)
  const document = useFlowStore((state) => state.document)
  const deviceState = useDeviceState(enabled && deviceId ? deviceId : undefined)
  const statuses = useBehaviorRuntimeStore((state) => state.statuses)
  const initialState = compiled?.document?.state_machine.initial_state ?? ''
  const map = useMemo(() => {
    if (!compiled) return null
    const names = Object.fromEntries(document.nodes.map((node) => [node.id, typeof node.data.state_name === 'string' ? node.data.state_name : '']))
    const pendingEdgeMap: Record<string, string[]> = {}
    document.edges.filter((edge) => typeof edge.data.delay_value === 'number' && edge.data.delay_value > 0).forEach((edge) => {
      const source = names[edge.source]
      if (source) pendingEdgeMap[source] = [...(pendingEdgeMap[source] ?? []), edge.id].sort()
    })
    return { stateNodeMap: compiled.stateNodeMap, transitionEdgeMap: compiled.transitionEdgeMap, pendingEdgeMap, initialState }
  }, [compiled, document, initialState])
  useEffect(() => { if (enabled && map) useBehaviorRuntimeStore.getState().configure(deviceId, map) }, [deviceId, enabled, map])
  useEffect(() => { if (enabled) useBehaviorRuntimeStore.getState().hydrate(deviceState.data?.state ?? undefined) }, [deviceState.data?.state, enabled])
  useEffect(() => { if (enabled) useBehaviorRuntimeStore.getState().applyEvents(events) }, [enabled, events])
  useEffect(() => { if (enabled) useFlowStore.getState().setRuntimeStatuses(statuses) }, [enabled, statuses])
}
