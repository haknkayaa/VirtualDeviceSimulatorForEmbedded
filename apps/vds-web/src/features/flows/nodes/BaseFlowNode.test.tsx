import { render, screen } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { GenericNodeInspector } from '../components/GenericInspectorSection'
import { flowFixture } from '../testFixtures'
import type { FlowCanvasNode, NodeRegistryEntry } from '../types/flow'
import { BaseFlowNode } from './BaseFlowNode'
import { PlaceholderActionNode } from './PlaceholderActionNode'

const definition: NodeRegistryEntry = {
  kind: 'placeholder_action',
  displayName: 'Placeholder Action',
  description: 'Test action',
  category: 'Test',
  iconIdentifier: 'test',
  accentToken: 'cyan',
  defaultData: {},
  inputPorts: [{ id: 'in', label: 'Input' }],
  outputPorts: [{ id: 'out', label: 'Output' }],
  component: PlaceholderActionNode,
  inspectorComponent: GenericNodeInspector,
  validationRules: [],
}

describe('runtime status rendering hook', () => {
  it('renders externally supplied runtime status without semantic mutation', () => {
    const document = flowFixture().nodes[1]
    const props = {
      id: document.id,
      type: document.kind,
      data: { document, definition, runtimeStatus: 'running', issues: [], readOnly: false },
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as NodeProps<FlowCanvasNode>
    render(<ReactFlowProvider><BaseFlowNode {...props} /></ReactFlowProvider>)
    expect(screen.getByText('Placeholder Action').closest('.flow-node')).toHaveAttribute('data-runtime-status', 'running')
    expect(document.data).not.toHaveProperty('runtimeStatus')
  })

  it('hides output handles when the node is a terminal state', () => {
    const document = flowFixture().nodes[1]
    document.data.terminal = true
    const props = {
      id: document.id,
      type: document.kind,
      data: { document, definition, runtimeStatus: 'idle', issues: [], readOnly: false },
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as NodeProps<FlowCanvasNode>

    render(<ReactFlowProvider><BaseFlowNode {...props} /></ReactFlowProvider>)

    expect(screen.getByLabelText('Input input')).toBeInTheDocument()
    expect(screen.queryByLabelText('Output output')).not.toBeInTheDocument()
  })
})
