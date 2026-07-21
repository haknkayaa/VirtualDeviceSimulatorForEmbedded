//! Declarative, schema-validated VDS4E device models.

use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use vds_core::device::{
    BusType, Device, DeviceError, DeviceTransfer, RegisterAccessType, RegisterErrorCode,
    RegisterFailure, RegisterOperation, RegisterTrace, TimingErrorCode, TimingFailure,
};
use vds_core::{
    clock::{RealTimeClock, SimulatorClock},
    event::{DeviceEvent, EventScheduler, SchedulerError},
};
use vds_registers::{AccessType, RegisterDefinition, RegisterEngine, RegisterError};

const DEVICE_MODEL_SCHEMA: &str = include_str!("../../../schemas/device-model.schema.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceModel {
    pub schema_version: u32,
    pub device: DeviceDefinition,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceDefinition {
    pub id: String,
    pub name: String,
    pub bus: String,
    pub model: String,
    pub commands: Vec<SpiCommandDefinition>,
    #[serde(default)]
    pub registers: Vec<RegisterDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy: Option<BusyDefinition>,
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
    pub timing: Option<CommandTimingDefinition>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CommandTimingDefinition {
    pub latency_us: u64,
    #[serde(default)]
    pub busy_during_operation: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpiCommandOperation {
    RegisterRead,
    RegisterWrite,
}

impl DeviceModel {
    /// Loads and validates a YAML device model.
    ///
    /// # Errors
    ///
    /// Returns an error for unreadable files, malformed YAML, schema violations,
    /// or duplicate command opcodes.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, ModelError> {
        let path = path.as_ref();
        let yaml = fs::read_to_string(path).map_err(|source| ModelError::Read {
            path: path.display().to_string(),
            source,
        })?;
        Self::from_yaml(&yaml)
    }

    /// Parses and validates YAML model content.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed YAML, schema violations, or duplicate
    /// command opcodes.
    pub fn from_yaml(yaml: &str) -> Result<Self, ModelError> {
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml)?;
        let instance = serde_json::to_value(yaml_value)?;
        let schema: serde_json::Value = serde_json::from_str(DEVICE_MODEL_SCHEMA)
            .map_err(|error| ModelError::InvalidEmbeddedSchema(error.to_string()))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| ModelError::InvalidEmbeddedSchema(error.to_string()))?;
        let errors = validator
            .iter_errors(&instance)
            .map(|error| format!("- {}: {}", error.instance_path, error))
            .collect::<Vec<_>>();
        if !errors.is_empty() {
            return Err(ModelError::Validation(errors.join("\n")));
        }

        let model: Self = serde_json::from_value(instance)?;
        let mut seen = HashMap::new();
        for command in &model.device.commands {
            if let Some(previous) = seen.insert(command.opcode, &command.name) {
                return Err(ModelError::DuplicateOpcode {
                    opcode: command.opcode,
                    first: previous.clone(),
                    second: command.name.clone(),
                });
            }
            match (
                command.response.as_ref(),
                command.operation,
                command.address_bytes,
            ) {
                (Some(_), None, None) | (None, Some(_), Some(1..=8)) => {}
                _ => {
                    return Err(ModelError::InvalidCommand {
                        name: command.name.clone(),
                        reason: "define either response, or operation with address_bytes 1..=8"
                            .to_owned(),
                    });
                }
            }
            if command.timing.is_some()
                && command.operation != Some(SpiCommandOperation::RegisterWrite)
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "timing v1 is supported only for register_write".to_owned(),
                });
            }
            if command
                .timing
                .is_some_and(|timing| timing.busy_during_operation)
                && model.device.busy.is_none()
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "busy_during_operation requires device.busy".to_owned(),
                });
            }
        }
        Ok(model)
    }

    /// Builds a statically linked generic SPI device from this model.
    ///
    /// # Errors
    ///
    /// Returns an error if the model is not a generic SPI command device.
    pub fn into_spi_device(self) -> Result<GenericSpiDevice, ModelError> {
        self.into_spi_device_with_clock(Arc::new(RealTimeClock::new()))
    }

    /// Builds a device using an injected simulator clock.
    ///
    /// Manual clocks make timing tests deterministic without sleeping.
    ///
    /// # Errors
    ///
    /// Returns an error if the model or busy-register binding is invalid.
    pub fn into_spi_device_with_clock(
        self,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<GenericSpiDevice, ModelError> {
        if self.device.bus != "spi" || self.device.model != "generic-spi-command" {
            return Err(ModelError::UnsupportedModel {
                bus: self.device.bus,
                model: self.device.model,
            });
        }

        let commands = self
            .device
            .commands
            .into_iter()
            .map(|command| {
                let behavior = match (command.response, command.operation, command.address_bytes) {
                    (Some(response), None, None) => SpiCommand::FixedResponse(response),
                    (None, Some(SpiCommandOperation::RegisterRead), Some(address_bytes)) => {
                        SpiCommand::RegisterRead { address_bytes }
                    }
                    (None, Some(SpiCommandOperation::RegisterWrite), Some(address_bytes)) => {
                        SpiCommand::RegisterWrite {
                            name: command.name,
                            address_bytes,
                            timing: command.timing,
                        }
                    }
                    _ => unreachable!("commands are validated while parsing"),
                };
                (command.opcode, behavior)
            })
            .collect();
        let registers = RegisterEngine::new(self.device.registers)?;
        if let Some(busy) = self.device.busy {
            let metadata = registers.metadata(busy.register_address)?;
            if busy.mask == 0
                || (metadata.width_bits < 64 && busy.mask >= (1_u64 << metadata.width_bits))
                || metadata.access == AccessType::Wo
            {
                return Err(ModelError::InvalidBusyBinding {
                    address: busy.register_address,
                    mask: busy.mask,
                });
            }
        }
        Ok(GenericSpiDevice {
            id: self.device.id,
            commands,
            clock,
            busy_binding: self.device.busy,
            state: Mutex::new(DeviceState {
                registers,
                scheduler: EventScheduler::new(),
                busy: false,
            }),
        })
    }
}

