import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

import type { FlowCanvasEdge } from '../types/flow'

export function BaseFlowEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps<FlowCanvasEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const tone = data?.issues.some((issue) => issue.severity === 'error') ? 'error' : data?.issues.length ? 'warning' : 'valid'
  return <BaseEdge className={`flow-edge flow-edge-${tone} runtime-${data?.runtimeStatus ?? 'idle'}${selected ? ' selected' : ''}`} markerEnd={markerEnd} path={path} />
}
