import { LockKeyhole, Network, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import {
  useAdapters,
  useAttachAdapterDevice,
  useCreateAdapter,
  useDetachAdapterDevice,
  useDevices,
  useLoadAdapter,
  useUnloadAdapter,
} from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import type { Adapter } from '../../types/api'
import { AdapterInspector, type AttachDraft } from './AdapterInspector'
import { AdapterTree, type AdapterTreeSelection } from './AdapterTree'
import { kernelModuleFor } from './adapterModel'
import { CreateAdapterForm } from './CreateAdapterForm'
import './adapters.css'

/** First free endpoint on an adapter: SPI from CS0, I²C from 0x50. */
function defaultEndpoint(adapter: Adapter) {
  const used = new Set(adapter.bindings.map((binding) => binding.endpoint))
  if (adapter.bus_type === 'i2c') {
    let address = 0x50
    while (used.has(address) && address < 0x77) address += 1
    return `0x${address.toString(16).padStart(2, '0')}`
  }
  let cs = 0
  while (used.has(cs)) cs += 1
  return String(cs)
}

/**
 * Host integration topology: which Linux device nodes exist, which adapter
 * (CUSE, gpio-sim, PTY) owns them, and which virtual device answers there.
 * URL params: `?adapter=<id>` selects an adapter, `?new=1` opens the create form.
 */
export function AdaptersPage() {
  const adapters = useAdapters()
  const devices = useDevices()
  const createAdapter = useCreateAdapter()
  const loadAdapter = useLoadAdapter()
  const unloadAdapter = useUnloadAdapter()
  const attachDevice = useAttachAdapterDevice()
  const detachDevice = useDetachAdapterDevice()
  const [searchParams, setSearchParams] = useSearchParams()
  const [drafts, setDrafts] = useState<Record<string, Partial<AttachDraft>>>({})
  const [authorizationAdapter, setAuthorizationAdapter] = useState<string | null>(null)
  const [focusedDeviceId, setFocusedDeviceId] = useState<string>()

  const creating = searchParams.get('new') === '1'
  const requestedId = searchParams.get('adapter')
  const adapterList = useMemo(() => adapters.data ?? [], [adapters.data])
  const selectedAdapter = adapterList.find((adapter) => adapter.id === requestedId) ?? adapterList[0]
  const attachedDeviceIds = useMemo(
    () => new Set(adapterList.flatMap((adapter) => adapter.bindings.map((binding) => binding.device_id))),
    [adapterList],
  )
  const bindingCount = attachedDeviceIds.size
  const exposedCount = adapterList.reduce((count, adapter) => count + (adapter.state === 'loaded' ? adapter.bindings.length : 0), 0)
  const busy = loadAdapter.isPending || unloadAdapter.isPending || attachDevice.isPending || detachDevice.isPending
  const operationError = (loadAdapter.error ?? unloadAdapter.error ?? attachDevice.error ?? detachDevice.error)?.message

  const select = (selection: AdapterTreeSelection) => {
    setSearchParams({ adapter: selection.adapterId }, { replace: true })
    setFocusedDeviceId(selection.deviceId)
  }
  const openCreate = () => {
    createAdapter.reset()
    const next = new URLSearchParams(searchParams)
    next.set('new', '1')
    setSearchParams(next)
  }
  const closeCreate = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next)
  }

  const mutateLoad = (adapterId: string) => {
    loadAdapter.mutate(adapterId, {
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'adapter_authorization_required') {
          setAuthorizationAdapter(adapterId)
        }
      },
    })
  }

  const inspector = (() => {
    if (creating) {
      return (
        <CreateAdapterForm
          adapters={adapterList}
          errorMessage={createAdapter.error?.message}
          isPending={createAdapter.isPending}
          onCancel={closeCreate}
          onCreate={(input) => createAdapter.mutate(input, {
            onSuccess: () => {
              setSearchParams({ adapter: input.id })
              setFocusedDeviceId(undefined)
            },
          })}
        />
      )
    }
    if (adapters.isPending) return <Panel className="adp-inspector"><AsyncState kind="loading" title="Loading adapters" /></Panel>
    if (adapters.isError) return <Panel className="adp-inspector"><AsyncState detail={adapters.error.message} kind="error" title="Adapters unavailable" /></Panel>
    if (!selectedAdapter) {
      return (
        <Panel className="adp-inspector">
          <AsyncState
            centered
            detail={<>An adapter owns a Linux device node such as <code>/dev/spidev0.0</code>, <code>/dev/i2c-1</code> or <code>/dev/gpiochipN</code>.</>}
            kind="empty"
            title="No adapter selected"
          />
        </Panel>
      )
    }
    const adapter = selectedAdapter
    const availableDevices = (devices.data ?? []).filter(
      (device) => device.bus.toLowerCase() === adapter.bus_type && !attachedDeviceIds.has(device.id),
    )
    const draft = drafts[adapter.id] ?? {}
    const attachDraft: AttachDraft = {
      deviceId: draft.deviceId && availableDevices.some((device) => device.id === draft.deviceId) ? draft.deviceId : availableDevices[0]?.id ?? '',
      endpoint: draft.endpoint ?? defaultEndpoint(adapter),
    }
    return (
      <AdapterInspector
        adapter={adapter}
        attachDraft={attachDraft}
        availableDevices={availableDevices}
        busy={busy}
        errorMessage={operationError}
        focusedDeviceId={focusedDeviceId}
        key={adapter.id}
        onAttach={(endpoint) => attachDevice.mutate(
          { adapterId: adapter.id, device_id: attachDraft.deviceId, endpoint },
          { onSuccess: () => setDrafts((current) => ({ ...current, [adapter.id]: {} })) },
        )}
        onDetach={(deviceId) => detachDevice.mutate({ adapterId: adapter.id, deviceId })}
        onDraft={(next) => setDrafts((current) => ({ ...current, [adapter.id]: next }))}
        onLoad={() => mutateLoad(adapter.id)}
        onUnload={() => unloadAdapter.mutate(adapter.id)}
      />
    )
  })()

  return (
    <div className="page adapters-page">
      <PageHeader
        actions={(
          <button aria-pressed={creating} className="button button-primary" onClick={creating ? closeCreate : openCreate} type="button">
            <Plus aria-hidden="true" size={13} /> New Adapter
          </button>
        )}
        context={adapters.data
          ? <span className="mono">{adapterList.length} adapters · {bindingCount} bindings · {exposedCount} nodes exposed</span>
          : 'Host bus adapters and Linux device nodes'}
        title="Adapters"
      />
      <div className="page-body fill adp-body">
        <div className="adp-layout">
          <Panel
            aria-label="Adapter topology"
            as="aside"
            className="adp-tree-panel"
            flush
            footer={<span className="adp-legend"><i className="status-dot ok" /> loaded <i className="status-dot" /> unloaded <i className="status-dot err" /> error · <span className="adp-node-down">struck</span> = not exposed</span>}
            icon={Network}
            meta={adapters.data ? `${adapterList.length}` : undefined}
            title="Host adapters"
          >
            <AdapterTree
              adapters={adapterList}
              busy={busy}
              errorMessage={adapters.error?.message}
              isLoading={adapters.isPending}
              onLoad={mutateLoad}
              onSelect={select}
              onUnload={(adapterId) => unloadAdapter.mutate(adapterId)}
              selection={!creating && selectedAdapter ? { adapterId: selectedAdapter.id, deviceId: focusedDeviceId } : undefined}
            />
          </Panel>
          {inspector}
        </div>
      </div>

      {authorizationAdapter && (
        <AuthorizationDialog
          adapter={adapterList.find((adapter) => adapter.id === authorizationAdapter)}
          adapterId={authorizationAdapter}
          onClose={() => setAuthorizationAdapter(null)}
          onRetry={() => {
            const adapterId = authorizationAdapter
            setAuthorizationAdapter(null)
            mutateLoad(adapterId)
          }}
        />
      )}
    </div>
  )
}

