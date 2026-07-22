import { beforeEach, describe, expect, it } from 'vitest'
import { useFlowStore } from '../../flows/store/flowStore'
import { createScenarioFlowDocument } from '../serialization/scenarioFlowDocument'
import { useScenarioRunStore } from './scenarioRunStore'
import type { DomainEvent } from '../../../types/events'

const event = (id: number, status?: string): DomainEvent => ({ event_id: id, event_type: status ? 'scenario_step_completed' : 'scenario_step_started', timestamp_virtual_ns: 0, timestamp_wall_ns: 0, scenario_run_id: 'run-1', payload: status ? { kind: 'scenario_step_completed', step_id: 'step', action: 'reset_device', status, error: null } : { kind: 'scenario_step_started', step_id: 'step', action: 'reset_device' } })

describe('scenario runtime mapping', () => {
  beforeEach(() => { useScenarioRunStore.getState().clear(); useFlowStore.getState().newDocument(createScenarioFlowDocument()) })
  it('maps replayed events without mutating authored history or dirty state', () => {
    const document = { schema_version: 1 as const, scenario: { id: 'x', name: 'X', timeout_ms: 1 }, steps: [{ id: 'step', action: 'reset_device', continue_on_failure: false, device: 'd' }] }
    useFlowStore.getState().prepareLocalSave(); const history = useFlowStore.getState().past.length
    useScenarioRunStore.getState().begin('run-1', document, { step: 'node' })
    useScenarioRunStore.getState().applyEvents([event(2), event(1), event(3, 'passed')])
    expect(useScenarioRunStore.getState().statuses.node).toBe('passed')
    expect(useFlowStore.getState().past).toHaveLength(history)
    expect(useFlowStore.getState().isDirty).toBe(false)
  })
})
