use std::fmt;

use crate::event::DeviceEvent;

/// Bus families supported by the core device interface.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BusType {
    Spi,
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
}
