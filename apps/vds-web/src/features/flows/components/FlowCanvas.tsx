import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnReconnect,
} from '@xyflow/react'

import { FLOW_NODE_MIME, FLOW_REUSABLE_NODE_MIME } from './NodePalette'
import { canvasEdgeTypes } from '../registry/edgeRegistry'
import { canvasNodeTypes } from '../registry/nodeRegistry'
import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowKeyboardShortcuts } from '../hooks/useFlowKeyboardShortcuts'
import { useFlowStore } from '../store/flowStore'
import type { FlowCanvasEdge, FlowCanvasNode, FlowRuntimeStatus, ValidationIssue } from '../types/flow'
import { validateFlowConnection } from '../validation/validator'

const runtimeMarkerColors: Partial<Record<FlowRuntimeStatus, string>> = {
  active: 'var(--live)', running: 'var(--live)', pending: 'var(--info)',
  passed: 'var(--ok)', transitioned: 'var(--ok)',
  failed: 'var(--err)', error: 'var(--err)', rejected: 'var(--err)',
}

/** Arrowheads follow the edge stroke state; React Flow dedupes markers per colour. */
function edgeMarkerColor(selected: boolean, runtimeStatus: FlowRuntimeStatus, issues: ValidationIssue[]) {
  if (selected) return 'var(--accent)'
  const runtime = runtimeMarkerColors[runtimeStatus]
  if (runtime) return runtime
  if (issues.some((issue) => issue.severity === 'error')) return 'var(--err)'
  if (issues.length) return 'var(--warn)'
  return 'var(--text-faint)'
}

function minimapNodeClass(node: FlowCanvasNode) {
  const status = node.data.runtimeStatus
  const issues = node.data.issues
  if (status !== 'idle') return `flow-minimap-node runtime-${status}`
  if (issues.some((issue) => issue.severity === 'error')) return 'flow-minimap-node invalid'
  return `flow-minimap-node accent-${node.data.definition?.accentToken ?? 'muted'}${node.selected ? ' selected' : ''}`
}

interface FlowCanvasProps {
  issues: ValidationIssue[]
  onSave: () => void
  canvasFocused: boolean
  setCanvasFocused: (focused: boolean) => void
}

