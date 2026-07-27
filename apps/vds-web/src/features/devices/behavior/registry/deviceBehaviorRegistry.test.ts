import { describe, expect, it } from 'vitest'

import { edgeRegistry } from '../../../flows/registry/edgeRegistry'
import { canvasNodeTypes, nodeRegistry } from '../../../flows/registry/nodeRegistry'
import { validateFlowConnection } from '../../../flows/validation/validator'
import { createDeviceBehaviorFlowDocument } from '../serialization/deviceBehaviorFlowDocument'
import { BEHAVIOR_NODE_KINDS, BEHAVIOR_TRANSITION_EDGE } from '../types/deviceBehaviorFlow'
import { registerDeviceBehaviorRegistry } from './deviceBehaviorRegistry'

describe('device behavior registries', () => {
  it('registers the complete catalog and exposes state, logical, and time nodes', () => {
    const entries = registerDeviceBehaviorRegistry()
    expect(entries).toHaveLength(24)
    Object.values(BEHAVIOR_NODE_KINDS).forEach((kind) => expect(nodeRegistry.has(kind)).toBe(true))
    const exposed = nodeRegistry.list().filter((entry) => entry.flowKinds?.includes('device_behavior'))
    expect(exposed).toHaveLength(15)
    expect(exposed.map((entry) => entry.category)).toContain('Logical')
    expect(exposed.map((entry) => entry.category)).toContain('Time')
    expect(exposed.map((entry) => entry.category)).toContain('File IO')
    expect(canvasNodeTypes()).toHaveProperty(BEHAVIOR_NODE_KINDS.fileRead)
    expect(canvasNodeTypes()).toHaveProperty(BEHAVIOR_NODE_KINDS.fileWrite)
    expect(edgeRegistry.has(BEHAVIOR_TRANSITION_EDGE)).toBe(true)
  })

  it('allows connections between File IO design nodes', () => {
    registerDeviceBehaviorRegistry()
    const document = createDeviceBehaviorFlowDocument()
    document.nodes.push(
      { id: 'read', kind: BEHAVIOR_NODE_KINDS.fileRead, position: { x: 0, y: 0 }, data: { label: 'Read' }, ui: {} },
      { id: 'write', kind: BEHAVIOR_NODE_KINDS.fileWrite, position: { x: 300, y: 0 }, data: { label: 'Write' }, ui: {} },
    )
    expect(validateFlowConnection(document, {
      source: 'read',
      sourceHandle: 'out',
      target: 'write',
      targetHandle: 'a',
    }, BEHAVIOR_TRANSITION_EDGE)).toBe(true)
  })
})
