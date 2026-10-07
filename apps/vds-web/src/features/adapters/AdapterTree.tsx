import { CircleAlert, LoaderCircle, Power, PowerOff } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import type { Adapter } from '../../types/api'
import { adapterNodePath, adapterStateTone, bindingEndpointLabel, bindingNodePath } from './adapterModel'

export interface AdapterTreeSelection {
  adapterId: string
  /** Optional binding highlighted in the inspector. */
  deviceId?: string
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

/** Arrow-key navigation between the focusable rows of the tree. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.adp-tree-focus')]
  const index = rows.indexOf(document.activeElement as HTMLButtonElement)
  if (index === -1) return
  event.preventDefault()
  rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
}

/** Host adapter topology: adapter rows with their bound Linux nodes nested below. */
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
    <div
      aria-label={`${adapters.length} adapters and ${deviceCount} attached devices`}
      className="adp-tree"
      onKeyDown={moveFocus}
      role="tree"
    >
      {isLoading && <AsyncState kind="loading" title="Reading adapter topology" />}
      {errorMessage && <AsyncState detail={errorMessage} kind="error" title="Adapters unavailable" />}
      {!isLoading && !errorMessage && adapters.length === 0 && (
        <AsyncState detail="Create an adapter to expose a Linux device node." kind="empty" title="No adapters configured" />
      )}
      {adapters.map((adapter) => {
        const adapterSelected = selection?.adapterId === adapter.id
        const loaded = adapter.state === 'loaded'
        const transitioning = adapter.state === 'loading' || adapter.state === 'unloading'
        const unloadable = loaded || adapter.state === 'error'
        const select = () => onSelect({ adapterId: adapter.id })

        return (
          <div
            aria-expanded="true"
            aria-level={1}
            aria-selected={adapterSelected}
            className={`adp-tree-item${adapterSelected ? ' selected' : ''}`}
            key={adapter.id}
            onClick={select}
            role="treeitem"
          >
            <div className="adp-tree-adapter">
              <button
                aria-label={`Select ${adapter.name}`}
                className="adp-tree-row adp-tree-focus"
                onClick={(event) => { event.stopPropagation(); select() }}
                type="button"
              >
                <i aria-hidden="true" className={`status-dot ${adapterStateTone(adapter.state)}`} />
                <BusTag bus={adapter.bus_type} />
                <strong className="adp-tree-name truncate">{adapter.name}</strong>
                <code className="adp-tree-id truncate">{adapter.id}</code>
                {adapter.readiness !== 'ready' && (
                  <CircleAlert
                    aria-label={adapter.readiness === 'authorization_required' ? 'Needs authorization' : 'Driver unavailable'}
                    className={adapter.readiness === 'unavailable' ? 'text-err' : 'text-warn'}
                    size={12}
                  />
                )}
                <span className={`adp-tree-state adp-state-${adapter.state}`}>{adapter.state}</span>
              </button>
              <button
                aria-label={unloadable ? `Unload ${adapter.name}` : `Load ${adapter.name}`}
                className="icon-button sm adp-tree-power"
                disabled={busy || transitioning || (!unloadable && (adapter.bindings.length === 0 || adapter.readiness === 'unavailable'))}
                onClick={(event) => { event.stopPropagation(); if (unloadable) onUnload(adapter.id); else onLoad(adapter.id) }}
                title={unloadable ? 'Unload adapter' : 'Load adapter'}
                type="button"
              >
                {transitioning
                  ? <LoaderCircle aria-hidden="true" className="spin" size={13} />
                  : unloadable
                    ? <PowerOff aria-hidden="true" size={13} />
                    : <Power aria-hidden="true" size={13} />}
              </button>
            </div>

            <div className="adp-tree-bindings" role="group">
              {adapter.bindings.length === 0 && (
                <div className="adp-tree-binding adp-tree-binding-empty">
                  <code className={loaded ? '' : 'adp-node-down'}>{adapterNodePath(adapter)}</code>
                  <span className="dim">no device attached</span>
                </div>
              )}
              {adapter.bindings.map((binding) => {
                const bindingSelected = adapterSelected && selection?.deviceId === binding.device_id
                return (
                  <button
                    aria-level={2}
                    aria-selected={bindingSelected}
                    className={`adp-tree-binding adp-tree-focus${bindingSelected ? ' selected' : ''}`}
                    key={binding.device_id}
                    onClick={(event) => { event.stopPropagation(); onSelect({ adapterId: adapter.id, deviceId: binding.device_id }) }}
                    role="treeitem"
                    title={loaded ? 'Exposed to applications' : 'Not exposed: adapter is not loaded'}
                    type="button"
                  >
                    <code className={`adp-tree-node truncate${loaded ? '' : ' adp-node-down'}`}>{bindingNodePath(adapter, binding)}</code>
                    <span className="adp-tree-endpoint">{bindingEndpointLabel(adapter, binding)}</span>
                    <span className="adp-tree-device truncate">{binding.device_id}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
