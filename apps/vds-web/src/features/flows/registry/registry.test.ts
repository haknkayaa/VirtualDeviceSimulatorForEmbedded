import { describe, expect, it } from 'vitest'

import { edgeRegistry, FlowEdgeRegistry } from './edgeRegistry'
import { nodeRegistry, FlowNodeRegistry } from './nodeRegistry'

describe('flow registries', () => {
  it('exposes the three generic node contracts', () => {
    expect(nodeRegistry.list().map((entry) => entry.kind)).toEqual(['start', 'end', 'placeholder_action'])
    expect(nodeRegistry.get('placeholder_action')).toMatchObject({ category: 'Actions', inputPorts: [{ id: 'in' }], outputPorts: [{ id: 'out' }] })
  })

  it('exposes the generic edge contract', () => {
    expect(edgeRegistry.get('default')?.displayName).toBe('Flow connection')
  })

  it('rejects duplicate registrations', () => {
    const nodes = new FlowNodeRegistry()
    const entry = nodeRegistry.get('start')!
    nodes.register(entry)
    expect(() => nodes.register(entry)).toThrow('already registered')
    const edges = new FlowEdgeRegistry()
    const edge = edgeRegistry.get('default')!
    edges.register(edge)
    expect(() => edges.register(edge)).toThrow('already registered')
  })
})
