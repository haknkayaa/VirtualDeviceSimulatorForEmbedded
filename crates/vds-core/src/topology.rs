//! Board topology: connections between public device signal ports.
//!
//! A topology wires a device's public output signal (`imu0.drdy`) to a named
//! line of a GPIO bank device (`gpio0.DRDY_IMU`). It never refers to registers
//! or states. Propagation is deterministic: signal changes are queued, zero-delay
//! changes drain through a FIFO at the same virtual timestamp until the system is
//! stable, and `delay_ns` connections are scheduled on virtual time.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::Deserialize;

use crate::{
    clock::SimulatorClock,
    device::{Device, DeviceError},
};

const TOPOLOGY_SCHEMA: &str = include_str!("../../../schemas/topology.schema.json");

/// Resolves a device ID to a live device; used by the router while settling.
pub type DeviceLookup<'a> = &'a dyn Fn(&str) -> Result<Arc<dyn Device>, DeviceError>;

/// Runtime safety limit for stabilization passes in one settle operation.
pub const MAX_SETTLE_PASSES: usize = 64;

/// Declarative board topology (`topology.yaml`).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Topology {
    pub schema_version: u32,
    #[serde(default)]
    pub connections: Vec<ConnectionDefinition>,
}

/// One wire from a device output signal to a GPIO line.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ConnectionDefinition {
    pub from: String,
    pub to: String,
    /// Optional virtual-time propagation delay; zero propagates immediately.
    #[serde(default)]
    pub delay_ns: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum TopologyError {
    #[error("failed to read topology '{path}': {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("topology is not valid YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("topology has an incompatible shape: {0}")]
    Shape(#[from] serde_json::Error),
    #[error("embedded topology schema is invalid: {0}")]
    InvalidEmbeddedSchema(String),
    #[error("topology failed schema validation:\n{0}")]
    Validation(String),
    #[error("connection '{endpoint}' must have the form <device>.<name>")]
    InvalidEndpoint { endpoint: String },
    #[error("connection '{connection}': device '{device}' does not exist")]
    UnknownDevice { connection: String, device: String },
    #[error("connection '{connection}': device '{device}' has no output signal '{signal}'")]
    UnknownSignal {
        connection: String,
        device: String,
        signal: String,
    },
    #[error("connection '{connection}': '{device}.{line}' is not a device-driven GPIO line")]
    InvalidTarget {
        connection: String,
        device: String,
        line: String,
    },
    #[error("GPIO line '{target}' is driven by more than one connection")]
    MultipleDrivers { target: String },
    #[error("topology contains a connection cycle through device '{device}'")]
    Cycle { device: String },
}

impl Topology {
    /// Loads and validates a topology file.
    ///
    /// # Errors
    /// Returns an error when the file is unreadable or does not match the schema.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, TopologyError> {
        let path = path.as_ref();
        let yaml = fs::read_to_string(path).map_err(|source| TopologyError::Read {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_yaml(&yaml)
    }

    /// Parses and schema-validates topology YAML.
    ///
    /// # Errors
    /// Returns an error for invalid YAML or schema violations.
    pub fn from_yaml(yaml: &str) -> Result<Self, TopologyError> {
        let value: serde_yaml::Value = serde_yaml::from_str(yaml)?;
        let instance = serde_json::to_value(value)?;
        let schema: serde_json::Value = serde_json::from_str(TOPOLOGY_SCHEMA)
            .map_err(|error| TopologyError::InvalidEmbeddedSchema(error.to_string()))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| TopologyError::InvalidEmbeddedSchema(error.to_string()))?;
        let errors = validator
            .iter_errors(&instance)
            .map(|error| format!("- {}: {}", error.instance_path(), error))
            .collect::<Vec<_>>();
        if !errors.is_empty() {
            return Err(TopologyError::Validation(errors.join("\n")));
        }
        Ok(serde_json::from_value(instance)?)
    }
}

fn split_endpoint(endpoint: &str) -> Result<(&str, &str), TopologyError> {
    endpoint
        .split_once('.')
        .filter(|(device, name)| !device.is_empty() && !name.is_empty())
        .ok_or_else(|| TopologyError::InvalidEndpoint {
            endpoint: endpoint.to_owned(),
        })
}

struct Edge {
    label: String,
    source_device: String,
    source_port: String,
    target_device: String,
    target_line: String,
    delay_ns: u64,
}

#[derive(Default)]
struct RouterState {
    /// Last level handed to the router per edge; `None` until first sampled.
    last: Vec<Option<bool>>,
    /// Delayed deliveries ordered by (due time, sequence).
    pending: BTreeMap<(u64, u64), (usize, bool)>,
    sequence: u64,
}

/// Deterministic zero-delay-by-default signal router.
pub struct SignalRouter {
    edges: Vec<Edge>,
    sources: Vec<String>,
    clock: Arc<dyn SimulatorClock>,
    state: Mutex<RouterState>,
}

impl SignalRouter {
    /// Validates a topology against live devices and builds a router.
    ///
    /// # Errors
    /// Returns an error for unknown devices, ports, or lines, multiple drivers,
    /// host-driven targets, or a connection cycle.
    pub fn new(
        topology: &Topology,
        lookup: &dyn Fn(&str) -> Option<Arc<dyn Device>>,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<Self, TopologyError> {
        let mut edges = Vec::with_capacity(topology.connections.len());
        let mut targets = BTreeSet::new();
        for connection in &topology.connections {
            let label = format!("{} -> {}", connection.from, connection.to);
            let (source_device, source_port) = split_endpoint(&connection.from)?;
            let (target_device, target_line) = split_endpoint(&connection.to)?;
            let source = lookup(source_device).ok_or_else(|| TopologyError::UnknownDevice {
                connection: label.clone(),
                device: source_device.to_owned(),
            })?;
            let has_signal = source
                .signal_outputs()
                .is_ok_and(|ports| ports.iter().any(|port| port.name == source_port));
            if !has_signal {
                return Err(TopologyError::UnknownSignal {
                    connection: label,
                    device: source_device.to_owned(),
                    signal: source_port.to_owned(),
                });
            }
            let target = lookup(target_device).ok_or_else(|| TopologyError::UnknownDevice {
                connection: label.clone(),
                device: target_device.to_owned(),
            })?;
            let drivable = target.gpio_lines().is_ok_and(|lines| {
                lines
                    .iter()
                    .any(|line| line.name == target_line && line.device_driven)
            });
            if !drivable {
                return Err(TopologyError::InvalidTarget {
                    connection: label,
                    device: target_device.to_owned(),
                    line: target_line.to_owned(),
                });
            }
            if !targets.insert(connection.to.clone()) {
                return Err(TopologyError::MultipleDrivers {
                    target: connection.to.clone(),
                });
            }
            edges.push(Edge {
                label,
                source_device: source_device.to_owned(),
                source_port: source_port.to_owned(),
                target_device: target_device.to_owned(),
                target_line: target_line.to_owned(),
                delay_ns: connection.delay_ns,
            });
        }
        reject_cycles(&edges)?;
        let sources = edges
            .iter()
            .map(|edge| edge.source_device.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let last = vec![None; edges.len()];
        Ok(Self {
            edges,
            sources,
            clock,
            state: Mutex::new(RouterState {
                last,
                ..RouterState::default()
            }),
        })
    }

    /// Earliest pending delayed delivery, in virtual time.
    #[must_use]
    pub fn next_deadline_ns(&self) -> Option<u64> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .keys()
            .next()
            .map(|(due, _)| *due)
    }

    /// Propagates every signal change until the system is stable.
    ///
    /// Due delayed deliveries are applied first, in due-time and then insertion
    /// order. Zero-delay changes drain through a FIFO queue; the loop is bounded
    /// by [`MAX_SETTLE_PASSES`].
    ///
    /// # Errors
    /// Returns an error when a device cannot be evaluated or driven, or when
    /// propagation does not stabilize within the pass limit.
    pub fn settle(&self, lookup: DeviceLookup<'_>) -> Result<(), DeviceError> {
        if self.edges.is_empty() {
            return Ok(());
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = self.clock.now_ns();
        let mut ready: VecDeque<(usize, bool)> = VecDeque::new();
        while let Some(entry) = state.pending.first_entry() {
            if entry.key().0 > now {
                break;
            }
            ready.push_back(entry.remove());
        }
        let mut passes = 0;
        loop {
            self.sample_sources(lookup, &mut state, now, &mut ready)?;
            if ready.is_empty() {
                return Ok(());
            }
            passes += 1;
            if passes > MAX_SETTLE_PASSES {
                return Err(DeviceError::InvalidRequest(format!(
                    "signal propagation did not stabilize within {MAX_SETTLE_PASSES} passes"
                )));
            }
            while let Some((index, value)) = ready.pop_front() {
                let edge = &self.edges[index];
                lookup(&edge.target_device)?.drive_gpio_line(&edge.target_line, value)?;
            }
        }
    }

    fn sample_sources(
        &self,
        lookup: DeviceLookup<'_>,
        state: &mut RouterState,
        now: u64,
        ready: &mut VecDeque<(usize, bool)>,
    ) -> Result<(), DeviceError> {
        let mut levels: HashMap<(&str, String), bool> = HashMap::new();
        for device_id in &self.sources {
            for level in lookup(device_id)?.signal_outputs()? {
                levels.insert((device_id.as_str(), level.name), level.value);
            }
        }
        for (index, edge) in self.edges.iter().enumerate() {
            let Some(&value) = levels.get(&(edge.source_device.as_str(), edge.source_port.clone()))
            else {
                continue;
            };
            // A signal propagates only when its value actually changes.
            if state.last[index] == Some(value) {
                continue;
            }
            state.last[index] = Some(value);
            if edge.delay_ns == 0 {
                ready.push_back((index, value));
            } else {
                let sequence = state.sequence;
                state.sequence += 1;
                state.pending.insert(
                    (now.saturating_add(edge.delay_ns), sequence),
                    (index, value),
                );
            }
        }
        Ok(())
    }

    /// Human-readable connection list for diagnostics.
    #[must_use]
    pub fn connections(&self) -> Vec<String> {
        self.edges.iter().map(|edge| edge.label.clone()).collect()
    }
}

fn reject_cycles(edges: &[Edge]) -> Result<(), TopologyError> {
    let mut graph: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for edge in edges {
        graph
            .entry(edge.source_device.as_str())
            .or_default()
            .push(edge.target_device.as_str());
    }
    // 0 = unvisited, 1 = on stack, 2 = done
    let mut mark: HashMap<&str, u8> = HashMap::new();
    for &start in graph.keys() {
        let mut stack = vec![(start, 0_usize)];
        while let Some(&(node, next)) = stack.last() {
            if next == 0 {
                match mark.get(node) {
                    Some(1) => {
                        return Err(TopologyError::Cycle {
                            device: node.to_owned(),
                        });
                    }
                    Some(_) => {
                        stack.pop();
                        continue;
                    }
                    None => {
                        mark.insert(node, 1);
                    }
                }
            }
            let children = graph.get(node).map_or(&[][..], Vec::as_slice);
            if let Some(&child) = children.get(next) {
                if let Some(top) = stack.last_mut() {
                    top.1 += 1;
                }
                if mark.get(child) == Some(&1) {
                    return Err(TopologyError::Cycle {
                        device: child.to_owned(),
                    });
                }
                if !mark.contains_key(child) {
                    stack.push((child, 0));
                }
            } else {
                mark.insert(node, 2);
                stack.pop();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::{
        clock::ManualClock,
        device::{BusType, DeviceTransfer, GpioLineSnapshot, SignalLevel, SpiWireConfig},
        registry::DeviceRegistry,
    };

    /// Device whose single `ready` port follows an externally set flag.
    struct Source {
        id: &'static str,
        level: AtomicBool,
    }

    impl Device for Source {
        fn id(&self) -> &str {
            self.id
        }
        fn bus_type(&self) -> BusType {
            BusType::Spi
        }
        fn transfer(&self, _request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
            Ok(DeviceTransfer::response(Vec::new()))
        }
        fn transfer_spi(
            &self,
            _request: &[u8],
            _rx_length: usize,
            _wire: SpiWireConfig,
        ) -> Result<DeviceTransfer, DeviceError> {
            Ok(DeviceTransfer::response(Vec::new()))
        }
        fn signal_outputs(&self) -> Result<Vec<SignalLevel>, DeviceError> {
            Ok(vec![SignalLevel {
                name: "ready".to_owned(),
                value: self.level.load(Ordering::SeqCst),
            }])
        }
    }

    /// GPIO bank with one device-driven and one host-driven line; counts drives.
    struct Bank {
        id: &'static str,
        levels: Mutex<HashMap<String, bool>>,
        drives: Mutex<Vec<(String, bool)>>,
    }

    impl Device for Bank {
        fn id(&self) -> &str {
            self.id
        }
        fn bus_type(&self) -> BusType {
            BusType::Gpio
        }
        fn transfer(&self, _request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
            Err(DeviceError::EmptyRequest)
        }
        fn transfer_spi(
            &self,
            _request: &[u8],
            _rx_length: usize,
            _wire: SpiWireConfig,
        ) -> Result<DeviceTransfer, DeviceError> {
            Err(DeviceError::EmptyRequest)
        }
        fn gpio_lines(&self) -> Result<Vec<GpioLineSnapshot>, DeviceError> {
            Ok(vec![
                GpioLineSnapshot {
                    offset: 0,
                    name: "DRDY".to_owned(),
                    device_driven: true,
                },
                GpioLineSnapshot {
                    offset: 1,
                    name: "DRDY2".to_owned(),
                    device_driven: true,
                },
                GpioLineSnapshot {
                    offset: 2,
                    name: "BUTTON".to_owned(),
                    device_driven: false,
                },
            ])
        }
        fn drive_gpio_line(&self, name: &str, level: bool) -> Result<bool, DeviceError> {
            self.drives.lock().unwrap().push((name.to_owned(), level));
            Ok(self.levels.lock().unwrap().insert(name.to_owned(), level) != Some(level))
        }
    }

    struct Fixture {
        registry: DeviceRegistry,
        clock: Arc<ManualClock>,
        source: Arc<Source>,
        bank: Arc<Bank>,
    }

    fn fixture() -> Fixture {
        let source = Arc::new(Source {
            id: "imu0",
            level: AtomicBool::new(false),
        });
        let bank = Arc::new(Bank {
            id: "gpio0",
            levels: Mutex::new(HashMap::new()),
            drives: Mutex::new(Vec::new()),
        });
        let registry = DeviceRegistry::new();
        registry.register(source.clone()).unwrap();
        registry.register(bank.clone()).unwrap();
        Fixture {
            registry,
            clock: Arc::new(ManualClock::default()),
            source,
            bank,
        }
    }

    fn attach(fixture: &Fixture, yaml: &str) -> Result<(), TopologyError> {
        let topology = Topology::from_yaml(yaml)?;
        fixture
            .registry
            .attach_topology(&topology, fixture.clock.clone())
    }

    const WIRED: &str =
        "schema_version: 1\nconnections:\n  - { from: imu0.ready, to: gpio0.DRDY }\n";

    fn poke(fixture: &Fixture) {
        // Any transaction on the registry settles pending signal changes.
        fixture
            .registry
            .transfer_spi("imu0", &[0], 0, SpiWireConfig::default())
            .unwrap();
    }

    #[test]
    fn propagates_only_when_the_value_changes() {
        let fixture = fixture();
        attach(&fixture, WIRED).unwrap();
        // The initial level is synchronized once.
        assert_eq!(
            *fixture.bank.drives.lock().unwrap(),
            [("DRDY".to_owned(), false)]
        );
        poke(&fixture);
        poke(&fixture);
        assert_eq!(fixture.bank.drives.lock().unwrap().len(), 1);
        fixture.source.level.store(true, Ordering::SeqCst);
        poke(&fixture);
        poke(&fixture);
        assert_eq!(
            *fixture.bank.drives.lock().unwrap(),
            [("DRDY".to_owned(), false), ("DRDY".to_owned(), true)]
        );
    }

    #[test]
    fn delayed_connections_use_virtual_time() {
        let fixture = fixture();
        attach(
            &fixture,
            "schema_version: 1\nconnections:\n  - { from: imu0.ready, to: gpio0.DRDY, delay_ns: 500 }\n",
        )
        .unwrap();
        fixture.clock.advance(Duration::from_nanos(500)).unwrap();
        fixture.registry.run_due_events().unwrap();
        fixture.source.level.store(true, Ordering::SeqCst);
        poke(&fixture);
        assert!(!fixture.bank.levels.lock().unwrap()["DRDY"]);
        assert_eq!(
            fixture.registry.next_event_deadline_ns().unwrap(),
            Some(1_000)
        );
        fixture.clock.advance(Duration::from_nanos(499)).unwrap();
        fixture.registry.run_due_events().unwrap();
        assert!(!fixture.bank.levels.lock().unwrap()["DRDY"]);
        fixture.clock.advance(Duration::from_nanos(1)).unwrap();
        fixture.registry.run_due_events().unwrap();
        assert!(fixture.bank.levels.lock().unwrap()["DRDY"]);
        assert_eq!(fixture.registry.next_event_deadline_ns().unwrap(), None);
    }

    #[test]
    fn rejects_invalid_connections() {
        let unknown_device = fixture();
        assert!(matches!(
            attach(
                &unknown_device,
                "schema_version: 1\nconnections:\n  - { from: nope.ready, to: gpio0.DRDY }\n"
            ),
            Err(TopologyError::UnknownDevice { .. })
        ));
        let unknown_signal = fixture();
        assert!(matches!(
            attach(
                &unknown_signal,
                "schema_version: 1\nconnections:\n  - { from: imu0.other, to: gpio0.DRDY }\n"
            ),
            Err(TopologyError::UnknownSignal { .. })
        ));
        let host_driven = fixture();
        assert!(matches!(
            attach(
                &host_driven,
                "schema_version: 1\nconnections:\n  - { from: imu0.ready, to: gpio0.BUTTON }\n"
            ),
            Err(TopologyError::InvalidTarget { .. })
        ));
        let missing_line = fixture();
        assert!(matches!(
            attach(
                &missing_line,
                "schema_version: 1\nconnections:\n  - { from: imu0.ready, to: gpio0.NOPE }\n"
            ),
            Err(TopologyError::InvalidTarget { .. })
        ));
        let two_drivers = fixture();
        assert!(matches!(
            attach(
                &two_drivers,
                "schema_version: 1\nconnections:\n  - { from: imu0.ready, to: gpio0.DRDY }\n  - { from: imu0.ready, to: gpio0.DRDY }\n"
            ),
            Err(TopologyError::MultipleDrivers { .. })
        ));
        assert!(matches!(
            Topology::from_yaml(
                "schema_version: 1\nconnections:\n  - { from: imu0, to: gpio0.DRDY }\n"
            ),
            Err(TopologyError::Validation(_))
        ));
    }

    #[test]
    fn detects_connection_cycles() {
        let edge = |from: &str, to: &str| Edge {
            label: format!("{from} -> {to}"),
            source_device: from.to_owned(),
            source_port: "p".to_owned(),
            target_device: to.to_owned(),
            target_line: "l".to_owned(),
            delay_ns: 0,
        };
        assert!(reject_cycles(&[edge("a", "b"), edge("b", "c")]).is_ok());
        assert!(matches!(
            reject_cycles(&[edge("a", "b"), edge("b", "a")]),
            Err(TopologyError::Cycle { .. })
        ));
        assert!(matches!(
            reject_cycles(&[edge("a", "a")]),
            Err(TopologyError::Cycle { .. })
        ));
    }

    #[test]
    fn unstable_propagation_hits_the_safety_limit() {
        // A source that toggles every time it is sampled never stabilizes.
        struct Toggler(AtomicBool, &'static str);
        impl Device for Toggler {
            fn id(&self) -> &str {
                self.1
            }
            fn bus_type(&self) -> BusType {
                BusType::Spi
            }
            fn transfer(&self, _r: &[u8]) -> Result<DeviceTransfer, DeviceError> {
                Err(DeviceError::EmptyRequest)
            }
            fn transfer_spi(
                &self,
                _r: &[u8],
                _l: usize,
                _w: SpiWireConfig,
            ) -> Result<DeviceTransfer, DeviceError> {
                Err(DeviceError::EmptyRequest)
            }
            fn signal_outputs(&self) -> Result<Vec<SignalLevel>, DeviceError> {
                Ok(vec![SignalLevel {
                    name: "ready".to_owned(),
                    value: !self.0.fetch_xor(true, Ordering::SeqCst),
                }])
            }
        }
        let fixture = fixture();
        fixture
            .registry
            .register(Arc::new(Toggler(AtomicBool::new(false), "osc0")))
            .unwrap();
        let error = attach(
            &fixture,
            "schema_version: 1\nconnections:\n  - { from: osc0.ready, to: gpio0.DRDY }\n",
        )
        .unwrap_err();
        assert!(error.to_string().contains("did not stabilize"));
    }

    use std::{sync::Mutex, time::Duration};
}
