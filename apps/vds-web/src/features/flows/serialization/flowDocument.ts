import { FLOW_SCHEMA_VERSION, type FlowDocument, type JsonValue } from '../types/flow'
import { assertFlowDocument, FlowDocumentError } from './flowDocumentSchema'

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
  }
  return value
}

export function createFlowDocument(options: { id?: string; name?: string; now?: string } = {}): FlowDocument {
  const now = options.now ?? new Date().toISOString()
  const id = options.id ?? `flow-${crypto.randomUUID()}`
  return {
    schema_version: FLOW_SCHEMA_VERSION,
    flow: { id, name: options.name ?? 'Untitled Flow', kind: 'generic', revision: 1, created_at: now, updated_at: now },
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {},
  }
}

export function deterministicFlowDocument(document: FlowDocument): FlowDocument {
  return {
    schema_version: FLOW_SCHEMA_VERSION,
    flow: {
      id: document.flow.id,
      name: document.flow.name,
      kind: document.flow.kind,
      revision: document.flow.revision,
      created_at: document.flow.created_at,
      updated_at: document.flow.updated_at,
    },
    nodes: document.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      position: { x: node.position.x, y: node.position.y },
      data: sortJson(node.data) as typeof node.data,
      ui: sortJson(node.ui) as typeof node.ui,
      ...(node.validation ? { validation: { muted_rule_ids: [...(node.validation.muted_rule_ids ?? [])].sort() } } : {}),
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      data: sortJson(edge.data) as typeof edge.data,
      ui: sortJson(edge.ui) as typeof edge.ui,
    })),
    viewport: { x: document.viewport.x, y: document.viewport.y, zoom: document.viewport.zoom },
    metadata: sortJson(document.metadata) as typeof document.metadata,
  }
}

export function serializeFlowDocument(document: FlowDocument) {
  return `${JSON.stringify(deterministicFlowDocument(document), null, 2)}\n`
}

export function deserializeFlowDocument(input: string): FlowDocument {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch (error) {
    throw new FlowDocumentError('invalid_json', `Flow JSON could not be parsed: ${error instanceof Error ? error.message : 'unknown parse error'}`)
  }
  assertFlowDocument(value)
  return structuredClone(value)
}
