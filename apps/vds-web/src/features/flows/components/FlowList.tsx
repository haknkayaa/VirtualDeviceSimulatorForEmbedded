import { ArrowRight, Clock3, FileJson2, GitBranch, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { FlowListItem } from '../types/flow'

export function FlowList({ items }: { items: FlowListItem[] }) {
  return (
    <div className="flow-list">
      <Link className="flow-list-new" to="/flows/new"><Plus size={20} /><div><strong>New generic flow</strong><span>Create an offline, versioned flow document.</span></div></Link>
      {items.map((item) => (
        <Link className="flow-list-card" key={`${item.source}-${item.id}`} to={`/flows/${encodeURIComponent(item.id)}`}>
          <div className="flow-list-icon"><GitBranch size={18} /></div>
          <div className="flow-list-copy"><span>{item.source} · {item.kind}</span><strong>{item.name}</strong><small>{item.id}</small></div>
          <div className="flow-list-meta"><span><FileJson2 size={13} /> revision {item.revision}</span><span><Clock3 size={13} /> {item.updatedAt.slice(0, 10)}</span></div>
          <ArrowRight size={17} />
        </Link>
      ))}
    </div>
  )
}
