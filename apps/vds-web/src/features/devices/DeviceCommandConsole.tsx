import { useMemo, useState } from 'react'
import { Cpu, Play, Radio } from 'lucide-react'

import { useDeviceCommands, useExecuteDeviceCommand } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import type { SpiLaneWidth, SpiTransferRate } from '../../types/api'
import { readSpiInterfaceConfiguration } from './spiInterfaceConfiguration'

function hex(value: number) {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function parseHex(value: string) {
  const compact = value.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
  if (compact.length % 2 !== 0) throw new Error('Hex data must contain complete bytes.')
  return compact.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
}

export function DeviceCommandConsole({ deviceId }: { deviceId: string }) {
  const commands = useDeviceCommands(deviceId)
  const execute = useExecuteDeviceCommand()
  const [selectedName, setSelectedName] = useState('')
  const [address, setAddress] = useState('00000000')
  const [payload, setPayload] = useState('')
  const [rxLength, setRxLength] = useState(1)
  const interfaceConfig = useMemo(() => readSpiInterfaceConfiguration(deviceId), [deviceId])
  const [speed, setSpeed] = useState(interfaceConfig.maxClockHz)
  const selected = useMemo(
    () => commands.data?.find((command) => command.name === selectedName) ?? commands.data?.[0],
    [commands.data, selectedName],
  )

  if (commands.isPending) return <GlassPanel><AsyncState kind="loading" title="Loading commands" /></GlassPanel>
  if (commands.isError) return <GlassPanel><AsyncState detail={commands.error.message} kind="error" title="Commands unavailable" /></GlassPanel>
  if (!selected) return <GlassPanel><AsyncState kind="empty" title="No commands defined" /></GlassPanel>

  const wire = selected.wire ?? {
    command_width: 'single' as SpiLaneWidth,
    address_width: 'single' as SpiLaneWidth,
    data_width: 'single' as SpiLaneWidth,
    rate: 'str' as SpiTransferRate,
    dummy_cycles: 0,
  }

  const applyShortcut = () => {
    if (!selected.shortcut) return
    const [, ...shortcutPayload] = selected.shortcut.tx
    setPayload(shortcutPayload.map(hex).join(' '))
    setRxLength(selected.shortcut.rx_length)
  }

  const run = () => {
    try {
      const addressBytes = selected.address_bytes
        ? parseHex(address.padStart(selected.address_bytes * 2, '0').slice(-selected.address_bytes * 2))
        : []
      execute.mutate({
        deviceId,
        tx: [selected.opcode, ...addressBytes, ...parseHex(payload)],
        rx_length: Math.max(0, rxLength),
        wire: {
          mode: (interfaceConfig.cpol << 1) | interfaceConfig.cpha,
          bits_per_word: interfaceConfig.bitsPerWord,
          max_speed_hz: speed,
          ...wire,
          lsb_first: interfaceConfig.lsbFirst,
        },
      })
    } catch (error) {
      execute.reset()
      window.alert(error instanceof Error ? error.message : 'Invalid command input')
    }
  }

  return (
    <GlassPanel className="device-command-console" eyebrow="Wire-level SPI console" title="Commands">
      <div className="command-console-layout">
        <div className="command-catalog">
          {commands.data?.map((command) => (
            <button className={command.name === selected.name ? 'active' : ''} key={command.name} onClick={() => {
              setSelectedName(command.name)
              setRxLength(command.response?.length ?? 1)
              setPayload('')
            }} type="button">
              <span>0x{hex(command.opcode)}</span><strong>{command.name}</strong>
            </button>
          ))}
        </div>
        <div className="command-workbench">
          <header><Cpu size={17} /><div><strong>{selected.name}</strong><span>{selected.operation ?? 'control command'} · 0x{hex(selected.opcode)}</span></div></header>
          {selected.shortcut && (
            <div className="command-shortcut">
              <div><strong>RX–TX shortcut</strong><span>{selected.shortcut.description ?? 'Load the package-defined test transfer.'}</span></div>
              <code>TX {selected.shortcut.tx.map(hex).join(' ')} · RX {selected.shortcut.rx_length}</code>
              <button className="button button-secondary" onClick={applyShortcut} type="button">Use shortcut</button>
            </div>
          )}
          <div className="command-fields">
            <label>Address<input disabled={!selected.address_bytes} onChange={(event) => setAddress(event.target.value)} value={address} /></label>
            <label>Payload (hex)<input onChange={(event) => setPayload(event.target.value)} placeholder="A5 5A" value={payload} /></label>
            <label>RX bytes<input min="0" onChange={(event) => setRxLength(Number(event.target.value))} type="number" value={rxLength} /></label>
            <label>Clock (Hz)<input min="1" onChange={(event) => setSpeed(Number(event.target.value))} type="number" value={speed} /></label>
          </div>
          <div className="command-wire-summary"><Radio size={14} /> {wire.command_width}-{wire.address_width}-{wire.data_width} · {wire.rate.toUpperCase()} · {wire.dummy_cycles} dummy cycles</div>
          <button className="button button-primary" disabled={execute.isPending} onClick={run} type="button"><Play size={14} /> {execute.isPending ? 'Executing…' : 'Execute command'}</button>
          {execute.isError && <AsyncState detail={execute.error.message} kind="error" title="Command failed" />}
          {execute.data && (
            <div className="command-result">
              <span>RX</span><code>{execute.data.rx.length ? execute.data.rx.map(hex).join(' ') : '—'}</code>
              <span>State</span><strong>{execute.data.state ?? '—'}</strong>
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
