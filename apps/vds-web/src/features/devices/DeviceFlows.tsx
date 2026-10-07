import { Orbit, Plus, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDeviceFlow } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
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
  const flowDocument = localFlow ? localFlowRepository.load(localFlow.id) : packagedFlow.data

  const editorLink = item ? `${editorBase}/${encodeURIComponent(item.id)}` : `${editorBase}/new`

  return (
    <Panel
      actions={!packagedFlow.isPending && (
        item
          ? <Link className="button button-primary button-sm" to={editorLink}><Workflow aria-hidden="true" size={12} /> Open editor</Link>
          : <Link className="button button-primary button-sm" to={editorLink}><Plus aria-hidden="true" size={12} /> Define behavior</Link>
      )}
      className="dv-tab-panel dv-flows"
      icon={Orbit}
      meta="always-on device logic"
      title="Behavior Model"
    >
      {packagedFlow.isPending && !localFlow && <AsyncState kind="loading" title="Loading packaged behavior model" />}
      {!packagedFlow.isPending && !item && (
        <AsyncState
          detail={<>No behavior model is defined for <code>{deviceId}</code>. <Link className="inline-link" to={editorLink}>Create the runtime logic</Link> in the visual editor.</>}
          kind="empty"
          title="No behavior model"
        />
      )}
      {item && (
        <dl className="kv-grid dv-flows-grid">
          <div><dt>Model</dt><dd><strong>{item.name}</strong></dd></div>
          <div><dt>Source</dt><dd><span className={`chip${item.source === 'local' ? ' dv-chip-draft' : ''}`}>{item.source === 'local' ? 'local draft' : 'device package'}</span></dd></div>
          <div><dt>Flow ID</dt><dd className="mono">{item.id}</dd></div>
          <div><dt>Revision</dt><dd className="mono">r{item.revision}</dd></div>
          <div><dt>Graph</dt><dd className="mono">{flowDocument ? `${flowDocument.nodes.length} nodes · ${flowDocument.edges.length} edges` : '—'}</dd></div>
        </dl>
      )}
    </Panel>
  )
}
