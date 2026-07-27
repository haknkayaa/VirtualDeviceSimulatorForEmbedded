import type { FlowDocument } from './types/flow'
import { GenericNodeInspector } from './components/GenericInspectorSection'
import { PlaceholderActionNode } from './nodes/PlaceholderActionNode'
import { nodeRegistry } from './registry/nodeRegistry'

const testNodes = [
  {
    kind: 'start',
    displayName: 'Start',
    inputPorts: [],
    outputPorts: [{ id: 'out', label: 'Output', required: true }],
  },
  {
    kind: 'placeholder_action',
    displayName: 'Placeholder Action',
    inputPorts: [{ id: 'in', label: 'Input' }],
    outputPorts: [{ id: 'out', label: 'Output' }],
  },
  {
    kind: 'end',
    displayName: 'End',
    inputPorts: [{ id: 'in', label: 'Input', required: true }],
    outputPorts: [],
  },
] as const

testNodes.forEach((node) => {
  if (nodeRegistry.has(node.kind)) return
  nodeRegistry.register({
    ...node,
    description: 'Test-only generic flow node.',
    category: 'Test',
    iconIdentifier: 'test',
    accentToken: 'cyan',
    defaultData: { label: node.displayName },
    inputPorts: [...node.inputPorts],
    outputPorts: [...node.outputPorts],
    component: PlaceholderActionNode,
    inspectorComponent: GenericNodeInspector,
    validationRules: [],
    flowKinds: ['generic'],
  })
})

export function flowFixture(): FlowDocument {
  return {
    schema_version: 1,
    flow: { id: 'test-flow', name: 'Test Flow', kind: 'generic', revision: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    nodes: [
      { id: 'start', kind: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' }, ui: {} },
      { id: 'action', kind: 'placeholder_action', position: { x: 240, y: 0 }, data: { label: 'Action', nested: { z: 1, a: 2 } }, ui: { collapsed: false } },
      { id: 'end', kind: 'end', position: { x: 480, y: 0 }, data: { label: 'End' }, ui: {} },
    ],
    edges: [
      { id: 'edge-1', kind: 'default', source: 'start', sourceHandle: 'out', target: 'action', targetHandle: 'in', data: {}, ui: {} },
      { id: 'edge-2', kind: 'default', source: 'action', sourceHandle: 'out', target: 'end', targetHandle: 'in', data: {}, ui: {} },
    ],
    viewport: { x: 12, y: 24, zoom: 1.2 },
    metadata: { z: 1, a: 2 },
  }
}
