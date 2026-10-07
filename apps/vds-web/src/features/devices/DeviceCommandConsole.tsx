import { Search, Terminal } from 'lucide-react'
import { type KeyboardEvent, useMemo, useState } from 'react'

import type { DeviceCommand } from '../../types/api'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { formatBytes, humanize } from '../../utils/format'

function opcode(value: number) {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`
}

function commandKind(command: DeviceCommand) {
  if (command.operation) return humanize(command.operation)
  if (command.event) return humanize(command.event)
  return 'fixed response'
}

const laneDigit = { single: 1, dual: 2, quad: 4 } as const

function wireSummary(command: DeviceCommand) {
  if (!command.wire) return null
  const { command_width, address_width, data_width, rate } = command.wire
  return `${laneDigit[command_width]}-${laneDigit[address_width]}-${laneDigit[data_width]} ${rate.toUpperCase()}`
}

interface DeviceCommandConsoleProps {
  commands?: DeviceCommand[]
  errorMessage?: string
  isLoading: boolean
  onSelect: (name: string) => void
  selectedName?: string
}

export function DeviceCommandConsole({ commands, errorMessage, isLoading, onSelect, selectedName }: DeviceCommandConsoleProps) {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return commands ?? []
    return (commands ?? []).filter((command) =>
      [command.name, opcode(command.opcode), command.operation ?? '', command.event ?? '', command.register ?? '']
        .some((value) => value.toLowerCase().includes(term)))
  }, [commands, filter])

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = visible.findIndex((command) => command.name === selectedName)
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (next) onSelect(next.name)
  }

  return (
    <Panel
      actions={(
        <label className="search-input dv-panel-search">
          <Search aria-hidden="true" size={12} />
          <span className="sr-only">Filter commands</span>
          <input onChange={(event) => setFilter(event.target.value)} placeholder="Name, opcode, operation" type="search" value={filter} />
        </label>
      )}
      className="dv-tab-panel dv-commands"
      flush
      footer={<span>Commands are package metadata. Execute hardware transactions through the configured Linux device endpoint or the Unix-socket data plane.</span>}
      icon={Terminal}
      meta={commands ? `${visible.length}/${commands.length}` : undefined}
      title="Commands"
    >
      {isLoading && <AsyncState kind="loading" title="Loading commands" />}
      {errorMessage && <AsyncState detail={errorMessage} kind="error" title="Commands unavailable" />}
      {!isLoading && !errorMessage && !commands?.length && <AsyncState kind="empty" title="No commands defined" />}
      {commands && commands.length > 0 && (
        <div aria-label="Command table" className="dv-table-scroll" onKeyDown={moveSelection} role="region" tabIndex={0}>
          <table className="data-table dv-commands-table">
            <colgroup><col className="dv-cmd-col-op" /><col /><col className="dv-cmd-col-kind" /><col className="dv-cmd-col-addr" /><col className="dv-cmd-col-wire" /><col className="dv-cmd-col-latency" /></colgroup>
            <thead>
              <tr><th>Op</th><th>Command</th><th>Kind</th><th className="num">Addr</th><th>Wire</th><th className="num">Latency</th></tr>
            </thead>
            <tbody>
              {visible.map((command) => (
                <tr
                  aria-selected={selectedName === command.name}
                  className={`clickable${selectedName === command.name ? ' selected' : ''}`}
                  key={command.name}
                  onClick={() => onSelect(command.name)}
                >
                  <td className="mono">{opcode(command.opcode)}</td>
                  <td className="dv-cmd-name" title={command.name}><strong>{command.name}</strong></td>
                  <td className="dim dv-cmd-kind" title={command.register ?? undefined}>{commandKind(command)}</td>
                  <td className="num dim">{command.address_bytes ?? '—'}</td>
                  <td className="mono dim">{wireSummary(command) ?? '—'}</td>
                  <td className="num dim">{command.timing ? `${command.timing.latency_us} µs` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

export function DeviceCommandInspector({ command }: { command?: DeviceCommand }) {
  return (
    <Panel className="dv-command-inspector" icon={Terminal} meta={command ? opcode(command.opcode) : undefined} title="Command Inspector">
      {!command
        ? <AsyncState detail="Select a command to inspect its protocol metadata." kind="empty" title="No command selected" />
        : (
          <>
            <h3 className="dv-inspector-heading"><code>{opcode(command.opcode)}</code> {command.name}</h3>
            <dl className="kv-grid">
              <div><dt>Kind</dt><dd>{commandKind(command)}</dd></div>
              {command.register ? <div><dt>Register</dt><dd className="mono">{command.register}</dd></div> : null}
              {command.address_bytes ? <div><dt>Address</dt><dd>{command.address_bytes} byte{command.address_bytes === 1 ? '' : 's'}</dd></div> : null}
              {command.timing ? <div><dt>Latency</dt><dd className="mono">{command.timing.latency_us} µs{command.timing.busy_during_operation ? ' · sets busy' : ''}</dd></div> : null}
              {command.event ? <div><dt>Event</dt><dd className="mono">{command.event}</dd></div> : null}
              {command.event_delay_us ? <div><dt>Event delay</dt><dd className="mono">{command.event_delay_us} µs</dd></div> : null}
              {command.response?.length ? <div><dt>Response</dt><dd className="mono">{formatBytes(command.response)}</dd></div> : null}
              {command.wire ? (
                <div>
                  <dt>Wire</dt>
                  <dd className="mono">{wireSummary(command)} · {command.wire.dummy_cycles} dummy</dd>
                </div>
              ) : null}
              {command.shortcut ? <div><dt>Example TX</dt><dd className="mono" title={command.shortcut.description}>{formatBytes(command.shortcut.tx)} · rx {command.shortcut.rx_length}</dd></div> : null}
            </dl>
            <div className="panel-section-title dv-flush-title">Allowed states</div>
            <div className="dv-chips">
              {command.allowed_states.length
                ? command.allowed_states.map((state) => <span className="chip mono" key={state}>{state}</span>)
                : <span className="chip">all</span>}
            </div>
          </>
        )}
    </Panel>
  )
}