/// Static generic SPI command implementation backed by declarative responses.
pub struct GenericSpiDevice {
    id: String,
    commands: HashMap<u8, SpiCommand>,
    clock: Arc<dyn SimulatorClock>,
    busy_binding: Option<BusyDefinition>,
    state: Mutex<DeviceState>,
}

struct DeviceState {
    registers: RegisterEngine,
    scheduler: EventScheduler<PendingOperation>,
    busy: bool,
}

enum PendingOperation {
    RegisterWrite {
        command: String,
        address: u64,
        value: u64,
        started_at_ns: u64,
        scheduled_duration_ns: u64,
        busy_during_operation: bool,
    },
}

enum SpiCommand {
    FixedResponse(Vec<u8>),
    RegisterRead {
        address_bytes: u8,
    },
    RegisterWrite {
        name: String,
        address_bytes: u8,
        timing: Option<CommandTimingDefinition>,
    },
}

impl Device for GenericSpiDevice {
    fn id(&self) -> &str {
        &self.id
    }

    fn bus_type(&self) -> BusType {
        BusType::Spi
    }

    fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        let opcode = request.first().copied().ok_or(DeviceError::EmptyRequest)?;
        let command = self
            .commands
            .get(&opcode)
            .ok_or(DeviceError::UnknownOpcode(opcode))?;
        let mut state = self.lock_state()?;
        let mut events = self.apply_due_events(&mut state)?;
        match command {
            SpiCommand::FixedResponse(response) => Ok(DeviceTransfer {
                response: response.clone(),
                register: None,
                events,
            }),
            SpiCommand::RegisterRead { address_bytes } => {
                Self::read_register(&state.registers, request, *address_bytes, events)
            }
            SpiCommand::RegisterWrite {
                name,
                address_bytes,
                timing,
            } => self.write_register(
                &mut state,
                request,
                name,
                *address_bytes,
                *timing,
                &mut events,
            ),
        }
    }

    fn run_due_events(&self) -> Result<Vec<DeviceEvent>, DeviceError> {
        let mut state = self.lock_state()?;
        self.apply_due_events(&mut state)
    }

    fn reset(&self) -> Result<(), DeviceError> {
        let mut state = self.lock_state()?;
        state.scheduler.clear();
        state.registers.reset();
        state.busy = false;
        Ok(())
    }
}

