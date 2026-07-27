import { Orbit, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDeviceFlow } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { localFlowRepository } from '../flows/serialization/localFlowRepository'
import { behaviorSettings } from './behavior/types/deviceBehaviorFlow'
import './behavior/registry/deviceBehaviorRegistry'

export function DeviceFlows({ deviceId }: { deviceId: string }) {
  const editorBase = `/devices/${encodeURIComponent(deviceId)}/flows`
  const packagedFlow = useDeviceFlow(deviceId)
  const localFlow = localFlowRepository.list()
    .filter((item) => item.kind === 'device_behavior')
    .find((item) => {
      const document = localFlowRepository.load(item.id)
      return document ? behaviorSettings(document).device_id === deviceId : false
    })
  const item = localFlow ?? (packagedFlow.data
    ? {
      id: packagedFlow.data.flow.id,
      name: packagedFlow.data.flow.name,
      kind: 'device_behavior',
      revision: packagedFlow.data.flow.revision,
      updatedAt: packagedFlow.data.flow.updated_at,
      source: 'package' as const,
    }
    : null)

  return (
    <GlassPanel className="flows-catalog" eyebrow="Device behavior" title="Flows">
      <div className="flow-list">
        {packagedFlow.isPending && !localFlow && <AsyncState kind="loading" title="Loading packaged device flow" />}
        {!packagedFlow.isPending && !item && <Link className="flow-list-new" to={`${editorBase}/new`}>
          <Plus size={21} />
          <div>
            <strong>Create device flow</strong>
            <span>Define states and transitions for {deviceId}.</span>
          </div>
        </Link>}
        {item && (
          <Link
            className="flow-list-card"
            to={`${editorBase}/${encodeURIComponent(item.id)}`}
          >
            <span className="flow-list-icon"><Orbit size={18} /></span>
            <div className="flow-list-copy">
              <span>{item.source} · device flow</span>
              <strong>{item.name}</strong>
              <small>{item.id}</small>
            </div>
            <div className="flow-list-meta"><span>r{item.revision}</span></div>
          </Link>
        )}
      </div>
    </GlassPanel>
  )
}
