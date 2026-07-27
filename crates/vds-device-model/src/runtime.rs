use super::{
    Arc, BusType, BusyDefinition, CommandTimingDefinition, Device, DeviceError, DeviceEvent,
    DeviceTransfer, EventId, EventScheduler, FaultAction, FaultContext, FaultEngine,
    FaultErrorCode, FaultFailure, HashMap, MemoryDefinition, Mutex, MutexGuard, RegisterEngine,
    RegisterOperation, RegisterSnapshot, RegisterTrace, SignalExecution, SignalGraph, SignalValue,
    SimulatorClock, SpiBusDefinition, SpiCommand, SpiCommandBehavior, SpiLaneWidth,
    SpiRateDefinition, SpiTransferRate, SpiWidthDefinition, SpiWireConfig, StateErrorCode,
    StateFailure, StateMachine, TransitionOutcome, apply_actions, apply_stuck, decode_unsigned,
    encode_unsigned, evaluate_guard, map_access, map_register_error, map_state_machine_error,
    ms_to_ns, schedule_state_events,
};

/// Static generic SPI command implementation backed by declarative responses.
pub struct GenericSpiDevice {
    pub(super) id: String,
    pub(super) commands: HashMap<u8, SpiCommand>,
    pub(super) spi: SpiBusDefinition,
    pub(super) clock: Arc<dyn SimulatorClock>,
    pub(super) busy_binding: Option<BusyDefinition>,
    pub(super) state: Mutex<DeviceState>,
}

pub(super) struct DeviceState {
    pub(super) registers: RegisterEngine,
    pub(super) memory: Option<FlashMemory>,
    pub(super) scheduler: EventScheduler<PendingOperation>,
    pub(super) operation_busy: bool,
    pub(super) state_machine: Option<StateMachine<DeviceAction, DeviceGuard>>,
    pub(super) state_delayed_events: Vec<EventId>,
    pub(super) signal_graph: Option<SignalGraph>,
    pub(super) signal_events: Vec<EventId>,
    pub(super) fault_engine: FaultEngine,
    pub(super) stuck_registers: Vec<ActiveStuck>,
}

pub(super) struct FlashMemory {
    pub(super) definition: MemoryDefinition,
    pub(super) bytes: Vec<u8>,
}

#[derive(Clone)]
pub(super) struct ActiveStuck {
    pub(super) address: u64,
    pub(super) value: u64,
    pub(super) mask: Option<u64>,
    pub(super) persistent: bool,
}

