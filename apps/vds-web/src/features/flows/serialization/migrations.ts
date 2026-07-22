import { FLOW_SCHEMA_VERSION, type FlowDocument } from '../types/flow'
import { assertFlowDocument, FlowDocumentError } from './flowDocumentSchema'

export function migrateFlowDocument(value: unknown): FlowDocument {
  if (typeof value !== 'object' || value === null) {
    throw new FlowDocumentError('invalid_document', 'Flow document must be a JSON object.')
  }
  const version = (value as { schema_version?: unknown }).schema_version
  if (version !== FLOW_SCHEMA_VERSION) {
    throw new FlowDocumentError('unsupported_schema', `Unsupported flow schema version ${String(version)}. This editor supports version ${FLOW_SCHEMA_VERSION}.`)
  }
  assertFlowDocument(value)
  return structuredClone(value)
}
