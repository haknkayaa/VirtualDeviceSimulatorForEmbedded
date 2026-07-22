import { GenericNodeInspector } from '../components/GenericInspectorSection'
import { EndNode } from '../nodes/EndNode'
import { PlaceholderActionNode } from '../nodes/PlaceholderActionNode'
import { StartNode } from '../nodes/StartNode'
import type { NodeRegistryEntry, NodeRegistryReader } from '../types/flow'

export class FlowNodeRegistry implements NodeRegistryReader {
  private readonly entries = new Map<string, NodeRegistryEntry>()

  register(entry: NodeRegistryEntry) {
    if (this.entries.has(entry.kind)) throw new Error(`Node kind "${entry.kind}" is already registered.`)
    this.entries.set(entry.kind, entry)
    return this
  }

  get(kind: string) { return this.entries.get(kind) }
  has(kind: string) { return this.entries.has(kind) }
  list() { return [...this.entries.values()] }
}

export const nodeRegistry = new FlowNodeRegistry()
  .register({
    kind: 'start', displayName: 'Start', description: 'Entry point for a generic flow.', category: 'Control',
    iconIdentifier: 'play', accentToken: 'cyan', defaultData: { label: 'Start' }, inputPorts: [],
    outputPorts: [{ id: 'out', label: 'Next', required: true }], component: StartNode,
    inspectorComponent: GenericNodeInspector, validationRules: [],
  })
  .register({
    kind: 'end', displayName: 'End', description: 'Terminal point for a generic flow.', category: 'Control',
    iconIdentifier: 'flag', accentToken: 'violet', defaultData: { label: 'End' },
    inputPorts: [{ id: 'in', label: 'Previous', required: true }], outputPorts: [], component: EndNode,
    inspectorComponent: GenericNodeInspector, validationRules: [],
  })
  .register({
    kind: 'placeholder_action', displayName: 'Placeholder Action', description: 'A semantic-free action used to exercise the editor foundation.',
    category: 'Actions', iconIdentifier: 'workflow', accentToken: 'amber', defaultData: { label: 'Placeholder Action' },
    inputPorts: [{ id: 'in', label: 'Input' }], outputPorts: [{ id: 'out', label: 'Output' }],
    component: PlaceholderActionNode, inspectorComponent: GenericNodeInspector, validationRules: [],
  })

export const canvasNodeTypes = Object.fromEntries(nodeRegistry.list().map((entry) => [entry.kind, entry.component]))
canvasNodeTypes.unknown = PlaceholderActionNode