impl GenericSpiDevice {
    fn read_register(
        engine: &RegisterEngine,
        request: &[u8],
        address_bytes: u8,
        events: Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let expected = 1 + usize::from(address_bytes);
        if request.len() != expected {
            return Err(DeviceError::InvalidRequest(format!(
                "register read expects {expected} bytes, received {}",
                request.len()
            )));
        }
        let address = decode_unsigned(&request[1..]);
        let read = engine
            .read(address)
            .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))?;
        let value_bytes = usize::from(read.register.width_bits).div_ceil(8);
        let response = encode_unsigned(read.value, value_bytes);
        Ok(DeviceTransfer {
            response,
            register: Some(RegisterTrace {
                name: Some(read.register.name),
                address,
                access_type: Some(map_access(read.register.access)),
                operation: RegisterOperation::Read,
                old_value: Some(read.value),
                new_value: Some(read.value),
            }),
            events,
        })
    }

    fn write_register(
        &self,
        state: &mut DeviceState,
        request: &[u8],
        command_name: &str,
        address_bytes: u8,
        timing: Option<CommandTimingDefinition>,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let address_end = 1 + usize::from(address_bytes);
        if request.len() < address_end {
            return Err(DeviceError::InvalidRequest(format!(
                "register write requires {address_end} address bytes including opcode"
            )));
        }
        let address = decode_unsigned(&request[1..address_end]);
        let metadata = state
            .registers
            .metadata(address)
            .map_err(|error| map_register_error(&error, RegisterOperation::Write, None))?;
        let value_bytes = usize::from(metadata.width_bits).div_ceil(8);
        let expected = address_end + value_bytes;
        if request.len() != expected {
            return Err(DeviceError::InvalidRequest(format!(
                "register '{}' write expects {expected} bytes, received {}",
                metadata.name,
                request.len()
            )));
        }
        let value = decode_unsigned(&request[address_end..]);
        state
            .registers
            .validate_write(address, value)
            .map_err(|error| map_register_error(&error, RegisterOperation::Write, Some(value)))?;

        if let Some(timing) = timing {
            return self.start_delayed_write(state, command_name, address, value, timing, events);
        }

        let write = state
            .registers
            .write(address, value)
            .map_err(|error| map_register_error(&error, RegisterOperation::Write, Some(value)))?;
        Ok(DeviceTransfer {
            response: Vec::new(),
            register: Some(RegisterTrace {
                name: Some(write.register.name),
                address,
                access_type: Some(map_access(write.register.access)),
                operation: RegisterOperation::Write,
                old_value: Some(write.old_value),
                new_value: Some(write.new_value),
            }),
            events: std::mem::take(events),
        })
    }

    fn start_delayed_write(
        &self,
        state: &mut DeviceState,
        command_name: &str,
        address: u64,
        value: u64,
        timing: CommandTimingDefinition,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let now_ns = self.clock.now_ns();
        if state.busy {
            return Err(DeviceError::Timing(TimingFailure {
                code: TimingErrorCode::DeviceBusy,
                command: command_name.to_owned(),
                now_ns,
                deadline_ns: None,
                message: format!("device '{}' is busy", self.id),
            }));
        }
        let scheduled_duration_ns = timing.latency_us.checked_mul(1_000).ok_or_else(|| {
            timing_failure(
                TimingErrorCode::DeadlineOverflow,
                command_name,
                now_ns,
                None,
                "command latency overflows nanoseconds",
            )
        })?;
        let deadline_ns = now_ns.checked_add(scheduled_duration_ns).ok_or_else(|| {
            timing_failure(
                TimingErrorCode::DeadlineOverflow,
                command_name,
                now_ns,
                None,
                "command deadline overflows virtual time",
            )
        })?;
        let old_value = state.registers.read(address).ok().map(|read| read.value);
        let pending = PendingOperation::RegisterWrite {
            command: command_name.to_owned(),
            address,
            value,
            started_at_ns: now_ns,
            scheduled_duration_ns,
            busy_during_operation: timing.busy_during_operation,
        };
        let event_id = state
            .scheduler
            .schedule_at(deadline_ns, pending)
            .map_err(|error| map_scheduler_error(error, command_name, now_ns, deadline_ns))?;

        if timing.busy_during_operation {
            if let Err(error) = self.set_busy(state, true) {
                state.scheduler.cancel(event_id);
                return Err(error);
            }
        }
        events.push(DeviceEvent::OperationStarted {
            command: command_name.to_owned(),
            scheduled_duration_ns,
            started_at_ns: now_ns,
            busy: state.busy,
        });

        if deadline_ns <= now_ns {
            events.extend(self.apply_due_events(state)?);
        }

        Ok(DeviceTransfer {
            response: Vec::new(),
            register: Some(RegisterTrace {
                name: Some(
                    state
                        .registers
                        .metadata(address)
                        .map_err(|error| {
                            map_register_error(&error, RegisterOperation::Write, Some(value))
                        })?
                        .name,
                ),
                address,
                access_type: Some(map_access(
                    state
                        .registers
                        .metadata(address)
                        .map_err(|error| {
                            map_register_error(&error, RegisterOperation::Write, Some(value))
                        })?
                        .access,
                )),
                operation: RegisterOperation::Write,
                old_value,
                new_value: Some(value),
            }),
            events: std::mem::take(events),
        })
    }

    fn apply_due_events(&self, state: &mut DeviceState) -> Result<Vec<DeviceEvent>, DeviceError> {
        let now_ns = self.clock.now_ns();
        let due = state.scheduler.drain_due(now_ns);
        let mut emitted = Vec::with_capacity(due.len());
        for event in due {
            match event.payload {
                PendingOperation::RegisterWrite {
                    command,
                    address,
                    value,
                    started_at_ns,
                    scheduled_duration_ns,
                    busy_during_operation,
                } => {
                    let write = state.registers.write(address, value).map_err(|error| {
                        map_register_error(&error, RegisterOperation::Write, Some(value))
                    })?;
                    if busy_during_operation {
                        self.set_busy(state, false)?;
                    }
                    emitted.push(DeviceEvent::OperationCompleted {
                        command,
                        scheduled_duration_ns,
                        started_at_ns,
                        completed_at_ns: now_ns,
                        busy: state.busy,
                        register: RegisterTrace {
                            name: Some(write.register.name),
                            address,
                            access_type: Some(map_access(write.register.access)),
                            operation: RegisterOperation::Write,
                            old_value: Some(write.old_value),
                            new_value: Some(write.new_value),
                        },
                        result: "success",
                    });
                }
            }
        }
        Ok(emitted)
    }

    fn set_busy(&self, state: &mut DeviceState, busy: bool) -> Result<(), DeviceError> {
        let Some(binding) = self.busy_binding else {
            state.busy = busy;
            return Ok(());
        };
        let current = state
            .registers
            .read(binding.register_address)
            .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))?
            .value;
        let updated = if busy {
            current | binding.mask
        } else {
            current & !binding.mask
        };
        state
            .registers
            .write_internal(binding.register_address, updated)
            .map_err(|error| map_register_error(&error, RegisterOperation::Write, Some(updated)))?;
        state.busy = busy;
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, DeviceState>, DeviceError> {
        self.state
            .lock()
            .map_err(|_| DeviceError::InvalidRequest("device state lock is poisoned".to_owned()))
    }
}

