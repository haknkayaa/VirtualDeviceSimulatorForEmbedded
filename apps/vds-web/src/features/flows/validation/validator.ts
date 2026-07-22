import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import type { EdgeRegistryReader, FlowConnection, FlowDocument, FlowValidationRule, NodeRegistryReader, ValidationContext, ValidationIssue } from '../types/flow'
import { genericFlowRules } from './rules'

const extensions = new Map<string, FlowValidationRule[]>()

export function registerFlowValidationRules(flowKind: string, rules: FlowValidationRule[]) {
  extensions.set(flowKind, rules)
  return () => extensions.delete(flowKind)
}

export function validateFlowDocument(
  document: FlowDocument,
  registries: { nodeRegistry?: NodeRegistryReader; edgeRegistry?: EdgeRegistryReader } = {},
): ValidationIssue[] {
  const context: ValidationContext = {
    document,
    nodeRegistry: registries.nodeRegistry ?? nodeRegistry,
    edgeRegistry: registries.edgeRegistry ?? edgeRegistry,
  }
  const issues = [...genericFlowRules, ...(extensions.get(document.flow.kind) ?? [])].flatMap((rule) => rule(context))
  document.nodes.forEach((node) => context.nodeRegistry.get(node.kind)?.validationRules.forEach((rule) => issues.push(...rule(node, context))))
  document.edges.forEach((edge) => context.edgeRegistry.get(edge.kind)?.validationRules.forEach((rule) => issues.push(...rule(edge, context))))
  return issues.filter((issue) => {
    if (!issue.nodeId) return true
    const muted = document.nodes.find((node) => node.id === issue.nodeId)?.validation?.muted_rule_ids ?? []
    return !muted.includes(issue.ruleId)
  })
}

export function validateFlowConnection(document: FlowDocument, connection: FlowConnection, kind = 'default') {
  const source = document.nodes.find((node) => node.id === connection.source)
  const target = document.nodes.find((node) => node.id === connection.target)
  if (!source || !target) return false
  const sourceDefinition = nodeRegistry.get(source.kind)
  const targetDefinition = nodeRegistry.get(target.kind)
  if (!sourceDefinition?.outputPorts.some((port) => port.id === connection.sourceHandle)) return false
  if (!targetDefinition?.inputPorts.some((port) => port.id === connection.targetHandle)) return false
  const edgeDefinition = edgeRegistry.get(kind)
  if (!edgeDefinition) return false
  return edgeDefinition.validateConnection(connection, { document, nodeRegistry, edgeRegistry })
}
