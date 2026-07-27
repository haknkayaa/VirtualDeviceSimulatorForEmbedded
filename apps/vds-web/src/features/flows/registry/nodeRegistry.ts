import { PlaceholderActionNode } from '../nodes/PlaceholderActionNode'
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

export function canvasNodeTypes() {
  return { ...Object.fromEntries(nodeRegistry.list().map((entry) => [entry.kind, entry.component])), unknown: PlaceholderActionNode }
}
