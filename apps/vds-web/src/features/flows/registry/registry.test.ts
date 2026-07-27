import { describe, expect, it } from 'vitest'

import { edgeRegistry, FlowEdgeRegistry } from './edgeRegistry'
import { nodeRegistry, FlowNodeRegistry } from './nodeRegistry'
import { PlaceholderActionNode } from '../nodes/PlaceholderActionNode'
import { GenericNodeInspector } from '../components/GenericInspectorSection'

describe('flow registries', () => {
  it('starts without product-specific node contracts', () => {
    expect(nodeRegistry.list()).toEqual([])
  })

  it('exposes the generic edge contract', () => {
    expect(edgeRegistry.get('default')?.displayName).toBe('Flow connection')
  })

  it('rejects duplicate registrations', () => {
    const nodes = new FlowNodeRegistry()
    const entry = {
      kind: 'test',
      displayName: 'Test',
      description: 'Test node',
      category: 'Test',
      iconIdentifier: 'test',
      accentToken: 'cyan',
      defaultData: {},
      inputPorts: [],
      outputPorts: [],
      component: PlaceholderActionNode,
      inspectorComponent: GenericNodeInspector,
      validationRules: [],
    }
    nodes.register(entry)
    expect(() => nodes.register(entry)).toThrow('already registered')
    const edges = new FlowEdgeRegistry()
    const edge = edgeRegistry.get('default')!
    edges.register(edge)
    expect(() => edges.register(edge)).toThrow('already registered')
  })
})
