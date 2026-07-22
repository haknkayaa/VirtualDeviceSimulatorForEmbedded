import type { FlowDocument } from '../../flows/types/flow'
import { EXECUTABLE_SCENARIO_KINDS, SCENARIO_NODE_KINDS, type CompilerIssue, type OrderedScenarioGraph } from '../types/scenarioFlow'

export function orderedScenarioNodes(document: FlowDocument): OrderedScenarioGraph {
  const errors: CompilerIssue[] = []
  const starts = document.nodes.filter((node) => node.kind === SCENARIO_NODE_KINDS.start)
  if (starts.length !== 1) return { nodes: [], errors }
  const incoming = new Map<string, typeof document.edges>()
  const outgoing = new Map<string, typeof document.edges>()
  document.nodes.forEach((node) => { incoming.set(node.id, []); outgoing.set(node.id, []) })
  document.edges.forEach((edge) => { incoming.get(edge.target)?.push(edge); outgoing.get(edge.source)?.push(edge) })
  document.nodes.forEach((node) => {
    const ins = incoming.get(node.id)?.length ?? 0
    const outs = outgoing.get(node.id)?.length ?? 0
    if (node.kind === SCENARIO_NODE_KINDS.start && outs !== 1) errors.push({ code: 'start-outgoing', message: 'Start Scenario must have exactly one outgoing edge.', node_id: node.id })
    if (node.kind === SCENARIO_NODE_KINDS.end && outs !== 0) errors.push({ code: 'end-outgoing', message: 'End Scenario cannot have an outgoing edge.', node_id: node.id })
    if (EXECUTABLE_SCENARIO_KINDS.has(node.kind as never) && outs > 1) errors.push({ code: 'unsupported-branch', message: `${node.id} has multiple outgoing edges; scenario branching is not supported.`, node_id: node.id })
    if (EXECUTABLE_SCENARIO_KINDS.has(node.kind as never) && ins > 1) errors.push({ code: 'unsupported-merge', message: `${node.id} has multiple incoming edges; scenario merges are not supported.`, node_id: node.id })
  })
  if (errors.length) return { nodes: [], errors }
  const ordered = []
  const visited = new Set<string>()
  let current = starts[0]
  while (current) {
    if (visited.has(current.id)) { errors.push({ code: 'scenario-cycle', message: `Cycle detected at ${current.id}.`, node_id: current.id }); break }
    visited.add(current.id)
    if (EXECUTABLE_SCENARIO_KINDS.has(current.kind as never)) ordered.push(current)
    if (current.kind === SCENARIO_NODE_KINDS.end) break
    const edge = outgoing.get(current.id)?.[0]
    if (!edge) { errors.push({ code: 'unterminated-path', message: `Scenario path stops at ${current.id} before an End node.`, node_id: current.id }); break }
    const next = document.nodes.find((node) => node.id === edge.target)
    if (!next) break
    current = next
  }
  document.nodes.filter((node) => EXECUTABLE_SCENARIO_KINDS.has(node.kind as never) && !visited.has(node.id)).forEach((node) => errors.push({ code: 'disconnected-executable', message: `${node.id} is not on the Start-to-End execution path.`, node_id: node.id }))
  return { nodes: ordered, errors }
}
