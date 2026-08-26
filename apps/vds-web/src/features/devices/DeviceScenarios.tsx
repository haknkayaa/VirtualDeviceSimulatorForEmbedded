import { useState } from 'react'

import { localFlowRepository } from '../flows/serialization/localFlowRepository'
import { ScenariosPage } from './scenarios/ScenariosPage'

export function DeviceScenarios({ deviceId, inspectorTarget }: { deviceId: string; inspectorTarget?: Element | null }) {
  const [, setLocalRevision] = useState(0)
  const localScenarios = localFlowRepository.list().filter((item) => {
    if (item.kind !== 'scenario') return false
    const document = localFlowRepository.load(item.id)
    if (!document) return false
    const settings = document.metadata.scenario
    const metadataDevice = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings.device_id : undefined
    return metadataDevice === deviceId || document.nodes.some((node) => node.data.device_id === deviceId)
  })

  return <ScenariosPage
    deviceId={deviceId}
    embedded
    inspectorTarget={inspectorTarget}
    localScenarios={localScenarios}
    onDeleteDraft={(id, name) => {
      if (!window.confirm(`Delete local draft "${name}"? This cannot be undone.`)) return
      if (localFlowRepository.remove(id)) setLocalRevision((revision) => revision + 1)
    }}
  />
}
