import type { NodeProps } from '@xyflow/react'
import type { FlowCanvasNode } from '../types/flow'
import { BaseFlowNode } from './BaseFlowNode'

export function PlaceholderActionNode(props: NodeProps<FlowCanvasNode>) { return <BaseFlowNode {...props} /> }
