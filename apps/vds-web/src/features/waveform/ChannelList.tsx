import { Eye, EyeOff } from 'lucide-react'

import { BusTag } from '../../components/BusTag'
import type { WaveformChannel } from './types'

interface ChannelListProps {
  channels: WaveformChannel[]
  onToggleChannel: (id: string) => void
  onShowAll: () => void
  onHideAll: () => void
}

/** Channel visibility manager, grouped by device like a probe/pod list. */
export function ChannelList({
  channels,
  onToggleChannel,
  onShowAll,
  onHideAll,
}: ChannelListProps) {
  const deviceGroups = new Map<string, WaveformChannel[]>()
  channels.forEach((channel) => {
    const list = deviceGroups.get(channel.deviceId) ?? []
    list.push(channel)
    deviceGroups.set(channel.deviceId, list)
  })
  const visibleCount = channels.filter((channel) => channel.visible).length

  return (
    <aside aria-label="Signal channels" className="wfa-channels-pane">
      <header className="wfa-pane-head">
        <h2 className="panel-title">Channels</h2>
        <span className="panel-meta">{visibleCount}/{channels.length}</span>
        <div className="segmented wfa-channel-bulk" role="group" aria-label="Channel visibility">
          <button onClick={onShowAll} title="Show all channels" type="button">All</button>
          <button onClick={onHideAll} title="Hide all channels" type="button">None</button>
        </div>
      </header>

      <div className="wfa-channel-scroll">
        {Array.from(deviceGroups.entries()).map(([deviceId, groupChannels]) => (
          <div className="wfa-channel-group" key={deviceId}>
            <div className="wfa-channel-device">
              <BusTag bus={groupChannels[0]?.bus} />
              <strong title={deviceId}>{deviceId}</strong>
            </div>
            {groupChannels.map((channel) => (
              <div className={`wfa-channel bus-${channel.bus.toLowerCase()}${channel.visible ? '' : ' is-off'}`} key={channel.id}>
                <span aria-hidden="true" className="wfa-channel-swatch" />
                <span className="wfa-channel-name">{channel.name}</span>
                <span className="wfa-channel-pin">{channel.pinType}</span>
                <button
                  aria-label={`${channel.visible ? 'Hide' : 'Show'} channel ${channel.name}`}
                  className="icon-button sm"
                  onClick={() => onToggleChannel(channel.id)}
                  type="button"
                >
                  {channel.visible ? <Eye aria-hidden="true" size={12} /> : <EyeOff aria-hidden="true" size={12} />}
                </button>
              </div>
            ))}
          </div>
        ))}

        {channels.length === 0 && <p className="wfa-channel-empty">No channels in this capture.</p>}
      </div>
    </aside>
  )
}