pub(super) enum PendingOperation {
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
    Signal {
        node_id: String,
        value: SignalValue,
        delay_ns: u64,
        repeat: bool,
    },
    FaultDelay {
        fault_id: String,
        command: String,
        duration_ns: u64,
        started_at_ns: u64,
    },
    MemoryCommit {
        offset: usize,
        bytes: Vec<u8>,
        completion_event: String,
    },
    MemoryErase {
        offset: usize,
        length: usize,
        erased_value: u8,
        completion_event: String,
    },
    CommandEvent {
        event: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum DeviceAction {
    SetRegister {
        address: u64,
        value: u64,
        mask: Option<u64>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum DeviceGuard {
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

    #[allow(clippy::too_many_lines)]
    fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        let opcode = request.first().copied().ok_or(DeviceError::EmptyRequest)?;
        let command = self
            .commands
            .get(&opcode)
            .ok_or(DeviceError::UnknownOpcode(opcode))?;
        let mut state = self.lock_state()?;
        let mut events = self.apply_due_events(&mut state)?;
        let register = Self::command_register(&state, command, request);
        let current_state = state
            .state_machine
            .as_ref()
            .map(StateMachine::current_state)
            .map(str::to_owned);
        let activations = state.fault_engine.evaluate(FaultContext {
            device: &self.id,
            command: &command.name,
            register: register.as_ref().map(|(_, name)| name.as_str()),
            state: current_state.as_deref(),
        });
        self.apply_faults(
            &mut state,
            command,
            register.as_ref().map(|(address, _)| *address),
            &activations,
            &mut events,
        )?;
        Self::validate_command_state(&state, command)?;
        let mut transfer = match &command.behavior {
            SpiCommandBehavior::FixedResponse(response) => Ok(DeviceTransfer {
                response: response.clone(),
                register: None,
                events,
            }),
            SpiCommandBehavior::RegisterRead {
                address_bytes,
                register,
            } => Self::read_register(
                &state.registers,
                request,
                *address_bytes,
                register.as_deref(),
                events,
            ),
            SpiCommandBehavior::RegisterWrite {
                address_bytes,
                register,
                timing,
            } => self.write_register(
                &mut state,
                request,
                &command.name,
                *address_bytes,
                register.as_deref(),
                *timing,
                &mut events,
            ),
            SpiCommandBehavior::MemoryRead { address_bytes } => {
                Self::read_memory(&state, request, *address_bytes, events)
            }
            SpiCommandBehavior::PageProgram {
                address_bytes,
                timing,
            } => self.start_page_program(
                &mut state,
                request,
                &command.name,
                *address_bytes,
                *timing,
                &mut events,
            ),
            SpiCommandBehavior::SectorErase {
                address_bytes,
                timing,
            } => self.start_sector_erase(
                &mut state,
                request,
                &command.name,
                *address_bytes,
                *timing,
                &mut events,
            ),
            SpiCommandBehavior::ChipErase { timing } => {
                self.start_chip_erase(&mut state, request, &command.name, *timing, &mut events)
            }
        }?;
        if let Some(event) = &command.event {
            if event == "reset" {
                state.scheduler.clear();
                state.state_delayed_events.clear();
                self.set_busy(&mut state, false)?;
            }
            if let Some(delay_us) = command.event_delay_us {
                let deadline = self
                    .clock
                    .now_ns()
                    .checked_add(delay_us.saturating_mul(1_000))
                    .ok_or_else(|| {
                        DeviceError::InvalidRequest(
                            "command event delay overflows virtual time".to_owned(),
                        )
                    })?;
                state
                    .scheduler
                    .schedule_at(
                        deadline,
                        PendingOperation::CommandEvent {
                            event: event.clone(),
                        },
                    )
                    .map_err(|error| DeviceError::InvalidRequest(error.to_string()))?;
            } else {
                Self::dispatch_state_event(
                    &mut state,
                    event,
                    self.clock.now_ns(),
                    &mut transfer.events,
                )?;
            }
        }
        for activation in &activations {
            if let FaultAction::CorruptResponse { xor_mask } = activation.action {
                for byte in &mut transfer.response {
                    *byte ^= xor_mask;
                }
            }
        }
        Ok(transfer)
    }

    fn transfer_spi(
        &self,
        request: &[u8],
        rx_length: usize,
        wire: SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError> {
        if wire.mode != self.spi.mode || wire.bits_per_word != self.spi.transfer_bits {
            return Err(DeviceError::InvalidRequest(format!(
                "SPI wire mode/bits {}/{} do not match device configuration {}/{}",
                wire.mode, wire.bits_per_word, self.spi.mode, self.spi.transfer_bits
            )));
        }
        if self
            .spi
            .max_frequency_hz
            .is_some_and(|maximum| wire.max_speed_hz > maximum)
        {
            return Err(DeviceError::InvalidRequest(format!(
                "SPI clock {} Hz exceeds device maximum {} Hz",
                wire.max_speed_hz,
                self.spi.max_frequency_hz.unwrap_or_default()
            )));
        }
        if wire.rate == SpiTransferRate::Dtr && !self.spi.supports_dtr {
            return Err(DeviceError::InvalidRequest(
                "device configuration does not support DTR".to_owned(),
            ));
        }
        let opcode = request.first().copied().ok_or(DeviceError::EmptyRequest)?;
        let command = self
            .commands
            .get(&opcode)
            .ok_or(DeviceError::UnknownOpcode(opcode))?;
        if let Some(expected) = command.wire {
            let width = |value| match value {
                SpiWidthDefinition::Single => SpiLaneWidth::Single,
                SpiWidthDefinition::Dual => SpiLaneWidth::Dual,
                SpiWidthDefinition::Quad => SpiLaneWidth::Quad,
            };
            let rate = match expected.rate {
                SpiRateDefinition::Str => SpiTransferRate::Str,
                SpiRateDefinition::Dtr => SpiTransferRate::Dtr,
            };
            if wire.command_width != width(expected.command_width)
                || wire.address_width != width(expected.address_width)
                || wire.data_width != width(expected.data_width)
                || wire.rate != rate
                || wire.dummy_cycles != expected.dummy_cycles
            {
                return Err(DeviceError::InvalidRequest(format!(
                    "SPI wire phases do not match command '{}'",
                    command.name
                )));
            }
        }
        let mut framed = request.to_vec();
        if rx_length > 0 && matches!(command.behavior, SpiCommandBehavior::MemoryRead { .. }) {
            framed.resize(framed.len().saturating_add(rx_length), 0);
        }
        let mut transfer = self.transfer(&framed)?;
        if rx_length > 0 && transfer.response.len() > rx_length {
            transfer.response.truncate(rx_length);
        }
        Ok(transfer)
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
        state.fault_engine.reset();
        state.stuck_registers.retain(|stuck| stuck.persistent);
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

    fn read_register(&self, name: &str) -> Result<u64, DeviceError> {
        let state = self.lock_state()?;
        let metadata = state.registers.metadata_by_name(name).ok_or_else(|| {
            DeviceError::InvalidRequest(format!("device '{}' has no register '{name}'", self.id))
        })?;
        state
            .registers
            .read_internal(metadata.address)
            .map(|read| read.value)
            .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))
    }

    fn write_register(&self, address: u64, value: u64) -> Result<RegisterTrace, DeviceError> {
        let mut state = self.lock_state()?;
        let write = state
            .registers
            .write(address, value)
            .map_err(|error| map_register_error(&error, RegisterOperation::Write, Some(value)))?;
        Ok(RegisterTrace {
            name: Some(write.register.name),
            address,
            access_type: Some(map_access(write.register.access)),
            operation: RegisterOperation::Write,
            old_value: Some(write.old_value),
            new_value: Some(write.new_value),
        })
    }

    fn current_state(&self) -> Result<Option<String>, DeviceError> {
        GenericSpiDevice::current_state(self)
    }

    fn set_fault_enabled(&self, fault_id: &str, enabled: bool) -> Result<bool, DeviceError> {
        Ok(self
            .lock_state()?
            .fault_engine
            .set_enabled(fault_id, enabled))
    }

    fn next_event_deadline_ns(&self) -> Result<Option<u64>, DeviceError> {
        Ok(self.lock_state()?.scheduler.next_deadline_ns())
    }

    fn registers(&self) -> Result<Vec<RegisterSnapshot>, DeviceError> {
        Ok(self
            .lock_state()?
            .registers
            .snapshots()
            .into_iter()
            .map(|read| RegisterSnapshot {
                name: read.register.name,
                address: read.register.address,
                width_bits: read.register.width_bits,
                access: map_access(read.register.access),
                value: read.value,
                reset_value: read.register.reset_value,
                description: read.register.description,
                bitfields: read
                    .register
                    .bitfields
                    .into_iter()
                    .map(|field| vds_core::device::RegisterBitFieldSnapshot {
                        name: field.name,
                        lsb: field.lsb,
                        width: field.width,
                        access: map_access(field.access),
                        description: field.description,
                    })
                    .collect(),
            })
            .collect())
    }

    fn faults(&self) -> Result<Vec<vds_core::fault::FaultSnapshot>, DeviceError> {
        Ok(self.lock_state()?.fault_engine.snapshots())
    }

    fn virtual_time_ns(&self) -> u64 {
        self.clock.now_ns()
    }
}

impl GenericSpiDevice {
    fn command_register(
        state: &DeviceState,
        command: &SpiCommand,
        request: &[u8],
    ) -> Option<(u64, String)> {
        let (address_bytes, register) = match &command.behavior {
            SpiCommandBehavior::RegisterRead {
                address_bytes,
                register,
            }
            | SpiCommandBehavior::RegisterWrite {
                address_bytes,
                register,
                ..
            } => (*address_bytes, register.as_deref()),
            _ => return None,
        };
        if let Some(name) = register {
            return state
                .registers
                .metadata_by_name(name)
                .map(|metadata| (metadata.address, metadata.name));
        }
        let address_bytes = address_bytes?;
        let end = 1 + usize::from(address_bytes);
        if request.len() < end {
            return None;
        }
        let address = decode_unsigned(&request[1..end]);
        state
            .registers
            .metadata(address)
            .ok()
            .map(|metadata| (address, metadata.name))
    }

    fn apply_faults(
        &self,
        state: &mut DeviceState,
        command: &SpiCommand,
        register: Option<u64>,
        activations: &[vds_core::fault::FaultActivation],
        events: &mut Vec<DeviceEvent>,
    ) -> Result<(), DeviceError> {
        let now_ns = self.clock.now_ns();
        for activation in activations {
            events.push(DeviceEvent::FaultTriggered {
                fault_id: activation.id.clone(),
                command: command.name.clone(),
                trigger: activation.trigger.name(),
                trigger_count: activation.trigger_count,
                action: activation.action.name(),
                virtual_time_ns: now_ns,
                result: "applied",
            });
            Self::apply_fault_action(state, command, register, activation, now_ns)?;
        }
        Ok(())
    }

    fn apply_fault_action(
        state: &mut DeviceState,
        command: &SpiCommand,
        register: Option<u64>,
        activation: &vds_core::fault::FaultActivation,
        now_ns: u64,
    ) -> Result<(), DeviceError> {
        match &activation.action {
            FaultAction::Timeout { duration_ms } => {
                return Err(Self::fault_failure(
                    activation,
                    &command.name,
                    FaultErrorCode::Timeout,
                    Some(ms_to_ns(*duration_ms, &activation.id)?),
                    now_ns,
                    "operation timed out by fault",
                ));
            }
            FaultAction::Delay { duration_ms } => {
                let duration = ms_to_ns(*duration_ms, &activation.id)?;
                let deadline = now_ns.checked_add(duration).ok_or_else(|| {
                    Self::fault_failure(
                        activation,
                        &command.name,
                        FaultErrorCode::ActionFailed,
                        Some(duration),
                        now_ns,
                        "fault delay deadline overflows virtual time",
                    )
                })?;
                state
                    .scheduler
                    .schedule_at(
                        deadline,
                        PendingOperation::FaultDelay {
                            fault_id: activation.id.clone(),
                            command: command.name.clone(),
                            duration_ns: duration,
                            started_at_ns: now_ns,
                        },
                    )
                    .map_err(|error| {
                        Self::fault_failure(
                            activation,
                            &command.name,
                            FaultErrorCode::ActionFailed,
                            Some(duration),
                            now_ns,
                            &error.to_string(),
                        )
                    })?;
            }
            FaultAction::ReturnError { message, .. } => {
                return Err(Self::fault_failure(
                    activation,
                    &command.name,
                    FaultErrorCode::ReturnError,
                    None,
                    now_ns,
                    message,
                ));
            }
            FaultAction::Drop => {
                return Err(Self::fault_failure(
                    activation,
                    &command.name,
                    FaultErrorCode::Dropped,
                    None,
                    now_ns,
                    "operation dropped by fault",
                ));
            }
            FaultAction::CorruptResponse { .. } => {}
            FaultAction::ForceRegisterValue { .. } | FaultAction::StuckAt { .. } => {
                Self::apply_register_fault(state, command, register, activation, now_ns)?;
            }
        }
        Ok(())
    }

    fn apply_register_fault(
        state: &mut DeviceState,
        command: &SpiCommand,
        register: Option<u64>,
        activation: &vds_core::fault::FaultActivation,
        now_ns: u64,
    ) -> Result<(), DeviceError> {
        let address = register.ok_or_else(|| {
            Self::fault_failure(
                activation,
                &command.name,
                FaultErrorCode::ActionFailed,
                None,
                now_ns,
                "fault target has no resolved register",
            )
        })?;
        match &activation.action {
            FaultAction::ForceRegisterValue { value } => {
                state
                    .registers
                    .write_internal(address, *value)
                    .map_err(|error| {
                        map_register_error(&error, RegisterOperation::Write, Some(*value))
                    })?;
            }
            FaultAction::StuckAt { value, mask } => {
                state
                    .stuck_registers
                    .retain(|stuck| stuck.address != address);
                state.stuck_registers.push(ActiveStuck {
                    address,
                    value: *value,
                    mask: *mask,
                    persistent: activation.persistent,
                });
                let current = state
                    .registers
                    .read_internal(address)
                    .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))?
                    .value;
                let forced = apply_stuck(current, *value, *mask);
                state
                    .registers
                    .write_internal(address, forced)
                    .map_err(|error| {
                        map_register_error(&error, RegisterOperation::Write, Some(forced))
                    })?;
            }
            _ => unreachable!("only register fault actions are delegated"),
        }
        Ok(())
    }

    fn fault_failure(
        activation: &vds_core::fault::FaultActivation,
        command: &str,
        code: FaultErrorCode,
        duration_ns: Option<u64>,
        now_ns: u64,
        message: &str,
    ) -> DeviceError {
        DeviceError::Fault(Box::new(FaultFailure {
            code,
            fault_id: activation.id.clone(),
            command: command.to_owned(),
            duration_ns,
            trigger: activation.trigger.name(),
            trigger_count: activation.trigger_count,
            action: activation.action.name(),
            virtual_time_ns: now_ns,
            message: message.to_owned(),
        }))
    }
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
        address_bytes: Option<u8>,
        register: Option<&str>,
        events: Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let expected = 1 + address_bytes.map_or(0, usize::from);
        let valid_length = if register.is_some() {
            request.len() >= expected
        } else {
            request.len() == expected
        };
        if !valid_length {
            return Err(DeviceError::InvalidRequest(format!(
                "register read expects at least {expected} bytes, received {}",
                request.len()
            )));
        }
        let address = if let Some(register) = register {
            engine
                .metadata_by_name(register)
                .ok_or_else(|| {
                    DeviceError::InvalidRequest(format!("unknown register '{register}'"))
                })?
                .address
        } else {
            decode_unsigned(&request[1..])
        };
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

    #[allow(clippy::too_many_arguments)]
    fn write_register(
        &self,
        state: &mut DeviceState,
        request: &[u8],
        command_name: &str,
        address_bytes: Option<u8>,
        register: Option<&str>,
        timing: Option<CommandTimingDefinition>,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let address_end = 1 + address_bytes.map_or(0, usize::from);
        if request.len() < address_end {
            return Err(DeviceError::InvalidRequest(format!(
                "register write requires {address_end} address bytes including opcode"
            )));
        }
        let address = if let Some(register) = register {
            state
                .registers
                .metadata_by_name(register)
                .ok_or_else(|| {
                    DeviceError::InvalidRequest(format!("unknown register '{register}'"))
                })?
                .address
        } else {
            decode_unsigned(&request[1..address_end])
        };
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
        let requested_value = decode_unsigned(&request[address_end..]);
        let value = state
            .stuck_registers
            .iter()
            .find(|stuck| stuck.address == address)
            .map_or(requested_value, |stuck| {
                apply_stuck(requested_value, stuck.value, stuck.mask)
            });
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

    #[allow(clippy::too_many_lines)]
    pub(super) fn apply_due_events(
        &self,
        state: &mut DeviceState,
    ) -> Result<Vec<DeviceEvent>, DeviceError> {
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
                PendingOperation::Signal {
                    node_id,
                    value,
                    delay_ns,
                    repeat,
                } => {
                    state.signal_events.retain(|event_id| *event_id != event.id);
                    let execution = state
                        .signal_graph
                        .as_mut()
                        .ok_or_else(|| {
                            DeviceError::InvalidRequest("signal graph is unavailable".to_owned())
                        })?
                        .resume(&node_id, value.clone())
                        .map_err(DeviceError::InvalidRequest)?;
                    Self::schedule_signal_execution(state, execution, now_ns)?;
                    if repeat {
                        let deadline = now_ns.checked_add(delay_ns).ok_or_else(|| {
                            DeviceError::InvalidRequest("signal deadline overflow".to_owned())
                        })?;
                        let id = state
                            .scheduler
                            .schedule_at(
                                deadline,
                                PendingOperation::Signal {
                                    node_id,
                                    value,
                                    delay_ns,
                                    repeat,
                                },
                            )
                            .map_err(|error| DeviceError::InvalidRequest(error.to_string()))?;
                        state.signal_events.push(id);
                    }
                }
                PendingOperation::FaultDelay {
                    fault_id,
                    command,
                    duration_ns,
                    started_at_ns,
                } => emitted.push(DeviceEvent::FaultDelayCompleted {
                    fault_id,
                    command,
                    scheduled_duration_ns: duration_ns,
                    started_at_ns,
                    completed_at_ns: now_ns,
                }),
                PendingOperation::MemoryCommit {
                    offset,
                    bytes,
                    completion_event,
                } => {
                    let memory = state.memory.as_mut().ok_or_else(|| {
                        DeviceError::InvalidRequest("device has no memory".to_owned())
                    })?;
                    memory.bytes[offset..offset + bytes.len()].copy_from_slice(&bytes);
                    self.set_busy(state, false)?;
                    Self::dispatch_state_event(state, &completion_event, now_ns, &mut emitted)?;
                }
                PendingOperation::MemoryErase {
                    offset,
                    length,
                    erased_value,
                    completion_event,
                } => {
                    let memory = state.memory.as_mut().ok_or_else(|| {
                        DeviceError::InvalidRequest("device has no memory".to_owned())
                    })?;
                    memory.bytes[offset..offset + length].fill(erased_value);
                    self.set_busy(state, false)?;
                    Self::dispatch_state_event(state, &completion_event, now_ns, &mut emitted)?;
                }
                PendingOperation::CommandEvent { event } => {
                    Self::dispatch_state_event(state, &event, now_ns, &mut emitted)?;
                }
            }
        }
        Ok(emitted)
    }

