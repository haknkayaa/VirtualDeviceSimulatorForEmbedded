import { GitBranch, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { GlassPanel } from '../../../components/GlassPanel'
import { PageHeader } from '../../../components/PageHeader'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import { exampleScenarioFlow } from '../serialization/scenarioFlowDocument'
import '../registry/scenarioNodeRegistry'

export function ScenarioFlowsPage() {
  const local = localFlowRepository.list().filter((item) => item.kind === 'scenario')
  const items = [...local, { id: exampleScenarioFlow.flow.id, name: exampleScenarioFlow.flow.name, kind: 'scenario', revision: 1, updatedAt: exampleScenarioFlow.flow.updated_at, source: 'example' as const }]
  return <div className="page-stack"><PageHeader eyebrow="Deterministic visual authoring" title="Scenario flows" description="Compile linear visual graphs into the existing vds-scenario definition and run them through the existing control plane." /><GlassPanel className="flows-catalog" eyebrow="Local workspace" title="Scenario documents"><div className="flow-list"><Link className="flow-list-new" to="/flows/scenarios/new"><Plus size={21} /><div><strong>New scenario flow</strong><span>Start with a local linear scenario document.</span></div></Link>{items.map((item) => <Link className="flow-list-card" key={`${item.source}-${item.id}`} to={`/flows/scenarios/${encodeURIComponent(item.id)}${item.source === 'example' ? '?readonly=1' : ''}`}><span className="flow-list-icon"><GitBranch size={18} /></span><div className="flow-list-copy"><span>{item.source} · scenario</span><strong>{item.name}</strong><small>{item.id}</small></div><div className="flow-list-meta"><span>r{item.revision}</span></div></Link>)}</div></GlassPanel></div>
}
