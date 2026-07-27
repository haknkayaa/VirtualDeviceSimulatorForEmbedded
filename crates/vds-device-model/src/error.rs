use vds_core::state_machine::StateMachineError;
use vds_registers::RegisterError;

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("failed to read device model '{path}': {source}")]
    Read {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("device model is not valid YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("device model has an incompatible shape: {0}")]
    Shape(#[from] serde_json::Error),

    #[error("embedded device-model schema is invalid: {0}")]
    InvalidEmbeddedSchema(String),

    #[error("device model failed schema validation:\n{0}")]
    Validation(String),

    #[error("behavior flow compilation failed: {0}")]
    BehaviorFlow(String),

    #[error("opcode 0x{opcode:02X} is duplicated by '{first}' and '{second}'")]
    DuplicateOpcode {
        opcode: u8,
        first: String,
        second: String,
    },

    #[error("unsupported device model '{model}' on bus '{bus}'")]
    UnsupportedModel { bus: String, model: String },

    #[error("SPI command '{name}' is invalid: {reason}")]
    InvalidCommand { name: String, reason: String },

    #[error("device memory geometry is invalid: {reason}")]
    InvalidMemory { reason: String },

    #[error("generic SPI command devices currently require mode 0 and 8-bit transfers")]
    InvalidSpiConfiguration,

    #[error("invalid BUSY register binding at 0x{address:X} with mask 0x{mask:X}")]
    InvalidBusyBinding { address: u64, mask: u64 },

    #[error("state machine is invalid: {reason}")]
    InvalidStateMachine { reason: String },

    #[error("state machine references unknown register '{name}'")]
    UnknownStateRegister { name: String },

    #[error("state machine register name '{name}' is ambiguous")]
    AmbiguousStateRegister { name: String },

    #[error(
        "state action or guard value for register '{name}' does not fit {width_bits} bits: value={value:#X}, mask={mask:?}"
    )]
    InvalidStateRegisterValue {
        name: String,
        width_bits: u8,
        value: u64,
        mask: Option<u64>,
    },

    #[error("failed to initialize device state machine: {0}")]
    StateInitialization(String),

    #[error("fault id '{id}' is duplicated")]
    DuplicateFaultId { id: String },

    #[error("fault '{id}' is invalid: {reason}")]
    InvalidFault { id: String, reason: String },

    #[error(transparent)]
    StateMachine(#[from] StateMachineError),

    #[error(transparent)]
    Register(#[from] RegisterError),
}
