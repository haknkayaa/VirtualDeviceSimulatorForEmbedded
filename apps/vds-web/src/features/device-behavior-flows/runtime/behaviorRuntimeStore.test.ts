import { beforeEach, describe, expect, it } from 'vitest'

import type { DomainEvent } from '../../../types/events'
import { useFlowStore } from '../../flows/store/flowStore'
import { exampleDeviceBehaviorFlow } from '../serialization/deviceBehaviorFlowDocument'
import { useBehaviorRuntimeStore } from './behaviorRuntimeStore'
import { transitionRuntimeKey } from './deviceEventMapper'

const event: DomainEvent = { event_id: 7, event_type: 'state_transition', timestamp_virtual_ns: 5000, timestamp_wall_ns: 10, device_id: 'device-0', payload: { kind: 'state_transition', from_state: 'resetting', to_state: 'ready', trigger: 'reset_complete', result: 'applied' } }

describe('behavior runtime mapping', () => {
  beforeEach(() => { useBehaviorRuntimeStore.getState().clear(); useFlowStore.getState().newDocument(exampleDeviceBehaviorFlow) })
  it('hydrates REST state then applies ordered replay without dirtying authored history', () => {
    useFlowStore.getState().prepareLocalSave()
    const history = useFlowStore.getState().past.length
    useBehaviorRuntimeStore.getState().configure('device-0', { initialState: 'resetting', stateNodeMap: { resetting: 'initial-resetting', ready: 'state-ready' }, transitionEdgeMap: { [transitionRuntimeKey('resetting', 'reset_complete', 'ready')]: 'transition-reset-ready' } })
    useBehaviorRuntimeStore.getState().hydrate('resetting')
    useBehaviorRuntimeStore.getState().applyEvents([{ ...event, event_id: 8 }, event])
    expect(useBehaviorRuntimeStore.getState().currentState).toBe('ready')
    expect(useBehaviorRuntimeStore.getState().statuses['state-ready']).toBe('active')
    expect(useBehaviorRuntimeStore.getState().statuses['transition-reset-ready']).toBe('transitioned')
    expect(useFlowStore.getState().past).toHaveLength(history)
    expect(useFlowStore.getState().isDirty).toBe(false)
  })
})
