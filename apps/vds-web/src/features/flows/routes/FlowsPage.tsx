import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { GlassPanel } from '../../../components/GlassPanel'
import { PageHeader } from '../../../components/PageHeader'
import { FlowList } from '../components/FlowList'
import { exampleFlowDocuments } from '../serialization/examples'
import { localFlowRepository } from '../serialization/localFlowRepository'

export function FlowsPage() {
  const items = useMemo(() => [
    ...localFlowRepository.list(),
    ...exampleFlowDocuments.map((document) => ({
      id: document.flow.id, name: document.flow.name, kind: document.flow.kind,
      revision: document.flow.revision, updatedAt: document.flow.updated_at, source: 'example' as const,
    })),
  ], [])
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Offline visual authoring" title="Flows" description="Versioned local documents powered by a generic node registry. No simulator runtime behavior is attached." />
      <GlassPanel className="flows-catalog" eyebrow="Local workspace" title="Flow documents"><FlowList items={items} /></GlassPanel>
      <GlassPanel className="flows-catalog" eyebrow="Domain editor" title="Visual scenarios"><Link className="flow-list-new" to="/flows/scenarios"><span><strong>Open Scenario Flow Editor</strong><span>Compile deterministic linear graphs into vds-scenario.</span></span></Link></GlassPanel>
      <GlassPanel className="flows-catalog" eyebrow="Domain editor" title="Device behavior"><Link className="flow-list-new" to="/flows/devices"><span><strong>Open Device Behavior Editor</strong><span>Compile edge-centric state graphs into the existing device-model schema.</span></span></Link></GlassPanel>
    </div>
  )
}
