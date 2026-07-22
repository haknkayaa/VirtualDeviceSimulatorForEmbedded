import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
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

import { FLOW_NODE_MIME } from './NodePalette'
import { canvasEdgeTypes } from '../registry/edgeRegistry'
import { canvasNodeTypes } from '../registry/nodeRegistry'
import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowKeyboardShortcuts } from '../hooks/useFlowKeyboardShortcuts'
import { useFlowStore } from '../store/flowStore'
import type { FlowCanvasEdge, FlowCanvasNode, ValidationIssue } from '../types/flow'
import { validateFlowConnection } from '../validation/validator'

interface FlowCanvasProps {
  issues: ValidationIssue[]
  onSave: () => void
  canvasFocused: boolean
  setCanvasFocused: (focused: boolean) => void
}

export function FlowCanvas({ issues, onSave, canvasFocused, setCanvasFocused }: FlowCanvasProps) {
  const store = useFlowStore()
  const instance = useReactFlow<FlowCanvasNode, FlowCanvasEdge>()
  const nodes = useMemo<FlowCanvasNode[]>(() => store.document.nodes.map((node) => ({
    id: node.id,
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
  })), [issues, store.document.nodes, store.readOnly, store.runtimeStatuses, store.selectedNodeIds])
  const edges = useMemo<FlowCanvasEdge[]>(() => store.document.edges.map((edge) => ({
    id: edge.id,
    type: edgeRegistry.has(edge.kind) ? edge.kind : 'unknown',
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    selected: store.selectedEdgeIds.includes(edge.id),
    reconnectable: !store.readOnly,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { document: edge, issues: issues.filter((issue) => issue.edgeId === edge.id), readOnly: store.readOnly },
  })), [issues, store.document.edges, store.readOnly, store.selectedEdgeIds])

  const fitView = useCallback(() => { void instance.fitView({ padding: 0.2, duration: 260 }) }, [instance])
  const shortcutOptions = useMemo(() => ({ fitView, save: onSave, canvasFocused }), [canvasFocused, fitView, onSave])
  useFlowKeyboardShortcuts(shortcutOptions)
  useEffect(() => {
    void instance.setViewport(store.document.viewport)
  }, [instance, store.document.viewport])

  const onNodesChange = useCallback((changes: NodeChange<FlowCanvasNode>[]) => {
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
  const onConnect = useCallback((connection: Connection) => { store.connect(connectionFrom(connection)) }, [connectionFrom, store])
  const onReconnect = useCallback<OnReconnect<FlowCanvasEdge>>((edge, connection) => { store.reconnect(edge.id, connectionFrom(connection)) }, [connectionFrom, store])
  const isValidConnection = useCallback<IsValidConnection<FlowCanvasEdge>>((connection) => validateFlowConnection(store.document, connectionFrom(connection)), [connectionFrom, store.document])

  return (
    <div
      className="flow-canvas"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCanvasFocused(false) }}
      onFocus={() => setCanvasFocused(true)}
      tabIndex={0}
    >
      <ReactFlow<FlowCanvasNode, FlowCanvasEdge>
        colorMode="dark"
        defaultViewport={store.document.viewport}
        defaultEdgeOptions={{ type: 'default' }}
        deleteKeyCode={null}
        edges={edges}
        edgesReconnectable={!store.readOnly}
        edgeTypes={canvasEdgeTypes as unknown as EdgeTypes}
        elementsSelectable
        elevateEdgesOnSelect
        fitViewOptions={{ padding: 0.2 }}
        isValidConnection={isValidConnection}
        maxZoom={2.2}
        minZoom={0.25}
        nodes={nodes}
        nodesConnectable={!store.readOnly}
        nodesDraggable={!store.readOnly}
        nodeTypes={canvasNodeTypes}
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
          const kind = event.dataTransfer.getData(FLOW_NODE_MIME)
          if (kind) store.addNode(kind, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: true }))
        }}
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={!store.readOnly}
        snapGrid={[20, 20]}
        snapToGrid
      >
        <Background color="rgba(140, 148, 166, .22)" gap={20} size={1} variant={BackgroundVariant.Dots} />
        <MiniMap className="flow-minimap" maskColor="rgba(5, 7, 11, .72)" pannable zoomable />
      </ReactFlow>
    </div>
  )
}

export function FlowCanvasController({ issues, onSave, onFitViewReady }: { issues: ValidationIssue[]; onSave: () => void; onFitViewReady?: (fit: () => void) => void }) {
  const [canvasFocused, setCanvasFocused] = useState(false)
  void onFitViewReady
  return <FlowCanvas canvasFocused={canvasFocused} issues={issues} onSave={onSave} setCanvasFocused={setCanvasFocused} />
}
