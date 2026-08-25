//! Bus-neutral virtual-device traits and transaction types.

use std::fmt;

use crate::event::DeviceEvent;

/// Bus families supported by the core device interface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BusType {
    Spi,
    I2c,
    Gpio,
}

/// One Linux-compatible I2C message within an atomic transfer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct I2cMessage {
    pub read: bool,
    pub data: Vec<u8>,
    pub read_length: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GpioLineSnapshot {
    pub offset: u16,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SpiLaneWidth {
    #[default]
    Single,
    Dual,
    Quad,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SpiTransferRate {
    #[default]
    Str,
    Dtr,
}

/// Physical attributes of one SPI transaction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SpiWireConfig {
    pub mode: u8,
    pub bits_per_word: u8,
    pub max_speed_hz: u64,
    pub command_width: SpiLaneWidth,
    pub address_width: SpiLaneWidth,
    pub data_width: SpiLaneWidth,
    pub rate: SpiTransferRate,
    pub dummy_cycles: u16,
    pub lsb_first: bool,
}

impl Default for SpiWireConfig {
    fn default() -> Self {
        Self {
            mode: 0,
            bits_per_word: 8,
            max_speed_hz: 0,
            command_width: SpiLaneWidth::Single,
            address_width: SpiLaneWidth::Single,
            data_width: SpiLaneWidth::Single,
            rate: SpiTransferRate::Str,
            dummy_cycles: 0,
            lsb_first: false,
        }
    }
}

impl fmt::Display for BusType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spi => formatter.write_str("spi"),
            Self::I2c => formatter.write_str("i2c"),
            Self::Gpio => formatter.write_str("gpio"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterSnapshot {
    pub name: String,
    pub address: u64,
    pub width_bits: u8,
    pub access: RegisterAccessType,
    pub value: u64,
    pub reset_value: u64,
    pub description: String,
    pub bitfields: Vec<RegisterBitFieldSnapshot>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterBitFieldSnapshot {
    pub name: String,
    pub lsb: u8,
    pub width: u8,
    pub access: RegisterAccessType,
    pub description: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegisterAccessType {
    Ro,
    Wo,
    Rw,
}

impl fmt::Display for RegisterAccessType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ro => formatter.write_str("ro"),
            Self::Wo => formatter.write_str("wo"),
            Self::Rw => formatter.write_str("rw"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegisterOperation {
    Read,
    Write,
}

impl fmt::Display for RegisterOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read => formatter.write_str("read"),
            Self::Write => formatter.write_str("write"),
        }
    }
}

/// Register metadata attached to a normalized device transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisterTrace {
    pub name: Option<String>,
    pub address: u64,
    pub access_type: Option<RegisterAccessType>,
    pub operation: RegisterOperation,
    pub old_value: Option<u64>,
    pub new_value: Option<u64>,
}

/// Successful device response and optional domain metadata.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceTransfer {
    pub response: Vec<u8>,
    pub register: Option<RegisterTrace>,
    pub events: Vec<DeviceEvent>,
}

impl DeviceTransfer {
    #[must_use]
    pub fn response(response: Vec<u8>) -> Self {
        Self {
            response,
            register: None,
            events: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegisterErrorCode {
    UnknownAddress,
    ReadNotAllowed,
    WriteNotAllowed,
    ValueOverflow,
    Internal,
}

impl fmt::Display for RegisterErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownAddress => formatter.write_str("register_unknown_address"),
            Self::ReadNotAllowed => formatter.write_str("register_read_not_allowed"),
            Self::WriteNotAllowed => formatter.write_str("register_write_not_allowed"),
            Self::ValueOverflow => formatter.write_str("register_value_overflow"),
            Self::Internal => formatter.write_str("register_internal"),
        }
    }
}

/// Structured register failure propagated through the generic device boundary.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("{message}")]
pub struct RegisterFailure {
    pub code: RegisterErrorCode,
    pub trace: RegisterTrace,
    pub message: String,
}

/// Backend-independent interface implemented by virtual devices.
pub trait Device: Send + Sync {
    fn id(&self) -> &str;
    fn bus_type(&self) -> BusType;

    /// Executes one bus transaction against the device.
    ///
    /// # Errors
    ///
    /// Returns a device error when the request is empty, malformed, or uses an
    /// unsupported command.
    fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError>;