export function FlowCanvas({ issues, onSave, canvasFocused, setCanvasFocused }: FlowCanvasProps) {
  const store = useFlowStore()
  const instance = useReactFlow<FlowCanvasNode, FlowCanvasEdge>()
  const nodeTypeSignature = nodeRegistry.list().map((entry) => entry.kind).join('|')
  const registeredNodeTypes = useMemo(() => {
    void nodeTypeSignature
    return canvasNodeTypes()
  }, [nodeTypeSignature])
  const registeredEdgeTypes = useMemo(() => canvasEdgeTypes(), [])
  const defaultEdgeKind = typeof store.document.metadata.default_edge_kind === 'string' && edgeRegistry.has(store.document.metadata.default_edge_kind)
    ? store.document.metadata.default_edge_kind
    : 'default'
  // Controlled nodes must carry their measured size, otherwise the minimap skips them.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const nodes = useMemo<FlowCanvasNode[]>(() => store.document.nodes.map((node) => ({
    id: node.id,
    measured: measured[node.id],
    type: nodeRegistry.has(node.kind) ? node.kind : 'unknown',
    position: node.position,
    selected: store.selectedNodeIds.includes(node.id),
    draggable: !store.readOnly,
    data: {
      document: node,
      definition: nodeRegistry.get(node.kind) ?? null,
      runtimeStatus: store.runtimeStatuses[node.id] ?? 'idle',
      issues: issues.filter((issue) => issue.nodeId === node.id),
      readOnly: store.readOnly,
    },
  })), [issues, measured, store.document.nodes, store.readOnly, store.runtimeStatuses, store.selectedNodeIds])
  const edges = useMemo<FlowCanvasEdge[]>(() => store.document.edges.map((edge) => {
    const selected = store.selectedEdgeIds.includes(edge.id)
    const edgeIssues = issues.filter((issue) => issue.edgeId === edge.id)
    const runtimeStatus = store.runtimeStatuses[edge.id] ?? 'idle'
    return {
      id: edge.id,
      type: edgeRegistry.has(edge.kind) ? edge.kind : 'unknown',
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      selected,
      reconnectable: !store.readOnly,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeMarkerColor(selected, runtimeStatus, edgeIssues) },
      data: {
        document: edge,
        issues: edgeIssues,
        readOnly: store.readOnly,
        runtimeStatus,
      },
    }
  }), [issues, store.document.edges, store.readOnly, store.runtimeStatuses, store.selectedEdgeIds])

  const fitView = useCallback(() => { void instance.fitView({ padding: 0.2, duration: 260 }) }, [instance])
  const shortcutOptions = useMemo(() => ({ fitView, save: onSave, canvasFocused }), [canvasFocused, fitView, onSave])
  useFlowKeyboardShortcuts(shortcutOptions)
  useEffect(() => {
    void instance.setViewport(store.document.viewport)
  }, [instance, store.document.viewport])

  const onNodesChange = useCallback((changes: NodeChange<FlowCanvasNode>[]) => {
    const sized = changes.flatMap((change) => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : [])
    if (sized.length) setMeasured((current) => ({ ...current, ...Object.fromEntries(sized) }))
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id)
    if (removed.length) store.removeNodes(removed)
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length) {
      const selected = new Set(store.selectedNodeIds)
      selectionChanges.forEach((change) => change.type === 'select' && (change.selected ? selected.add(change.id) : selected.delete(change.id)))
      store.select([...selected], store.selectedEdgeIds)
    }
    const positions = Object.fromEntries(changes.flatMap((change) => change.type === 'position' && change.position ? [[change.id, change.position]] : []))
    if (Object.keys(positions).length) store.moveNodes(positions)
  }, [store])
  const onEdgesChange = useCallback((changes: EdgeChange<FlowCanvasEdge>[]) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id)
    if (removed.length) store.removeEdges(removed)
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length) {
      const selected = new Set(store.selectedEdgeIds)
      selectionChanges.forEach((change) => change.type === 'select' && (change.selected ? selected.add(change.id) : selected.delete(change.id)))
      store.select(store.selectedNodeIds, [...selected])
    }
  }, [store])
  const connectionFrom = useCallback((connection: Pick<Connection, 'source' | 'sourceHandle' | 'target' | 'targetHandle'> | FlowCanvasEdge) => ({
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  }), [])
  const connectionKind = useCallback((connection: Pick<Connection, 'source' | 'target'>) => {
    if (store.document.flow.kind !== 'device_behavior') return defaultEdgeKind
    const sourceKind = store.document.nodes.find((node) => node.id === connection.source)?.kind
    const targetKind = store.document.nodes.find((node) => node.id === connection.target)?.kind
    const runtimeState = (kind?: string) => kind === 'device_behavior.initial_state' || kind === 'device_behavior.state'
    return runtimeState(sourceKind) && runtimeState(targetKind) ? 'device_behavior.transition' : 'device_behavior.signal'
  }, [defaultEdgeKind, store.document.flow.kind, store.document.nodes])
  const onConnect = useCallback((connection: Connection) => { store.connect(connectionFrom(connection), connectionKind(connection)) }, [connectionFrom, connectionKind, store])
  const onReconnect = useCallback<OnReconnect<FlowCanvasEdge>>((edge, connection) => { store.reconnect(edge.id, connectionFrom(connection)) }, [connectionFrom, store])
  const isValidConnection = useCallback<IsValidConnection<FlowCanvasEdge>>((connection) => validateFlowConnection(store.document, connectionFrom(connection), connectionKind(connection)), [connectionFrom, connectionKind, store.document])

  return (
    <div
      aria-label="Flow canvas"
      className="flow-canvas"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCanvasFocused(false) }}
      onFocus={() => setCanvasFocused(true)}
      tabIndex={0}
    >
      <ReactFlow<FlowCanvasNode, FlowCanvasEdge>
        defaultViewport={store.document.viewport}
        defaultEdgeOptions={{ type: defaultEdgeKind }}
        deleteKeyCode={null}
        edges={edges}
        edgesReconnectable={!store.readOnly}
        edgeTypes={registeredEdgeTypes as unknown as EdgeTypes}
        elementsSelectable
        elevateEdgesOnSelect
        fitViewOptions={{ padding: 0.2 }}
        isValidConnection={isValidConnection}
        maxZoom={2.2}
        minZoom={0.25}
        nodes={nodes}
        nodesConnectable={!store.readOnly}
        nodesDraggable={!store.readOnly}
        nodeTypes={registeredNodeTypes}
        onConnect={onConnect}
        onConnectEnd={() => store.setConnectionPreview(null)}
        onEdgesChange={onEdgesChange}
        onMoveEnd={(_, viewport) => store.setViewport(viewport)}
        onNodeDragStart={() => store.beginGesture()}
        onNodeDragStop={() => store.endGesture()}
        onNodesChange={onNodesChange}
        onPaneClick={() => store.clearSelection()}
        onReconnect={onReconnect}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDrop={(event) => {
          event.preventDefault()
          const reusableId = event.dataTransfer.getData(FLOW_REUSABLE_NODE_MIME)
          const kind = event.dataTransfer.getData(FLOW_NODE_MIME)
          const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: true })
          if (reusableId) store.addReusableNode(reusableId, position)
          else if (kind) store.addNode(kind, position)
        }}
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={!store.readOnly}
        snapGrid={[20, 20]}
        snapToGrid
      >
        <Background gap={20} size={1} variant={BackgroundVariant.Dots} />
        <Controls className="flow-controls" fitViewOptions={{ padding: 0.2, duration: 260 }} showInteractive={false} />
        <MiniMap
          ariaLabel="Flow overview"
          className="flow-minimap"
          nodeBorderRadius={2}
          nodeClassName={minimapNodeClass}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}

export function FlowCanvasController({ issues, onSave, onFitViewReady }: { issues: ValidationIssue[]; onSave: () => void; onFitViewReady?: (fit: () => void) => void }) {
  const [canvasFocused, setCanvasFocused] = useState(false)
  void onFitViewReady
  return <FlowCanvas canvasFocused={canvasFocused} issues={issues} onSave={onSave} setCanvasFocused={setCanvasFocused} />
}
