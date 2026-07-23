import { describe, expect, it } from 'vitest'

import { exampleDeviceBehaviorFlow } from '../serialization/deviceBehaviorFlowDocument'
import { compileDeviceBehaviorFlow, serializeCompiledDeviceBehavior } from './compileDeviceBehaviorFlow'

describe('device behavior compiler', () => {
  it('compiles state actions, delayed events and cyclic transitions deterministically', () => {
    const source = structuredClone(exampleDeviceBehaviorFlow)
    const first = compileDeviceBehaviorFlow(source)
    const shuffled = structuredClone(source)
    shuffled.nodes.reverse(); shuffled.edges.reverse()
    const second = compileDeviceBehaviorFlow(shuffled)
    expect(first.errors).toEqual([])
    expect(serializeCompiledDeviceBehavior(first.document!)).toBe(serializeCompiledDeviceBehavior(second.document!))
    expect(first.document?.state_machine.initial_state).toBe('resetting')
    expect(first.document?.state_machine.states.resetting.delayed_events).toEqual([{ event: 'reset_complete', delay_us: 5000 }])
    expect(first.document?.state_machine.states.resetting.entry_actions?.[0].set_register).toMatchObject({ name: 'STATUS', value: 1, mask: 1 })
    expect(first.document?.state_machine.states.busy.transitions).toContainEqual({ event: 'operation_completed', target: 'ready' })
    expect(source).toEqual(exampleDeviceBehaviorFlow)
  })

  it('ignores node coordinates and reports structured validation errors', () => {
    const moved = structuredClone(exampleDeviceBehaviorFlow)
    moved.nodes.forEach((node, index) => { node.position = { x: index * 999, y: -index * 42 } })
    expect(compileDeviceBehaviorFlow(moved).document).toEqual(compileDeviceBehaviorFlow(exampleDeviceBehaviorFlow).document)
    moved.nodes = moved.nodes.filter((node) => node.kind !== 'device_behavior.initial_state')
    const result = compileDeviceBehaviorFlow(moved)
    expect(result.document).toBeNull()
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'behavior-missing-initial' }))
  })
})
