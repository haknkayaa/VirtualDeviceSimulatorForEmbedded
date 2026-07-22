import type { FlowDocument } from '../types/flow'

const now = '2026-01-01T00:00:00.000Z'

export const exampleFlowDocuments: FlowDocument[] = [{
  schema_version: 1,
  flow: { id: 'example-linear-flow', name: 'Linear Foundation Example', kind: 'generic', revision: 1, created_at: now, updated_at: now },
  nodes: [
    { id: 'start-1', kind: 'start', position: { x: 40, y: 120 }, data: { label: 'Start' }, ui: {} },
    { id: 'action-1', kind: 'placeholder_action', position: { x: 330, y: 120 }, data: { label: 'Placeholder action' }, ui: {} },
    { id: 'end-1', kind: 'end', position: { x: 640, y: 120 }, data: { label: 'End' }, ui: {} },
  ],
  edges: [
    { id: 'edge-start-action', kind: 'default', source: 'start-1', sourceHandle: 'out', target: 'action-1', targetHandle: 'in', data: {}, ui: {} },
    { id: 'edge-action-end', kind: 'default', source: 'action-1', sourceHandle: 'out', target: 'end-1', targetHandle: 'in', data: {}, ui: {} },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: { example: true },
}]

export function loadExampleFlow(id: string) {
  const document = exampleFlowDocuments.find((candidate) => candidate.flow.id === id)
  return document ? structuredClone(document) : null
}
