//! Semantic validation and compilation helpers for device models.

use super::{
    AccessType, BTreeMap, DelayedEventDefinition, DeviceAction, DeviceError, DeviceGuard,
    DeviceState, DeviceStateMachineDefinition, EventId, EventScheduler, FaultAction,
    FaultDefinition, GenericSpiDevice, ModelError, PendingOperation, RegisterAccessType,
    RegisterDefinition, RegisterEngine, RegisterError, RegisterErrorCode, RegisterFailure,
    RegisterOperation, RegisterTrace, SchedulerError, StateActionDefinition, StateDefinition,
    StateErrorCode, StateFailure, StateGuardDefinition, StateMachine, StateMachineDefinition,
    StateMachineError, TimingErrorCode, TimingFailure, TransitionDefinition,
};

pub(super) fn uncompiled_state_machine(
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

pub(super) fn compile_state_machine(
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

pub(super) fn compile_action(
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

pub(super) fn compile_guard(
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

pub(super) fn validate_state_value(
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

pub(super) fn validate_register_reference(
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

pub(super) fn validate_faults(
    faults: &[FaultDefinition],
    registers: &[RegisterDefinition],
) -> Result<(), ModelError> {
    let mut ids = std::collections::HashSet::new();
    for fault in faults {
        if !ids.insert(&fault.id) {
            return Err(ModelError::DuplicateFaultId {
                id: fault.id.clone(),
            });
        }
        if matches!(
            fault.trigger,
            vds_core::fault::FaultTrigger::FirstN(0)
                | vds_core::fault::FaultTrigger::EveryNth(0)
                | vds_core::fault::FaultTrigger::OperationCount(0)
        ) {
            return Err(ModelError::InvalidFault {
                id: fault.id.clone(),
                reason: "trigger count must be greater than zero".to_owned(),
            });
        }
        if matches!(
            fault.action,
            FaultAction::ForceRegisterValue { .. } | FaultAction::StuckAt { .. }
        ) && fault.target.register.is_none()
        {
            return Err(ModelError::InvalidFault {
                id: fault.id.clone(),
                reason: "register action requires target.register".to_owned(),
            });
        }
        if let Some(register) = fault.target.register.as_deref() {
            validate_register_reference(registers, register)?;
        }
    }
    Ok(())
}

pub(super) fn initialize_state_machine(
    state: &mut DeviceState,
    now_ns: u64,
) -> Result<(), ModelError> {
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
    .map_err(|error| ModelError::StateInitialization(error.to_string()))?;
    GenericSpiDevice::activate_signal_graph(state, &activation.state, now_ns)
        .map_err(|error| ModelError::StateInitialization(error.to_string()))
}

pub(super) fn apply_actions(
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

pub(super) fn evaluate_guard(registers: &RegisterEngine, guard: &DeviceGuard) -> bool {
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

pub(super) fn schedule_state_events(
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

pub(super) fn map_state_machine_error(error: &StateMachineError) -> DeviceError {
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

pub(super) fn state_action_error(error: &RegisterError) -> DeviceError {
    state_failure(StateErrorCode::ActionFailed, "", None, &error.to_string())
}

pub(super) fn state_failure(
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

pub(super) fn timing_failure(
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

pub(super) fn map_scheduler_error(
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

pub(super) fn decode_unsigned(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte))
}

pub(super) fn encode_unsigned(value: u64, byte_count: usize) -> Vec<u8> {
    value.to_be_bytes()[8 - byte_count..].to_vec()
}

pub(super) fn apply_stuck(candidate: u64, value: u64, mask: Option<u64>) -> u64 {
    mask.map_or(value, |mask| (candidate & !mask) | (value & mask))
}

pub(super) fn ms_to_ns(duration_ms: u64, fault_id: &str) -> Result<u64, DeviceError> {
    duration_ms.checked_mul(1_000_000).ok_or_else(|| {
        DeviceError::InvalidRequest(format!("fault '{fault_id}' duration overflows nanoseconds"))
    })
}

pub(super) fn map_access(access: AccessType) -> RegisterAccessType {
    match access {
        AccessType::Ro => RegisterAccessType::Ro,
        AccessType::Wo => RegisterAccessType::Wo,
        AccessType::Rw => RegisterAccessType::Rw,
    }
}

pub(super) fn map_register_error(
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
        | RegisterError::InvalidBitField { address, .. }
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
