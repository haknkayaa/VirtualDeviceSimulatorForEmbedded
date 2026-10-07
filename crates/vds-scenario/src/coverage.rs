//! Scenario coverage of declared device-model behavior (ADR 0013).
//!
//! Targets are what each device model declares; observations are what a run
//! exercised through normal device paths. Inspection reads are not observations.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use vds_core::{device::RegisterTrace, event::DeviceEvent};
use vds_device_model::DeviceModel;

use crate::{ScenarioAction, ScenarioDocument};

/// Behavior one device model declares.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DeviceCoverageTargets {
    /// SPI command opcode → command name.
    pub commands: BTreeMap<u8, String>,
    /// Register address → register name.
    pub registers: BTreeMap<u64, String>,
    pub states: BTreeSet<String>,
    /// Declared `(from, to)` state-machine transitions.
    pub transitions: BTreeSet<(String, String)>,
    pub faults: BTreeSet<String>,
}

impl DeviceCoverageTargets {
    #[must_use]
    pub fn from_model(model: &DeviceModel) -> Self {
        let device = &model.device;
        let mut targets = Self {
            commands: device
                .commands
                .iter()
                .map(|command| (command.opcode, command.name.clone()))
                .collect(),
            registers: device
                .registers
                .iter()
                .map(|register| (register.address, register.name.clone()))
                .collect(),
            faults: device.faults.iter().map(|fault| fault.id.clone()).collect(),
            ..Self::default()
        };
        if let Some(machine) = &device.state_machine {
            for (state, definition) in &machine.states {
                targets.states.insert(state.clone());
                for transition in &definition.transitions {
                    targets
                        .transitions
                        .insert((state.clone(), transition.target.clone()));
                }
            }
        }
        targets
    }
}

/// Declared behavior of every device a run can touch, keyed by device ID.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CoverageTargets {
    devices: BTreeMap<String, DeviceCoverageTargets>,
}

impl CoverageTargets {
    /// Targets for models whose device IDs are the runtime device IDs.
    #[must_use]
    pub fn from_models<'a>(models: impl IntoIterator<Item = &'a DeviceModel>) -> Self {
        Self {
            devices: models
                .into_iter()
                .map(|model| {
                    (
                        model.device.id.clone(),
                        DeviceCoverageTargets::from_model(model),
                    )
                })
                .collect(),
        }
    }

    pub fn insert(&mut self, device_id: impl Into<String>, targets: DeviceCoverageTargets) {
        self.devices.insert(device_id.into(), targets);
    }

    #[must_use]
    pub fn device(&self, device_id: &str) -> Option<&DeviceCoverageTargets> {
        self.devices.get(device_id)
    }

    /// Devices a scenario names directly, plus owners of faults it toggles.
    #[must_use]
    pub fn scope(&self, document: &ScenarioDocument) -> Vec<String> {
        let mut devices = document
            .referenced_devices()
            .into_iter()
            .filter(|device| self.devices.contains_key(device))
            .collect::<BTreeSet<_>>();
        for step in &document.steps {
            if let ScenarioAction::EnableFault { fault } | ScenarioAction::DisableFault { fault } =
                &step.action
            {
                devices.extend(
                    self.devices
                        .iter()
                        .filter(|(_, targets)| targets.faults.contains(fault))
                        .map(|(device, _)| device.clone()),
                );
            }
        }
        devices.into_iter().collect()
    }
}

/// Covered and declared items of one kind.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CoverageMetric {
    pub covered: usize,
    pub total: usize,
    /// Declared items the run did not exercise: commands by opcode, registers
    /// by address, states, transitions and faults by name.
    pub missed: Vec<String>,
}

