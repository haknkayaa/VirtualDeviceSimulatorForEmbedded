//! Serializable definitions that form a declarative device model.

use super::{
    BTreeMap, Deserialize, FaultDefinition, RegisterDefinition, Serialize, SignalGraphDefinition,
};

pub(super) const DEVICE_MODEL_SCHEMA: &str =
    include_str!("../../../schemas/device-model.schema.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceModel {
    pub schema_version: u32,
    pub device: DeviceDefinition,
    #[serde(skip)]
    pub signal_graph: Option<SignalGraphDefinition>,
    #[serde(skip)]
    pub package_root: Option<std::path::PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceDefinition {
    pub id: String,
    pub name: String,
    pub bus: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spi: Option<SpiBusDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i2c: Option<I2cBusDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpio: Option<GpioBusDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uart: Option<UartBusDefinition>,
    #[serde(default)]
    pub commands: Vec<SpiCommandDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryDefinition>,
    #[serde(default)]
    pub registers: Vec<RegisterDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy: Option<BusyDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_machine: Option<DeviceStateMachineDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub faults: Vec<FaultDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signals: Option<SignalsDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signal_bindings: Vec<SignalBindingDefinition>,
}

/// Public signal ports exposed to board topology. Internals stay private.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignalsDefinition {
    #[serde(default)]
    pub outputs: Vec<SignalOutputDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignalOutputDefinition {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: SignalPortType,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

/// Signal value types. Version 1 supports boolean levels only.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalPortType {
    Bool,
}

/// Drives one public output port from the device's own behavior.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignalBindingDefinition {
    pub signal: String,
    pub source: SignalSourceDefinition,
}

/// Internal level source for a public port.
///
/// Combined sources reuse the logical node vocabulary of the typed signal graph
/// (`and`, `or`, `not`, `nand`, `nor`, `xor`, `xnor`); there is no expression
/// language.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SignalSourceDefinition {
    Register(RegisterBitSourceDefinition),
    State(StateSourceDefinition),
    Logic(LogicSourceDefinition),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterBitSourceDefinition {
    pub register: String,
    pub bit: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StateSourceDefinition {
    pub state: StateEqualsDefinition,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StateEqualsDefinition {
    pub equals: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogicSourceDefinition {
    And([Box<SignalSourceDefinition>; 2]),
    Or([Box<SignalSourceDefinition>; 2]),
    Nand([Box<SignalSourceDefinition>; 2]),
    Nor([Box<SignalSourceDefinition>; 2]),
    Xor([Box<SignalSourceDefinition>; 2]),
    Xnor([Box<SignalSourceDefinition>; 2]),
    Not(Box<SignalSourceDefinition>),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UartBusDefinition {
    pub baud_rate: u32,
    #[serde(default = "default_uart_data_bits")]
    pub data_bits: u8,
    #[serde(default = "default_uart_stop_bits")]
    pub stop_bits: u8,
    #[serde(default)]
    pub parity: UartParity,
    pub responses: Vec<UartResponseDefinition>,
}

const fn default_uart_data_bits() -> u8 {
    8
}
const fn default_uart_stop_bits() -> u8 {
    1
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UartParity {
    #[default]
    None,
    Even,
    Odd,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UartResponseDefinition {
    pub request: Vec<u8>,
    pub response: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GpioBusDefinition {
    pub lines: Vec<GpioLineDefinition>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct I2cBusDefinition {
    #[serde(default = "default_i2c_register_address_bytes")]
    pub register_address_bytes: u8,
    #[serde(default = "default_true")]
    pub auto_increment: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_cycle_us: Option<u64>,
    #[serde(default)]
    pub write_protect: bool,
}

const fn default_i2c_register_address_bytes() -> u8 {
    1
}

const fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GpioLineDefinition {
    pub offset: u16,
    pub name: String,
    pub direction: GpioLineDirection,
    #[serde(default)]
    pub initial_value: bool,
    #[serde(default)]
    pub active_low: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub register: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GpioLineDirection {
    Input,
    Output,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpiBusDefinition {
    pub mode: u8,
    pub transfer_bits: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_frequency_hz: Option<u64>,
    #[serde(default)]
    pub supports_dtr: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryDefinition {
    pub size_bytes: u64,
    pub page_size_bytes: u64,
    pub sector_size_bytes: u64,
    pub erased_value: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BusyDefinition {
    pub register_address: u64,
    pub mask: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpiCommandDefinition {
    pub name: String,
    pub opcode: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<SpiCommandOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address_bytes: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub register: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_delay_us: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<CommandTimingDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_states: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wire: Option<SpiCommandWireDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<SpiCommandShortcutDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpiCommandShortcutDefinition {
    pub tx: Vec<u8>,
    pub rx_length: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpiCommandWireDefinition {
    pub command_width: SpiWidthDefinition,
    pub address_width: SpiWidthDefinition,
    pub data_width: SpiWidthDefinition,
    pub rate: SpiRateDefinition,
    #[serde(default)]
    pub dummy_cycles: u16,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpiWidthDefinition {
    Single,
    Dual,
    Quad,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpiRateDefinition {
    Str,
    Dtr,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CommandTimingDefinition {
    pub latency_us: u64,
    #[serde(default)]
    pub busy_during_operation: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceStateMachineDefinition {
    pub initial_state: String,
    pub states: BTreeMap<String, DeviceStateDefinition>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceStateDefinition {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entry_actions: Vec<StateActionDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exit_actions: Vec<StateActionDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<StateTransitionDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delayed_events: Vec<DeviceDelayedEventDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StateTransitionDefinition {
    pub event: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<StateGuardDefinition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceDelayedEventDefinition {
    pub event: String,
    pub delay_us: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StateActionDefinition {
    SetRegister(RegisterActionDefinition),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterActionDefinition {
    pub name: String,
    pub value: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StateGuardDefinition {
    Register(RegisterGuardDefinition),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterGuardDefinition {
    pub name: String,
    pub equals: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpiCommandOperation {
    RegisterRead,
    RegisterWrite,
    MemoryRead,
    PageProgram,
    SectorErase,
    ChipErase,
}