    /// Executes a configured SPI transfer.
    ///
    /// # Errors
    /// Returns a device error when the request cannot be executed.
    fn transfer_spi(
        &self,
        request: &[u8],
        rx_length: usize,
        wire: SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError>;

    /// Executes an atomic sequence of addressed I2C messages.
    ///
    /// Read messages use `read_length`; write messages use `data`. The returned
    /// vector contains one entry per read message in request order.
    ///
    /// # Errors
    /// Returns a device error when the message sequence is malformed or the
    /// device rejects a register access.
    fn transfer_i2c(&self, _messages: &[I2cMessage]) -> Result<Vec<Vec<u8>>, DeviceError> {
        Err(DeviceError::InvalidRequest(format!(
            "device '{}' does not support I2C transfers",
            self.id()
        )))
    }

    /// Exchanges host-driven GPIO levels for the device's current output
    /// levels. Vectors are indexed by GPIO line offset.
    ///
    /// # Errors
    /// Returns a device error when the device is not a GPIO bank or the line
    /// vector does not match its declared width.
    fn exchange_gpio(&self, _host_values: &[bool]) -> Result<Vec<bool>, DeviceError> {
        Err(DeviceError::InvalidRequest(format!(
            "device '{}' does not support GPIO exchange",
            self.id()
        )))
    }

    /// Returns declarative GPIO line metadata in offset order.
    ///
    /// # Errors
    /// Returns a device error when GPIO metadata cannot be inspected.
    fn gpio_lines(&self) -> Result<Vec<GpioLineSnapshot>, DeviceError> {
        Ok(Vec::new())
    }

    /// Applies due simulator events without issuing a bus transaction.
    ///
    /// # Errors
    ///
    /// Returns a device error if pending effects cannot be applied.
    fn run_due_events(&self) -> Result<Vec<DeviceEvent>, DeviceError> {
        Ok(Vec::new())
    }

    /// Restores device runtime state and cancels pending operations.
    ///
    /// # Errors
    ///
    /// Returns a device error if runtime state cannot be reset safely.
    fn reset(&self) -> Result<Vec<DeviceEvent>, DeviceError> {
        Ok(Vec::new())
    }

    /// Reads a device register through the public runtime inspection API.
    ///
    /// # Errors
    /// Returns an error when the register is unavailable.
    fn read_register(&self, name: &str) -> Result<u64, DeviceError> {
        Err(DeviceError::InvalidRequest(format!(
            "device '{}' does not expose register '{name}'",
            self.id()
        )))
    }

    /// Writes a device register through the public runtime control API.
    ///
    /// # Errors
    /// Returns an error when the register is unavailable, read-only, or the
    /// value does not fit its declared width.
    fn write_register(&self, address: u64, _value: u64) -> Result<RegisterTrace, DeviceError> {
        Err(DeviceError::InvalidRequest(format!(
            "device '{}' does not expose writable register at 0x{address:X}",
            self.id()
        )))
    }

    /// Returns the current state-machine state, when present.
    ///
    /// # Errors
    /// Returns an error when device runtime state cannot be inspected.
    fn current_state(&self) -> Result<Option<String>, DeviceError> {
        Ok(None)
    }

    /// Enables or disables one declarative fault. Returns whether it was found.
    ///
    /// # Errors
    /// Returns an error when fault runtime state cannot be updated.
    fn set_fault_enabled(&self, _fault_id: &str, _enabled: bool) -> Result<bool, DeviceError> {
        Ok(false)
    }

    /// Returns the next scheduled device deadline in simulator time.
    ///
    /// # Errors
    /// Returns an error when scheduler state cannot be inspected.
    fn next_event_deadline_ns(&self) -> Result<Option<u64>, DeviceError> {
        Ok(None)
    }

    /// Lists current register snapshots through runtime inspection.
    ///
    /// # Errors
    /// Returns an error when register state cannot be inspected.
    fn registers(&self) -> Result<Vec<RegisterSnapshot>, DeviceError> {
        Ok(Vec::new())
    }

    /// Lists current declarative fault snapshots.
    ///
    /// # Errors
    /// Returns an error when fault state cannot be inspected.
    fn faults(&self) -> Result<Vec<crate::fault::FaultSnapshot>, DeviceError> {
        Ok(Vec::new())
    }

    /// Returns this device's current virtual time.
    fn virtual_time_ns(&self) -> u64 {
        0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimingErrorCode {
    DeviceBusy,
    DeadlineOverflow,
    Scheduler,
}

impl fmt::Display for TimingErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DeviceBusy => formatter.write_str("device_busy"),
            Self::DeadlineOverflow => formatter.write_str("timing_deadline_overflow"),
            Self::Scheduler => formatter.write_str("timing_scheduler_error"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("{message}")]
pub struct TimingFailure {
    pub code: TimingErrorCode,
    pub command: String,
    pub now_ns: u64,
    pub deadline_ns: Option<u64>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateErrorCode {
    InvalidEvent,
    GuardRejected,
    CommandRejected,
    ActionFailed,
    Internal,
}

impl fmt::Display for StateErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEvent => formatter.write_str("state_invalid_event"),
            Self::GuardRejected => formatter.write_str("state_guard_rejected"),
            Self::CommandRejected => formatter.write_str("state_command_rejected"),
            Self::ActionFailed => formatter.write_str("state_action_failed"),
            Self::Internal => formatter.write_str("state_internal"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("{message}")]
pub struct StateFailure {
    pub code: StateErrorCode,
    pub state: String,
    pub event: Option<String>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FaultErrorCode {
    Timeout,
    ReturnError,
    Dropped,
    ActionFailed,
}

impl fmt::Display for FaultErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Timeout => "fault_timeout",
            Self::ReturnError => "fault_return_error",
            Self::Dropped => "fault_dropped",
            Self::ActionFailed => "fault_action_failed",
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
#[error("{message}")]
pub struct FaultFailure {
    pub code: FaultErrorCode,
    pub fault_id: String,
    pub command: String,
    pub duration_ns: Option<u64>,
    pub trigger: &'static str,
    pub trigger_count: u64,
    pub action: &'static str,
    pub virtual_time_ns: u64,
    pub message: String,
}

/// Errors produced while routing or executing a device transaction.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DeviceError {
    #[error("device '{0}' was not found")]
    NotFound(String),

    #[error("SPI request is empty")]
    EmptyRequest,

    #[error("unknown SPI opcode 0x{0:02X}")]
    UnknownOpcode(u8),

    #[error("invalid device request: {0}")]
    InvalidRequest(String),

    #[error(transparent)]
    Register(#[from] RegisterFailure),

    #[error(transparent)]
    Timing(#[from] TimingFailure),

    #[error(transparent)]
    State(#[from] StateFailure),

    #[error(transparent)]
    Fault(Box<FaultFailure>),
}

impl DeviceError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "device_not_found",
            Self::EmptyRequest | Self::InvalidRequest(_) => "invalid_request",
            Self::UnknownOpcode(_) => "unknown_opcode",
            Self::Register(failure) => match failure.code {
                RegisterErrorCode::UnknownAddress => "register_unknown_address",
                RegisterErrorCode::ReadNotAllowed => "register_read_not_allowed",
                RegisterErrorCode::WriteNotAllowed => "register_write_not_allowed",
                RegisterErrorCode::ValueOverflow => "register_value_overflow",
                RegisterErrorCode::Internal => "register_internal",
            },
            Self::Timing(failure) => match failure.code {
                TimingErrorCode::DeviceBusy => "device_busy",
                TimingErrorCode::DeadlineOverflow | TimingErrorCode::Scheduler => "timing_error",
            },
            Self::State(failure) => match failure.code {
                StateErrorCode::InvalidEvent => "state_invalid_event",
                StateErrorCode::GuardRejected => "state_guard_rejected",
                StateErrorCode::CommandRejected => "state_command_rejected",
                StateErrorCode::ActionFailed | StateErrorCode::Internal => "state_action_failed",
            },
            Self::Fault(failure) => match failure.code {
                FaultErrorCode::Timeout => "fault_timeout",
                FaultErrorCode::ReturnError => "fault_return_error",
                FaultErrorCode::Dropped => "fault_dropped",
                FaultErrorCode::ActionFailed => "fault_action_failed",
            },
        }
    }
}
