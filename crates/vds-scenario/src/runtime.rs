use std::{sync::Arc, time::Duration};

use vds_core::{
    clock::{ManualClock, SimulatorClock},
    device::{DeviceError, DeviceTransfer},
    event::DeviceEvent,
    registry::DeviceRegistry,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedEvent {
    pub device_id: String,
    pub event: DeviceEvent,
}

pub trait ScenarioRuntime {
    fn now_ns(&self) -> u64;
    /// Advances simulator time and returns newly due events.
    ///
    /// # Errors
    /// Returns an error on clock overflow or event application failure.
    fn advance_time(&self, duration_ns: u64) -> Result<Vec<ObservedEvent>, String>;
    /// Resets a device through its public runtime API.
    ///
    /// # Errors
    /// Returns an error when reset fails.
    fn reset_device(&self, device: &str) -> Result<Vec<ObservedEvent>, String>;
    /// Sends an SPI transfer through the transaction router.
    ///
    /// # Errors
    /// Returns the structured error produced by the normal transfer path.
    fn send_spi(&self, device: &str, tx: &[u8]) -> Result<DeviceTransfer, DeviceError>;
    /// Updates a declarative fault's enabled state.
    ///
    /// # Errors
    /// Returns an error for missing or ambiguous fault IDs.
    fn set_fault_enabled(&self, fault: &str, enabled: bool) -> Result<(), String>;
    /// Reads a register through runtime inspection.
    ///
    /// # Errors
    /// Returns an error for unknown devices or registers.
    fn read_register(&self, device: &str, register: &str) -> Result<u64, String>;
    /// Reads the current device state.
    ///
    /// # Errors
    /// Returns an error when state cannot be inspected.
    fn current_state(&self, device: &str) -> Result<Option<String>, String>;
    /// Returns the earliest pending device deadline.
    ///
    /// # Errors
    /// Returns an error when scheduler state cannot be inspected.
    fn next_event_deadline_ns(&self) -> Result<Option<u64>, String>;
    /// Applies all currently due device events.
    ///
    /// # Errors
    /// Returns an error when an event cannot be applied.
    fn run_due_events(&self) -> Result<Vec<ObservedEvent>, String>;
}

pub struct RegistryRuntime {
    registry: Arc<DeviceRegistry>,
    clock: Arc<ManualClock>,
}

impl RegistryRuntime {
    #[must_use]
    pub fn new(registry: Arc<DeviceRegistry>, clock: Arc<ManualClock>) -> Self {
        Self { registry, clock }
    }
}

impl ScenarioRuntime for RegistryRuntime {
    fn now_ns(&self) -> u64 {
        self.clock.now_ns()
    }

    fn advance_time(&self, duration_ns: u64) -> Result<Vec<ObservedEvent>, String> {
        self.clock
            .advance(Duration::from_nanos(duration_ns))
            .map_err(|error| error.to_string())?;
        self.run_due_events()
    }

    fn reset_device(&self, device: &str) -> Result<Vec<ObservedEvent>, String> {
        self.registry
            .reset(device)
            .map(|events| {
                events
                    .into_iter()
                    .map(|event| ObservedEvent {
                        device_id: device.to_owned(),
                        event,
                    })
                    .collect()
            })
            .map_err(|error| error.to_string())
    }

    fn send_spi(&self, device: &str, tx: &[u8]) -> Result<DeviceTransfer, DeviceError> {
        self.registry.transfer(device, tx)
    }

    fn set_fault_enabled(&self, fault: &str, enabled: bool) -> Result<(), String> {
        match self
            .registry
            .set_fault_enabled(fault, enabled)
            .map_err(|error| error.to_string())?
        {
            1 => Ok(()),
            0 => Err(format!("fault '{fault}' was not found")),
            count => Err(format!(
                "fault '{fault}' is ambiguous across {count} devices"
            )),
        }
    }

    fn read_register(&self, device: &str, register: &str) -> Result<u64, String> {
        self.registry
            .read_register(device, register)
            .map_err(|error| error.to_string())
    }

    fn current_state(&self, device: &str) -> Result<Option<String>, String> {
        self.registry
            .current_state(device)
            .map_err(|error| error.to_string())
    }

    fn next_event_deadline_ns(&self) -> Result<Option<u64>, String> {
        self.registry
            .next_event_deadline_ns()
            .map_err(|error| error.to_string())
    }

    fn run_due_events(&self) -> Result<Vec<ObservedEvent>, String> {
        self.registry
            .run_due_events()
            .map(|events| {
                events
                    .into_iter()
                    .map(|(device_id, event)| ObservedEvent { device_id, event })
                    .collect()
            })
            .map_err(|error| error.to_string())
    }
}
