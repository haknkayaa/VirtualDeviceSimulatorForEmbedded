//! Thread-safe registration and lookup of virtual-device instances.

use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

use crate::device::{Device, DeviceError, DeviceTransfer, I2cMessage, SpiWireConfig};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceSnapshot {
    pub id: String,
    pub bus: String,
    pub state: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceFaultSnapshot {
    pub device_id: String,
    pub fault: crate::fault::FaultSnapshot,
}

/// Registry used by the transaction router to locate virtual devices.
#[derive(Default)]
pub struct DeviceRegistry {
    devices: RwLock<HashMap<String, Arc<dyn Device>>>,
    router: RwLock<Option<Arc<crate::topology::SignalRouter>>>,
}

impl DeviceRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a device and rejects duplicate identifiers.
    ///
    /// # Errors
    ///
    /// Returns an error when another device already uses the same identifier.
    pub fn register(&self, device: Arc<dyn Device>) -> Result<(), DeviceError> {
        let id = device.id().to_owned();
        let mut devices = self
            .devices
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if devices.contains_key(&id) {
            return Err(DeviceError::InvalidRequest(format!(
                "duplicate device id '{id}'"
            )));
        }
        devices.insert(id, device);
        Ok(())
    }

    /// Validates a topology against the registered devices and activates
    /// signal routing. Current signal levels are propagated immediately.
    ///
    /// # Errors
    /// Returns an error when the topology references unknown devices, ports or
    /// lines, has multiple drivers or a cycle, or the initial propagation fails.
    pub fn attach_topology(
        &self,
        topology: &crate::topology::Topology,
        clock: Arc<dyn crate::clock::SimulatorClock>,
    ) -> Result<(), crate::topology::TopologyError> {
        let router =
            crate::topology::SignalRouter::new(topology, &|id| self.device(id).ok(), clock)?;
        *self
            .router
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Arc::new(router));
        self.settle()
            .map_err(|error| crate::topology::TopologyError::Validation(error.to_string()))
    }

    /// Returns whether a topology with at least one connection is active.
    #[must_use]
    pub fn has_topology(&self) -> bool {
        self.router().is_some()
    }

    fn router(&self) -> Option<Arc<crate::topology::SignalRouter>> {
        self.router
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Propagates pending signal changes until stable.
    fn settle(&self) -> Result<(), DeviceError> {
        match self.router() {
            Some(router) => router.settle(&|id| self.device(id)),
            None => Ok(()),
        }
    }

    /// Returns the transaction result unless signal propagation itself failed.
    fn after_transaction<T>(&self, result: Result<T, DeviceError>) -> Result<T, DeviceError> {
        let settled = self.settle();
        let value = result?;
        settled?;
        Ok(value)
    }

    /// Routes a configured SPI transaction to a registered device.
    ///
    /// # Errors
    /// Returns an error when the device does not exist or rejects the transfer.
    pub fn transfer_spi(
        &self,
        device_id: &str,
        request: &[u8],
        rx_length: usize,
        wire: SpiWireConfig,
    ) -> Result<DeviceTransfer, DeviceError> {
        crate::device::validate_spi_transfer_size(request.len(), rx_length)?;
        let result = self
            .device(device_id)?
            .transfer_spi(request, rx_length, wire);
        self.after_transaction(result)
    }

    /// Routes an atomic I2C message sequence to a registered device.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or rejects the transfer.
    pub fn transfer_i2c(
        &self,
        device_id: &str,
        messages: &[I2cMessage],
    ) -> Result<Vec<Vec<u8>>, DeviceError> {
        crate::device::validate_i2c_transfer_size(messages)?;
        let result = self.device(device_id)?.transfer_i2c(messages);
        self.after_transaction(result)
    }

    /// Exchanges GPIO line levels with a registered GPIO device.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or rejects the line vector.
    pub fn exchange_gpio(
        &self,
        device_id: &str,
        host_values: &[bool],
    ) -> Result<Vec<bool>, DeviceError> {
        self.device(device_id)?.exchange_gpio(host_values)
    }

    /// Routes bytes received from a UART PTY to a registered device.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or rejects the byte stream.
    pub fn transfer_uart(
        &self,
        device_id: &str,
        request: &[u8],
    ) -> Result<DeviceTransfer, DeviceError> {
        self.device(device_id)?.transfer_uart(request)
    }

    /// Returns declarative GPIO line metadata for adapter provisioning.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or metadata is unavailable.
    pub fn gpio_lines(
        &self,
        device_id: &str,
    ) -> Result<Vec<crate::device::GpioLineSnapshot>, DeviceError> {
        self.device(device_id)?.gpio_lines()
    }

    /// Resets one registered device.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or rejects reset.
    pub fn reset(&self, device_id: &str) -> Result<Vec<crate::event::DeviceEvent>, DeviceError> {
        let result = self.device(device_id)?.reset();
        self.after_transaction(result)
    }

    /// Reads a register through a registered device's inspection API.
    ///
    /// # Errors
    /// Returns an error when the device or register is unknown.
    pub fn read_register(&self, device_id: &str, name: &str) -> Result<u64, DeviceError> {
        self.device(device_id)?.read_register(name)
    }

    /// Writes a register through a registered device's public control API.
    ///
    /// # Errors
    /// Returns an error when the device or register is unknown, read-only, or
    /// rejects the supplied value.
    pub fn write_register(
        &self,
        device_id: &str,
        address: u64,
        value: u64,
    ) -> Result<crate::device::RegisterTrace, DeviceError> {
        let result = self.device(device_id)?.write_register(address, value);
        self.after_transaction(result)
    }

    /// Returns a registered device's current state.
    ///
    /// # Errors
    /// Returns an error when the device is unknown or unavailable.
    pub fn current_state(&self, device_id: &str) -> Result<Option<String>, DeviceError> {
        self.device(device_id)?.current_state()
    }

    /// Updates matching fault definitions and returns the match count.
    ///
    /// # Errors
    /// Returns an error when a device fault runtime cannot be updated.
    pub fn set_fault_enabled(&self, fault_id: &str, enabled: bool) -> Result<usize, DeviceError> {
        let mut matched = 0;
        for device in self.device_values() {
            matched += usize::from(device.set_fault_enabled(fault_id, enabled)?);
        }
        Ok(matched)
    }

    /// Runs due events for every device in deterministic device-id order.
    ///
    /// # Errors
    /// Returns an error when a device cannot apply a due event.
    pub fn run_due_events(&self) -> Result<Vec<(String, crate::event::DeviceEvent)>, DeviceError> {
        let mut ids = self
            .devices
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        ids.sort();
        let mut events = Vec::new();
        for id in ids {
            for event in self.device(&id)?.run_due_events()? {
                events.push((id.clone(), event));
            }
        }
        self.settle()?;
        Ok(events)
    }

    /// Returns the earliest pending device deadline.
    ///
    /// # Errors
    /// Returns an error when scheduler state cannot be inspected.
    pub fn next_event_deadline_ns(&self) -> Result<Option<u64>, DeviceError> {
        let router_deadline = self.router().and_then(|router| router.next_deadline_ns());
        self.device_values()
            .iter()
            .try_fold(router_deadline, |next, device| {
                let deadline = device.next_event_deadline_ns()?;
                Ok(match (next, deadline) {
                    (Some(left), Some(right)) => Some(left.min(right)),
                    (None, deadline) | (deadline, None) => deadline,
                })
            })
    }

    /// Lists devices in deterministic ID order.
    ///
    /// # Errors
    /// Returns an error when device state cannot be inspected.
    pub fn snapshots(&self) -> Result<Vec<DeviceSnapshot>, DeviceError> {
        let mut devices = self
            .device_values()
            .iter()
            .map(|device| {
                Ok(DeviceSnapshot {
                    id: device.id().to_owned(),
                    bus: device.bus_type().to_string(),
                    state: device.current_state()?,
                })
            })
            .collect::<Result<Vec<_>, DeviceError>>()?;
        devices.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(devices)
    }

    /// Lists all faults in deterministic device and fault ID order.
    ///
    /// # Errors
    /// Returns an error when fault state cannot be inspected.
    pub fn fault_snapshots(&self) -> Result<Vec<DeviceFaultSnapshot>, DeviceError> {
        let mut faults = Vec::new();
        for device in self.device_values() {
            faults.extend(
                device
                    .faults()?
                    .into_iter()
                    .map(|fault| DeviceFaultSnapshot {
                        device_id: device.id().to_owned(),
                        fault,
                    }),
            );
        }
        faults.sort_by(|left, right| {
            (&left.device_id, &left.fault.id).cmp(&(&right.device_id, &right.fault.id))
        });
        Ok(faults)
    }

    /// Lists register snapshots for one device.
    ///
    /// # Errors
    /// Returns an error for unknown devices or unavailable register state.
    pub fn registers(
        &self,
        device_id: &str,
    ) -> Result<Vec<crate::device::RegisterSnapshot>, DeviceError> {
        self.device(device_id)?.registers()
    }

    /// Returns one device's virtual time.
    ///
    /// # Errors
    /// Returns an error for an unknown device.
    pub fn virtual_time_ns(&self, device_id: &str) -> Result<u64, DeviceError> {
        Ok(self.device(device_id)?.virtual_time_ns())
    }

    fn device(&self, device_id: &str) -> Result<Arc<dyn Device>, DeviceError> {
        self.devices
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(device_id)
            .cloned()
            .ok_or_else(|| DeviceError::NotFound(device_id.to_owned()))
    }

    fn device_values(&self) -> Vec<Arc<dyn Device>> {
        self.devices
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.devices
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.devices
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::device::{BusType, Device, DeviceError, DeviceTransfer};

    use super::DeviceRegistry;

    struct EchoDevice;

    impl Device for EchoDevice {
        fn id(&self) -> &'static str {
            "echo"
        }

        fn bus_type(&self) -> BusType {
            BusType::Spi
        }

        fn transfer(&self, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
            Ok(DeviceTransfer::response(request.to_vec()))
        }

        fn transfer_spi(
            &self,
            request: &[u8],
            _rx_length: usize,
            _wire: crate::device::SpiWireConfig,
        ) -> Result<DeviceTransfer, DeviceError> {
            self.transfer(request)
        }
    }

    #[test]
    fn routes_to_a_registered_device() {
        let registry = DeviceRegistry::new();
        registry
            .register(Arc::new(EchoDevice))
            .expect("device should register");

        let response = registry
            .transfer_spi("echo", &[0x9f], 0, crate::device::SpiWireConfig::default())
            .expect("transfer should succeed");

        assert_eq!(response.response, vec![0x9f]);
    }

    #[test]
    fn rejects_oversized_spi_and_i2c_length_fields() {
        let registry = DeviceRegistry::new();
        registry
            .register(Arc::new(EchoDevice))
            .expect("device should register");

        let spi = registry.transfer_spi(
            "echo",
            &[0x03],
            usize::MAX,
            crate::device::SpiWireConfig::default(),
        );
        assert!(matches!(spi, Err(DeviceError::InvalidRequest(_))));

        let i2c = registry.transfer_i2c(
            "echo",
            &[crate::device::I2cMessage {
                read: true,
                data: Vec::new(),
                read_length: u32::MAX as usize,
            }],
        );
        assert!(matches!(i2c, Err(DeviceError::InvalidRequest(_))));
    }

    #[test]
    fn reports_an_unknown_device() {
        let registry = DeviceRegistry::new();

        assert_eq!(
            registry.transfer_spi(
                "missing",
                &[0x9f],
                0,
                crate::device::SpiWireConfig::default()
            ),
            Err(DeviceError::NotFound("missing".to_owned()))
        );
    }
}