fn timing_failure(
    code: TimingErrorCode,
    command: &str,
    now_ns: u64,
    deadline_ns: Option<u64>,
    message: &str,
) -> DeviceError {
    DeviceError::Timing(TimingFailure {
        code,
        command: command.to_owned(),
        now_ns,
        deadline_ns,
        message: message.to_owned(),
    })
}

fn map_scheduler_error(
    error: SchedulerError,
    command: &str,
    now_ns: u64,
    deadline_ns: u64,
) -> DeviceError {
    timing_failure(
        TimingErrorCode::Scheduler,
        command,
        now_ns,
        Some(deadline_ns),
        &error.to_string(),
    )
}

fn decode_unsigned(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte))
}

fn encode_unsigned(value: u64, byte_count: usize) -> Vec<u8> {
    value.to_be_bytes()[8 - byte_count..].to_vec()
}

fn map_access(access: AccessType) -> RegisterAccessType {
    match access {
        AccessType::Ro => RegisterAccessType::Ro,
        AccessType::Wo => RegisterAccessType::Wo,
        AccessType::Rw => RegisterAccessType::Rw,
    }
}

fn map_register_error(
    error: &RegisterError,
    operation: RegisterOperation,
    requested_value: Option<u64>,
) -> DeviceError {
    let (code, name, address, access_type, old_value, new_value) = match &error {
        RegisterError::UnknownAddress { address } => (
            RegisterErrorCode::UnknownAddress,
            None,
            *address,
            None,
            None,
            requested_value,
        ),
        RegisterError::ReadNotAllowed {
            name,
            address,
            access,
            current_value,
        } => (
            RegisterErrorCode::ReadNotAllowed,
            Some(name.clone()),
            *address,
            Some(map_access(*access)),
            Some(*current_value),
            Some(*current_value),
        ),
        RegisterError::WriteNotAllowed {
            name,
            address,
            access,
            current_value,
            requested_value,
        } => (
            RegisterErrorCode::WriteNotAllowed,
            Some(name.clone()),
            *address,
            Some(map_access(*access)),
            Some(*current_value),
            Some(*requested_value),
        ),
        RegisterError::ValueOverflow {
            name,
            address,
            access,
            current_value,
            value,
            ..
        } => (
            RegisterErrorCode::ValueOverflow,
            Some(name.clone()),
            *address,
            Some(map_access(*access)),
            Some(*current_value),
            Some(*value),
        ),
        RegisterError::DuplicateAddress { address, .. }
        | RegisterError::InvalidWidth { address, .. }
        | RegisterError::ResetValueOverflow { address, .. } => (
            RegisterErrorCode::Internal,
            None,
            *address,
            None,
            None,
            requested_value,
        ),
    };
    DeviceError::Register(RegisterFailure {
        code,
        trace: RegisterTrace {
            name,
            address,
            access_type,
            operation,
            old_value,
            new_value,
        },
        message: error.to_string(),
    })
}

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

    #[error("invalid BUSY register binding at 0x{address:X} with mask 0x{mask:X}")]
    InvalidBusyBinding { address: u64, mask: u64 },

    #[error(transparent)]
    Register(#[from] RegisterError),
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use vds_core::{
        clock::ManualClock,
        device::{Device, DeviceError, TimingErrorCode},
        event::DeviceEvent,
    };

    use super::{DeviceModel, ModelError};

    const MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Example SPI Flash
  bus: spi
  model: generic-spi-command
  commands:
    - name: READ_ID
      opcode: 0x9F
      response: [0xEF, 0x40, 0x18]
";

    const TIMED_MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Timed SPI Device
  bus: spi
  model: generic-spi-command
  commands:
    - name: READ_ID
      opcode: 0x9F
      response: [0xEF, 0x40, 0x18]
    - name: READ_REGISTER
      opcode: 0x03
      operation: register_read
      address_bytes: 1
    - name: WRITE_REGISTER
      opcode: 0x02
      operation: register_write
      address_bytes: 1
      timing:
        latency_us: 10000
        busy_during_operation: true
  busy:
    register_address: 0x00
    mask: 0x01
  registers:
    - name: STATUS
      address: 0x00
      width_bits: 8
      reset_value: 0x00
      access: ro
    - name: CONTROL
      address: 0x01
      width_bits: 8
      reset_value: 0x12
      access: rw
";

    #[test]
    fn executes_read_id() {
        let device = DeviceModel::from_yaml(MODEL)
            .expect("model should parse")
            .into_spi_device()
            .expect("SPI model should build");

        assert_eq!(
            device
                .transfer(&[0x9f])
                .expect("READ_ID should work")
                .response,
            vec![0xef, 0x40, 0x18]
        );
    }

    #[test]
    fn rejects_unknown_opcode() {
        let device = DeviceModel::from_yaml(MODEL)
            .expect("model should parse")
            .into_spi_device()
            .expect("SPI model should build");

        assert_eq!(
            device.transfer(&[0x00]),
            Err(DeviceError::UnknownOpcode(0x00))
        );
    }

    #[test]
    fn rejects_duplicate_opcodes() {
        let duplicate = MODEL.replace(
            "      response: [0xEF, 0x40, 0x18]",
            "      response: [0xEF, 0x40, 0x18]\n    - name: DUPLICATE\n      opcode: 0x9F\n      response: []",
        );

        assert!(matches!(
            DeviceModel::from_yaml(&duplicate),
            Err(ModelError::DuplicateOpcode { opcode: 0x9f, .. })
        ));
    }

    #[test]
    fn parses_command_timing_and_busy_binding() {
        let model = DeviceModel::from_yaml(TIMED_MODEL).expect("timed model should parse");

        assert_eq!(model.device.busy.expect("busy binding").mask, 1);
        assert_eq!(
            model.device.commands[2]
                .timing
                .expect("write timing")
                .latency_us,
            10_000
        );
    }

    #[test]
    fn delayed_write_observes_busy_lifecycle() {
        let clock = Arc::new(ManualClock::default());
        let device = DeviceModel::from_yaml(TIMED_MODEL)
            .expect("model should parse")
            .into_spi_device_with_clock(clock.clone())
            .expect("device should build");

        let accepted = device
            .transfer(&[0x02, 0x01, 0x5a])
            .expect("write should be accepted");
        assert!(accepted.response.is_empty());
        assert!(matches!(
            accepted.events.as_slice(),
            [DeviceEvent::OperationStarted {
                scheduled_duration_ns: 10_000_000,
                busy: true,
                ..
            }]
        ));
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x01]
        );

        clock
            .advance(Duration::from_millis(9))
            .expect("manual time should advance");
        assert_eq!(
            device
                .transfer(&[0x03, 0x01])
                .expect("control should read")
                .response,
            [0x12]
        );

        clock
            .advance(Duration::from_millis(1))
            .expect("manual time should advance");
        let completed = device
            .transfer(&[0x03, 0x01])
            .expect("control should read after completion");
        assert_eq!(completed.response, [0x5a]);
        assert!(matches!(
            completed.events.as_slice(),
            [DeviceEvent::OperationCompleted {
                scheduled_duration_ns: 10_000_000,
                started_at_ns: 0,
                completed_at_ns: 10_000_000,
                busy: false,
                ..
            }]
        ));
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x00]
        );
    }

    #[test]
    fn reset_cancels_pending_operations() {
        let clock = Arc::new(ManualClock::default());
        let device = DeviceModel::from_yaml(TIMED_MODEL)
            .expect("model should parse")
            .into_spi_device_with_clock(clock.clone())
            .expect("device should build");
        device
            .transfer(&[0x02, 0x01, 0x5a])
            .expect("write should be accepted");

        device.reset().expect("reset should succeed");
        clock
            .advance(Duration::from_millis(10))
            .expect("manual time should advance");

        assert!(
            device
                .run_due_events()
                .expect("due events should run")
                .is_empty()
        );
        assert_eq!(
            device
                .transfer(&[0x03, 0x01])
                .expect("control should read")
                .response,
            [0x12]
        );
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x00]
        );
    }

    #[test]
    fn timed_write_is_rejected_while_device_is_busy() {
        let clock = Arc::new(ManualClock::default());
        let device = DeviceModel::from_yaml(TIMED_MODEL)
            .expect("model should parse")
            .into_spi_device_with_clock(clock)
            .expect("device should build");
        device
            .transfer(&[0x02, 0x01, 0x5a])
            .expect("first write should be accepted");

        assert!(matches!(
            device.transfer(&[0x02, 0x01, 0x34]),
            Err(DeviceError::Timing(failure))
                if failure.code == TimingErrorCode::DeviceBusy
        ));
    }
}
