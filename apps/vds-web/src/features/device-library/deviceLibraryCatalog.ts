export type LibraryPackageKind = 'device_model' | 'behavior_flow' | 'scenario_flow' | 'flow_foundation'

export interface LibraryPackage {
  id: string
  name: string
  acronym: string
  kind: LibraryPackageKind
  bus: 'SPI' | 'Generic'
  version: string
  source: string
  description: string
  capabilities: string[]
  statistics: Array<{ label: string; value: string }>
  readme: string[]
  editorPath?: string
}

export const deviceLibraryCatalog: LibraryPackage[] = [
  {
    id: 'generic-spi-flash-128m',
    name: 'Generic SPI Flash 128 Mbit',
    acronym: 'SPI',
    kind: 'device_model',
    bus: 'SPI',
    version: '1.0.0',
    source: 'device-models/examples/generic-spi-flash/model.yaml',
    description: 'Complete vendor-neutral 16 MiB SPI flash reference with deterministic timing, memory and fault behavior.',
    capabilities: ['SPI Mode 0', '16 MiB memory', 'State machine', '6 fault profiles', '10 scenarios'],
    statistics: [
      { label: 'Registers', value: '3' },
      { label: 'Commands', value: '12' },
      { label: 'States', value: '8' },
      { label: 'Scenarios', value: '10' },
    ],
    readme: [
      'Public-safe reference model for an 8-bit SPI Mode 0 flash device.',
      'Includes 256-byte pages, 4 KiB sectors and 1-to-0 page programming.',
      'Reset, program, erase and power-down timing use the virtual scheduler.',
    ],
    editorPath: '/flows/devices/generic-spi-flash-128m-behavior',
  },
  {
    id: 'spi-flash-compatibility',
    name: 'SPI Flash Compatibility Fixture',
    acronym: 'SPI',
    kind: 'device_model',
    bus: 'SPI',
    version: '1.0.0',
    source: 'device-models/examples/spi-flash.yaml',
    description: 'Compact READ_ID, register, timing and fault fixture retained for client compatibility checks.',
    capabilities: ['READ_ID', 'Register I/O', 'Busy timing', 'Timeout fault'],
    statistics: [
      { label: 'Registers', value: '3' },
      { label: 'Commands', value: '3' },
      { label: 'States', value: '3' },
      { label: 'Faults', value: '1' },
    ],
    readme: [
      'Small compatibility model used by the existing C client and vertical-slice tests.',
      'Exercises the same Unix socket and Protobuf transaction path as full models.',
    ],
  },
  {
    id: 'generic-spi-flash-128m-behavior',
    name: 'SPI Flash Behavior Flow',
    acronym: 'FSM',
    kind: 'behavior_flow',
    bus: 'SPI',
    version: '1.0.0',
    source: 'apps/vds-web/src/features/device-behavior-flows/serialization/deviceBehaviorFlowDocument.ts',
    description: 'Read-only visual state-machine representation of the complete Generic SPI Flash reference.',
    capabilities: ['8 states', 'Typed transitions', 'Register actions', 'Runtime highlighting'],
    statistics: [
      { label: 'States', value: '8' },
      { label: 'Source', value: 'Local' },
      { label: 'Flow kind', value: 'Behavior' },
      { label: 'Runtime', value: 'Authoritative' },
    ],
    readme: [
      'States are nodes and transitions are typed edges.',
      'The compiler targets the existing device-model schema without adding another runtime.',
    ],
    editorPath: '/flows/devices/generic-spi-flash-128m-behavior',
  },
  {
    id: 'generic-busy-device-behavior',
    name: 'Generic Busy Device Flow',
    acronym: 'FSM',
    kind: 'behavior_flow',
    bus: 'Generic',
    version: '1.0.0',
    source: 'apps/vds-web/src/features/device-behavior-flows/serialization/deviceBehaviorFlowDocument.ts',
    description: 'Safe resetting, ready and busy state-machine example for visual behavior authoring.',
    capabilities: ['Reset flow', 'Busy state', 'Delayed completion', 'Register actions'],
    statistics: [
      { label: 'States', value: '3' },
      { label: 'Source', value: 'Local' },
      { label: 'Flow kind', value: 'Behavior' },
      { label: 'Schema', value: 'v1' },
    ],
    readme: [
      'Minimal cyclic device behavior example.',
      'Useful as a starting point for custom local models.',
    ],
    editorPath: '/flows/devices/example-generic-device-behavior',
  },
  {
    id: 'read-id-scenario-flow',
    name: 'Deterministic READ_ID Scenario',
    acronym: 'SCN',
    kind: 'scenario_flow',
    bus: 'SPI',
    version: '1.0.0',
    source: 'apps/vds-web/src/features/scenario-flows/serialization/scenarioFlowDocument.ts',
    description: 'Visual sequential scenario example compiled into the existing vds-scenario definition.',
    capabilities: ['Reset device', 'Advance time', 'Send SPI', 'Assert response'],
    statistics: [
      { label: 'Execution', value: 'Sequential' },
      { label: 'Source', value: 'Local' },
      { label: 'Flow kind', value: 'Scenario' },
      { label: 'Schema', value: 'v1' },
    ],
    readme: [
      'Demonstrates deterministic visual scenario authoring.',
      'Execution remains owned by the existing vds-scenario crate.',
    ],
    editorPath: '/flows/scenarios/example-read-id-scenario',
  },
  {
    id: 'linear-flow-foundation',
    name: 'Linear Flow Foundation',
    acronym: 'FLOW',
    kind: 'flow_foundation',
    bus: 'Generic',
    version: '1.0.0',
    source: 'apps/vds-web/src/features/flows/serialization/examples.ts',
    description: 'Generic Start, Placeholder Action and End flow document demonstrating the reusable canvas.',
    capabilities: ['Versioned document', 'Undo / redo', 'Validation', 'Import / export'],
    statistics: [
      { label: 'Nodes', value: '3' },
      { label: 'Source', value: 'Local' },
      { label: 'Flow kind', value: 'Generic' },
      { label: 'Schema', value: 'v1' },
    ],
    readme: [
      'Domain-neutral example for the visual flow editor foundation.',
      'Contains no simulator runtime behavior.',
    ],
    editorPath: '/flows/example-linear-flow',
  },
]

export function libraryKindLabel(kind: LibraryPackageKind) {
  const labels: Record<LibraryPackageKind, string> = {
    device_model: 'Device Model',
    behavior_flow: 'Behavior Flow',
    scenario_flow: 'Scenario Flow',
    flow_foundation: 'Flow Foundation',
  }
  return labels[kind]
}
