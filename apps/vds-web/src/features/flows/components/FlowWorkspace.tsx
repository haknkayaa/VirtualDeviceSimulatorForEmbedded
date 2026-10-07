import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useRef, useState } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'

import { PageHeader } from '../../../components/PageHeader'

import { defaultLayoutEngine } from '../layout/dagreLayout'
import { runFlowLayout } from '../layout/layoutEngine'
import { useFlowValidation } from '../hooks/useFlowValidation'
import { useFlowStore } from '../store/flowStore'
import type { FlowCanvasEdge, FlowCanvasNode, FlowLayoutDirection } from '../types/flow'
import { FlowCanvas } from './FlowCanvas'
import { FlowStatusBar } from './FlowStatusBar'
import { flowDocumentName } from './flowLabels'
import { FlowDocumentState, FlowToolbar } from './FlowToolbar'
import { NodePalette } from './NodePalette'
import { PropertiesInspector } from './PropertiesInspector'
import { ValidationPanel } from './ValidationPanel'
import '@xyflow/react/dist/style.css'
import '../flows.css'

interface FlowWorkspaceProps {
  /** Breadcrumb context rendered before the editable document name. */
  context?: ReactNode
  /** Transient editor notice rendered under the page bar. */
  notice?: ReactNode
  /** Document-level properties shown in the inspector when nothing is selected. */
  documentInspector?: ReactNode
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  toolbarActions?: ReactNode
  validationTabs?: {
    activeTab: string
    onTabChange: (tab: string) => void
    tabs: { id: string; label: string; meta?: ReactNode; content: ReactNode }[]
  }
}

type WorkspaceSize = 'palette' | 'inspector' | 'validation'

const limits = {
  palette: { min: 150, max: 420 },
  inspector: { min: 260, max: 620 },
  validation: { min: 72, max: 480 },
} satisfies Record<WorkspaceSize, { min: number; max: number }>

function clamp(value: number, size: WorkspaceSize) {
  return Math.min(limits[size].max, Math.max(limits[size].min, value))
}

function WorkspaceBody({ context, notice, documentInspector, onSave, onExport, onImport, toolbarActions, validationTabs }: FlowWorkspaceProps) {
  const document = useFlowStore((state) => state.document)
  const density = useFlowStore((state) => state.density)
  const replaceNodePositions = useFlowStore((state) => state.replaceNodePositions)
  const inspectorVisible = useFlowStore((state) => state.inspectorVisible)
  const validationVisible = useFlowStore((state) => state.validationVisible)
  const issues = useFlowValidation(document)
  const instance = useReactFlow<FlowCanvasNode, FlowCanvasEdge>()
  const workspaceRef = useRef<HTMLElement>(null)
  const [canvasFocused, setCanvasFocused] = useState(false)
  const [panelSizes, setPanelSizes] = useState({ palette: 200, inspector: 320, validation: 190 })
  const resizePanel = useCallback((size: WorkspaceSize, value: number) => {
    setPanelSizes((current) => ({ ...current, [size]: clamp(value, size) }))
  }, [])
  const startResize = useCallback((size: WorkspaceSize, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.matchMedia('(max-width: 980px)').matches) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const initial = panelSizes[size]
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = size === 'validation'
        ? startY - moveEvent.clientY
        : (moveEvent.clientX - startX) * (size === 'inspector' ? -1 : 1)
      let next = initial + delta
      if (size !== 'validation' && workspaceRef.current) {
        const otherPanel = size === 'palette' ? panelSizes.inspector : panelSizes.palette
        next = Math.min(next, workspaceRef.current.clientWidth - otherPanel - 320)
      }
      resizePanel(size, next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      globalThis.document.body.classList.remove('flow-panel-resizing')
    }
    globalThis.document.body.classList.add('flow-panel-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop, { once: true })
  }, [panelSizes, resizePanel])
  const resizeWithKeyboard = useCallback((size: WorkspaceSize, event: KeyboardEvent<HTMLDivElement>) => {
    const direction = size === 'validation'
      ? { ArrowUp: 1, ArrowDown: -1 }[event.key]
      : { ArrowLeft: size === 'inspector' ? 1 : -1, ArrowRight: size === 'inspector' ? -1 : 1 }[event.key]
    if (!direction) return
    event.preventDefault()
    resizePanel(size, panelSizes[size] + direction * 16)
  }, [panelSizes, resizePanel])
  const fitView = useCallback(() => { void instance.fitView({ padding: 0.2, duration: 260 }) }, [instance])
  const autoLayout = useCallback((direction: FlowLayoutDirection) => {
    const result = runFlowLayout(defaultLayoutEngine, document, { direction })
    replaceNodePositions(result.nodes)
    requestAnimationFrame(fitView)
  }, [document, fitView, replaceNodePositions])
  const workspaceStyle = {
    '--flow-palette-width': `${panelSizes.palette}px`,
    '--flow-inspector-width': `${panelSizes.inspector}px`,
    '--flow-validation-height': `${panelSizes.validation}px`,
  } as CSSProperties
  return (
    <>
      <PageHeader
        actions={<FlowToolbar autoLayout={autoLayout} fitView={fitView} onExport={onExport} onImport={onImport} onSave={onSave} toolbarActions={toolbarActions} />}
        context={context}
        title={document.flow.name.trim() || `Untitled ${flowDocumentName(document.flow.kind).toLowerCase()}`}
      >
        <FlowDocumentState />
      </PageHeader>
      {notice}
      <div className="page-body fill flush flow-body">
        <section
          aria-label={`${flowDocumentName(document.flow.kind)} editor`}
          className={`flow-workspace density-${density}${inspectorVisible ? '' : ' inspector-collapsed'}${validationVisible ? '' : ' validation-collapsed'}`}
          ref={workspaceRef}
          style={workspaceStyle}
        >
          <NodePalette />
          <FlowCanvas canvasFocused={canvasFocused} issues={issues} onSave={onSave} setCanvasFocused={setCanvasFocused} />
          <FlowStatusBar issues={issues} />
          <ValidationPanel issues={issues} tabConfig={validationTabs} />
          <PropertiesInspector documentInspector={documentInspector} issues={issues} />
          <div aria-label="Resize node palette" aria-orientation="vertical" className="flow-resize-handle flow-resize-palette" onKeyDown={(event) => resizeWithKeyboard('palette', event)} onPointerDown={(event) => startResize('palette', event)} role="separator" tabIndex={0} />
          {inspectorVisible && <div aria-label="Resize properties panel" aria-orientation="vertical" className="flow-resize-handle flow-resize-inspector" onKeyDown={(event) => resizeWithKeyboard('inspector', event)} onPointerDown={(event) => startResize('inspector', event)} role="separator" tabIndex={0} />}
          {validationVisible && <div aria-label="Resize validation panel" aria-orientation="horizontal" className="flow-resize-handle flow-resize-validation" onKeyDown={(event) => resizeWithKeyboard('validation', event)} onPointerDown={(event) => startResize('validation', event)} role="separator" tabIndex={0} />}
        </section>
      </div>
    </>
  )
}

export function FlowWorkspace(props: FlowWorkspaceProps) {
  return <ReactFlowProvider><WorkspaceBody {...props} /></ReactFlowProvider>
}