function AuthorizationDialog({ adapter, adapterId, onClose, onRetry }: {
  adapter?: Adapter
  adapterId: string
  onClose: () => void
  onRetry: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const module = adapter ? kernelModuleFor(adapter) : undefined
  const commands = [
    { module: 'gpio-sim', label: 'GPIO (gpio-sim)' },
    { module: 'cuse', label: 'SPI / I²C (CUSE)' },
  ]
  return (
    <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-labelledby="adapter-authorization-title" aria-modal="true" className="dialog adp-auth-dialog" role="dialog">
        <header>
          <LockKeyhole aria-hidden="true" className="text-warn" size={14} />
          <h2 id="adapter-authorization-title">Kernel adapter access required</h2>
          <button aria-label="Close" className="icon-button adp-dialog-close" onClick={onClose} type="button"><X aria-hidden="true" size={14} /></button>
        </header>
        <div className="dialog-body adp-auth-body">
          <p>
            Loading <code>{adapterId}</code> needs a kernel module that only the operating system can authorize.
            VDS4E never accepts or stores your sudo password: run the command in a terminal, then retry.
          </p>
          <table className="data-table adp-auth-commands">
            <tbody>
              {commands.map((command) => (
                <tr className={command.module === module ? 'selected' : ''} key={command.module}>
                  <td className="dim">{command.label}</td>
                  <td><code>sudo modprobe {command.module}</code></td>
                  <td className="dim">{command.module === module ? 'required for this adapter' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <button className="button" onClick={onClose} type="button">Close</button>
          <button autoFocus className="button button-primary" onClick={onRetry} type="button">Retry load</button>
        </footer>
      </section>
    </div>
  )
}