    pub(super) fn set_busy(&self, state: &mut DeviceState, busy: bool) -> Result<(), DeviceError> {
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

    pub(super) fn dispatch_state_event(
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
        Self::activate_signal_graph(state, &outcome.to_state, now_ns)?;
        emitted.push(DeviceEvent::StateTransition {
            from_state: outcome.from_state,
            to_state: outcome.to_state,
            trigger: outcome.trigger,
            virtual_time_ns: now_ns,
            result: "success",
        });
        Ok(())
    }

    pub(super) fn activate_signal_graph(
        state: &mut DeviceState,
        state_name: &str,
        now_ns: u64,
    ) -> Result<(), DeviceError> {
        for event_id in state.signal_events.drain(..) {
            state.scheduler.cancel(event_id);
        }
        let Some(graph) = state.signal_graph.as_mut() else {
            return Ok(());
        };
        let execution = graph
            .activate_state(state_name)
            .map_err(DeviceError::InvalidRequest)?;
        Self::schedule_signal_execution(state, execution, now_ns)
    }

    fn schedule_signal_execution(
        state: &mut DeviceState,
        execution: SignalExecution,
        now_ns: u64,
    ) -> Result<(), DeviceError> {
        for scheduled in execution.scheduled {
            let deadline = now_ns.checked_add(scheduled.delay_ns).ok_or_else(|| {
                DeviceError::InvalidRequest("signal deadline overflow".to_owned())
            })?;
            let event_id = state
                .scheduler
                .schedule_at(
                    deadline,
                    PendingOperation::Signal {
                        node_id: scheduled.node_id,
                        value: scheduled.value,
                        delay_ns: scheduled.delay_ns,
                        repeat: scheduled.repeat,
                    },
                )
                .map_err(|error| DeviceError::InvalidRequest(error.to_string()))?;
            state.signal_events.push(event_id);
        }
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, DeviceState>, DeviceError> {
        self.state
            .lock()
            .map_err(|_| DeviceError::InvalidRequest("device state lock is poisoned".to_owned()))
    }
}
