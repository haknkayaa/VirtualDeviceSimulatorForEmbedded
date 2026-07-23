import { GenericNodeInspector } from '../../flows/components/GenericInspectorSection'
import { edgeRegistry } from '../../flows/registry/edgeRegistry'
import { nodeRegistry } from '../../flows/registry/nodeRegistry'
import type { JsonObject, NodeRegistryEntry } from '../../flows/types/flow'
import { registerFlowValidationRules } from '../../flows/validation/validator'
import { BehaviorTransitionEdge } from '../edges/BehaviorTransitionEdge'
import { TransitionInspector } from '../inspectors/TransitionInspector'
import { StateNodeInspector } from '../inspectors/StateNodeInspector'
import { InitialStateNode } from '../nodes/InitialStateNode'
import { StateNode } from '../nodes/StateNode'
import { CommandTriggerNode } from '../nodes/CommandTriggerNode'
import { EventTriggerNode } from '../nodes/EventTriggerNode'
import { GuardNode } from '../nodes/GuardNode'
import { DelayNode } from '../nodes/DelayNode'
import { SetRegisterNode } from '../nodes/SetRegisterNode'
import { ResetRegisterNode } from '../nodes/ResetRegisterNode'
import { EmitEventNode } from '../nodes/EmitEventNode'
import { StartOperationNode } from '../nodes/StartOperationNode'
import { CompleteOperationNode } from '../nodes/CompleteOperationNode'
import { EndNode } from '../nodes/EndNode'
import {
  ACTIVE_BEHAVIOR_NODE_KINDS,
  BEHAVIOR_NODE_KINDS,
  BEHAVIOR_TRANSITION_EDGE,
} from '../types/deviceBehaviorFlow'
import { behaviorFlowRules } from '../validation/behaviorRules'

const stateInput = [{ id: 'in', label: 'Incoming transition' }]
const stateOutput = [{ id: 'out', label: 'Outgoing transition' }]

function entry(
  kind: string,
  displayName: string,
  component: NodeRegistryEntry['component'],
  defaultData: JsonObject,
  active = false,
): NodeRegistryEntry {
  return {
    kind,
    displayName,
    description: active ? `${displayName} in the compiled device state machine.` : `${displayName} metadata is represented by state or transition inspectors in edge-centric v1.`,
    category: active ? 'Device states' : 'Reserved metadata',
    iconIdentifier: kind === BEHAVIOR_NODE_KINDS.initialState ? 'play' : 'workflow',
    accentToken: kind === BEHAVIOR_NODE_KINDS.initialState ? 'cyan' : 'violet',
    defaultData,
    inputPorts: active ? stateInput : [],
    outputPorts: active ? stateOutput : [],
    component,
    inspectorComponent: active ? StateNodeInspector : GenericNodeInspector,
    validationRules: [],
    flowKinds: active ? ['device_behavior'] : ['device_behavior_reserved'],
  }
}

const entries = [
  entry(BEHAVIOR_NODE_KINDS.initialState, 'Initial State', InitialStateNode, { label: 'Initial State', state_name: 'resetting', description: '', terminal: false, entry_actions: [], exit_actions: [] }, true),
  entry(BEHAVIOR_NODE_KINDS.state, 'State', StateNode, { label: 'State', state_name: 'state', description: '', terminal: false, entry_actions: [], exit_actions: [] }, true),
  entry(BEHAVIOR_NODE_KINDS.commandTrigger, 'Command Trigger', CommandTriggerNode, { label: 'Command Trigger' }),
  entry(BEHAVIOR_NODE_KINDS.eventTrigger, 'Event Trigger', EventTriggerNode, { label: 'Event Trigger' }),
  entry(BEHAVIOR_NODE_KINDS.guard, 'Guard', GuardNode, { label: 'Guard' }),
  entry(BEHAVIOR_NODE_KINDS.delay, 'Delay', DelayNode, { label: 'Delay' }),
  entry(BEHAVIOR_NODE_KINDS.setRegister, 'Set Register', SetRegisterNode, { label: 'Set Register' }),
  entry(BEHAVIOR_NODE_KINDS.resetRegister, 'Reset Register', ResetRegisterNode, { label: 'Reset Register' }),
  entry(BEHAVIOR_NODE_KINDS.emitEvent, 'Emit Event', EmitEventNode, { label: 'Emit Event' }),
  entry(BEHAVIOR_NODE_KINDS.startOperation, 'Start Operation', StartOperationNode, { label: 'Start Operation' }),
  entry(BEHAVIOR_NODE_KINDS.completeOperation, 'Complete Operation', CompleteOperationNode, { label: 'Complete Operation' }),
  entry(BEHAVIOR_NODE_KINDS.end, 'End', EndNode, { label: 'End' }),
]

export function registerDeviceBehaviorRegistry() {
  entries.forEach((definition) => {
    if (!nodeRegistry.has(definition.kind)) nodeRegistry.register(definition)
  })
  if (!edgeRegistry.has(BEHAVIOR_TRANSITION_EDGE)) {
    edgeRegistry.register({
      kind: BEHAVIOR_TRANSITION_EDGE,
      displayName: 'State transition',
      component: BehaviorTransitionEdge,
      defaultData: {
        trigger_type: 'event',
        trigger: 'event',
        priority: 0,
        guard_enabled: false,
        guard_register: '',
        guard_equals: '0x0',
        guard_mask: '',
        delay_value: null,
        delay_unit: 'ms',
      },
      inspectorComponent: TransitionInspector,
      validationRules: [],
      validateConnection: (connection, context) => {
        const source = context.document.nodes.find((node) => node.id === connection.source)
        const target = context.document.nodes.find((node) => node.id === connection.target)
        return Boolean(source && target && ACTIVE_BEHAVIOR_NODE_KINDS.has(source.kind) && ACTIVE_BEHAVIOR_NODE_KINDS.has(target.kind))
      },
    })
  }
  return entries
}

registerDeviceBehaviorRegistry()
registerFlowValidationRules('device_behavior', behaviorFlowRules)
