import { describe, expect, it } from 'vitest'

import { edgeRegistry } from '../../flows/registry/edgeRegistry'
import { nodeRegistry } from '../../flows/registry/nodeRegistry'
import { BEHAVIOR_NODE_KINDS, BEHAVIOR_TRANSITION_EDGE } from '../types/deviceBehaviorFlow'
import { registerDeviceBehaviorRegistry } from './deviceBehaviorRegistry'

describe('device behavior registries', () => {
  it('registers the complete catalog while exposing only edge-centric state nodes', () => {
    const entries = registerDeviceBehaviorRegistry()
    expect(entries).toHaveLength(12)
    Object.values(BEHAVIOR_NODE_KINDS).forEach((kind) => expect(nodeRegistry.has(kind)).toBe(true))
    expect(nodeRegistry.list().filter((entry) => entry.flowKinds?.includes('device_behavior')).map((entry) => entry.kind)).toEqual([
      BEHAVIOR_NODE_KINDS.initialState,
      BEHAVIOR_NODE_KINDS.state,
    ])
    expect(edgeRegistry.has(BEHAVIOR_TRANSITION_EDGE)).toBe(true)
  })
})
