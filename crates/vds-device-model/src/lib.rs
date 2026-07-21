//! Declarative, schema-validated VDS4E device models.

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use vds_core::device::{
    BusType, Device, DeviceError, DeviceTransfer, RegisterAccessType, RegisterErrorCode,
    RegisterFailure, RegisterOperation, RegisterTrace, StateErrorCode, StateFailure,
    TimingErrorCode, TimingFailure,
};
use vds_core::{
    clock::{RealTimeClock, SimulatorClock},
    event::{DeviceEvent, EventId, EventScheduler, SchedulerError},
    state_machine::{
        DelayedEventDefinition, StateDefinition, StateMachine, StateMachineDefinition,
        StateMachineError, TransitionDefinition, TransitionOutcome,
    },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_machine: Option<DeviceStateMachineDefinition>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_states: Vec<String>,
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
            if !command.allowed_states.is_empty() {
                let Some(machine) = &model.device.state_machine else {
                    return Err(ModelError::InvalidCommand {
                        name: command.name.clone(),
                        reason: "allowed_states requires device.state_machine".to_owned(),
                    });
                };
                if let Some(state) = command
                    .allowed_states
                    .iter()
                    .find(|state| !machine.states.contains_key(*state))
                {
                    return Err(ModelError::InvalidCommand {
                        name: command.name.clone(),
                        reason: format!("allowed state '{state}' is not defined"),
                    });
                }
            }
        }
        if let Some(machine) = &model.device.state_machine {
            StateMachine::new(uncompiled_state_machine(machine)?)?;
            for state in machine.states.values() {
                for action in state.entry_actions.iter().chain(&state.exit_actions) {
                    let StateActionDefinition::SetRegister(action) = action;
                    validate_register_reference(&model.device.registers, &action.name)?;
                }
                for transition in &state.transitions {
                    if let Some(StateGuardDefinition::Register(guard)) = &transition.guard {
                        validate_register_reference(&model.device.registers, &guard.name)?;
                    }
                }
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
                let name = command.name;
                let behavior = match (command.response, command.operation, command.address_bytes) {
                    (Some(response), None, None) => SpiCommandBehavior::FixedResponse(response),
                    (None, Some(SpiCommandOperation::RegisterRead), Some(address_bytes)) => {
                        SpiCommandBehavior::RegisterRead { address_bytes }
                    }
                    (None, Some(SpiCommandOperation::RegisterWrite), Some(address_bytes)) => {
                        SpiCommandBehavior::RegisterWrite {
                            address_bytes,
                            timing: command.timing,
                        }
                    }
                    _ => unreachable!("commands are validated while parsing"),
                };
                (
                    command.opcode,
                    SpiCommand {
                        name,
                        allowed_states: command.allowed_states,
                        behavior,
                    },
                )
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
        let state_machine = self
            .device
            .state_machine
            .as_ref()
            .map(|definition| compile_state_machine(definition, &registers))
            .transpose()?;
        let mut state = DeviceState {
            registers,
            scheduler: EventScheduler::new(),
            operation_busy: false,
            state_machine,
            state_delayed_events: Vec::new(),
        };
        initialize_state_machine(&mut state, clock.now_ns())?;
        Ok(GenericSpiDevice {
            id: self.device.id,
            commands,
            clock,
            busy_binding: self.device.busy,
            state: Mutex::new(state),
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
    operation_busy: bool,
    state_machine: Option<StateMachine<DeviceAction, DeviceGuard>>,
    state_delayed_events: Vec<EventId>,
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
    DelayedStateEvent {
        event: String,
    },
}

struct SpiCommand {
    name: String,
    allowed_states: Vec<String>,
    behavior: SpiCommandBehavior,
}

enum SpiCommandBehavior {
    FixedResponse(Vec<u8>),
    RegisterRead {
        address_bytes: u8,
    },
    RegisterWrite {
        address_bytes: u8,
        timing: Option<CommandTimingDefinition>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DeviceAction {
    SetRegister {
        address: u64,
        value: u64,
        mask: Option<u64>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum DeviceGuard {
    RegisterEquals {
        address: u64,
        equals: u64,
        mask: Option<u64>,
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
        Self::validate_command_state(&state, command)?;
        match &command.behavior {
            SpiCommandBehavior::FixedResponse(response) => Ok(DeviceTransfer {
                response: response.clone(),
                register: None,
                events,
            }),
            SpiCommandBehavior::RegisterRead { address_bytes } => {
                Self::read_register(&state.registers, request, *address_bytes, events)
            }
            SpiCommandBehavior::RegisterWrite {
                address_bytes,
                timing,
            } => self.write_register(
                &mut state,
                request,
                &command.name,
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

    fn reset(&self) -> Result<Vec<DeviceEvent>, DeviceError> {
        let mut state = self.lock_state()?;
        state.scheduler.clear();
        state.state_delayed_events.clear();
        state.registers.reset();
        state.operation_busy = false;
        let Some(mut machine) = state.state_machine.take() else {
            return Ok(Vec::new());
        };
        let outcome = machine
            .reset()
            .map_err(|error| map_state_machine_error(&error))?;
        state.state_machine = Some(machine);
        let mut events = Vec::new();
        Self::apply_transition(&mut state, outcome, self.clock.now_ns(), &mut events)?;
        Ok(events)
    }
}

impl GenericSpiDevice {
    /// Returns the current named state when this device has a state machine.
    ///
    /// # Errors
    ///
    /// Returns an error if the synchronized device state is unavailable.
    pub fn current_state(&self) -> Result<Option<String>, DeviceError> {
        let state = self.lock_state()?;
        Ok(state
            .state_machine
            .as_ref()
            .map(|machine| machine.current_state().to_owned()))
    }

    fn validate_command_state(
        state: &DeviceState,
        command: &SpiCommand,
    ) -> Result<(), DeviceError> {
        if command.allowed_states.is_empty() {
            return Ok(());
        }
        let current = state
            .state_machine
            .as_ref()
            .map_or("", StateMachine::current_state);
        if command
            .allowed_states
            .iter()
            .any(|allowed| allowed == current)
        {
            return Ok(());
        }
        Err(DeviceError::State(StateFailure {
            code: StateErrorCode::CommandRejected,
            state: current.to_owned(),
            event: None,
            message: format!(
                "command '{}' is not allowed in state '{}'",
                command.name, current
            ),
        }))
    }

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
        if state.operation_busy {
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

        if let Err(error) = Self::dispatch_state_event(state, "write_started", now_ns, events) {
            state.scheduler.cancel(event_id);
            return Err(error);
        }

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
            busy: state.operation_busy,
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
                        busy: state.operation_busy,
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
                    Self::dispatch_state_event(state, "operation_completed", now_ns, &mut emitted)?;
                }
                PendingOperation::DelayedStateEvent { event: state_event } => {
                    state
                        .state_delayed_events
                        .retain(|event_id| *event_id != event.id);
                    Self::dispatch_state_event(state, &state_event, now_ns, &mut emitted)?;
                }
            }
        }
        Ok(emitted)
    }

    fn set_busy(&self, state: &mut DeviceState, busy: bool) -> Result<(), DeviceError> {
        let Some(binding) = self.busy_binding else {
            state.operation_busy = busy;
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
        state.operation_busy = busy;
        Ok(())
    }

    fn dispatch_state_event(
        state: &mut DeviceState,
        event: &str,
        now_ns: u64,
        emitted: &mut Vec<DeviceEvent>,
    ) -> Result<(), DeviceError> {
        let Some(mut machine) = state.state_machine.take() else {
            return Ok(());
        };
        let outcome = machine
            .dispatch(event, |guard| evaluate_guard(&state.registers, guard))
            .map_err(|error| map_state_machine_error(&error));
        state.state_machine = Some(machine);
        let outcome = outcome?;
        Self::apply_transition(state, outcome, now_ns, emitted)
    }

    fn apply_transition(
        state: &mut DeviceState,
        outcome: TransitionOutcome<DeviceAction>,
        now_ns: u64,
        emitted: &mut Vec<DeviceEvent>,
    ) -> Result<(), DeviceError> {
        for event_id in state.state_delayed_events.drain(..) {
            state.scheduler.cancel(event_id);
        }
        apply_actions(&mut state.registers, &outcome.exit_actions)?;
        apply_actions(&mut state.registers, &outcome.entry_actions)?;
        schedule_state_events(
            &mut state.scheduler,
            &mut state.state_delayed_events,
            &outcome.delayed_events,
            now_ns,
        )?;
        emitted.push(DeviceEvent::StateTransition {
            from_state: outcome.from_state,
            to_state: outcome.to_state,
            trigger: outcome.trigger,
            virtual_time_ns: now_ns,
            result: "success",
        });
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, DeviceState>, DeviceError> {
        self.state
            .lock()
            .map_err(|_| DeviceError::InvalidRequest("device state lock is poisoned".to_owned()))
    }
}

fn uncompiled_state_machine(
    definition: &DeviceStateMachineDefinition,
) -> Result<StateMachineDefinition<StateActionDefinition, StateGuardDefinition>, ModelError> {
    let states = definition
        .states
        .iter()
        .map(|(name, state)| {
            let delayed_events = state
                .delayed_events
                .iter()
                .map(|delayed| {
                    delayed
                        .delay_us
                        .checked_mul(1_000)
                        .map(|delay_ns| DelayedEventDefinition {
                            event: delayed.event.clone(),
                            delay_ns,
                        })
                        .ok_or_else(|| ModelError::InvalidStateMachine {
                            reason: format!(
                                "state '{name}' delayed event '{}' overflows nanoseconds",
                                delayed.event
                            ),
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok((
                name.clone(),
                StateDefinition {
                    entry_actions: state.entry_actions.clone(),
                    exit_actions: state.exit_actions.clone(),
                    transitions: state
                        .transitions
                        .iter()
                        .map(|transition| TransitionDefinition {
                            event: transition.event.clone(),
                            target: transition.target.clone(),
                            guard: transition.guard.clone(),
                        })
                        .collect(),
                    delayed_events,
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>, ModelError>>()?;
    Ok(StateMachineDefinition {
        initial_state: definition.initial_state.clone(),
        states,
    })
}

fn compile_state_machine(
    definition: &DeviceStateMachineDefinition,
    registers: &RegisterEngine,
) -> Result<StateMachine<DeviceAction, DeviceGuard>, ModelError> {
    let uncompiled = uncompiled_state_machine(definition)?;
    let states = uncompiled
        .states
        .into_iter()
        .map(|(name, state)| {
            Ok((
                name,
                StateDefinition {
                    entry_actions: state
                        .entry_actions
                        .iter()
                        .map(|action| compile_action(action, registers))
                        .collect::<Result<Vec<_>, _>>()?,
                    exit_actions: state
                        .exit_actions
                        .iter()
                        .map(|action| compile_action(action, registers))
                        .collect::<Result<Vec<_>, _>>()?,
                    transitions: state
                        .transitions
                        .into_iter()
                        .map(|transition| {
                            Ok(TransitionDefinition {
                                event: transition.event,
                                target: transition.target,
                                guard: transition
                                    .guard
                                    .as_ref()
                                    .map(|guard| compile_guard(guard, registers))
                                    .transpose()?,
                            })
                        })
                        .collect::<Result<Vec<_>, ModelError>>()?,
                    delayed_events: state.delayed_events,
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>, ModelError>>()?;
    StateMachine::new(StateMachineDefinition {
        initial_state: uncompiled.initial_state,
        states,
    })
    .map_err(ModelError::from)
}

fn compile_action(
    action: &StateActionDefinition,
    registers: &RegisterEngine,
) -> Result<DeviceAction, ModelError> {
    match action {
        StateActionDefinition::SetRegister(action) => {
            let metadata = registers.metadata_by_name(&action.name).ok_or_else(|| {
                ModelError::UnknownStateRegister {
                    name: action.name.clone(),
                }
            })?;
            validate_state_value(&action.name, metadata.width_bits, action.value, action.mask)?;
            Ok(DeviceAction::SetRegister {
                address: metadata.address,
                value: action.value,
                mask: action.mask,
            })
        }
    }
}

fn compile_guard(
    guard: &StateGuardDefinition,
    registers: &RegisterEngine,
) -> Result<DeviceGuard, ModelError> {
    match guard {
        StateGuardDefinition::Register(guard) => {
            let metadata = registers.metadata_by_name(&guard.name).ok_or_else(|| {
                ModelError::UnknownStateRegister {
                    name: guard.name.clone(),
                }
            })?;
            validate_state_value(&guard.name, metadata.width_bits, guard.equals, guard.mask)?;
            Ok(DeviceGuard::RegisterEquals {
                address: metadata.address,
                equals: guard.equals,
                mask: guard.mask,
            })
        }
    }
}

fn validate_state_value(
    name: &str,
    width_bits: u8,
    value: u64,
    mask: Option<u64>,
) -> Result<(), ModelError> {
    let maximum = if width_bits == 64 {
        u64::MAX
    } else {
        (1_u64 << width_bits) - 1
    };
    if value > maximum || mask.is_some_and(|mask| mask == 0 || mask > maximum) {
        return Err(ModelError::InvalidStateRegisterValue {
            name: name.to_owned(),
            width_bits,
            value,
            mask,
        });
    }
    Ok(())
}

fn validate_register_reference(
    definitions: &[RegisterDefinition],
    name: &str,
) -> Result<(), ModelError> {
    let count = definitions
        .iter()
        .filter(|definition| definition.name == name)
        .count();
    match count {
        1 => Ok(()),
        0 => Err(ModelError::UnknownStateRegister {
            name: name.to_owned(),
        }),
        _ => Err(ModelError::AmbiguousStateRegister {
            name: name.to_owned(),
        }),
    }
}

fn initialize_state_machine(state: &mut DeviceState, now_ns: u64) -> Result<(), ModelError> {
    let Some(machine) = state.state_machine.as_ref() else {
        return Ok(());
    };
    let activation = machine.current_activation()?;
    apply_actions(&mut state.registers, &activation.entry_actions)
        .map_err(|error| ModelError::StateInitialization(error.to_string()))?;
    schedule_state_events(
        &mut state.scheduler,
        &mut state.state_delayed_events,
        &activation.delayed_events,
        now_ns,
    )
    .map_err(|error| ModelError::StateInitialization(error.to_string()))
}

fn apply_actions(
    registers: &mut RegisterEngine,
    actions: &[DeviceAction],
) -> Result<(), DeviceError> {
    for action in actions {
        match action {
            DeviceAction::SetRegister {
                address,
                value,
                mask,
            } => {
                let current = registers
                    .read_internal(*address)
                    .map_err(|error| state_action_error(&error))?
                    .value;
                let updated = mask.map_or(*value, |mask| (current & !mask) | (value & mask));
                registers
                    .write_internal(*address, updated)
                    .map_err(|error| state_action_error(&error))?;
            }
        }
    }
    Ok(())
}

fn evaluate_guard(registers: &RegisterEngine, guard: &DeviceGuard) -> bool {
    match guard {
        DeviceGuard::RegisterEquals {
            address,
            equals,
            mask,
        } => registers.read_internal(*address).is_ok_and(|read| {
            mask.map_or(read.value == *equals, |mask| {
                read.value & mask == equals & mask
            })
        }),
    }
}

fn schedule_state_events(
    scheduler: &mut EventScheduler<PendingOperation>,
    event_ids: &mut Vec<EventId>,
    events: &[DelayedEventDefinition],
    now_ns: u64,
) -> Result<(), DeviceError> {
    for event in events {
        let deadline_ns = now_ns.checked_add(event.delay_ns).ok_or_else(|| {
            state_failure(
                StateErrorCode::ActionFailed,
                "",
                Some(&event.event),
                "delayed state event deadline overflows virtual time",
            )
        })?;
        let event_id = scheduler
            .schedule_at(
                deadline_ns,
                PendingOperation::DelayedStateEvent {
                    event: event.event.clone(),
                },
            )
            .map_err(|error| {
                state_failure(
                    StateErrorCode::ActionFailed,
                    "",
                    Some(&event.event),
                    &error.to_string(),
                )
            })?;
        event_ids.push(event_id);
    }
    Ok(())
}

fn map_state_machine_error(error: &StateMachineError) -> DeviceError {
    let (code, state, event) = match error {
        StateMachineError::InvalidEvent { state, event } => (
            StateErrorCode::InvalidEvent,
            state.clone(),
            Some(event.clone()),
        ),
        StateMachineError::GuardRejected { state, event } => (
            StateErrorCode::GuardRejected,
            state.clone(),
            Some(event.clone()),
        ),
        StateMachineError::UnknownInitialState { state }
        | StateMachineError::InternalUnknownState { state } => {
            (StateErrorCode::Internal, state.clone(), None)
        }
        StateMachineError::UnknownTransitionTarget { state, event, .. } => {
            (StateErrorCode::Internal, state.clone(), Some(event.clone()))
        }
    };
    DeviceError::State(StateFailure {
        code,
        state,
        event,
        message: error.to_string(),
    })
}

fn state_action_error(error: &RegisterError) -> DeviceError {
    state_failure(StateErrorCode::ActionFailed, "", None, &error.to_string())
}

fn state_failure(
    code: StateErrorCode,
    state: &str,
    event: Option<&str>,
    message: &str,
) -> DeviceError {
    DeviceError::State(StateFailure {
        code,
        state: state.to_owned(),
        event: event.map(str::to_owned),
        message: message.to_owned(),
    })
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

    #[error(transparent)]
    StateMachine(#[from] StateMachineError),

    #[error(transparent)]
    Register(#[from] RegisterError),
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use vds_core::{
        clock::ManualClock,
        device::{Device, DeviceError, StateErrorCode, TimingErrorCode},
        event::DeviceEvent,
    };

    use super::{DeviceModel, GenericSpiDevice, ModelError};

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

    const STATE_MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Stateful SPI Device
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
      allowed_states: [ready]
      timing:
        latency_us: 10000
        busy_during_operation: true
  busy:
    register_address: 0x00
    mask: 0x01
  state_machine:
    initial_state: resetting
    states:
      resetting:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x01
        transitions:
          - event: reset_complete
            target: ready
        delayed_events:
          - event: reset_complete
            delay_us: 5000
      ready:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x00
        exit_actions:
          - set_register:
              name: CONTROL
              value: 0x34
        transitions:
          - event: write_started
            target: busy
            guard:
              register:
                name: STATUS
                mask: 0x01
                equals: 0x00
      busy:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x01
        exit_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x00
        transitions:
          - event: operation_completed
            target: ready
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

    #[test]
    fn state_machine_initial_state_and_targets_are_validated() {
        let model = DeviceModel::from_yaml(STATE_MODEL).expect("state model should parse");
        assert_eq!(
            model
                .device
                .state_machine
                .expect("state machine should exist")
                .initial_state,
            "resetting"
        );

        let unknown_initial =
            STATE_MODEL.replace("initial_state: resetting", "initial_state: missing");
        assert!(matches!(
            DeviceModel::from_yaml(&unknown_initial),
            Err(ModelError::StateMachine(
                vds_core::state_machine::StateMachineError::UnknownInitialState { .. }
            ))
        ));

        let unknown_target = STATE_MODEL.replacen("target: ready", "target: missing", 1);
        assert!(matches!(
            DeviceModel::from_yaml(&unknown_target),
            Err(ModelError::StateMachine(
                vds_core::state_machine::StateMachineError::UnknownTransitionTarget { .. }
            ))
        ));
    }

    #[test]
    fn delayed_transition_and_state_actions_execute_at_exact_deadline() {
        let clock = Arc::new(ManualClock::default());
        let device = DeviceModel::from_yaml(STATE_MODEL)
            .expect("model should parse")
            .into_spi_device_with_clock(clock.clone())
            .expect("device should build");

        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("resetting")
        );
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x01]
        );

        clock
            .advance(Duration::from_millis(4))
            .expect("manual time should advance");
        assert!(
            device
                .run_due_events()
                .expect("events should run")
                .is_empty()
        );
        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("resetting")
        );

        clock
            .advance(Duration::from_millis(1))
            .expect("manual time should advance");
        let events = device.run_due_events().expect("events should run");
        assert!(matches!(
            events.as_slice(),
            [DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                virtual_time_ns: 5_000_000,
                ..
            }] if from_state == "resetting" && to_state == "ready" && trigger == "reset_complete"
        ));
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x00]
        );

        assert_write_state_lifecycle(&device, &clock);
    }

    fn assert_write_state_lifecycle(device: &GenericSpiDevice, clock: &ManualClock) {
        let accepted = device
            .transfer(&[0x02, 0x01, 0x5a])
            .expect("write should start from ready");
        assert!(accepted.events.iter().any(|event| matches!(
            event,
            DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                ..
            } if from_state == "ready" && to_state == "busy" && trigger == "write_started"
        )));
        assert_eq!(
            device
                .transfer(&[0x03, 0x01])
                .expect("control should read")
                .response,
            [0x34],
            "ready exit action should execute"
        );
        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("busy")
        );

        assert!(matches!(
            device.transfer(&[0x02, 0x01, 0x22]),
            Err(DeviceError::State(failure))
                if failure.code == StateErrorCode::CommandRejected && failure.state == "busy"
        ));

        clock
            .advance(Duration::from_millis(10))
            .expect("manual time should advance");
        let events = device.run_due_events().expect("events should run");
        assert!(events.iter().any(|event| matches!(
            event,
            DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                virtual_time_ns: 15_000_000,
                ..
            } if from_state == "busy" && to_state == "ready" && trigger == "operation_completed"
        )));
        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("ready")
        );
        assert_eq!(
            device
                .transfer(&[0x03, 0x00])
                .expect("status should read")
                .response,
            [0x00],
            "busy exit action should execute"
        );
    }

    #[test]
    fn state_machine_reset_cancels_operations_and_reenters_initial_state() {
        let clock = Arc::new(ManualClock::default());
        let device = DeviceModel::from_yaml(STATE_MODEL)
            .expect("model should parse")
            .into_spi_device_with_clock(clock.clone())
            .expect("device should build");
        clock
            .advance(Duration::from_millis(5))
            .expect("manual time should advance");
        device.run_due_events().expect("reset should complete");
        device
            .transfer(&[0x02, 0x01, 0x5a])
            .expect("write should start");

        let events = device.reset().expect("device reset should succeed");
        assert!(matches!(
            events.as_slice(),
            [DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                ..
            }] if from_state == "busy" && to_state == "resetting" && trigger == "reset"
        ));
        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("resetting")
        );

        clock
            .advance(Duration::from_millis(5))
            .expect("manual time should advance");
        device.run_due_events().expect("reset should complete");
        assert_eq!(
            device
                .current_state()
                .expect("state should read")
                .as_deref(),
            Some("ready")
        );
        clock
            .advance(Duration::from_millis(5))
            .expect("manual time should advance");
        assert!(
            device
                .run_due_events()
                .expect("cancelled write must not complete")
                .is_empty()
        );
        assert_eq!(
            device
                .transfer(&[0x03, 0x01])
                .expect("control should read")
                .response,
            [0x12]
        );
    }
}
