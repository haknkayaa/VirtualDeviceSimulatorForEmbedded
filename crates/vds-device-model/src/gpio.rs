//! Generic declarative GPIO device runtime.

use std::sync::Mutex;

use vds_core::device::{
    BusType, Device, DeviceError, DeviceTransfer, GpioLineSnapshot, RegisterOperation,
    RegisterSnapshot, RegisterTrace,
};
use vds_registers::{RegisterDefinition, RegisterEngine};

use crate::{
    GpioBusDefinition, GpioLineDefinition, GpioLineDirection, ModelError, map_access,
    map_register_error,
};

struct GpioState {
    values: Vec<bool>,
    registers: RegisterEngine,
}

/// Declarative GPIO bank runtime indexed by Linux GPIO line offset.
pub struct GenericGpioDevice {
    id: String,
    lines: Vec<GpioLineDefinition>,
    register_addresses: Vec<Option<u64>>,
    state: Mutex<GpioState>,
}

impl GenericGpioDevice {
    pub(crate) fn new(
        id: String,
        definition: GpioBusDefinition,
        register_definitions: Vec<RegisterDefinition>,
    ) -> Result<Self, ModelError> {
        let values = definition
            .lines
            .iter()
            .map(|line| line.initial_value)
            .collect();
        let registers = RegisterEngine::new(register_definitions)?;
        let register_addresses = definition
            .lines
            .iter()
            .map(|line| {
                line.register
                    .as_deref()
                    .map(|name| {
                        registers
                            .metadata_by_name(name)
                            .map(|metadata| metadata.address)
                            .ok_or_else(|| ModelError::UnknownStateRegister {
                                name: name.to_owned(),
                            })
                    })
                    .transpose()
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            id,
            lines: definition.lines,
            register_addresses,
            state: Mutex::new(GpioState { values, registers }),
        })
    }

    #[must_use]
    pub fn line_count(&self) -> usize {
        self.lines.len()
    }
}

impl Device for GenericGpioDevice {
    fn id(&self) -> &str {
        &self.id
    }

    fn bus_type(&self) -> BusType {
        BusType::Gpio
    }

    fn transfer(&self, _request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest(
            "GPIO devices use line exchange transactions".to_owned(),
        ))
    }

    fn transfer_spi(
        &self,
        _request: &[u8],
        _rx_length: usize,
        _wire: vds_core::device::SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest(
            "GPIO devices do not support SPI transfers".to_owned(),
        ))
    }

    fn exchange_gpio(&self, host_values: &[bool]) -> Result<Vec<bool>, DeviceError> {
        if host_values.len() != self.lines.len() {
            return Err(DeviceError::InvalidRequest(format!(
                "GPIO device '{}' expects {} lines but received {}",
                self.id,
                self.lines.len(),
                host_values.len()
            )));
        }
        let mut state = self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("GPIO device '{}' state is unavailable", self.id))
        })?;
        for (index, line) in self.lines.iter().enumerate() {
            if line.direction == GpioLineDirection::Input {
                state.values[index] = host_values[index] ^ line.active_low;
                if let Some(address) = self.register_addresses[index] {
                    let line_value = u64::from(state.values[index]);
                    state
                        .registers
                        .write_internal(address, line_value)
                        .map_err(|error| {
                            map_register_error(&error, RegisterOperation::Write, Some(line_value))
                        })?;
                }
            } else if let Some(address) = self.register_addresses[index] {
                state.values[index] = state
                    .registers
                    .read_internal(address)
                    .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))?
                    .value
                    != 0;
            }
        }
        Ok(self
            .lines
            .iter()
            .enumerate()
            .map(|(index, line)| state.values[index] ^ line.active_low)
            .collect())
    }

    fn gpio_lines(&self) -> Result<Vec<GpioLineSnapshot>, DeviceError> {
        Ok(self
            .lines
            .iter()
            .map(|line| GpioLineSnapshot {
                offset: line.offset,
                name: line.name.clone(),
            })
            .collect())
    }

    fn reset(&self) -> Result<Vec<vds_core::event::DeviceEvent>, DeviceError> {
        let mut state = self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("GPIO device '{}' state is unavailable", self.id))
        })?;
        for (value, line) in state.values.iter_mut().zip(&self.lines) {
            *value = line.initial_value;
        }
        state.registers.reset();
        Ok(Vec::new())
    }

    fn read_register(&self, name: &str) -> Result<u64, DeviceError> {
        let state = self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("GPIO device '{}' state is unavailable", self.id))
        })?;
        let metadata = state.registers.metadata_by_name(name).ok_or_else(|| {
            DeviceError::InvalidRequest(format!("unknown GPIO register '{name}'"))
        })?;
        state
            .registers
            .read(metadata.address)
            .map(|read| read.value)
            .map_err(|error| map_register_error(&error, RegisterOperation::Read, None))
    }

    fn write_register(&self, address: u64, value: u64) -> Result<RegisterTrace, DeviceError> {
        let mut state = self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("GPIO device '{}' state is unavailable", self.id))
        })?;
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

    fn registers(&self) -> Result<Vec<RegisterSnapshot>, DeviceError> {
        let state = self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("GPIO device '{}' state is unavailable", self.id))
        })?;
        Ok(state
            .registers
            .snapshots()
            .into_iter()
            .map(|snapshot| RegisterSnapshot {
                name: snapshot.register.name,
                address: snapshot.register.address,
                width_bits: snapshot.register.width_bits,
                access: map_access(snapshot.register.access),
                value: snapshot.value,
                reset_value: snapshot.register.reset_value,
                description: snapshot.register.description,
                bitfields: Vec::new(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vds_registers::AccessType;

    #[test]
    fn exchanges_host_inputs_and_device_outputs() {
        let device = GenericGpioDevice::new(
            "gpio-bank".to_owned(),
            GpioBusDefinition {
                lines: vec![
                    GpioLineDefinition {
                        offset: 0,
                        name: "button".to_owned(),
                        direction: GpioLineDirection::Input,
                        initial_value: false,
                        active_low: false,
                        register: None,
                    },
                    GpioLineDefinition {
                        offset: 1,
                        name: "ready_n".to_owned(),
                        direction: GpioLineDirection::Output,
                        initial_value: true,
                        active_low: true,
                        register: Some("READY_STATE".to_owned()),
                    },
                ],
            },
            vec![RegisterDefinition {
                name: "READY_STATE".to_owned(),
                address: 1,
                width_bits: 1,
                reset_value: 1,
                access: AccessType::Rw,
                description: String::new(),
                bitfields: Vec::new(),
            }],
        )
        .unwrap();
        assert_eq!(device.exchange_gpio(&[true, false]).unwrap(), [true, false]);
        device.write_register(1, 0).unwrap();
        assert_eq!(device.exchange_gpio(&[true, false]).unwrap(), [true, true]);
    }
}
