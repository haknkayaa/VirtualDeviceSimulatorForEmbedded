import type { FlowDocument } from './types/flow'

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
