import { Flag, Play, Search, Workflow } from 'lucide-react'

import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowStore } from '../store/flowStore'

const icons = { play: Play, flag: Flag, workflow: Workflow }
export const FLOW_NODE_MIME = 'application/vnd.vds4e.flow-node-kind'

export function NodePalette() {
  const search = useFlowStore((state) => state.paletteSearch)
  const setSearch = useFlowStore((state) => state.setPaletteSearch)
  const readOnly = useFlowStore((state) => state.readOnly)
  const flowKind = useFlowStore((state) => state.document.flow.kind)
  const nodes = nodeRegistry.list()
    .filter((entry) => !entry.flowKinds || entry.flowKinds.includes(flowKind))
    .filter((entry) => `${entry.displayName} ${entry.description} ${entry.category}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <aside className="flow-palette flow-frosted" aria-label="Node palette">
      <header><div><span className="eyebrow">Registry</span><strong>Node palette</strong></div><span>{nodes.length}</span></header>
      <label className="flow-palette-search"><Search aria-hidden="true" size={14} /><input aria-label="Search nodes" onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes" value={search} /></label>
      <div className="flow-palette-list">
        {nodes.map((entry) => {
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
              <span><Icon aria-hidden="true" size={16} /></span><div><strong>{entry.displayName}</strong><small>{entry.category}</small></div>
            </button>
          )
        })}
      </div>
      <p>Drag a registered {flowKind} type onto the canvas.</p>
    </aside>
  )
}
