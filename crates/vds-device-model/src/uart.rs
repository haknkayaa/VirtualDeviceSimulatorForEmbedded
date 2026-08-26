use std::sync::Mutex;
use vds_core::device::{BusType, Device, DeviceError, DeviceTransfer, SpiWireConfig};

use crate::UartBusDefinition;

/// Deterministic byte-oriented UART request/response runtime.
pub struct GenericUartDevice {
    id: String,
    definition: UartBusDefinition,
    pending: Mutex<Vec<u8>>,
}

impl GenericUartDevice {
    pub(crate) fn new(id: String, definition: UartBusDefinition) -> Self {
        Self {
            id,
            definition,
            pending: Mutex::new(Vec::new()),
        }
    }
}

impl Device for GenericUartDevice {
    fn id(&self) -> &str {
        &self.id
    }

    fn bus_type(&self) -> BusType {
        BusType::Uart
    }

    fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        self.transfer_uart(request)
    }

    fn transfer_spi(
        &self,
        _request: &[u8],
        _rx_length: usize,
        _wire: SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError> {
        Err(DeviceError::InvalidRequest(format!(
            "device '{}' does not support SPI transfers",
            self.id
        )))
    }

    fn transfer_uart(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        if request.is_empty() {
            return Err(DeviceError::InvalidRequest(
                "UART transfer must contain at least one byte".to_owned(),
            ));
        }
        let mut pending = self.pending.lock().map_err(|_| {
            DeviceError::InvalidRequest("UART receive buffer lock is poisoned".to_owned())
        })?;
        pending.extend_from_slice(request);
        let mut response = Vec::new();
        loop {
            if let Some(rule) = self
                .definition
                .responses
                .iter()
                .find(|rule| pending.starts_with(&rule.request))
            {
                response.extend_from_slice(&rule.response);
                pending.drain(..rule.request.len());
                if pending.is_empty() {
                    break;
                }
                continue;
            }
            if self
                .definition
                .responses
                .iter()
                .any(|rule| rule.request.starts_with(pending.as_slice()))
            {
                break;
            }
            let rejected = std::mem::take(&mut *pending);
            return Err(DeviceError::InvalidRequest(format!(
                "UART device '{}' has no response for stream {:02x?}",
                self.id, rejected
            )));
        }
        Ok(DeviceTransfer::response(response))
    }

    fn reset(&self) -> Result<Vec<vds_core::event::DeviceEvent>, DeviceError> {
        self.pending
            .lock()
            .map_err(|_| {
                DeviceError::InvalidRequest("UART receive buffer lock is poisoned".to_owned())
            })?
            .clear();
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{UartParity, UartResponseDefinition};

    fn device() -> GenericUartDevice {
        GenericUartDevice::new(
            "serial-0".to_owned(),
            UartBusDefinition {
                baud_rate: 115_200,
                data_bits: 8,
                stop_bits: 1,
                parity: UartParity::None,
                responses: vec![UartResponseDefinition {
                    request: b"PING\r\n".to_vec(),
                    response: b"PONG\r\n".to_vec(),
                }],
            },
        )
    }

    #[test]
    fn matches_across_arbitrary_stream_chunks() {
        let device = device();
        assert!(device.transfer_uart(b"PI").unwrap().response.is_empty());
        assert_eq!(
            device.transfer_uart(b"NG\r\n").unwrap().response,
            b"PONG\r\n"
        );
    }

    #[test]
    fn handles_multiple_frames_in_one_chunk() {
        let device = device();
        assert_eq!(
            device.transfer_uart(b"PING\r\nPING\r\n").unwrap().response,
            b"PONG\r\nPONG\r\n"
        );
    }
}
