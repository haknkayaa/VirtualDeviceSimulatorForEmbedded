import type { NodeProps } from '@xyflow/react'
import { BaseFlowNode } from '../../flows/nodes/BaseFlowNode'
import type { FlowCanvasNode } from '../../flows/types/flow'

export const StartScenarioNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const EndScenarioNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const ResetDeviceNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const SendSpiNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const AdvanceTimeNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const EnableFaultNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const DisableFaultNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const AssertRegisterNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const AssertStateNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const AssertResponseNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const AssertErrorNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
export const WaitForEventNode = (props: NodeProps<FlowCanvasNode>) => <BaseFlowNode {...props} />
