use std::sync::Mutex;

use vds_core::device::{
    BusType, Device, DeviceError, DeviceTransfer, I2cMessage, RegisterOperation, RegisterSnapshot,
    RegisterTrace,
};
use vds_registers::{RegisterDefinition, RegisterEngine};

use crate::{I2cBusDefinition, ModelError, map_access, map_register_error};

struct I2cState {
    pointer: u64,
    registers: RegisterEngine,
}

/// Declarative byte-register I2C device with Linux combined-transfer semantics.
pub struct GenericI2cDevice {
    id: String,
    definition: I2cBusDefinition,
    state: Mutex<I2cState>,
}

impl GenericI2cDevice {
    pub(crate) fn new(
        id: String,
        definition: I2cBusDefinition,
        registers: Vec<RegisterDefinition>,
    ) -> Result<Self, ModelError> {
        Ok(Self {
            id,
            definition,
            state: Mutex::new(I2cState {
                pointer: 0,
                registers: RegisterEngine::new(registers)?,
            }),
        })
    }

    fn pointer_from(&self, bytes: &[u8]) -> u64 {
        bytes
            .iter()
            .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte))
    }

    fn advance(&self, pointer: &mut u64) {
        if self.definition.auto_increment {
            *pointer = pointer.saturating_add(1);
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, I2cState>, DeviceError> {
        self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("I2C device '{}' state is unavailable", self.id))
        })
    }
}

impl Device for GenericI2cDevice {
    fn id(&self) -> &str {
        &self.id
    }

    fn bus_type(&self) -> BusType {
        BusType::I2c
    }

    fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        self.transfer_i2c(&[I2cMessage {
            read: false,
            data: request.to_vec(),
            read_length: 0,
        }])?;
        Ok(DeviceTransfer::response(Vec::new()))
    }

    fn transfer_i2c(&self, messages: &[I2cMessage]) -> Result<Vec<Vec<u8>>, DeviceError> {
        if messages.is_empty() {
            return Err(DeviceError::InvalidRequest(
                "I2C transfer requires at least one message".to_owned(),
            ));
        }
        let address_bytes = usize::from(self.definition.register_address_bytes);
        let mut state = self.lock()?;
        let mut reads = Vec::new();
        for message in messages {
            if message.read {
                if !message.data.is_empty() {
                    return Err(DeviceError::InvalidRequest(
                        "I2C read message cannot contain write data".to_owned(),
                    ));
                }
                let mut response = Vec::with_capacity(message.read_length);
                for _ in 0..message.read_length {
                    let read = state.registers.read(state.pointer).map_err(|error| {
                        map_register_error(&error, RegisterOperation::Read, None)
                    })?;
                    response.push(u8::try_from(read.value).map_err(|_| {
                        DeviceError::InvalidRequest(format!(
                            "I2C register 0x{:X} does not fit one byte",
                            state.pointer
                        ))
                    })?);
                    self.advance(&mut state.pointer);
                }
                reads.push(response);
                continue;
            }
            if message.read_length != 0 {
                return Err(DeviceError::InvalidRequest(
                    "I2C write message cannot request read bytes".to_owned(),
                ));
            }
            if message.data.is_empty() {
                continue;
            }
            if message.data.len() < address_bytes {
                return Err(DeviceError::InvalidRequest(format!(
                    "I2C write requires {address_bytes} register-address bytes"
                )));
            }
            state.pointer = self.pointer_from(&message.data[..address_bytes]);
            for byte in &message.data[address_bytes..] {
                let pointer = state.pointer;
                state
                    .registers
                    .write(pointer, u64::from(*byte))
                    .map_err(|error| {
                        map_register_error(&error, RegisterOperation::Write, Some(u64::from(*byte)))
                    })?;
                self.advance(&mut state.pointer);
            }
        }
        Ok(reads)
    }

    fn reset(&self) -> Result<Vec<vds_core::event::DeviceEvent>, DeviceError> {
        let mut state = self.lock()?;
        state.pointer = 0;
        state.registers.reset();
        Ok(Vec::new())
    }

    fn read_register(&self, name: &str) -> Result<u64, DeviceError> {
        let state = self.lock()?;
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
        let mut state = self.lock()?;
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
        Ok(self
            .lock()?
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use vds_registers::AccessType;

    #[test]
    fn supports_combined_register_write_and_read() {
        let device = GenericI2cDevice::new(
            "sensor".to_owned(),
            I2cBusDefinition {
                register_address_bytes: 1,
                auto_increment: true,
            },
            vec![
                RegisterDefinition {
                    name: "who_am_i".to_owned(),
                    address: 0x0f,
                    width_bits: 8,
                    reset_value: 0x42,
                    access: AccessType::Ro,
                    description: String::new(),
                    bitfields: Vec::new(),
                },
                RegisterDefinition {
                    name: "control".to_owned(),
                    address: 0x10,
                    width_bits: 8,
                    reset_value: 0,
                    access: AccessType::Rw,
                    description: String::new(),
                    bitfields: Vec::new(),
                },
            ],
        )
        .unwrap();
        let reads = device
            .transfer_i2c(&[
                I2cMessage {
                    read: false,
                    data: vec![0x0f],
                    read_length: 0,
                },
                I2cMessage {
                    read: true,
                    data: Vec::new(),
                    read_length: 2,
                },
            ])
            .unwrap();
        assert_eq!(reads, [vec![0x42, 0x00]]);
    }
}
