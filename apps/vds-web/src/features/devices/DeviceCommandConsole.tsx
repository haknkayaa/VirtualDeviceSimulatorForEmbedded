import { Cpu, Radio } from 'lucide-react'

import type { DeviceCommand } from '../../types/api'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'

function hex(value: number) {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function bytes(values?: number[]) {
  return values?.map((value) => hex(value)).join(' ') ?? ''
}

interface DeviceCommandConsoleProps {
  commands?: DeviceCommand[]
  errorMessage?: string
  isLoading: boolean
  onSelect: (name: string) => void
  selectedName?: string
}

export function DeviceCommandConsole({ commands, errorMessage, isLoading, onSelect, selectedName }: DeviceCommandConsoleProps) {
  if (isLoading) return <GlassPanel><AsyncState kind="loading" title="Loading commands" /></GlassPanel>
  if (errorMessage) return <GlassPanel><AsyncState detail={errorMessage} kind="error" title="Commands unavailable" /></GlassPanel>
  if (!commands?.length) return <GlassPanel><AsyncState kind="empty" title="No commands defined" /></GlassPanel>

  return (
    <GlassPanel className="device-command-console" eyebrow="Package definition" title="Commands">
      <div className="command-console-layout">
        <div className="command-catalog command-selector-list">
          {commands.map((command) => (
            <button
              aria-pressed={selectedName === command.name}
              className={selectedName === command.name ? 'active' : ''}
              key={command.name}
              onClick={() => onSelect(command.name)}
              type="button"
            >
              <code>0x{hex(command.opcode)}</code>
              <span className="command-selector-copy">
                <strong>{command.name}</strong>
                <small>{command.operation ? label(command.operation) : command.event ? label(command.event) : 'fixed response'}</small>
              </span>
            </button>
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

export function DeviceCommandInspector({ command }: { command?: DeviceCommand }) {
  return (
    <GlassPanel className="device-context-inspector command-inspector" eyebrow="Protocol definition" title="Command Inspector">
      {!command
        ? <AsyncState detail="Select a command to inspect its protocol metadata." kind="empty" title="No command selected" />
        : <>
          <header className="command-inspector-heading">
            <span><Cpu aria-hidden="true" size={17} /></span>
            <div><code>0x{hex(command.opcode)}</code><strong>{command.name}</strong></div>
          </header>
          <p className="command-inspector-kind">{command.operation ? label(command.operation) : command.event ? label(command.event) : 'fixed response'}</p>
          <dl className="command-definition-details command-inspector-details">
            {command.address_bytes ? <div><dt>Address</dt><dd>{command.address_bytes} byte{command.address_bytes === 1 ? '' : 's'}</dd></div> : null}
            {command.register ? <div><dt>Register</dt><dd>{command.register}</dd></div> : null}
            {command.timing ? <div><dt>Timing</dt><dd>{command.timing.latency_us} µs{command.timing.busy_during_operation ? ' · busy' : ''}</dd></div> : null}
            {command.event_delay_us ? <div><dt>Event delay</dt><dd>{command.event_delay_us} µs</dd></div> : null}
            {command.response?.length ? <div><dt>Response</dt><dd><code>{bytes(command.response)}</code></dd></div> : null}
          </dl>
          {command.wire ? <div className="command-wire-summary"><Radio aria-hidden="true" size={13} /><span>{command.wire.command_width}-{command.wire.address_width}-{command.wire.data_width} · {command.wire.rate.toUpperCase()} · {command.wire.dummy_cycles} dummy cycles</span></div> : null}
          <section className="command-inspector-states">
            <strong>Allowed states</strong>
            <div>{command.allowed_states.length ? command.allowed_states.map((state) => <span key={state}>{label(state)}</span>) : <span>all</span>}</div>
          </section>
        </>}
    </GlassPanel>
  )
}
