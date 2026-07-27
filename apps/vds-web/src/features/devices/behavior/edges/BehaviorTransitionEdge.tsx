import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

import type { FlowCanvasEdge } from '../../../flows/types/flow'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function BehaviorTransitionEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<FlowCanvasEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const tone = data?.issues.some((issue) => issue.severity === 'error') ? 'error' : data?.issues.length ? 'warning' : 'valid'
  const trigger = text(data?.document.data.trigger) || 'event'
  const guard = text(data?.document.data.guard_register)
  const delay = data?.document.data.delay_value
  const delayUnit = text(data?.document.data.delay_unit)
  const runtime = data?.runtimeStatus ?? 'idle'
  return (
    <>
      <BaseEdge
        className={`flow-edge behavior-transition-edge flow-edge-${tone} runtime-${runtime}${selected ? ' selected' : ''}`}
        markerEnd={markerEnd}
        path={path}
      />
      <EdgeLabelRenderer>
        <div
          className={`behavior-edge-label runtime-${runtime}${selected ? ' selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <strong>{trigger}</strong>
          {guard && <span>if {guard}</span>}
          {typeof delay === 'number' && delay > 0 && <span>{delay} {delayUnit}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
