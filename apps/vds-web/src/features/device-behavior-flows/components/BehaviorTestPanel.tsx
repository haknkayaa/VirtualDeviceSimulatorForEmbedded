import { useEffect, useMemo } from 'react'
import { RotateCcw, X } from 'lucide-react'

import { useDeviceState, useRegisters, useResetDevice } from '../../../api/queries'
import { useEventStore } from '../../../stores/eventStore'
import { useFlowStore } from '../../flows/store/flowStore'
import type { BehaviorCompileResult } from '../types/deviceBehaviorFlow'
import { useBehaviorRuntimeStore } from '../runtime/behaviorRuntimeStore'

export function BehaviorTestPanel({ deviceId, compiled, onClose }: { deviceId: string; compiled: BehaviorCompileResult; onClose: () => void }) {
  const events = useEventStore((state) => state.events)
  const connection = useEventStore((state) => state.connectionStatus)
  const deviceState = useDeviceState(deviceId || undefined)
  const registers = useRegisters(deviceId || undefined)
  const reset = useResetDevice()
  const runtime = useBehaviorRuntimeStore()
  const initialState = compiled.document?.state_machine.initial_state ?? ''
  const document = useFlowStore((state) => state.document)
  const map = useMemo(() => {
    const names = Object.fromEntries(document.nodes.map((node) => [node.id, typeof node.data.state_name === 'string' ? node.data.state_name : '']))
    const pendingEdgeMap: Record<string, string[]> = {}
    document.edges.filter((edge) => typeof edge.data.delay_value === 'number' && edge.data.delay_value > 0).forEach((edge) => {
      const source = names[edge.source]
      if (source) pendingEdgeMap[source] = [...(pendingEdgeMap[source] ?? []), edge.id].sort()
    })
    return { stateNodeMap: compiled.stateNodeMap, transitionEdgeMap: compiled.transitionEdgeMap, pendingEdgeMap, initialState }
  }, [compiled, document, initialState])
  useEffect(() => { runtime.configure(deviceId, map) }, [deviceId, map]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { runtime.hydrate(deviceState.data?.state ?? undefined) }, [deviceState.data?.state]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { runtime.applyEvents(events) }, [events]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { useFlowStore.getState().setRuntimeStatuses(runtime.statuses) }, [runtime.statuses])
  const timeline = events.filter((event) => event.device_id === deviceId && event.payload.kind === 'state_transition').slice(-8).reverse()
  return <aside className="behavior-test-panel glass-panel">
    <header><div><strong>Runtime observation</strong><span>{connection} · REST snapshot + replayed events</span></div><button aria-label="Close test panel" onClick={onClose} type="button"><X size={16} /></button></header>
    {!deviceId ? <p>Select a runtime device to observe and reset it.</p> : <>
      <div className="behavior-current-state"><span>Current state</span><strong>{deviceState.data?.state ?? 'unknown'}</strong><button disabled={reset.isPending} onClick={() => reset.mutate(deviceId)} type="button"><RotateCcw size={14} /> Reset</button></div>
      <div className="behavior-register-snapshot">{(registers.data ?? []).map((register) => <span key={register.name}><b>{register.name}</b> 0x{register.value.toString(16).toUpperCase()}</span>)}</div>
      <div className="behavior-timeline"><strong>Transition timeline</strong>{timeline.length === 0 ? <small>No transition events.</small> : timeline.map((event) => event.payload.kind === 'state_transition' && <p key={event.event_id}><span>#{event.event_id}</span>{event.payload.from_state} → {event.payload.to_state}<small>{event.payload.trigger}</small></p>)}</div>
      <small>Command execution and manual time/event dispatch are intentionally unavailable: the Control API exposes no safe data-plane adapter.</small>
    </>}
  </aside>
}
