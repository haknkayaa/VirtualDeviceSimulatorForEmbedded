import type { ReactNode } from 'react'
import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Copy, Download, Eye, Focus, Import, PanelLeftClose, PanelRightClose, Redo2, Save, Trash2, Undo2 } from 'lucide-react'

import { useFlowStore } from '../store/flowStore'
import type { FlowLayoutDirection } from '../types/flow'

interface FlowToolbarProps {
  fitView: () => void
  autoLayout: (direction: FlowLayoutDirection) => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  toolbarActions?: ReactNode
}

export function FlowToolbar({ fitView, autoLayout, onSave, onExport, onImport, toolbarActions }: FlowToolbarProps) {
  const state = useFlowStore()
  const documentName = state.document.flow.kind === 'scenario' ? 'Test scenario' : state.document.flow.kind === 'device_behavior' ? 'Behavior model' : 'Document'
  return (
    <div className="flow-toolbar flow-frosted" role="toolbar" aria-label={`${documentName} editor toolbar`}>
      <div className="flow-toolbar-title">
        <input aria-label={`${documentName} name`} disabled={state.readOnly} onChange={(event) => state.updateFlowName(event.target.value)} value={state.document.flow.name} />
        <span>{state.readOnly ? <><Eye size={13} /> Read only</> : state.isDirty ? 'Unsaved changes' : 'Saved locally'}</span>
      </div>
      <div className="flow-tool-group">
        <button aria-label="Undo" disabled={state.readOnly || state.past.length === 0} onClick={state.undo} title="Undo (Ctrl+Z)" type="button"><Undo2 size={16} /></button>
        <button aria-label="Redo" disabled={state.readOnly || state.future.length === 0} onClick={state.redo} title="Redo (Ctrl+Shift+Z)" type="button"><Redo2 size={16} /></button>
        <button aria-label="Duplicate selection" disabled={state.readOnly || state.selectedNodeIds.length === 0} onClick={state.duplicateSelection} title="Duplicate (Ctrl+D)" type="button"><Copy size={16} /></button>
        <button aria-label="Delete selection" disabled={state.readOnly || (state.selectedNodeIds.length === 0 && state.selectedEdgeIds.length === 0)} onClick={state.deleteSelection} title="Delete selection" type="button"><Trash2 size={16} /></button>
      </div>
      <div className="flow-tool-group">
        <button aria-label="Fit view" onClick={fitView} title="Fit view (F)" type="button"><Focus size={16} /></button>
        <button aria-label="Auto layout left to right" disabled={state.readOnly} onClick={() => autoLayout('LR')} title="Auto layout left to right" type="button"><AlignHorizontalSpaceAround size={16} /></button>
        <button aria-label="Auto layout top to bottom" disabled={state.readOnly} onClick={() => autoLayout('TB')} title="Auto layout top to bottom" type="button"><AlignVerticalSpaceAround size={16} /></button>
      </div>
      {toolbarActions}
      <div className="flow-tool-group flow-tool-files">
        <button aria-label="Toggle validation panel" onClick={() => state.setValidationVisible(!state.validationVisible)} title="Toggle validation" type="button"><PanelLeftClose size={16} /></button>
        <button aria-label="Toggle inspector" onClick={() => state.setInspectorVisible(!state.inspectorVisible)} title="Toggle inspector" type="button"><PanelRightClose size={16} /></button>
        <label title="Import JSON"><Import size={16} /><span>Import</span><input accept="application/json,.json" disabled={state.readOnly} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = '' }} type="file" /></label>
        <button onClick={onExport} type="button"><Download size={16} /><span>Export</span></button>
        <button className={`flow-save${state.isDirty ? ' flow-save-dirty' : ''}`} disabled={state.readOnly} onClick={onSave} type="button"><Save size={16} /><span>{state.isDirty ? 'Unsaved changes' : 'Save'}</span></button>
      </div>
    </div>
  )
}
