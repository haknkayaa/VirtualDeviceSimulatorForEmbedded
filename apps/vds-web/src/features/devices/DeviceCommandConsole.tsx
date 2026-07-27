import { Cpu, Radio } from 'lucide-react'

import { useDeviceCommands } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'

function hex(value: number) {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

export function DeviceCommandConsole({ deviceId }: { deviceId: string }) {
  const commands = useDeviceCommands(deviceId)

  if (commands.isPending) return <GlassPanel><AsyncState kind="loading" title="Loading commands" /></GlassPanel>
  if (commands.isError) return <GlassPanel><AsyncState detail={commands.error.message} kind="error" title="Commands unavailable" /></GlassPanel>
  if (!commands.data?.length) return <GlassPanel><AsyncState kind="empty" title="No commands defined" /></GlassPanel>

  return (
    <GlassPanel className="device-command-console" eyebrow="Package definition" title="Commands">
      <div className="command-console-layout">
        <div className="command-catalog">
          {commands.data.map((command) => (
            <article className="command-definition-card" key={command.name}>
              <header>
                <Cpu aria-hidden="true" size={16} />
                <code>0x{hex(command.opcode)}</code>
                <strong>{command.name}</strong>
              </header>
              <span>{command.operation ?? 'control command'}</span>
              {command.wire ? (
                <small>
                  <Radio aria-hidden="true" size={12} />
                  {command.wire.command_width}-{command.wire.address_width}-{command.wire.data_width}
                  {' · '}{command.wire.rate.toUpperCase()}
                  {' · '}{command.wire.dummy_cycles} dummy cycles
                </small>
              ) : null}
            </article>
          ))}
        </div>
        <p className="command-data-plane-note">
          Commands are package metadata. Execute hardware transactions through the configured
          Linux device endpoint or the Unix-socket data plane.
        </p>
      </div>
    </GlassPanel>
  )
}
