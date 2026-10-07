import { Eye, EyeOff, SlidersHorizontal } from 'lucide-react'
import type { WaveformChannel } from './types'

interface ChannelListProps {
  channels: WaveformChannel[]
  onToggleChannel: (id: string) => void
  onShowAll: () => void
  onHideAll: () => void
}

export function ChannelList({
  channels,
  onToggleChannel,
  onShowAll,
  onHideAll,
}: ChannelListProps) {
  // Group channels by deviceId
  const deviceGroups = new Map<string, WaveformChannel[]>()
  channels.forEach((c) => {
    const list = deviceGroups.get(c.deviceId) ?? []
    list.push(c)
    deviceGroups.set(c.deviceId, list)
  })

  return (
    <aside className="waveform-channel-sidebar">
      <header className="waveform-channel-header">
        <div className="channel-header-title">
          <SlidersHorizontal size={14} />
          <strong>Signal Channels</strong>
          <small>({channels.filter((c) => c.visible).length}/{channels.length})</small>
        </div>
        <div className="channel-quick-actions">
          <button
            className="channel-action-btn"
            onClick={onShowAll}
            title="Show all channels"
            type="button"
          >
            All
          </button>
          <button
            className="channel-action-btn"
            onClick={onHideAll}
            title="Hide all channels"
            type="button"
          >
            None
          </button>
        </div>
      </header>

      <div className="waveform-channel-items">
        {Array.from(deviceGroups.entries()).map(([deviceId, groupChannels]) => {
          const bus = groupChannels[0]?.bus ?? 'unknown'
          return (
            <div className="channel-device-group" key={deviceId}>
              <div className="channel-device-heading">
                <span className={`channel-bus-pill bus-${bus.toLowerCase()}`}>
                  {bus.toUpperCase()}
                </span>
                <strong title={deviceId}>{deviceId}</strong>
              </div>

              <div className="channel-group-list">
                {groupChannels.map((channel) => (
                  <div
                    className={`channel-row ${channel.visible ? 'visible' : 'hidden'}`}
                    key={channel.id}
                  >
                    <div className="channel-row-main">
                      <span
                        className="channel-color-dot"
                        style={{ backgroundColor: channel.color }}
                      />
                      <span className="channel-name">{channel.name}</span>
                      <small className="channel-pin-type">{channel.pinType}</small>
                    </div>

                    <button
                      aria-label={`${channel.visible ? 'Hide' : 'Show'} channel ${channel.name}`}
                      className="channel-toggle-visibility"
                      onClick={() => onToggleChannel(channel.id)}
                      type="button"
                    >
                      {channel.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {channels.length === 0 && (
          <div className="channel-empty-msg">
            No active channels in capture.
          </div>
        )}
      </div>
    </aside>
  )
}
