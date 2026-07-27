use std::{collections::BTreeMap, path::PathBuf};

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{
    DeviceDelayedEventDefinition, DeviceStateDefinition, DeviceStateMachineDefinition, FileFormat,
    FileWriteMode, RegisterActionDefinition, SignalEdge, SignalGraphDefinition, SignalNode,
    StateActionDefinition, StateGuardDefinition, StateSignalRoot, StateTransitionDefinition,
};

#[derive(Debug, Deserialize)]
pub struct BehaviorFlow {
    pub flow: FlowMetadata,
    #[serde(default)]
    pub nodes: Vec<FlowNode>,
    #[serde(default)]
    pub edges: Vec<FlowEdge>,
}

#[derive(Debug, Deserialize)]
pub struct FlowMetadata {
    pub kind: String,
}

#[derive(Debug, Deserialize)]
pub struct FlowNode {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub data: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEdge {
    pub kind: String,
    pub source: String,
    pub target: String,
    pub target_handle: Option<String>,
    #[serde(default)]
    pub data: Map<String, Value>,
}

pub fn compile_behavior_flow(
    yaml: &str,
) -> Result<(DeviceStateMachineDefinition, SignalGraphDefinition), String> {
    let flow: BehaviorFlow =
        serde_yaml::from_str(yaml).map_err(|error| format!("invalid behavior flow: {error}"))?;
    if flow.flow.kind != "device_behavior" {
        return Err("flow.kind must be device_behavior".to_owned());
    }
    let state_nodes = flow
        .nodes
        .iter()
        .filter(|node| {
            matches!(
                node.kind.as_str(),
                "device_behavior.initial_state" | "device_behavior.state"
            )
        })
        .collect::<Vec<_>>();
    let initial = state_nodes
        .iter()
        .filter(|node| node.kind == "device_behavior.initial_state")
        .collect::<Vec<_>>();
    if initial.len() != 1 {
        return Err("behavior flow requires exactly one initial state".to_owned());
    }
    let names = state_nodes
        .iter()
        .map(|node| {
            string(&node.data, "state_name")
                .map(|name| (node.id.clone(), name))
                .ok_or_else(|| format!("node '{}' requires data.state_name", node.id))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut states = BTreeMap::new();
    for node in &state_nodes {
        let name = names[&node.id].clone();
        if states.contains_key(&name) {
            return Err(format!("duplicate state_name '{name}'"));
        }
        let transitions = flow
            .edges
            .iter()
            .filter(|edge| edge.kind == "device_behavior.transition" && edge.source == node.id)
            .map(|edge| compile_transition(edge, &names))
            .collect::<Result<Vec<_>, _>>()?;
        let delayed_events = flow
            .edges
            .iter()
            .filter(|edge| {
                edge.kind == "device_behavior.transition"
                    && edge.source == node.id
                    && number(&edge.data, "delay_value").is_some_and(|value| value > 0)
            })
            .map(|edge| {
                let event = required_string(&edge.data, "trigger", &edge.source)?;
                let value = number(&edge.data, "delay_value").unwrap_or(0);
                let unit = string(&edge.data, "delay_unit").unwrap_or_else(|| "ms".to_owned());
                Ok(DeviceDelayedEventDefinition {
                    event,
                    delay_us: duration_us(value, &unit)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        states.insert(
            name,
            DeviceStateDefinition {
                entry_actions: actions(&node.data, "entry_actions")?,
                exit_actions: actions(&node.data, "exit_actions")?,
                transitions,
                delayed_events,
            },
        );
    }
    let graph = compile_signal_graph(&flow, &names)?;
    Ok((
        DeviceStateMachineDefinition {
            initial_state: names[&initial[0].id].clone(),
            states,
        },
        graph,
    ))
}

fn compile_transition(
    edge: &FlowEdge,
    names: &BTreeMap<String, String>,
) -> Result<StateTransitionDefinition, String> {
    let target = names
        .get(&edge.target)
        .cloned()
        .ok_or_else(|| format!("transition target '{}' is not a state", edge.target))?;
    let guard = if boolean(&edge.data, "guard_enabled") {
        Some(StateGuardDefinition::Register(
            crate::RegisterGuardDefinition {
                name: required_string(&edge.data, "guard_register", &edge.source)?,
                equals: integer(&edge.data, "guard_equals")?,
                mask: optional_integer(&edge.data, "guard_mask")?,
            },
        ))
    } else {
        None
    };
    Ok(StateTransitionDefinition {
        event: required_string(&edge.data, "trigger", &edge.source)?,
        target,
        guard,
    })
}

fn compile_signal_graph(
    flow: &BehaviorFlow,
    state_names: &BTreeMap<String, String>,
) -> Result<SignalGraphDefinition, String> {
    let mut nodes = BTreeMap::new();
    for node in &flow.nodes {
        let Some(signal) = compile_signal_node(node)? else {
            continue;
        };
        nodes.insert(node.id.clone(), signal);
    }
    let mut edges = Vec::new();
    let mut state_roots = BTreeMap::<String, Vec<StateSignalRoot>>::new();
    for edge in &flow.edges {
        if edge.kind != "device_behavior.signal" {
            continue;
        }
        if let Some(state) = state_names.get(&edge.source) {
            state_roots
                .entry(state.clone())
                .or_default()
                .push(StateSignalRoot {
                    target: edge.target.clone(),
                    target_port: edge
                        .target_handle
                        .clone()
                        .unwrap_or_else(|| "in".to_owned()),
                });
        } else {
            edges.push(SignalEdge {
                source: edge.source.clone(),
                target: edge.target.clone(),
                target_port: edge
                    .target_handle
                    .clone()
                    .unwrap_or_else(|| "in".to_owned()),
            });
        }
    }
    let graph = SignalGraphDefinition {
        nodes,
        edges,
        state_roots,
    };
    validate_signal_graph(&graph)?;
    Ok(graph)
}

#[allow(clippy::items_after_statements)]
fn validate_signal_graph(graph: &SignalGraphDefinition) -> Result<(), String> {
    for roots in graph.state_roots.values() {
        for root in roots {
            if !graph.nodes.contains_key(&root.target) {
                return Err(format!("unknown signal root target '{}'", root.target));
            }
        }
    }
    for edge in &graph.edges {
        if !graph.nodes.contains_key(&edge.source) || !graph.nodes.contains_key(&edge.target) {
            return Err(format!(
                "signal edge references unknown endpoint '{} -> {}'",
                edge.source, edge.target
            ));
        }
    }
    fn visit(
        node: &str,
        graph: &SignalGraphDefinition,
        visiting: &mut std::collections::HashSet<String>,
        visited: &mut std::collections::HashSet<String>,
    ) -> Result<(), String> {
        if visited.contains(node) {
            return Ok(());
        }
        if !visiting.insert(node.to_owned()) {
            return Err(format!("signal graph contains a cycle at '{node}'"));
        }
        for target in graph
            .edges
            .iter()
            .filter(|edge| edge.source == node)
            .map(|edge| edge.target.as_str())
        {
            visit(target, graph, visiting, visited)?;
        }
        visiting.remove(node);
        visited.insert(node.to_owned());
        Ok(())
    }
    let mut visiting = std::collections::HashSet::new();
    let mut visited = std::collections::HashSet::new();
    for node in graph.nodes.keys() {
        visit(node, graph, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn compile_signal_node(node: &FlowNode) -> Result<Option<SignalNode>, String> {
    let duration = || {
        let value = number(&node.data, "duration")
            .ok_or_else(|| format!("node '{}' requires duration", node.id))?;
        let unit = string(&node.data, "unit").unwrap_or_else(|| "ms".to_owned());
        duration_us(value, &unit)?
            .checked_mul(1_000)
            .ok_or_else(|| format!("node '{}' duration overflows nanoseconds", node.id))
    };
    let result = match node.kind.as_str() {
        "device_behavior.logical_not" => SignalNode::LogicalNot,
        "device_behavior.logical_and" => SignalNode::LogicalAnd,
        "device_behavior.logical_or" => SignalNode::LogicalOr,
        "device_behavior.logical_nand" => SignalNode::LogicalNand,
        "device_behavior.logical_nor" => SignalNode::LogicalNor,
        "device_behavior.logical_xor" => SignalNode::LogicalXor,
        "device_behavior.logical_xnor" => SignalNode::LogicalXnor,
        "device_behavior.timer" => SignalNode::Timer {
            duration_ns: duration()?,
        },
        "device_behavior.delay" => SignalNode::Delay {
            duration_ns: duration()?,
        },
        "device_behavior.timeout" => SignalNode::Timeout {
            duration_ns: duration()?,
        },
        "device_behavior.interval" => SignalNode::Interval {
            duration_ns: duration()?,
        },
        "device_behavior.file_read" => SignalNode::FileRead {
            path: PathBuf::from(required_string(&node.data, "path", &node.id)?),
            format: file_format(&node.data)?,
            offset: number(&node.data, "offset").unwrap_or(0),
            length: number(&node.data, "length"),
        },
        "device_behavior.file_write" => SignalNode::FileWrite {
            path: PathBuf::from(required_string(&node.data, "path", &node.id)?),
            format: file_format(&node.data)?,
            mode: match string(&node.data, "mode").as_deref() {
                Some("append") => FileWriteMode::Append,
                _ => FileWriteMode::Overwrite,
            },
            create: node
                .data
                .get("create")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        },
        _ => return Ok(None),
    };
    Ok(Some(result))
}

fn actions(data: &Map<String, Value>, field: &str) -> Result<Vec<StateActionDefinition>, String> {
    data.get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|value| {
            let action = value
                .as_object()
                .ok_or_else(|| format!("{field} action must be an object"))?;
            let kind = string(action, "kind").unwrap_or_default();
            let value_field = if kind == "reset_register" {
                "reset_value"
            } else {
                "value"
            };
            Ok(StateActionDefinition::SetRegister(
                RegisterActionDefinition {
                    name: required_string(action, "register", field)?,
                    value: integer(action, value_field)?,
                    mask: optional_integer(action, "mask")?,
                },
            ))
        })
        .collect()
}

fn file_format(data: &Map<String, Value>) -> Result<FileFormat, String> {
    match string(data, "format").as_deref() {
        Some("bytes") | None => Ok(FileFormat::Bytes),
        Some("text") => Ok(FileFormat::Text),
        Some("json") => Ok(FileFormat::Json),
        Some(other) => Err(format!("unsupported file format '{other}'")),
    }
}

fn duration_us(value: u64, unit: &str) -> Result<u64, String> {
    match unit {
        "ns" if value % 1_000 == 0 => Ok(value / 1_000),
        "us" => Ok(value),
        "ms" => value
            .checked_mul(1_000)
            .ok_or_else(|| "duration overflow".to_owned()),
        "s" => value
            .checked_mul(1_000_000)
            .ok_or_else(|| "duration overflow".to_owned()),
        _ => Err(format!("duration {value} {unit} is not representable")),
    }
}

fn string(data: &Map<String, Value>, field: &str) -> Option<String> {
    data.get(field).and_then(Value::as_str).map(str::to_owned)
}
fn required_string(data: &Map<String, Value>, field: &str, owner: &str) -> Result<String, String> {
    string(data, field)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("'{owner}' requires {field}"))
}
fn number(data: &Map<String, Value>, field: &str) -> Option<u64> {
    data.get(field).and_then(Value::as_u64)
}
fn boolean(data: &Map<String, Value>, field: &str) -> bool {
    data.get(field).and_then(Value::as_bool).unwrap_or(false)
}
fn integer(data: &Map<String, Value>, field: &str) -> Result<u64, String> {
    let value = data
        .get(field)
        .ok_or_else(|| format!("{field} is required"))?;
    if let Some(value) = value.as_u64() {
        return Ok(value);
    }
    value
        .as_str()
        .and_then(|value| {
            value
                .strip_prefix("0x")
                .and_then(|value| u64::from_str_radix(value, 16).ok())
                .or_else(|| value.parse().ok())
        })
        .ok_or_else(|| format!("{field} must be a non-negative integer"))
}
fn optional_integer(data: &Map<String, Value>, field: &str) -> Result<Option<u64>, String> {
    match data.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.is_empty() => Ok(None),
        Some(_) => integer(data, field).map(Some),
    }
}

#[cfg(test)]
mod tests {
    use super::compile_behavior_flow;

    const GENERIC_SPI_FLOW: &str =
        include_str!("../../../device-models/examples/generic-spi-flash/flows/behavior.yaml");

    #[test]
    fn compiles_reference_package_states_and_typed_signal_graph() {
        let (machine, graph) =
            compile_behavior_flow(GENERIC_SPI_FLOW).expect("reference flow should compile");
        assert_eq!(machine.initial_state, "resetting");
        assert_eq!(machine.states.len(), 8);
        assert_eq!(graph.nodes.len(), 13);
        assert!(
            graph
                .state_roots
                .get("ready")
                .expect("ready roots")
                .iter()
                .any(|root| root.target == "design-timer" && root.target_port == "in")
        );
        assert!(graph.edges.iter().any(|edge| {
            edge.source == "design-file-read"
                && edge.target == "design-file-write"
                && edge.target_port == "b"
        }));
    }
}
