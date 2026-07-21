use std::{collections::HashMap, sync::Arc};

use crate::device::{Device, DeviceError, DeviceTransfer};

/// Registry used by the transaction router to locate virtual devices.
#[derive(Default)]
pub struct DeviceRegistry {
    devices: HashMap<String, Arc<dyn Device>>,
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
    pub fn register(&mut self, device: Arc<dyn Device>) -> Result<(), DeviceError> {
        let id = device.id().to_owned();
        if self.devices.contains_key(&id) {
            return Err(DeviceError::InvalidRequest(format!(
                "duplicate device id '{id}'"
            )));
        }
        self.devices.insert(id, device);
        Ok(())
    }

    /// Routes a transfer to a registered device.
    ///
    /// # Errors
    ///
    /// Returns an error when the device does not exist or rejects the transfer.
    pub fn transfer(&self, device_id: &str, request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        let device = self
            .devices
            .get(device_id)
            .ok_or_else(|| DeviceError::NotFound(device_id.to_owned()))?;
        device.transfer(request)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.devices.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.devices.is_empty()
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
    }

    #[test]
    fn routes_to_a_registered_device() {
        let mut registry = DeviceRegistry::new();
        registry
            .register(Arc::new(EchoDevice))
            .expect("device should register");

        let response = registry
            .transfer("echo", &[0x9f])
            .expect("transfer should succeed");

        assert_eq!(response.response, vec![0x9f]);
    }

    #[test]
    fn reports_an_unknown_device() {
        let registry = DeviceRegistry::new();

        assert_eq!(
            registry.transfer("missing", &[0x9f]),
            Err(DeviceError::NotFound("missing".to_owned()))
        );
    }
}
