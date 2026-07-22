import type { ComponentType } from 'react'
import type { Edge, EdgeProps, Node, NodeProps, Viewport, XYPosition } from '@xyflow/react'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const FLOW_SCHEMA_VERSION = 1 as const
export type FlowSchemaVersion = typeof FLOW_SCHEMA_VERSION
export type FlowRuntimeStatus = 'idle' | 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'warning'
export type FlowDensity = 'compact' | 'comfortable'
export type FlowLayoutDirection = 'LR' | 'TB'
export type ValidationSeverity = 'error' | 'warning'

export interface FlowMetadata {
  id: string
  name: string
  kind: string
  revision: number
  created_at: string
  updated_at: string
}

export interface FlowNodeValidationMetadata {
  muted_rule_ids?: string[]
}

export interface FlowNodeDocument {
  id: string
  kind: string
  position: XYPosition
  data: JsonObject
  ui: JsonObject
  validation?: FlowNodeValidationMetadata
}

export interface FlowEdgeDocument {
  id: string
  kind: string
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
  data: JsonObject
  ui: JsonObject
}

export interface FlowDocument {
  schema_version: FlowSchemaVersion
  flow: FlowMetadata
  nodes: FlowNodeDocument[]
  edges: FlowEdgeDocument[]
  viewport: Viewport
  metadata: JsonObject
}

export interface ValidationIssue {
  ruleId: string
  severity: ValidationSeverity
  message: string
  nodeId?: string
  edgeId?: string
}

export interface ValidationContext {
  document: FlowDocument
  nodeRegistry: NodeRegistryReader
  edgeRegistry: EdgeRegistryReader
}

export type FlowValidationRule = (context: ValidationContext) => ValidationIssue[]
export type NodeValidationRule = (node: FlowNodeDocument, context: ValidationContext) => ValidationIssue[]
export type EdgeValidationRule = (edge: FlowEdgeDocument, context: ValidationContext) => ValidationIssue[]

export interface PortDefinition {
  id: string
  label: string
  required?: boolean
}

export interface NodeInspectorProps {
  node: FlowNodeDocument
  issues: ValidationIssue[]
  readOnly: boolean
  updateData: (patch: JsonObject) => void
}

export interface EdgeInspectorProps {
  edge: FlowEdgeDocument
  issues: ValidationIssue[]
  readOnly: boolean
  updateData: (patch: JsonObject) => void
}

export interface RuntimeStatusRendererProps {
  status: FlowRuntimeStatus
}

export interface NodeRegistryEntry {
  kind: string
  displayName: string
  description: string
  category: string
  iconIdentifier: string
  accentToken: string
  defaultData: JsonObject
  inputPorts: PortDefinition[]
  outputPorts: PortDefinition[]
  component: ComponentType<NodeProps<FlowCanvasNode>>
  inspectorComponent: ComponentType<NodeInspectorProps>
  validationRules: NodeValidationRule[]
  compilerAdapter?: (node: FlowNodeDocument) => unknown
  runtimeStatusRenderer?: ComponentType<RuntimeStatusRendererProps>
  flowKinds?: string[]
}

export interface EdgeRegistryEntry {
  kind: string
  displayName: string
  component: ComponentType<EdgeProps<FlowCanvasEdge>>
  validateConnection: (connection: FlowConnection, context: ValidationContext) => boolean
  defaultData: JsonObject
  inspectorComponent?: ComponentType<EdgeInspectorProps>
  validationRules: EdgeValidationRule[]
}

export interface NodeRegistryReader {
  get(kind: string): NodeRegistryEntry | undefined
  has(kind: string): boolean
  list(): NodeRegistryEntry[]
}

export interface EdgeRegistryReader {
  get(kind: string): EdgeRegistryEntry | undefined
  has(kind: string): boolean
  list(): EdgeRegistryEntry[]
}

export interface FlowConnection {
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
  kind?: string
}

export type FlowCanvasNode = Node<{
  document: FlowNodeDocument
  definition: NodeRegistryEntry | null
  runtimeStatus: FlowRuntimeStatus
  issues: ValidationIssue[]
  readOnly: boolean
}, string>

export type FlowCanvasEdge = Edge<{
  document: FlowEdgeDocument
  issues: ValidationIssue[]
  readOnly: boolean
}, string>

export interface FlowLayoutOptions {
  direction: FlowLayoutDirection
  nodeWidth?: number
  nodeHeight?: number
  rankSeparation?: number
  nodeSeparation?: number
}

export interface FlowLayoutResult {
  nodes: FlowNodeDocument[]
  viewport?: Viewport
}

export interface FlowLayoutEngine {
  readonly id: string
  layout(document: FlowDocument, options: FlowLayoutOptions): FlowLayoutResult
}

export interface FlowListItem {
  id: string
  name: string
  kind: string
  revision: number
  updatedAt: string
  source: 'local' | 'example'
}
