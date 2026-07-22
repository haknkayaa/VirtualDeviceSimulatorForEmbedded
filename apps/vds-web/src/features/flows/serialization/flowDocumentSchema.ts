import { FLOW_SCHEMA_VERSION, type FlowDocument, type JsonObject, type JsonValue } from '../types/flow'

export class FlowDocumentError extends Error {
  constructor(public readonly code: 'invalid_json' | 'invalid_document' | 'unsupported_schema', message: string) {
    super(message)
    this.name = 'FlowDocumentError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isObject(value) && Object.values(value).every(isJsonValue)
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new FlowDocumentError('invalid_document', `${path} must be a non-empty string.`)
}

function requireFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new FlowDocumentError('invalid_document', `${path} must be a finite number.`)
}

function requireJsonObject(value: unknown, path: string): asserts value is JsonObject {
  if (!isObject(value) || !isJsonValue(value)) throw new FlowDocumentError('invalid_document', `${path} must be a JSON object.`)
}

export function assertFlowDocument(value: unknown): asserts value is FlowDocument {
  if (!isObject(value)) throw new FlowDocumentError('invalid_document', 'Flow document must be a JSON object.')
  if (value.schema_version !== FLOW_SCHEMA_VERSION) {
    throw new FlowDocumentError(
      'unsupported_schema',
      `Unsupported flow schema version ${String(value.schema_version)}. This editor supports version ${FLOW_SCHEMA_VERSION}.`,
    )
  }
  if (!isObject(value.flow)) throw new FlowDocumentError('invalid_document', 'flow must be an object.')
  requireString(value.flow.id, 'flow.id')
  requireString(value.flow.name, 'flow.name')
  requireString(value.flow.kind, 'flow.kind')
  requireFiniteNumber(value.flow.revision, 'flow.revision')
  requireString(value.flow.created_at, 'flow.created_at')
  requireString(value.flow.updated_at, 'flow.updated_at')

  if (!Array.isArray(value.nodes)) throw new FlowDocumentError('invalid_document', 'nodes must be an array.')
  value.nodes.forEach((node, index) => {
    if (!isObject(node)) throw new FlowDocumentError('invalid_document', `nodes[${index}] must be an object.`)
    requireString(node.id, `nodes[${index}].id`)
    requireString(node.kind, `nodes[${index}].kind`)
    if (!isObject(node.position)) throw new FlowDocumentError('invalid_document', `nodes[${index}].position must be an object.`)
    requireFiniteNumber(node.position.x, `nodes[${index}].position.x`)
    requireFiniteNumber(node.position.y, `nodes[${index}].position.y`)
    requireJsonObject(node.data, `nodes[${index}].data`)
    requireJsonObject(node.ui, `nodes[${index}].ui`)
    if (node.validation !== undefined) {
      if (!isObject(node.validation) || (node.validation.muted_rule_ids !== undefined &&
        (!Array.isArray(node.validation.muted_rule_ids) || !node.validation.muted_rule_ids.every((id) => typeof id === 'string')))) {
        throw new FlowDocumentError('invalid_document', `nodes[${index}].validation is invalid.`)
      }
    }
  })

  if (!Array.isArray(value.edges)) throw new FlowDocumentError('invalid_document', 'edges must be an array.')
  value.edges.forEach((edge, index) => {
    if (!isObject(edge)) throw new FlowDocumentError('invalid_document', `edges[${index}] must be an object.`)
    requireString(edge.id, `edges[${index}].id`)
    requireString(edge.kind, `edges[${index}].kind`)
    requireString(edge.source, `edges[${index}].source`)
    requireString(edge.target, `edges[${index}].target`)
    if (edge.sourceHandle !== null && typeof edge.sourceHandle !== 'string') throw new FlowDocumentError('invalid_document', `edges[${index}].sourceHandle must be a string or null.`)
    if (edge.targetHandle !== null && typeof edge.targetHandle !== 'string') throw new FlowDocumentError('invalid_document', `edges[${index}].targetHandle must be a string or null.`)
    requireJsonObject(edge.data, `edges[${index}].data`)
    requireJsonObject(edge.ui, `edges[${index}].ui`)
  })

  if (!isObject(value.viewport)) throw new FlowDocumentError('invalid_document', 'viewport must be an object.')
  requireFiniteNumber(value.viewport.x, 'viewport.x')
  requireFiniteNumber(value.viewport.y, 'viewport.y')
  requireFiniteNumber(value.viewport.zoom, 'viewport.zoom')
  if (value.viewport.zoom <= 0) throw new FlowDocumentError('invalid_document', 'viewport.zoom must be greater than zero.')
  requireJsonObject(value.metadata, 'metadata')
}
