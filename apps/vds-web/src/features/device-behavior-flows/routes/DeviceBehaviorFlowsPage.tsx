import { Orbit, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { GlassPanel } from '../../../components/GlassPanel'
import { PageHeader } from '../../../components/PageHeader'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import { exampleDeviceBehaviorFlow } from '../serialization/deviceBehaviorFlowDocument'
import '../registry/deviceBehaviorRegistry'

export function DeviceBehaviorFlowsPage() {
  const local = localFlowRepository.list().filter((item) => item.kind === 'device_behavior')
  const items = [...local, { id: exampleDeviceBehaviorFlow.flow.id, name: exampleDeviceBehaviorFlow.flow.name, kind: 'device_behavior', revision: 1, updatedAt: exampleDeviceBehaviorFlow.flow.updated_at, source: 'example' as const }]
  return <div className="page-stack"><PageHeader eyebrow="Author against the existing runtime" title="Device behavior flows" description="Create deterministic state-machine fragments with typed transition edges, runtime-backed register validation, and local persistence." /><GlassPanel className="flows-catalog" eyebrow="Local workspace" title="Behavior documents"><div className="flow-list"><Link className="flow-list-new" to="/flows/devices/new"><Plus size={21} /><div><strong>New device behavior</strong><span>Start with an initial and ready state.</span></div></Link>{items.map((item) => <Link className="flow-list-card" key={`${item.source}-${item.id}`} to={`/flows/devices/${encodeURIComponent(item.id)}${item.source === 'example' ? '?readonly=1' : ''}`}><span className="flow-list-icon"><Orbit size={18} /></span><div className="flow-list-copy"><span>{item.source} · state machine</span><strong>{item.name}</strong><small>{item.id}</small></div><div className="flow-list-meta"><span>r{item.revision}</span></div></Link>)}</div></GlassPanel></div>
}
