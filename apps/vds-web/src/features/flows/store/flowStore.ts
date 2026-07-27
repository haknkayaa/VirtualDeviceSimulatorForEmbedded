import { create } from 'zustand'
import type { Viewport, XYPosition } from '@xyflow/react'

import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import { createFlowDocument, deserializeFlowDocument } from '../serialization/flowDocument'
import type {
  FlowConnection,
  FlowDensity,
  FlowDocument,
  FlowEdgeDocument,
  FlowNodeDocument,
  FlowRuntimeStatus,
  JsonObject,
} from '../types/flow'
import { validateFlowConnection, validateFlowDocument } from '../validation/validator'
import { appendHistory, documentsEqual } from './flowHistory'

function uniqueId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function withUpdated(document: FlowDocument, patch: Partial<FlowDocument>): FlowDocument {
  return { ...document, ...patch, flow: { ...document.flow, updated_at: new Date().toISOString() } }
}

interface ClipboardGraph {
  nodes: FlowNodeDocument[]
  edges: FlowEdgeDocument[]
}

interface FlowStoreState {
  document: FlowDocument
  savedDocument: FlowDocument
  past: FlowDocument[]
  future: FlowDocument[]
  selectedNodeIds: string[]
  selectedEdgeIds: string[]
  hoveredElementId: string | null
  activeGestureSnapshot: FlowDocument | null
  connectionPreview: FlowConnection | null
  paletteSearch: string
  inspectorVisible: boolean
  validationVisible: boolean
  activeKeyboardMode: string | null
  viewportAnimating: boolean
  runtimeStatuses: Record<string, FlowRuntimeStatus>
  clipboard: ClipboardGraph | null
  readOnly: boolean
  isPersisted: boolean
  density: FlowDensity
  isDirty: boolean
  loadDocument: (document: FlowDocument, options?: { readOnly?: boolean }) => void
  newDocument: (document?: FlowDocument) => void
  importJson: (input: string) => { ok: true; issues: ReturnType<typeof validateFlowDocument> } | { ok: false; error: string }
  prepareLocalSave: () => FlowDocument
  addNode: (kind: string, position: XYPosition, id?: string) => string | null
  addReusableNode: (reusableId: string, position: XYPosition, id?: string) => string | null
  setNodeReusable: (id: string, reusable: boolean) => void
  updateNodeData: (id: string, patch: JsonObject) => void
  updateEdgeData: (id: string, patch: JsonObject) => void
  updateFlowName: (name: string) => void
  updateMetadata: (patch: JsonObject) => void
  moveNodes: (positions: Record<string, XYPosition>) => void
  connect: (connection: FlowConnection, kind?: string, id?: string) => boolean
  reconnect: (edgeId: string, connection: FlowConnection) => boolean
  deleteSelection: () => void
  removeNodes: (ids: string[]) => void
  removeEdges: (ids: string[]) => void
  copySelection: () => boolean
  paste: () => boolean
  duplicateSelection: () => boolean
  select: (nodeIds: string[], edgeIds: string[]) => void
  selectAll: () => void
  clearSelection: () => void
  beginGesture: () => void
  endGesture: () => void
  replaceNodePositions: (nodes: FlowNodeDocument[]) => void
  setViewport: (viewport: Viewport) => void
  undo: () => void
  redo: () => void
  setReadOnly: (readOnly: boolean) => void
  setRuntimeStatuses: (statuses: Record<string, FlowRuntimeStatus>) => void
  setPaletteSearch: (search: string) => void
  setInspectorVisible: (visible: boolean) => void
  setValidationVisible: (visible: boolean) => void
  setDensity: (density: FlowDensity) => void
  setConnectionPreview: (connection: FlowConnection | null) => void
  setHoveredElement: (id: string | null) => void
  reset: () => void
}

const initialDocument = createFlowDocument({ id: 'flow-new', now: '2026-01-01T00:00:00.000Z' })

