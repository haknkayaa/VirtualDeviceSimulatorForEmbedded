import { GitBranch, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { GlassPanel } from '../../components/GlassPanel'
import { localFlowRepository } from '../flows/serialization/localFlowRepository'
import { exampleScenarioFlow } from './scenario-flows/serialization/scenarioFlowDocument'
import { ScenariosPage } from './scenarios/ScenariosPage'

export function DeviceScenarios({ deviceId }: { deviceId: string }) {
  const editorBase = `/devices/${encodeURIComponent(deviceId)}/scenarios`
  const localScenarios = localFlowRepository.list().filter((item) => {
    if (item.kind !== 'scenario') return false
    const document = localFlowRepository.load(item.id)
    if (!document) return false
    const settings = document.metadata.scenario
    const metadataDevice = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings.device_id : undefined
    return metadataDevice === deviceId || document.nodes.some((node) => node.data.device_id === deviceId)
  })
  const exampleTargetsDevice = exampleScenarioFlow.nodes.some((node) => node.data.device_id === deviceId)

  return (
    <div className="device-scenarios">
      <GlassPanel className="flows-catalog" eyebrow="Visual authoring" title="Scenario flows">
        <div className="flow-list">
          <Link className="flow-list-new" to={`${editorBase}/new`}>
            <Plus size={21} />
            <div><strong>New scenario flow</strong><span>Create a deterministic scenario for {deviceId}.</span></div>
          </Link>
          {localScenarios.map((item) => (
            <Link className="flow-list-card" key={item.id} to={`${editorBase}/${encodeURIComponent(item.id)}`}>
              <span className="flow-list-icon"><GitBranch size={18} /></span>
              <div className="flow-list-copy"><span>local · scenario</span><strong>{item.name}</strong><small>{item.id}</small></div>
              <div className="flow-list-meta"><span>r{item.revision}</span></div>
            </Link>
          ))}
          {exampleTargetsDevice ? (
            <Link className="flow-list-card" to={`${editorBase}/${encodeURIComponent(exampleScenarioFlow.flow.id)}?readonly=1`}>
              <span className="flow-list-icon"><GitBranch size={18} /></span>
              <div className="flow-list-copy"><span>example · scenario</span><strong>{exampleScenarioFlow.flow.name}</strong><small>{exampleScenarioFlow.flow.id}</small></div>
              <div className="flow-list-meta"><span>r1</span></div>
            </Link>
          ) : null}
        </div>
      </GlassPanel>
      <ScenariosPage deviceId={deviceId} embedded />
    </div>
  )
}
