import { FLOW_SCHEMA_VERSION, type FlowValidationRule, type ValidationIssue } from '../types/flow'

function duplicates(values: string[]) {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  values.forEach((value) => seen.has(value) ? duplicate.add(value) : seen.add(value))
  return duplicate
}

const schemaVersionRule: FlowValidationRule = ({ document }) =>
  document.schema_version === FLOW_SCHEMA_VERSION ? [] : [{ ruleId: 'schema-version', severity: 'error', message: `Schema version ${document.schema_version} is not supported.` }]

const duplicateIdsRule: FlowValidationRule = ({ document }) => [
  ...[...duplicates(document.nodes.map((node) => node.id))].map((nodeId): ValidationIssue => ({ ruleId: 'duplicate-node-id', severity: 'error', message: `Duplicate node ID: ${nodeId}`, nodeId })),
  ...[...duplicates(document.edges.map((edge) => edge.id))].map((edgeId): ValidationIssue => ({ ruleId: 'duplicate-edge-id', severity: 'error', message: `Duplicate edge ID: ${edgeId}`, edgeId })),
]

const knownKindsRule: FlowValidationRule = ({ document, nodeRegistry, edgeRegistry }) => [
  ...document.nodes.filter((node) => !nodeRegistry.has(node.kind)).map((node): ValidationIssue => ({ ruleId: 'unknown-node-kind', severity: 'error', message: `Unknown node kind: ${node.kind}`, nodeId: node.id })),
  ...document.edges.filter((edge) => !edgeRegistry.has(edge.kind)).map((edge): ValidationIssue => ({ ruleId: 'unknown-edge-kind', severity: 'error', message: `Unknown edge kind: ${edge.kind}`, edgeId: edge.id })),
]

const edgeReferencesRule: FlowValidationRule = ({ document, nodeRegistry }) => {
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  const issues: ValidationIssue[] = []
  document.edges.forEach((edge) => {
    const source = document.nodes.find((node) => node.id === edge.source)
    const target = document.nodes.find((node) => node.id === edge.target)
    if (!nodeIds.has(edge.source)) issues.push({ ruleId: 'unknown-edge-source', severity: 'error', message: `Edge source ${edge.source} does not exist.`, edgeId: edge.id })
    if (!nodeIds.has(edge.target)) issues.push({ ruleId: 'unknown-edge-target', severity: 'error', message: `Edge target ${edge.target} does not exist.`, edgeId: edge.id })
    if (source) {
      const definition = nodeRegistry.get(source.kind)
      if (!edge.sourceHandle || !definition?.outputPorts.some((port) => port.id === edge.sourceHandle)) {
        issues.push({ ruleId: 'invalid-source-handle', severity: 'error', message: `Invalid source handle ${edge.sourceHandle ?? 'null'} on ${edge.source}.`, edgeId: edge.id })
      }
      if (definition?.inputPorts.some((port) => port.id === edge.sourceHandle)) {
        issues.push({ ruleId: 'invalid-connection-direction', severity: 'error', message: 'Connections must originate from an output port.', edgeId: edge.id })
      }
    }
    if (target) {
      const definition = nodeRegistry.get(target.kind)
      if (!edge.targetHandle || !definition?.inputPorts.some((port) => port.id === edge.targetHandle)) {
        issues.push({ ruleId: 'invalid-target-handle', severity: 'error', message: `Invalid target handle ${edge.targetHandle ?? 'null'} on ${edge.target}.`, edgeId: edge.id })
      }
      if (definition?.outputPorts.some((port) => port.id === edge.targetHandle)) {
        issues.push({ ruleId: 'invalid-connection-direction', severity: 'error', message: 'Connections must terminate at an input port.', edgeId: edge.id })
      }
    }
  })
  return issues
}

const boundaryNodesRule: FlowValidationRule = ({ document }) => {
  if (document.flow.kind !== 'generic') return []
  const starts = document.nodes.filter((node) => node.kind === 'start')
  const ends = document.nodes.filter((node) => node.kind === 'end')
  const issues: ValidationIssue[] = []
  if (starts.length === 0) issues.push({ ruleId: 'missing-start', severity: 'error', message: 'Flow requires one Start node.' })
  if (starts.length > 1) issues.push({ ruleId: 'multiple-starts', severity: 'error', message: 'Flow has multiple Start nodes.' })
  if (ends.length === 0) issues.push({ ruleId: 'missing-end', severity: 'error', message: 'Flow requires at least one End node.' })
  return issues
}

const orphanRule: FlowValidationRule = ({ document }) => {
  const connected = new Set(document.edges.flatMap((edge) => [edge.source, edge.target]))
  return document.nodes.filter((node) => !connected.has(node.id)).map((node): ValidationIssue => ({ ruleId: 'orphan-node', severity: 'warning', message: `${node.id} is not connected.`, nodeId: node.id }))
}

const selfLoopRule: FlowValidationRule = ({ document }) => document.edges
  .filter((edge) => edge.source === edge.target)
  .map((edge): ValidationIssue => ({ ruleId: 'self-loop', severity: 'warning', message: `Self-loop on ${edge.source}.`, edgeId: edge.id }))

const cycleRule: FlowValidationRule = ({ document }) => {
  const adjacency = new Map<string, string[]>()
  document.nodes.forEach((node) => adjacency.set(node.id, []))
  document.edges.forEach((edge) => adjacency.get(edge.source)?.push(edge.target))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle = false
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) { cycle = true; return }
    if (visited.has(nodeId) || cycle) return
    visiting.add(nodeId)
    adjacency.get(nodeId)?.forEach(visit)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  document.nodes.forEach((node) => visit(node.id))
  return cycle ? [{ ruleId: 'cycle-detected', severity: 'warning', message: 'Cycle detected. Generic flows allow cycles but report them for domain validators.' }] : []
}

const requiredLabelRule: FlowValidationRule = ({ document }) => document.nodes
  .filter((node) => typeof node.data.label !== 'string' || node.data.label.trim().length === 0)
  .map((node): ValidationIssue => ({ ruleId: 'empty-required-label', severity: 'error', message: `${node.id} requires a label.`, nodeId: node.id }))

export const genericFlowRules: FlowValidationRule[] = [
  schemaVersionRule,
  duplicateIdsRule,
  knownKindsRule,
  edgeReferencesRule,
  boundaryNodesRule,
  orphanRule,
  selfLoopRule,
  cycleRule,
  requiredLabelRule,
]
