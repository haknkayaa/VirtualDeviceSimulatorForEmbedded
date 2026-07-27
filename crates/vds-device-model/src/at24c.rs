use std::sync::{Arc, Mutex};

use vds_core::{
    clock::SimulatorClock,
    device::{
        BusType, Device, DeviceError, DeviceTransfer, I2cMessage, TimingErrorCode, TimingFailure,
    },
};

use crate::{I2cBusDefinition, MemoryDefinition, ModelError};

struct At24cState {
    pointer: usize,
    memory: Vec<u8>,
    busy_until_ns: Option<u64>,
}

/// AT24C128/AT24C256 serial EEPROM runtime derived from Atmel datasheet 0670T.
pub struct At24cEepromDevice {
    id: String,
    i2c: I2cBusDefinition,
    memory: MemoryDefinition,
    clock: Arc<dyn SimulatorClock>,
    state: Mutex<At24cState>,
}

impl At24cEepromDevice {
    pub(crate) fn new(
        id: String,
        i2c: I2cBusDefinition,
        memory: MemoryDefinition,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<Self, ModelError> {
        let size = usize::try_from(memory.size_bytes).map_err(|_| ModelError::InvalidMemory {
            reason: "AT24C capacity is too large".to_owned(),
        })?;
        if !matches!(size, 16_384 | 32_768) {
            return Err(ModelError::InvalidMemory {
                reason: "AT24C128/256 capacity must be 16384 or 32768 bytes".to_owned(),
            });
        }
        if memory.page_size_bytes != 64 {
            return Err(ModelError::InvalidMemory {
                reason: "AT24C128/256 page size must be 64 bytes".to_owned(),
            });
        }
        if i2c.register_address_bytes != 2 {
            return Err(ModelError::InvalidMemory {
                reason: "AT24C128/256 requires a two-byte word address".to_owned(),
            });
        }
        if i2c.write_cycle_us.is_none() {
            return Err(ModelError::InvalidMemory {
                reason: "AT24C128/256 requires write_cycle_us".to_owned(),
            });
        }
        Ok(Self {
            id,
            i2c,
            memory,
            clock,
            state: Mutex::new(At24cState {
                pointer: 0,
                memory: vec![memory.erased_value; size],
                busy_until_ns: None,
            }),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, At24cState>, DeviceError> {
        self.state.lock().map_err(|_| {
            DeviceError::InvalidRequest(format!("AT24C device '{}' state is unavailable", self.id))
        })
    }

    fn reject_while_busy(&self, state: &mut At24cState) -> Result<(), DeviceError> {
        let now_ns = self.clock.now_ns();
        let Some(deadline_ns) = state.busy_until_ns else {
            return Ok(());
        };
        if now_ns >= deadline_ns {
            state.busy_until_ns = None;
            return Ok(());
        }
        Err(DeviceError::Timing(TimingFailure {
            code: TimingErrorCode::DeviceBusy,
            command: "I2C_ACK_POLL".to_owned(),
            now_ns,
            deadline_ns: Some(deadline_ns),
            message: format!(
                "AT24C device '{}' is in its self-timed write cycle",
                self.id
            ),
        }))
    }

    fn decode_pointer(&self, bytes: &[u8]) -> usize {
        bytes
            .iter()
            .fold(0_usize, |value, byte| (value << 8) | usize::from(*byte))
            % usize::try_from(self.memory.size_bytes).expect("validated AT24C capacity")
    }
}

impl Device for At24cEepromDevice {
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

    fn transfer_spi(
        &self,
        _request: &[u8],
        _rx_length: usize,
        _wire: vds_core::device::SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest(
            "AT24C devices do not support SPI transfers".to_owned(),
        ))
    }

    fn transfer_i2c(&self, messages: &[I2cMessage]) -> Result<Vec<Vec<u8>>, DeviceError> {
        if messages.is_empty() {
            return Err(DeviceError::InvalidRequest(
                "AT24C transfer requires at least one I2C message".to_owned(),
            ));
        }
        let mut state = self.lock()?;
        self.reject_while_busy(&mut state)?;
        let capacity = state.memory.len();
        let page_size =
            usize::try_from(self.memory.page_size_bytes).expect("validated AT24C page size");
        let mut reads = Vec::new();

        for message in messages {
            if message.read {
                if !message.data.is_empty() {
                    return Err(DeviceError::InvalidRequest(
                        "AT24C read message cannot contain write data".to_owned(),
                    ));
                }
                let mut response = Vec::with_capacity(message.read_length);
                for _ in 0..message.read_length {
                    response.push(state.memory[state.pointer]);
                    state.pointer = (state.pointer + 1) % capacity;
                }
                reads.push(response);
                continue;
            }
            if message.read_length != 0 {
                return Err(DeviceError::InvalidRequest(
                    "AT24C write message cannot request read bytes".to_owned(),
                ));
            }
            if message.data.is_empty() {
                continue;
            }
            if message.data.len() < 2 {
                return Err(DeviceError::InvalidRequest(
                    "AT24C write requires a two-byte word address".to_owned(),
                ));
            }

            let start = self.decode_pointer(&message.data[..2]);
            state.pointer = start;
            let payload = &message.data[2..];
            if payload.is_empty() {
                continue;
            }
            let page_base = start - (start % page_size);
            for (index, byte) in payload.iter().enumerate() {
                let address = page_base + ((start % page_size + index) % page_size);
                if !self.i2c.write_protect {
                    state.memory[address] = *byte;
                }
                state.pointer = (address + 1) % capacity;
            }
            if !self.i2c.write_protect {
                let cycle_ns = self
                    .i2c
                    .write_cycle_us
                    .expect("validated AT24C write cycle")
                    .saturating_mul(1_000);
                state.busy_until_ns = Some(self.clock.now_ns().saturating_add(cycle_ns));
            }
        }
        Ok(reads)
    }

    fn reset(&self) -> Result<Vec<vds_core::event::DeviceEvent>, DeviceError> {
        let mut state = self.lock()?;
        state.pointer = 0;
        state.busy_until_ns = None;
        // EEPROM contents survive reset and power-cycle style runtime resets.
        Ok(Vec::new())
    }

    fn virtual_time_ns(&self) -> u64 {
        self.clock.now_ns()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use vds_core::clock::ManualClock;

    use super::*;

    fn device(size_bytes: u64, write_protect: bool) -> (At24cEepromDevice, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock::default());
        let runtime = At24cEepromDevice::new(
            "at24c".to_owned(),
            I2cBusDefinition {
                register_address_bytes: 2,
                auto_increment: true,
                write_cycle_us: Some(5_000),
                write_protect,
            },
            MemoryDefinition {
                size_bytes,
                page_size_bytes: 64,
                sector_size_bytes: 64,
                erased_value: 0xff,
            },
            clock.clone(),
        )
        .unwrap();
        (runtime, clock)
    }

    #[test]
    fn supports_random_current_and_sequential_reads_with_capacity_rollover() {
        let (device, clock) = device(16_384, false);
        device
            .transfer_i2c(&[I2cMessage {
                read: false,
                data: vec![0x3f, 0xff, 0x12],
                read_length: 0,
            }])
            .unwrap();
        assert!(matches!(
            device.transfer_i2c(&[I2cMessage {
                read: true,
                data: Vec::new(),
                read_length: 1,
            }]),
            Err(DeviceError::Timing(_))
        ));
        clock.advance(Duration::from_millis(5)).unwrap();
        let reads = device
            .transfer_i2c(&[
                I2cMessage {
                    read: false,
                    data: vec![0x3f, 0xff],
                    read_length: 0,
                },
                I2cMessage {
                    read: true,
                    data: Vec::new(),
                    read_length: 2,
                },
            ])
            .unwrap();
        assert_eq!(reads, [vec![0x12, 0xff]]);
    }

    #[test]
    fn page_write_wraps_within_the_same_64_byte_page() {
        let (device, clock) = device(32_768, false);
        device
            .transfer_i2c(&[I2cMessage {
                read: false,
                data: vec![0x00, 0x3f, 0xaa, 0xbb],
                read_length: 0,
            }])
            .unwrap();
        clock.advance(Duration::from_millis(5)).unwrap();
        let reads = device
            .transfer_i2c(&[
                I2cMessage {
                    read: false,
                    data: vec![0x00, 0x00],
                    read_length: 0,
                },
                I2cMessage {
                    read: true,
                    data: Vec::new(),
                    read_length: 1,
                },
            ])
            .unwrap();
        assert_eq!(reads, [vec![0xbb]]);
    }

    #[test]
    fn write_protect_inhibits_the_entire_memory() {
        let (device, _) = device(32_768, true);
        device
            .transfer_i2c(&[I2cMessage {
                read: false,
                data: vec![0x00, 0x10, 0x00],
                read_length: 0,
            }])
            .unwrap();
        let reads = device
            .transfer_i2c(&[
                I2cMessage {
                    read: false,
                    data: vec![0x00, 0x10],
                    read_length: 0,
                },
                I2cMessage {
                    read: true,
                    data: Vec::new(),
                    read_length: 1,
                },
            ])
            .unwrap();
        assert_eq!(reads, [vec![0xff]]);
    }
}