impl CoverageMetric {
    /// Builds a metric from `(item, exercised)` pairs.
    fn measure(items: impl IntoIterator<Item = (String, bool)>) -> Self {
        let mut metric = Self::default();
        for (item, exercised) in items {
            metric.total += 1;
            if exercised {
                metric.covered += 1;
            } else {
                metric.missed.push(item);
            }
        }
        metric
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeviceCoverage {
    pub device_id: String,
    pub commands: CoverageMetric,
    pub registers: CoverageMetric,
    pub states: CoverageMetric,
    pub transitions: CoverageMetric,
    pub faults: CoverageMetric,
}

impl DeviceCoverage {
    /// `(metric name, metric)` pairs in report order.
    #[must_use]
    pub fn metrics(&self) -> [(&'static str, &CoverageMetric); 5] {
        [
            ("commands", &self.commands),
            ("registers", &self.registers),
            ("states", &self.states),
            ("transitions", &self.transitions),
            ("faults", &self.faults),
        ]
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ScenarioCoverage {
    pub devices: Vec<DeviceCoverage>,
}

/// Formats a transition the way coverage reports name it.
#[must_use]
pub fn transition_label(from: &str, to: &str) -> String {
    format!("{from} -> {to}")
}

/// What one run exercised, per device.
#[derive(Debug, Default)]
pub(crate) struct CoverageRecorder {
    opcodes: BTreeSet<(String, u8)>,
    registers: BTreeSet<(String, u64)>,
    register_names: BTreeSet<(String, String)>,
    states: BTreeSet<(String, String)>,
    transitions: BTreeSet<(String, String, String)>,
    faults: BTreeSet<(String, String)>,
}

impl CoverageRecorder {
    pub(crate) fn spi_request(&mut self, device: &str, request: &[u8]) {
        if let Some(&opcode) = request.first() {
            self.opcodes.insert((device.to_owned(), opcode));
        }
    }

    pub(crate) fn register(&mut self, device: &str, trace: &RegisterTrace) {
        self.registers.insert((device.to_owned(), trace.address));
        if let Some(name) = &trace.name {
            self.register_names
                .insert((device.to_owned(), name.clone()));
        }
    }

    pub(crate) fn state(&mut self, device: &str, state: &str) {
        self.states.insert((device.to_owned(), state.to_owned()));
    }

    pub(crate) fn event(&mut self, device: &str, event: &DeviceEvent) {
        match event {
            DeviceEvent::StateTransition {
                from_state,
                to_state,
                ..
            } => {
                self.state(device, from_state);
                self.state(device, to_state);
                self.transitions
                    .insert((device.to_owned(), from_state.clone(), to_state.clone()));
            }
            DeviceEvent::OperationCompleted { register, .. } => self.register(device, register),
            DeviceEvent::FaultTriggered { fault_id, .. } => {
                self.faults.insert((device.to_owned(), fault_id.clone()));
            }
            DeviceEvent::OperationStarted { .. } | DeviceEvent::FaultDelayCompleted { .. } => {}
        }
    }

    pub(crate) fn report(&self, targets: &CoverageTargets, devices: &[String]) -> ScenarioCoverage {
        let devices = devices
            .iter()
            .filter_map(|device_id| {
                let declared = targets.device(device_id)?;
                let owned = |item: &str| (device_id.clone(), item.to_owned());
                Some(DeviceCoverage {
                    device_id: device_id.clone(),
                    commands: CoverageMetric::measure(declared.commands.iter().map(
                        |(opcode, name)| {
                            let exercised = self.opcodes.contains(&(device_id.clone(), *opcode));
                            (name.clone(), exercised)
                        },
                    )),
                    registers: CoverageMetric::measure(declared.registers.iter().map(
                        |(address, name)| {
                            let exercised = self.registers.contains(&(device_id.clone(), *address))
                                || self.register_names.contains(&owned(name));
                            (name.clone(), exercised)
                        },
                    )),
                    states: CoverageMetric::measure(
                        declared
                            .states
                            .iter()
                            .map(|state| (state.clone(), self.states.contains(&owned(state)))),
                    ),
                    transitions: CoverageMetric::measure(declared.transitions.iter().map(
                        |(from, to)| {
                            let exercised = self.transitions.contains(&(
                                device_id.clone(),
                                from.clone(),
                                to.clone(),
                            ));
                            (transition_label(from, to), exercised)
                        },
                    )),
                    faults: CoverageMetric::measure(
                        declared
                            .faults
                            .iter()
                            .map(|fault| (fault.clone(), self.faults.contains(&owned(fault)))),
                    ),
                })
            })
            .collect();
        ScenarioCoverage { devices }
    }
}
