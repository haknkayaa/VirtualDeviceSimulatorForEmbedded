import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'

export function DeviceLibraryPage() {
  return (
    <div className="page-stack">
      <PageHeader
        description="Reusable device packages and model discovery will live here in a later phase."
        eyebrow="Workspace / Library"
        title="Device Library"
      />
      <GlassPanel>
        <AsyncState
          detail="This section is reserved for the Device Library phase."
          kind="empty"
          title="Device Library is not available yet"
        />
      </GlassPanel>
    </div>
  )
}
