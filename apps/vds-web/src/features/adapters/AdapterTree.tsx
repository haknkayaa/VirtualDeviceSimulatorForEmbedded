import { Cable, ChevronDown, Cpu, LoaderCircle, Power, PowerOff } from 'lucide-react'

import type { Adapter } from '../../types/api'

export interface AdapterTreeSelection {
  adapterId: string
}

interface AdapterTreeProps {
  adapters: Adapter[]
  busy: boolean
  errorMessage?: string
  isLoading: boolean
  onLoad: (adapterId: string) => void
  onSelect: (selection: AdapterTreeSelection) => void
  onUnload: (adapterId: string) => void
  selection?: AdapterTreeSelection
}

export function AdapterTree({
  adapters,
  busy,
  errorMessage,
  isLoading,
  onLoad,
  onSelect,
  onUnload,
  selection,
}: AdapterTreeProps) {
  const deviceCount = adapters.reduce((count, adapter) => count + adapter.bindings.length, 0)

  return (
    <aside aria-label="Adapter topology" className="glass-panel adapter-tree-panel">
      <header className="adapter-tree-header">
        <div>
          <span>Host topology</span>
          <strong>Adapters</strong>
        </div>
        <span className="adapter-tree-count">{adapters.length}</span>
      </header>

      <div aria-label={`${adapters.length} adapters and ${deviceCount} attached devices`} className="adapter-tree" role="tree">
        {isLoading && <span className="adapter-tree-message">Loading adapter topology…</span>}
        {errorMessage && <span className="adapter-tree-message error">{errorMessage}</span>}
        {!isLoading && !errorMessage && adapters.length === 0 && (
          <span className="adapter-tree-message">No adapters are configured.</span>
        )}
        {adapters.map((adapter) => {
          const adapterSelected = selection?.adapterId === adapter.id
          const devicePaths = adapter.bindings.map((binding) => binding.device_path)
          const pathLabel = devicePaths.length > 0
            ? devicePaths.join(', ')
            : adapter.bus_type === 'gpio'
              ? adapter.device_path ?? `/dev/gpiochipX · ${adapter.line_count ?? 0} lines`
              : `/dev/spidev${adapter.bus_number}.*`
          const loaded = adapter.state === 'loaded'
          const transitioning = adapter.state === 'loading' || adapter.state === 'unloading'
          const unloadable = loaded || adapter.state === 'error'

          return (
            <div
              aria-expanded="true"
              aria-selected={adapterSelected}
              className={`adapter-tree-branch${adapterSelected ? ' active' : ''}`}
              key={adapter.id}
              role="treeitem"
            >
              <button
                aria-label={`Select ${adapter.name}`}
                className="adapter-tree-select"
                onClick={() => onSelect({ adapterId: adapter.id })}
                type="button"
              >
                <span className="adapter-tree-adapter">
                  <ChevronDown aria-hidden="true" className="adapter-tree-chevron" size={14} />
                  <span className="adapter-tree-icon"><Cable aria-hidden="true" size={16} /></span>
                  <span className="adapter-tree-copy">
                    <span className="adapter-tree-name">
                      <strong>{adapter.name}</strong>
                      <code>{pathLabel}</code>
                    </span>
                  </span>
                </span>

                <span className="adapter-tree-devices">
                  {adapter.bindings.length === 0 && <span className="adapter-tree-empty">No attached devices</span>}
                  {adapter.bindings.map((binding) => (
                    <span className="adapter-tree-device" key={binding.device_id}>
                      <span className="adapter-tree-device-line" />
                      <span className="adapter-tree-device-icon"><Cpu aria-hidden="true" size={14} /></span>
                      <span className="adapter-tree-copy">
                        <strong>{binding.device_id}</strong>
                        <small>CS{binding.endpoint} · {binding.device_path}</small>
                      </span>
                    </span>
                  ))}
                </span>
              </button>

              <div className="adapter-tree-status-actions">
                <span className={`adapter-tree-status ${loaded ? 'online' : 'offline'}`}>
                  <i aria-hidden="true" className={`adapter-tree-state ${adapter.state}`} />
                  <span>{loaded ? 'Online' : 'Offline'}</span>
                </span>
                <button
                  aria-label={unloadable ? `Unload ${adapter.name}` : `Load ${adapter.name}`}
                  className={`adapter-tree-power${unloadable ? ' adapter-tree-power-unload' : ''}`}
                  disabled={busy || transitioning || (!unloadable && (adapter.bindings.length === 0 || adapter.readiness === 'unavailable'))}
                  onClick={() => unloadable ? onUnload(adapter.id) : onLoad(adapter.id)}
                  title={unloadable ? 'Unload adapter' : 'Load adapter'}
                  type="button"
                >
                  {transitioning
                    ? <LoaderCircle aria-hidden="true" className="spin" size={14} />
                    : unloadable
                      ? <PowerOff aria-hidden="true" size={14} />
                      : <Power aria-hidden="true" size={14} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
