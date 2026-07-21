use crate::AccessType;

/// Structured validation and runtime errors produced by the register engine.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum RegisterError {
    #[error("register address 0x{address:X} is duplicated by '{first_name}' and '{second_name}'")]
    DuplicateAddress {
        address: u64,
        first_name: String,
        second_name: String,
    },

    #[error("register '{name}' at 0x{address:X} has invalid width {width_bits}; expected 1..=64")]
    InvalidWidth {
        name: String,
        address: u64,
        width_bits: u8,
    },

    #[error("register '{name}' reset value 0x{reset_value:X} does not fit width {width_bits}")]
    ResetValueOverflow {
        name: String,
        address: u64,
        width_bits: u8,
        reset_value: u64,
    },

    #[error("register address 0x{address:X} is not defined")]
    UnknownAddress { address: u64 },

    #[error("register '{name}' at 0x{address:X} with access {access} cannot be read")]
    ReadNotAllowed {
        name: String,
        address: u64,
        access: AccessType,
        current_value: u64,
    },

    #[error("register '{name}' at 0x{address:X} with access {access} cannot be written")]
    WriteNotAllowed {
        name: String,
        address: u64,
        access: AccessType,
        current_value: u64,
        requested_value: u64,
    },

    #[error("value 0x{value:X} does not fit register '{name}' width {width_bits} at 0x{address:X}")]
    ValueOverflow {
        name: String,
        address: u64,
        width_bits: u8,
        value: u64,
        current_value: u64,
        access: AccessType,
    },
}
