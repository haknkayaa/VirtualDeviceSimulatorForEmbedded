import type { ReactNode } from 'react'
import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Copy,
  Download,
  Eye,
  Focus,
  Import,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react'

import { useFlowStore } from '../store/flowStore'
import type { FlowLayoutDirection } from '../types/flow'
import { flowDocumentName } from './flowLabels'

/** Revision and save state, shown next to the document title in the page bar. */
export function FlowDocumentState() {
  const revision = useFlowStore((state) => state.document.flow.revision)
  const readOnly = useFlowStore((state) => state.readOnly)
  const isDirty = useFlowStore((state) => state.isDirty)
  return (
    <div className="flow-document-state">
      <span className="flow-revision" title="Document revision">r{revision}</span>
      <span className={`flow-save-state${isDirty ? ' dirty' : ''}`} title={isDirty ? 'Unsaved changes' : 'Saved locally'}>
        {readOnly ? <><Eye aria-hidden="true" size={12} /> Read only</> : isDirty ? 'Unsaved' : 'Saved'}
      </span>
    </div>
  )
}

/** Editable document name; rendered at the top of the inspector's document section. */
export function FlowNameField() {
  const name = useFlowStore((state) => state.document.flow.name)
  const kind = useFlowStore((state) => state.document.flow.kind)
  const readOnly = useFlowStore((state) => state.readOnly)
  const updateFlowName = useFlowStore((state) => state.updateFlowName)
  return (
    <label className="flow-field">
      <span>Name</span>
      <input aria-label={`${flowDocumentName(kind)} name`} disabled={readOnly} onChange={(event) => updateFlowName(event.target.value)} spellCheck={false} value={name} />
    </label>
  )
}

interface FlowToolbarProps {
  fitView: () => void
  autoLayout: (direction: FlowLayoutDirection) => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  toolbarActions?: ReactNode
}

/** Editor command bar rendered in the page bar's action slot. */
export function FlowToolbar({ fitView, autoLayout, onSave, onExport, onImport, toolbarActions }: FlowToolbarProps) {
  const state = useFlowStore()
  const documentName = flowDocumentName(state.document.flow.kind)
  const hasSelection = state.selectedNodeIds.length > 0 || state.selectedEdgeIds.length > 0
  return (
    <div className="toolbar flow-toolbar" role="toolbar" aria-label={`${documentName} editor toolbar`}>
      <button aria-label="Undo" className="icon-button" disabled={state.readOnly || state.past.length === 0} onClick={state.undo} title="Undo (Ctrl+Z)" type="button"><Undo2 size={15} /></button>
      <button aria-label="Redo" className="icon-button" disabled={state.readOnly || state.future.length === 0} onClick={state.redo} title="Redo (Ctrl+Shift+Z)" type="button"><Redo2 size={15} /></button>
      <button aria-label="Duplicate selection" className="icon-button" disabled={state.readOnly || state.selectedNodeIds.length === 0} onClick={state.duplicateSelection} title="Duplicate (Ctrl+D)" type="button"><Copy size={15} /></button>
      <button aria-label="Delete selection" className="icon-button" disabled={state.readOnly || !hasSelection} onClick={state.deleteSelection} title="Delete selection (Del)" type="button"><Trash2 size={15} /></button>
      <span aria-hidden="true" className="toolbar-separator" />
      <button aria-label="Fit view" className="icon-button" onClick={fitView} title="Fit view (F)" type="button"><Focus size={15} /></button>
      <button aria-label="Auto layout left to right" className="icon-button" disabled={state.readOnly} onClick={() => autoLayout('LR')} title="Auto layout left to right" type="button"><AlignHorizontalSpaceAround size={15} /></button>
      <button aria-label="Auto layout top to bottom" className="icon-button" disabled={state.readOnly} onClick={() => autoLayout('TB')} title="Auto layout top to bottom" type="button"><AlignVerticalSpaceAround size={15} /></button>
      <span aria-hidden="true" className="toolbar-separator" />
      <label aria-disabled={state.readOnly || undefined} className={`icon-button flow-import${state.readOnly ? ' disabled' : ''}`} title="Import JSON">
        <Import aria-hidden="true" size={15} />
        <span className="sr-only">Import</span>
        <input accept="application/json,.json" disabled={state.readOnly} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = '' }} type="file" />
      </label>
      <button aria-label="Export" className="icon-button" onClick={onExport} title="Export JSON" type="button"><Download size={15} /></button>
      {toolbarActions && <><span aria-hidden="true" className="toolbar-separator" />{toolbarActions}</>}
      <span aria-hidden="true" className="toolbar-separator" />
      <button className={`button button-primary flow-save${state.isDirty ? ' flow-save-dirty' : ''}`} disabled={state.readOnly} onClick={onSave} title="Save locally (Ctrl+S)" type="button"><Save size={14} /><span>Save</span></button>
    </div>
  )
}
