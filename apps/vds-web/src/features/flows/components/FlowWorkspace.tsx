import { useCallback, useState } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'

import { defaultLayoutEngine } from '../layout/dagreLayout'
import { runFlowLayout } from '../layout/layoutEngine'
import { useFlowValidation } from '../hooks/useFlowValidation'
import { useFlowStore } from '../store/flowStore'
import type { FlowCanvasEdge, FlowCanvasNode, FlowLayoutDirection } from '../types/flow'
import { FlowCanvas } from './FlowCanvas'
import { FlowStatusBar } from './FlowStatusBar'
import { FlowToolbar } from './FlowToolbar'
import { NodePalette } from './NodePalette'
import { PropertiesInspector } from './PropertiesInspector'
import { ValidationPanel } from './ValidationPanel'

interface FlowWorkspaceProps {
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
}

function WorkspaceBody({ onSave, onExport, onImport }: FlowWorkspaceProps) {
  const document = useFlowStore((state) => state.document)
  const density = useFlowStore((state) => state.density)
  const replaceNodePositions = useFlowStore((state) => state.replaceNodePositions)
  const inspectorVisible = useFlowStore((state) => state.inspectorVisible)
  const validationVisible = useFlowStore((state) => state.validationVisible)
  const issues = useFlowValidation(document)
  const instance = useReactFlow<FlowCanvasNode, FlowCanvasEdge>()
  const [canvasFocused, setCanvasFocused] = useState(false)
  const fitView = useCallback(() => { void instance.fitView({ padding: 0.2, duration: 260 }) }, [instance])
  const autoLayout = useCallback((direction: FlowLayoutDirection) => {
    const result = runFlowLayout(defaultLayoutEngine, document, { direction })
    replaceNodePositions(result.nodes)
    requestAnimationFrame(fitView)
  }, [document, fitView, replaceNodePositions])
  return (
    <section className={`flow-workspace density-${density}${inspectorVisible ? '' : ' inspector-collapsed'}${validationVisible ? '' : ' validation-collapsed'}`}>
      <FlowToolbar autoLayout={autoLayout} fitView={fitView} onExport={onExport} onImport={onImport} onSave={onSave} />
      <NodePalette />
      <ValidationPanel issues={issues} />
      <FlowCanvas canvasFocused={canvasFocused} issues={issues} onSave={onSave} setCanvasFocused={setCanvasFocused} />
      <PropertiesInspector issues={issues} />
      <FlowStatusBar issues={issues} />
    </section>
  )
}

export function FlowWorkspace(props: FlowWorkspaceProps) {
  return <ReactFlowProvider><WorkspaceBody {...props} /></ReactFlowProvider>
}
