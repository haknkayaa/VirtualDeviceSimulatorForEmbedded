//! Flash-memory storage and mutation primitives.

use super::{
    CommandTimingDefinition, DeviceError, DeviceEvent, DeviceState, DeviceTransfer,
    GenericSpiDevice, PendingOperation, RegisterOperation, RegisterTrace, TimingErrorCode,
    TimingFailure, decode_unsigned, map_access, map_register_error, map_scheduler_error,
    timing_failure,
};

impl GenericSpiDevice {
    pub(super) fn read_memory(
        state: &DeviceState,
        request: &[u8],
        address_bytes: u8,
        events: Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let address_end = 1 + usize::from(address_bytes);
        if request.len() < address_end {
            return Err(DeviceError::InvalidRequest(
                "memory read is missing address bytes".to_owned(),
            ));
        }
        let memory = state
            .memory
            .as_ref()
            .ok_or_else(|| DeviceError::InvalidRequest("device has no memory".to_owned()))?;
        let address = usize::try_from(decode_unsigned(&request[1..address_end]))
            .map_err(|_| DeviceError::InvalidRequest("memory address is too large".to_owned()))?;
        let length = request.len() - address_end;
        let end = address
            .checked_add(length)
            .ok_or_else(|| DeviceError::InvalidRequest("memory read range overflows".to_owned()))?;
        if end > memory.bytes.len() {
            return Err(DeviceError::InvalidRequest(
                "memory read is out of range".to_owned(),
            ));
        }
        Ok(DeviceTransfer {
            response: memory.bytes[address..end].to_vec(),
            register: None,
            events,
        })
    }

    pub(super) fn start_page_program(
        &self,
        state: &mut DeviceState,
        request: &[u8],
        command: &str,
        address_bytes: u8,
        timing: CommandTimingDefinition,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let address_end = 1 + usize::from(address_bytes);
        if request.len() <= address_end {
            return Err(DeviceError::InvalidRequest(
                "page program requires address and data".to_owned(),
            ));
        }
        let memory = state
            .memory
            .as_ref()
            .ok_or_else(|| DeviceError::InvalidRequest("device has no memory".to_owned()))?;
        let offset = usize::try_from(decode_unsigned(&request[1..address_end]))
            .map_err(|_| DeviceError::InvalidRequest("program address is too large".to_owned()))?;
        let data = &request[address_end..];
        let end = offset
            .checked_add(data.len())
            .ok_or_else(|| DeviceError::InvalidRequest("program range overflows".to_owned()))?;
        let page_size =
            usize::try_from(memory.definition.page_size_bytes).expect("validated memory geometry");
        if end > memory.bytes.len() || offset / page_size != (end - 1) / page_size {
            return Err(DeviceError::InvalidRequest(
                "page program crosses a page boundary or memory end".to_owned(),
            ));
        }
        let programmed = memory.bytes[offset..end]
            .iter()
            .zip(data)
            .map(|(old, new)| old & new)
            .collect();
        self.schedule_memory_operation(
            state,
            command,
            timing,
            PendingOperation::MemoryCommit {
                offset,
                bytes: programmed,
                completion_event: "operation_completed".to_owned(),
            },
            events,
        )
    }

    pub(super) fn start_sector_erase(
        &self,
        state: &mut DeviceState,
        request: &[u8],
        command: &str,
        address_bytes: u8,
        timing: CommandTimingDefinition,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let address_end = 1 + usize::from(address_bytes);
        if request.len() != address_end {
            return Err(DeviceError::InvalidRequest(
                "sector erase expects opcode and address only".to_owned(),
            ));
        }
        let memory = state
            .memory
            .as_ref()
            .ok_or_else(|| DeviceError::InvalidRequest("device has no memory".to_owned()))?;
        let address = usize::try_from(decode_unsigned(&request[1..address_end]))
            .map_err(|_| DeviceError::InvalidRequest("erase address is too large".to_owned()))?;
        let length = usize::try_from(memory.definition.sector_size_bytes)
            .expect("validated memory geometry");
        let offset = address / length * length;
        if offset
            .checked_add(length)
            .is_none_or(|end| end > memory.bytes.len())
        {
            return Err(DeviceError::InvalidRequest(
                "sector erase is out of range".to_owned(),
            ));
        }
        self.schedule_memory_operation(
            state,
            command,
            timing,
            PendingOperation::MemoryErase {
                offset,
                length,
                erased_value: memory.definition.erased_value,
                completion_event: "operation_completed".to_owned(),
            },
            events,
        )
    }

    pub(super) fn start_chip_erase(
        &self,
        state: &mut DeviceState,
        request: &[u8],
        command: &str,
        timing: CommandTimingDefinition,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        if request.len() != 1 {
            return Err(DeviceError::InvalidRequest(
                "chip erase expects opcode only".to_owned(),
            ));
        }
        let memory = state
            .memory
            .as_ref()
            .ok_or_else(|| DeviceError::InvalidRequest("device has no memory".to_owned()))?;
        self.schedule_memory_operation(
            state,
            command,
            timing,
            PendingOperation::MemoryErase {
                offset: 0,
                length: memory.bytes.len(),
                erased_value: memory.definition.erased_value,
                completion_event: "operation_completed".to_owned(),
            },
            events,
        )
    }

    pub(super) fn schedule_memory_operation(
        &self,
        state: &mut DeviceState,
        command: &str,
        timing: CommandTimingDefinition,
        pending: PendingOperation,
        events: &mut Vec<DeviceEvent>,
    ) -> Result<DeviceTransfer, DeviceError> {
        let now_ns = self.clock.now_ns();
        if state.operation_busy {
            return Err(timing_failure(
                TimingErrorCode::DeviceBusy,
                command,
                now_ns,
                None,
                "device is busy",
            ));
        }
        let duration_ns = timing.latency_us.checked_mul(1_000).ok_or_else(|| {
            timing_failure(
                TimingErrorCode::DeadlineOverflow,
                command,
                now_ns,
                None,
                "operation duration overflows",
            )
        })?;
        let deadline = now_ns.checked_add(duration_ns).ok_or_else(|| {
            timing_failure(
                TimingErrorCode::DeadlineOverflow,
                command,
                now_ns,
                None,
                "operation deadline overflows",
            )
        })?;
        state
            .scheduler
            .schedule_at(deadline, pending)
            .map_err(|error| map_scheduler_error(error, command, now_ns, deadline))?;
        if timing.busy_during_operation {
            self.set_busy(state, true)?;
        }
        events.push(DeviceEvent::OperationStarted {
            command: command.to_owned(),
            scheduled_duration_ns: duration_ns,
            started_at_ns: now_ns,
            busy: state.operation_busy,
        });
        Ok(DeviceTransfer {
            response: Vec::new(),
            register: None,
            events: std::mem::take(events),
        })
    }

    pub(super) fn start_delayed_write(
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
}