export const useFlowStore = create<FlowStoreState>((set, get) => {
  const refreshDirty = (document: FlowDocument) => !documentsEqual(document, get().savedDocument)
  const commit = (mutate: (document: FlowDocument) => FlowDocument) => {
    const state = get()
    if (state.readOnly) return false
    const next = mutate(structuredClone(state.document))
    if (documentsEqual(next, state.document)) return false
    set({
      document: next,
      past: appendHistory(state.past, state.document),
      future: [],
      isDirty: refreshDirty(next),
    })
    return true
  }

  const resetTransient = {
    selectedNodeIds: [] as string[], selectedEdgeIds: [] as string[], hoveredElementId: null,
    activeGestureSnapshot: null, connectionPreview: null, paletteSearch: '', inspectorVisible: true,
    validationVisible: true, activeKeyboardMode: null, viewportAnimating: false,
    runtimeStatuses: {} as Record<string, FlowRuntimeStatus>, clipboard: null, density: 'comfortable' as FlowDensity,
  }

  return {
    document: initialDocument,
    savedDocument: initialDocument,
    past: [], future: [], readOnly: false, isPersisted: false, isDirty: false,
    ...resetTransient,
    loadDocument: (document, options = {}) => set({
      document: structuredClone(document), savedDocument: structuredClone(document), past: [], future: [],
      readOnly: options.readOnly ?? false, isPersisted: true, isDirty: false, ...resetTransient,
    }),
    newDocument: (document = createFlowDocument()) => {
      get().loadDocument(document)
      set({ isPersisted: false, isDirty: true })
    },
    importJson: (input) => {
      try {
        const document = deserializeFlowDocument(input)
        const issues = validateFlowDocument(document)
        const blockingRules = new Set(['duplicate-node-id', 'duplicate-edge-id', 'unknown-edge-source', 'unknown-edge-target'])
        const blocking = issues.filter((issue) => blockingRules.has(issue.ruleId))
        if (blocking.length) return { ok: false, error: `Flow import was rejected: ${blocking[0].message}` }
        if (get().readOnly) return { ok: false, error: 'Read-only flows cannot be imported.' }
        commit(() => document)
        set({ selectedNodeIds: [], selectedEdgeIds: [], isPersisted: false })
        return { ok: true, issues }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Flow import failed.' }
      }
    },
    prepareLocalSave: () => {
      const state = get()
      if (state.readOnly) return structuredClone(state.document)
      const changed = state.isDirty
      const document = {
        ...state.document,
        flow: {
          ...state.document.flow,
          revision: changed && state.isPersisted ? state.document.flow.revision + 1 : state.document.flow.revision,
          updated_at: changed ? new Date().toISOString() : state.document.flow.updated_at,
        },
      }
      set({ document, savedDocument: structuredClone(document), isPersisted: true, isDirty: false })
      return structuredClone(document)
    },
    addNode: (kind, position, id = uniqueId(kind)) => {
      const definition = nodeRegistry.get(kind)
      if (!definition || get().document.nodes.some((node) => node.id === id)) return null
      const added = commit((document) => withUpdated(document, { nodes: [...document.nodes, { id, kind, position, data: structuredClone(definition.defaultData), ui: {} }] }))
      if (added) set({ selectedNodeIds: [id], selectedEdgeIds: [] })
      return added ? id : null
    },
    addReusableNode: (reusableId, position, id = uniqueId('reusable')) => {
      const state = get()
      const source = state.document.nodes.find((node) => node.ui.reusable_id === reusableId)
      if (!source || state.document.nodes.some((node) => node.id === id)) return null
      const node = {
        ...structuredClone(source),
        id,
        position,
        ui: { ...structuredClone(source.ui), reusable_id: reusableId },
      }
      const added = commit((document) => withUpdated(document, { nodes: [...document.nodes, node] }))
      if (added) set({ selectedNodeIds: [id], selectedEdgeIds: [] })
      return added ? id : null
    },
    setNodeReusable: (id, reusable) => {
      commit((document) => {
        const selected = document.nodes.find((node) => node.id === id)
        if (!selected) return document
        const reusableId = reusable
          ? (typeof selected.ui.reusable_id === 'string' ? selected.ui.reusable_id : uniqueId('reusable'))
          : null
        return withUpdated(document, {
          nodes: document.nodes.map((node) => node.id === id
            ? {
                ...node,
                ui: reusableId
                  ? { ...node.ui, reusable_id: reusableId }
                  : Object.fromEntries(Object.entries(node.ui).filter(([key]) => key !== 'reusable_id')),
              }
            : node),
        })
      })
    },
    updateNodeData: (id, patch) => {
      commit((document) => {
        const selected = document.nodes.find((node) => node.id === id)
        if (!selected) return document
        const reusableId = typeof selected.ui.reusable_id === 'string' ? selected.ui.reusable_id : null
        return withUpdated(document, {
          nodes: document.nodes.map((node) => node.id === id || (reusableId && node.ui.reusable_id === reusableId)
            ? { ...node, data: { ...node.data, ...patch } }
            : node),
        })
      })
    },
    updateEdgeData: (id, patch) => { commit((document) => withUpdated(document, { edges: document.edges.map((edge) => edge.id === id ? { ...edge, data: { ...edge.data, ...patch } } : edge) })) },
    updateFlowName: (name) => { commit((document) => ({ ...document, flow: { ...document.flow, name, updated_at: new Date().toISOString() } })) },
    updateMetadata: (patch) => { commit((document) => withUpdated(document, { metadata: { ...document.metadata, ...patch } })) },
    moveNodes: (positions) => {
      if (get().readOnly) return
      const document = withUpdated(get().document, { nodes: get().document.nodes.map((node) => positions[node.id] ? { ...node, position: positions[node.id] } : node) })
      set({ document, isDirty: refreshDirty(document) })
    },
    connect: (connection, kind = 'default', id = uniqueId('edge')) => {
      const state = get()
      if (state.readOnly || state.document.edges.some((edge) => edge.id === id) || !validateFlowConnection(state.document, connection, kind)) return false
      const definition = edgeRegistry.get(kind)
      if (!definition) return false
      return commit((document) => withUpdated(document, { edges: [...document.edges, { id, kind, ...connection, data: structuredClone(definition.defaultData), ui: {} }] }))
    },
    reconnect: (edgeId, connection) => {
      const state = get()
      const edge = state.document.edges.find((candidate) => candidate.id === edgeId)
      if (!edge || !validateFlowConnection(state.document, connection, edge.kind)) return false
      return commit((document) => withUpdated(document, { edges: document.edges.map((candidate) => candidate.id === edgeId ? { ...candidate, ...connection } : candidate) }))
    },
    deleteSelection: () => {
      const state = get()
      if (state.readOnly || (!state.selectedNodeIds.length && !state.selectedEdgeIds.length)) return
      const nodeIds = new Set(state.selectedNodeIds)
      const edgeIds = new Set(state.selectedEdgeIds)
      commit((document) => withUpdated(document, {
        nodes: document.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: document.edges.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
      }))
      set({ selectedNodeIds: [], selectedEdgeIds: [] })
    },
    removeNodes: (ids) => { set({ selectedNodeIds: ids, selectedEdgeIds: [] }); get().deleteSelection() },
    removeEdges: (ids) => { set({ selectedNodeIds: [], selectedEdgeIds: ids }); get().deleteSelection() },
    copySelection: () => {
      const state = get()
      const ids = new Set(state.selectedNodeIds)
      if (!ids.size) return false
      set({ clipboard: {
        nodes: state.document.nodes.filter((node) => ids.has(node.id)).map((node) => structuredClone(node)),
        edges: state.document.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => structuredClone(edge)),
      } })
      return true
    },
    paste: () => {
      const { clipboard, readOnly } = get()
      if (!clipboard || readOnly) return false
      const idMap = new Map(clipboard.nodes.map((node) => [node.id, uniqueId(node.kind)]))
      const nodes = clipboard.nodes.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, position: { x: node.position.x + 36, y: node.position.y + 36 } }))
      const edges = clipboard.edges.map((edge) => ({ ...structuredClone(edge), id: uniqueId('edge'), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }))
      const changed = commit((document) => withUpdated(document, { nodes: [...document.nodes, ...nodes], edges: [...document.edges, ...edges] }))
      if (changed) set({ selectedNodeIds: nodes.map((node) => node.id), selectedEdgeIds: [] })
      return changed
    },
    duplicateSelection: () => get().copySelection() && get().paste(),
    select: (selectedNodeIds, selectedEdgeIds) => set((state) => {
      const sameNodes = state.selectedNodeIds.length === selectedNodeIds.length && state.selectedNodeIds.every((id, index) => id === selectedNodeIds[index])
      const sameEdges = state.selectedEdgeIds.length === selectedEdgeIds.length && state.selectedEdgeIds.every((id, index) => id === selectedEdgeIds[index])
      return sameNodes && sameEdges ? state : { selectedNodeIds, selectedEdgeIds }
    }),
    selectAll: () => set({ selectedNodeIds: get().document.nodes.map((node) => node.id), selectedEdgeIds: get().document.edges.map((edge) => edge.id) }),
    clearSelection: () => set({ selectedNodeIds: [], selectedEdgeIds: [] }),
    beginGesture: () => { if (!get().readOnly && !get().activeGestureSnapshot) set({ activeGestureSnapshot: structuredClone(get().document) }) },
    endGesture: () => {
      const state = get()
      if (!state.activeGestureSnapshot) return
      if (!documentsEqual(state.activeGestureSnapshot, state.document)) set({ past: appendHistory(state.past, state.activeGestureSnapshot), future: [], activeGestureSnapshot: null })
      else set({ activeGestureSnapshot: null })
    },
    replaceNodePositions: (nodes) => { commit((document) => withUpdated(document, { nodes: structuredClone(nodes) })) },
    setViewport: (viewport) => {
      if (get().readOnly || documentsEqual({ ...get().document, viewport }, get().document)) return
      const document = { ...get().document, viewport }
      set({ document, isDirty: refreshDirty(document) })
    },
    undo: () => {
      const state = get()
      if (state.readOnly || state.past.length === 0) return
      const document = structuredClone(state.past[state.past.length - 1])
      set({ document, past: state.past.slice(0, -1), future: appendHistory(state.future, state.document), isDirty: refreshDirty(document), selectedNodeIds: [], selectedEdgeIds: [] })
    },
    redo: () => {
      const state = get()
      if (state.readOnly || state.future.length === 0) return
      const document = structuredClone(state.future[state.future.length - 1])
      set({ document, past: appendHistory(state.past, state.document), future: state.future.slice(0, -1), isDirty: refreshDirty(document), selectedNodeIds: [], selectedEdgeIds: [] })
    },
    setReadOnly: (readOnly) => set({ readOnly }),
    setRuntimeStatuses: (runtimeStatuses) => set({ runtimeStatuses }),
    setPaletteSearch: (paletteSearch) => set({ paletteSearch }),
    setInspectorVisible: (inspectorVisible) => set({ inspectorVisible }),
    setValidationVisible: (validationVisible) => set({ validationVisible }),
    setDensity: (density) => set({ density }),
    setConnectionPreview: (connectionPreview) => set({ connectionPreview }),
    setHoveredElement: (hoveredElementId) => set({ hoveredElementId }),
    reset: () => set({ document: initialDocument, savedDocument: initialDocument, past: [], future: [], readOnly: false, isPersisted: false, isDirty: false, ...resetTransient }),
  }
})
