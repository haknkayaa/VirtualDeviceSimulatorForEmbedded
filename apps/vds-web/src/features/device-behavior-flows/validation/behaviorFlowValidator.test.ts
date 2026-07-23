import { describe, expect, it } from 'vitest'

import type { DeviceRegister } from '../../../types/api'
import { exampleDeviceBehaviorFlow } from '../serialization/deviceBehaviorFlowDocument'
import { validateBehaviorFlow } from './behaviorFlowValidator'

const registers: DeviceRegister[] = [{ name: 'STATUS', address: 1, width_bits: 8, access: 'ro', value: 0 }]
const rules = (document = exampleDeviceBehaviorFlow) => validateBehaviorFlow(document, { registers }).map((issue) => issue.ruleId)

describe('device behavior validation', () => {
  it('accepts the safe cyclic example', () => expect(rules()).not.toContain('cycle-detected'))
  it('rejects missing/multiple initial states and duplicate names', () => {
    const missing = structuredClone(exampleDeviceBehaviorFlow); missing.nodes[0].kind = 'device_behavior.state'
    expect(rules(missing)).toContain('behavior-missing-initial')
    const multiple = structuredClone(exampleDeviceBehaviorFlow); multiple.nodes[1].kind = 'device_behavior.initial_state'
    expect(rules(multiple)).toContain('behavior-multiple-initial')
    const duplicate = structuredClone(exampleDeviceBehaviorFlow); duplicate.nodes[1].data.state_name = 'resetting'
    expect(rules(duplicate)).toContain('behavior-duplicate-state-name')
  })
  it('rejects invalid delay, empty trigger and conflicting transitions', () => {
    const document = structuredClone(exampleDeviceBehaviorFlow)
    document.edges[0].data.trigger = ''
    document.edges[0].data.delay_value = 1
    document.edges[0].data.delay_unit = 'ns'
    expect(rules(document)).toEqual(expect.arrayContaining(['behavior-empty-trigger', 'behavior-invalid-delay']))
    const conflict = structuredClone(exampleDeviceBehaviorFlow)
    conflict.edges.push({ ...structuredClone(conflict.edges[1]), id: 'conflict', target: 'initial-resetting' })
    expect(rules(conflict)).toContain('behavior-conflicting-transition')
  })
  it('checks register width and explicit internal read-only writes', () => {
    const document = structuredClone(exampleDeviceBehaviorFlow)
    const action = (document.nodes[0].data.entry_actions as Record<string, unknown>[])[0]
    action.value = '0x100'; action.allow_read_only_internal = false
    expect(rules(document)).toEqual(expect.arrayContaining(['behavior-register-value-overflow', 'behavior-read-only-register-action']))
  })
  it('reports unreachable states and unsupported guards', () => {
    const document = structuredClone(exampleDeviceBehaviorFlow)
    document.edges = document.edges.filter((edge) => edge.target !== 'state-busy')
    document.edges[0].data.guard_enabled = true
    document.edges[0].data.guard_register = 'STATUS'
    document.edges[0].data.guard_equals = 'not-an-expression'
    expect(rules(document)).toEqual(expect.arrayContaining(['behavior-unreachable-state', 'behavior-unsupported-guard']))
  })
})
