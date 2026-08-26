import { Flag, Play, Search, Workflow } from 'lucide-react'

import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowStore } from '../store/flowStore'

const icons = { play: Play, flag: Flag, workflow: Workflow }
export const FLOW_NODE_MIME = 'application/vnd.vds4e.flow-node-kind'
export const FLOW_REUSABLE_NODE_MIME = 'application/vnd.vds4e.reusable-node'

export function NodePalette() {
  const search = useFlowStore((state) => state.paletteSearch)
  const setSearch = useFlowStore((state) => state.setPaletteSearch)
  const readOnly = useFlowStore((state) => state.readOnly)
  const flowKind = useFlowStore((state) => state.document.flow.kind)
  const paletteHint = flowKind === 'scenario'
    ? 'Drag test steps onto the canvas, then connect them in execution order.'
    : flowKind === 'device_behavior'
      ? 'Drag states and behavior actions onto the canvas to define runtime logic.'
      : 'Drag an available node onto the canvas.'
  const reusableNodes = [...new Map(
    useFlowStore((state) => state.document.nodes)
      .filter((node) => typeof node.ui.reusable_id === 'string')
      .map((node) => [node.ui.reusable_id as string, node]),
  ).values()].filter((node) => {
    const definition = nodeRegistry.get(node.kind)
    return `${String(node.data.label ?? definition?.displayName ?? node.kind)} ${definition?.description ?? ''} Reusable nodes`.toLowerCase().includes(search.toLowerCase())
  })
  const nodes = nodeRegistry.list()
    .filter((entry) => !entry.flowKinds || entry.flowKinds.includes(flowKind))
    .filter((entry) => `${entry.displayName} ${entry.description} ${entry.category}`.toLowerCase().includes(search.toLowerCase()))
  const categories = [...new Set(nodes.map((entry) => entry.category))]
  return (
    <aside className="flow-palette flow-frosted" aria-label="Node palette">
      <header><div><span className="eyebrow">Registry</span><strong>Node palette</strong></div><span>{nodes.length}</span></header>
      <label className="flow-palette-search"><Search aria-hidden="true" size={14} /><input aria-label="Search nodes" onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes" value={search} /></label>
      <p>{paletteHint}</p>
      <div className="flow-palette-list">
        {flowKind === 'device_behavior' && reusableNodes.length > 0 && <section className="flow-palette-category">
          <h3>Reusable nodes</h3>
          <div>
            {reusableNodes.map((node) => {
              const entry = nodeRegistry.get(node.kind)
              const Icon = icons[entry?.iconIdentifier as keyof typeof icons] ?? Workflow
              const reusableId = node.ui.reusable_id as string
              return <button
                className="flow-palette-item flow-palette-item-reusable"
                data-accent={entry?.accentToken}
                disabled={readOnly}
                draggable={!readOnly}
                key={reusableId}
                onDragStart={(event) => {
                  event.dataTransfer.setData(FLOW_REUSABLE_NODE_MIME, reusableId)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                title="Linked instances share the same settings."
                type="button"
              >
                <span><Icon aria-hidden="true" size={16} /></span>
                <div><strong>{String(node.data.label ?? entry?.displayName ?? node.kind)}</strong><small>Linked · changes apply to every instance</small></div>
              </button>
            })}
          </div>
        </section>}
        {categories.map((category) => <section className="flow-palette-category" key={category}>
          <h3>{category}</h3>
          <div>
            {nodes.filter((entry) => entry.category === category).map((entry) => {
              const Icon = icons[entry.iconIdentifier as keyof typeof icons] ?? Workflow
              return (
                <button
                  className="flow-palette-item"
                  data-accent={entry.accentToken}
                  disabled={readOnly}
                  draggable={!readOnly}
                  key={entry.kind}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(FLOW_NODE_MIME, entry.kind)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={entry.description}
                  type="button"
                >
                  <span><Icon aria-hidden="true" size={16} /></span><div><strong>{entry.displayName}</strong><small>{entry.description}</small></div>
                </button>
              )
            })}
          </div>
        </section>)}
      </div>
    </aside>
  )
}
