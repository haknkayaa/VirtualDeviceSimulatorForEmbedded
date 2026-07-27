import type { NodeProps } from '@xyflow/react'
import { BaseFlowNode } from '../../../flows/nodes/BaseFlowNode'
import type { FlowCanvasNode } from '../../../flows/types/flow'

export function StateNode(props: NodeProps<FlowCanvasNode>) {
  return <BaseFlowNode {...props} />
}
