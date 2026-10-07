import { Boxes, Link2, Search } from 'lucide-react'

import { FlowNodeIcon } from '../nodes/nodeIcons'
import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowStore } from '../store/flowStore'

export const FLOW_NODE_MIME = 'application/vnd.vds4e.flow-node-kind'
export const FLOW_REUSABLE_NODE_MIME = 'application/vnd.vds4e.reusable-node'

export function NodePalette() {
  const search = useFlowStore((state) => state.paletteSearch)
  const setSearch = useFlowStore((state) => state.setPaletteSearch)
  const readOnly = useFlowStore((state) => state.readOnly)
  const flowKind = useFlowStore((state) => state.document.flow.kind)
  const documentNodes = useFlowStore((state) => state.document.nodes)
  const query = search.toLowerCase()
  const paletteHint = flowKind === 'scenario'
    ? 'Drag test steps onto the canvas, then connect them in execution order.'
    : flowKind === 'device_behavior'
      ? 'Drag states and behavior actions onto the canvas to define runtime logic.'
      : 'Drag an available node onto the canvas.'
  const reusableNodes = [...new Map(
    documentNodes
      .filter((node) => typeof node.ui.reusable_id === 'string')
      .map((node) => [node.ui.reusable_id as string, node]),
  ).values()].filter((node) => {
    const definition = nodeRegistry.get(node.kind)
    return `${String(node.data.label ?? definition?.displayName ?? node.kind)} ${definition?.description ?? ''} Reusable nodes`.toLowerCase().includes(query)
  })
  const nodes = nodeRegistry.list()
    .filter((entry) => !entry.flowKinds || entry.flowKinds.includes(flowKind))
    .filter((entry) => `${entry.displayName} ${entry.description} ${entry.category}`.toLowerCase().includes(query))
  const categories = [...new Set(nodes.map((entry) => entry.category))]
  return (
    <aside className="flow-palette" aria-label="Node palette">
      <header className="flow-pane-header">
        <h2 className="panel-title"><Boxes aria-hidden="true" size={13} />Nodes</h2>
        <span className="count">{nodes.length}</span>
      </header>
      <div className="flow-palette-search search-input">
        <Search aria-hidden="true" size={13} />
        <input aria-label="Search nodes" onChange={(event) => setSearch(event.target.value)} placeholder="Filter nodes" type="search" value={search} />
      </div>
      <div className="flow-palette-list">
        {flowKind === 'device_behavior' && reusableNodes.length > 0 && <section className="flow-palette-category">
          <h3>Reusable nodes <span className="count">{reusableNodes.length}</span></h3>
          <div>
            {reusableNodes.map((node) => {
              const entry = nodeRegistry.get(node.kind)
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
                title="Linked instances share the same settings. Changes apply to every instance."
                type="button"
              >
                <span className="flow-palette-icon"><FlowNodeIcon identifier={entry?.iconIdentifier} size={13} /></span>
                <strong>{String(node.data.label ?? entry?.displayName ?? node.kind)}</strong>
                <Link2 aria-label="Linked" className="flow-palette-linked" size={12} />
              </button>
            })}
          </div>
        </section>}
        {categories.map((category) => <section className="flow-palette-category" key={category}>
          <h3>{category}</h3>
          <div>
            {nodes.filter((entry) => entry.category === category).map((entry) => {
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
                  <span className="flow-palette-icon"><FlowNodeIcon identifier={entry.iconIdentifier} size={13} /></span>
                  <strong>{entry.displayName}</strong>
                </button>
              )
            })}
          </div>
        </section>)}
        {nodes.length === 0 && reusableNodes.length === 0 && <p className="flow-palette-empty">No nodes match “{search}”.</p>}
      </div>
      <p className="flow-palette-hint">{paletteHint}</p>
    </aside>
  )
}
