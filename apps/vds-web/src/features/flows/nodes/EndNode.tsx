import type { NodeProps } from '@xyflow/react'
import type { FlowCanvasNode } from '../types/flow'
import { BaseFlowNode } from './BaseFlowNode'

export function EndNode(props: NodeProps<FlowCanvasNode>) { return <BaseFlowNode {...props} /> }
