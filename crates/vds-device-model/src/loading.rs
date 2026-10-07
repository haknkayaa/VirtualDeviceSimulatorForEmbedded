//! Device-model deserialization and file loading.

use super::{
    AccessType, Arc, At24cEepromDevice, CommandTimingDefinition, DeviceModel, DeviceState,
    EventScheduler, FaultEngine, FlashMemory, GenericGpioDevice, GenericI2cDevice,
    GenericSpiDevice, GenericUartDevice, HashMap, ModelError, Mutex, Path, RealTimeClock,
    RegisterEngine, SignalGraph, SimulatorClock, SpiBusDefinition, SpiCommand, SpiCommandBehavior,
    SpiCommandOperation, StateActionDefinition, StateGuardDefinition, StateMachine,
    compile_state_machine, fs, initialize_state_machine, uncompiled_state_machine, validate_faults,
    validate_register_reference,
};
use std::collections::BTreeSet;

use crate::{DEVICE_MODEL_SCHEMA, SignalOutputs, behavior_flow};

impl DeviceModel {
    /// Compiles an authoritative behavior flow into this runtime model.
    ///
    /// # Errors
    /// Returns an error when the flow cannot be parsed or compiled.
    pub fn apply_behavior_flow(
        &mut self,
        yaml: &str,
        package_root: impl AsRef<Path>,
    ) -> Result<(), ModelError> {
        let (state_machine, signal_graph) =
            behavior_flow::compile_behavior_flow(yaml).map_err(ModelError::BehaviorFlow)?;
        self.device.state_machine = Some(state_machine);
        self.signal_graph = Some(signal_graph);
        self.package_root = Some(package_root.as_ref().to_path_buf());
        Ok(())
    }
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
        let mut model = Self::from_yaml(&yaml)?;
        model.package_root = path.parent().map(Path::to_path_buf);
        Ok(model)
    }

    /// Parses and validates YAML model content.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed YAML, schema violations, or duplicate
    /// command opcodes.
    #[allow(clippy::too_many_lines)]
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
        let has_signals =
            model.device.signals.is_some() || !model.device.signal_bindings.is_empty();
        if has_signals
            && !matches!(
                model.device.model.as_str(),
                "generic-spi-command" | "generic-i2c-register"
            )
        {
            return Err(ModelError::InvalidSignal {
                reason: format!(
                    "model '{}' does not support public signal ports",
                    model.device.model
                ),
            });
        }
        if model.device.bus == "uart" {
            let uart = model.device.uart.as_ref().ok_or_else(|| {
                ModelError::Validation("UART device is missing device.uart".to_owned())
            })?;
            if !(5..=8).contains(&uart.data_bits) || !(1..=2).contains(&uart.stop_bits) {
                return Err(ModelError::Validation(
                    "UART data_bits must be 5..=8 and stop_bits must be 1..=2".to_owned(),
                ));
            }
            let mut requests = std::collections::HashSet::new();
            if uart.responses.is_empty()
                || uart.responses.iter().any(|rule| rule.request.is_empty())
                || uart
                    .responses
                    .iter()
                    .any(|rule| !requests.insert(rule.request.clone()))
            {
                return Err(ModelError::Validation(
                    "UART responses require unique, non-empty request byte sequences".to_owned(),
                ));
            }
            if uart.responses.iter().enumerate().any(|(index, left)| {
                uart.responses.iter().skip(index + 1).any(|right| {
                    left.request.starts_with(&right.request)
                        || right.request.starts_with(&left.request)
                })
            }) {
                return Err(ModelError::Validation(
                    "UART response requests must not be prefixes of one another".to_owned(),
                ));
            }
            return Ok(model);
        }
        if model.device.bus == "gpio" {
            let gpio = model.device.gpio.as_ref().ok_or_else(|| {
                ModelError::Validation("GPIO device is missing device.gpio".to_owned())
            })?;
            for (expected, line) in gpio.lines.iter().enumerate() {
                if usize::from(line.offset) != expected {
                    return Err(ModelError::Validation(
                        "GPIO line offsets must be contiguous and start at zero".to_owned(),
                    ));
                }
                if let Some(register) = &line.register {
                    validate_register_reference(&model.device.registers, register)?;
                }
            }
            RegisterEngine::new(model.device.registers.clone())?;
            return Ok(model);
        }
        if model.device.bus == "i2c" {
            let i2c = model.device.i2c.as_ref().ok_or_else(|| {
                ModelError::Validation("I2C device is missing device.i2c".to_owned())
            })?;
            if !(1..=4).contains(&i2c.register_address_bytes) {
                return Err(ModelError::Validation(
                    "I2C register_address_bytes must be between 1 and 4".to_owned(),
                ));
            }
            if model
                .device
                .registers
                .iter()
                .any(|register| register.width_bits != 8)
            {
                return Err(ModelError::Validation(
                    "generic I2C register devices currently require 8-bit registers".to_owned(),
                ));
            }
        }
        if model
            .device
            .spi
            .is_some_and(|spi| spi.mode != 0 || spi.transfer_bits != 8)
        {
            return Err(ModelError::InvalidSpiConfiguration);
        }
        let mut seen = HashMap::new();
        for command in &model.device.commands {
            if let Some(previous) = seen.insert(command.opcode, &command.name) {
                return Err(ModelError::DuplicateOpcode {
                    opcode: command.opcode,
                    first: previous.clone(),
                    second: command.name.clone(),
                });
            }
            let valid_shape = match (command.response.as_ref(), command.operation) {
                (Some(_), None) => command.address_bytes.is_none() && command.register.is_none(),
                (
                    None,
                    Some(SpiCommandOperation::RegisterRead | SpiCommandOperation::RegisterWrite),
                ) => {
                    command.register.is_some()
                        ^ command
                            .address_bytes
                            .is_some_and(|bytes| (1..=8).contains(&bytes))
                }
                (
                    None,
                    Some(
                        SpiCommandOperation::MemoryRead
                        | SpiCommandOperation::PageProgram
                        | SpiCommandOperation::SectorErase,
                    ),
                ) => {
                    command
                        .address_bytes
                        .is_some_and(|bytes| (1..=8).contains(&bytes))
                        && command.register.is_none()
                }
                (None, Some(SpiCommandOperation::ChipErase)) => {
                    command.address_bytes.is_none() && command.register.is_none()
                }
                _ => false,
            };
            if !valid_shape {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "define a fixed response or a supported operation with its required address/register selector".to_owned(),
                });
            }
            if let Some(shortcut) = &command.shortcut
                && shortcut.tx.first() != Some(&command.opcode)
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "shortcut TX must start with the command opcode".to_owned(),
                });
            }
            if command.timing.is_some()
                && !matches!(
                    command.operation,
                    Some(
                        SpiCommandOperation::RegisterWrite
                            | SpiCommandOperation::PageProgram
                            | SpiCommandOperation::SectorErase
                            | SpiCommandOperation::ChipErase
                    )
                )
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "timing is supported only for mutating operations".to_owned(),
                });
            }
            if matches!(
                command.operation,
                Some(
                    SpiCommandOperation::PageProgram
                        | SpiCommandOperation::SectorErase
                        | SpiCommandOperation::ChipErase
                )
            ) && command.timing.is_none()
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "mutating memory operation requires timing".to_owned(),
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
            if matches!(
                command.operation,
                Some(
                    SpiCommandOperation::MemoryRead
                        | SpiCommandOperation::PageProgram
                        | SpiCommandOperation::SectorErase
                        | SpiCommandOperation::ChipErase
                )
            ) && model.device.memory.is_none()
            {
                return Err(ModelError::InvalidCommand {
                    name: command.name.clone(),
                    reason: "memory operation requires device.memory".to_owned(),
                });
            }
            if let Some(register) = &command.register {
                validate_register_reference(&model.device.registers, register)?;
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
        if let Some(memory) = model.device.memory
            && (memory.size_bytes == 0
                || memory.page_size_bytes == 0
                || memory.sector_size_bytes == 0
                || memory.size_bytes % memory.sector_size_bytes != 0
                || memory.sector_size_bytes % memory.page_size_bytes != 0
                || usize::try_from(memory.size_bytes).is_err())
        {
            return Err(ModelError::InvalidMemory {
                reason: "size, page, and sector geometry must be non-zero and aligned".to_owned(),
            });
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
        validate_faults(&model.device.faults, &model.device.registers)?;
        SignalOutputs::compile(
            model.device.signals.as_ref(),
            &model.device.signal_bindings,
            &RegisterEngine::new(model.device.registers.clone())?,
            None,
        )?;
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

    /// Builds a declarative GPIO bank runtime from this model.
    ///
    /// # Errors
    /// Returns an error unless the model uses the generic GPIO bank driver.
    pub fn into_gpio_device(self) -> Result<GenericGpioDevice, ModelError> {
        if self.device.bus != "gpio" || self.device.model != "generic-gpio-bank" {
            return Err(ModelError::UnsupportedModel {
                bus: self.device.bus,
                model: self.device.model,
            });
        }
        let definition = self
            .device
            .gpio
            .ok_or_else(|| ModelError::UnsupportedModel {
                bus: "gpio".to_owned(),
                model: "generic-gpio-bank".to_owned(),
            })?;
        GenericGpioDevice::new(self.device.id, definition, self.device.registers)
    }

    /// Builds a declarative I2C register device runtime.
    ///
    /// # Errors
    /// Returns an error unless the model uses the generic I2C register driver.
    pub fn into_i2c_device(self) -> Result<GenericI2cDevice, ModelError> {
        if self.device.bus != "i2c" || self.device.model != "generic-i2c-register" {
            return Err(ModelError::UnsupportedModel {
                bus: self.device.bus,
                model: self.device.model,
            });
        }
        let definition = self
            .device
            .i2c
            .ok_or_else(|| ModelError::UnsupportedModel {
                bus: "i2c".to_owned(),
                model: "generic-i2c-register".to_owned(),
            })?;
        let signals = SignalOutputs::compile(
            self.device.signals.as_ref(),
            &self.device.signal_bindings,
            &RegisterEngine::new(self.device.registers.clone())?,
            Some(&BTreeSet::new()),
        )?;
        GenericI2cDevice::new(self.device.id, definition, self.device.registers, signals)
    }

    /// Builds a declarative byte-oriented UART runtime.
    ///
    /// # Errors
    /// Returns an error unless the model uses the generic UART responder driver.
    pub fn into_uart_device(self) -> Result<GenericUartDevice, ModelError> {
        if self.device.bus != "uart" || self.device.model != "generic-uart-responder" {
            return Err(ModelError::UnsupportedModel {
                bus: self.device.bus,
                model: self.device.model,
            });
        }
        let definition = self
            .device
            .uart
            .ok_or_else(|| ModelError::UnsupportedModel {
                bus: "uart".to_owned(),
                model: "generic-uart-responder".to_owned(),
            })?;
        Ok(GenericUartDevice::new(self.device.id, definition))
    }

    /// Builds an AT24C128/AT24C256 EEPROM runtime using an injected clock.
    ///
    /// # Errors
    /// Returns an error unless the model declares valid AT24C memory geometry.
    pub fn into_at24c_device_with_clock(
        self,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<At24cEepromDevice, ModelError> {
        if self.device.bus != "i2c" || self.device.model != "at24c-eeprom" {
            return Err(ModelError::UnsupportedModel {
                bus: self.device.bus,
                model: self.device.model,
            });
        }
        let definition = self
            .device
            .i2c
            .ok_or_else(|| ModelError::UnsupportedModel {
                bus: "i2c".to_owned(),
                model: "at24c-eeprom".to_owned(),
            })?;
        let memory = self
            .device
            .memory
            .ok_or_else(|| ModelError::InvalidMemory {
                reason: "AT24C EEPROM model requires memory geometry".to_owned(),
            })?;
        At24cEepromDevice::new(self.device.id, definition, memory, clock)
    }

    /// Builds a device using an injected simulator clock.
    ///
    /// Manual clocks make timing tests deterministic without sleeping.
    ///
    /// # Errors
    ///
    /// Returns an error if the model or busy-register binding is invalid.
    #[allow(clippy::too_many_lines)]
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
                let behavior = match (
                    command.response,
                    command.operation,
                    command.address_bytes,
                    command.register,
                ) {
                    (Some(response), None, None, None) => {
                        SpiCommandBehavior::FixedResponse(response)
                    }
                    (None, Some(SpiCommandOperation::RegisterRead), address_bytes, register) => {
                        SpiCommandBehavior::RegisterRead {
                            address_bytes,
                            register,
                        }
                    }
                    (None, Some(SpiCommandOperation::RegisterWrite), address_bytes, register) => {
                        SpiCommandBehavior::RegisterWrite {
                            address_bytes,
                            register,
                            timing: command.timing,
                        }
                    }
                    (None, Some(SpiCommandOperation::MemoryRead), Some(address_bytes), None) => {
                        SpiCommandBehavior::MemoryRead { address_bytes }
                    }
                    (None, Some(SpiCommandOperation::PageProgram), Some(address_bytes), None) => {
                        SpiCommandBehavior::PageProgram {
                            address_bytes,
                            timing: command.timing.unwrap_or(CommandTimingDefinition {
                                latency_us: 0,
                                busy_during_operation: false,
                            }),
                        }
                    }
                    (None, Some(SpiCommandOperation::SectorErase), Some(address_bytes), None) => {
                        SpiCommandBehavior::SectorErase {
                            address_bytes,
                            timing: command.timing.unwrap_or(CommandTimingDefinition {
                                latency_us: 0,
                                busy_during_operation: false,
                            }),
                        }
                    }
                    (None, Some(SpiCommandOperation::ChipErase), None, None) => {
                        SpiCommandBehavior::ChipErase {
                            timing: command.timing.unwrap_or(CommandTimingDefinition {
                                latency_us: 0,
                                busy_during_operation: false,
                            }),
                        }
                    }
                    _ => unreachable!("commands are validated while parsing"),
                };
                (
                    command.opcode,
                    SpiCommand {
                        name,
                        allowed_states: command.allowed_states,
                        event: command.event,
                        event_delay_us: command.event_delay_us,
                        wire: command.wire,
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
        let signals = SignalOutputs::compile(
            self.device.signals.as_ref(),
            &self.device.signal_bindings,
            &registers,
            Some(
                &self
                    .device
                    .state_machine
                    .as_ref()
                    .map(|machine| machine.states.keys().cloned().collect::<BTreeSet<_>>())
                    .unwrap_or_default(),
            ),
        )?;
        let signal_graph = self
            .signal_graph
            .map(|definition| SignalGraph::new(definition, self.package_root.unwrap_or_default()));
        let mut state = DeviceState {
            registers,
            memory: self.device.memory.map(|definition| FlashMemory {
                bytes: vec![
                    definition.erased_value;
                    usize::try_from(definition.size_bytes).unwrap_or(0)
                ],
                definition,
            }),
            scheduler: EventScheduler::new(),
            operation_busy: false,
            state_machine,
            state_delayed_events: Vec::new(),
            signal_graph,
            signal_events: Vec::new(),
            fault_engine: FaultEngine::new(self.device.faults),
            stuck_registers: Vec::new(),
        };
        initialize_state_machine(&mut state, clock.now_ns())?;
        Ok(GenericSpiDevice {
            id: self.device.id,
            commands,
            spi: self.device.spi.unwrap_or(SpiBusDefinition {
                mode: 0,
                transfer_bits: 8,
                max_frequency_hz: None,
                supports_dtr: false,
            }),
            clock,
            busy_binding: self.device.busy,
            signals,
            state: Mutex::new(state),
        })
    }
}
