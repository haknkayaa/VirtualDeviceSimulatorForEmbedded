import { GenericEdgeInspector } from '../components/GenericInspectorSection'
import { BaseFlowEdge } from '../edges/BaseFlowEdge'
import type { EdgeRegistryEntry, EdgeRegistryReader } from '../types/flow'

export class FlowEdgeRegistry implements EdgeRegistryReader {
  private readonly entries = new Map<string, EdgeRegistryEntry>()

  register(entry: EdgeRegistryEntry) {
    if (this.entries.has(entry.kind)) throw new Error(`Edge kind "${entry.kind}" is already registered.`)
    this.entries.set(entry.kind, entry)
    return this
  }

  get(kind: string) { return this.entries.get(kind) }
  has(kind: string) { return this.entries.has(kind) }
  list() { return [...this.entries.values()] }
}

export const edgeRegistry = new FlowEdgeRegistry().register({
  kind: 'default',
  displayName: 'Flow connection',
  component: BaseFlowEdge,
  validateConnection: () => true,
  defaultData: {},
  inspectorComponent: GenericEdgeInspector,
  validationRules: [],
})

export const canvasEdgeTypes = Object.fromEntries(edgeRegistry.list().map((entry) => [entry.kind, entry.component]))
canvasEdgeTypes.unknown = BaseFlowEdge
