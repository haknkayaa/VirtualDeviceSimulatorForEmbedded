//! Typed signal-graph definitions and deterministic execution.

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SignalValue {
    Bool(bool),
    Bytes(Vec<u8>),
    Text(String),
    Json(serde_json::Value),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SignalNode {
    LogicalNot,
    LogicalAnd,
    LogicalOr,
    LogicalNand,
    LogicalNor,
    LogicalXor,
    LogicalXnor,
    Timer {
        duration_ns: u64,
    },
    Delay {
        duration_ns: u64,
    },
    Timeout {
        duration_ns: u64,
    },
    Interval {
        duration_ns: u64,
    },
    FileRead {
        path: PathBuf,
        format: FileFormat,
        offset: u64,
        length: Option<u64>,
    },
    FileWrite {
        path: PathBuf,
        format: FileFormat,
        mode: FileWriteMode,
        create: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileFormat {
    Bytes,
    Text,
    Json,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileWriteMode {
    Overwrite,
    Append,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SignalEdge {
    pub source: String,
    pub target: String,
    pub target_port: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StateSignalRoot {
    pub target: String,
    pub target_port: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SignalGraphDefinition {
    pub nodes: BTreeMap<String, SignalNode>,
    pub edges: Vec<SignalEdge>,
    #[serde(default)]
    pub state_roots: BTreeMap<String, Vec<StateSignalRoot>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScheduledSignal {
    pub node_id: String,
    pub value: SignalValue,
    pub delay_ns: u64,
    pub repeat: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SignalExecution {
    pub scheduled: Vec<ScheduledSignal>,
    pub outputs: Vec<(String, SignalValue)>,
}

#[derive(Debug)]
pub struct SignalGraph {
    definition: SignalGraphDefinition,
    inputs: HashMap<String, HashMap<String, SignalValue>>,
    package_root: PathBuf,
}

impl SignalGraph {
    #[must_use]
    pub fn new(definition: SignalGraphDefinition, package_root: PathBuf) -> Self {
        Self {
            definition,
            inputs: HashMap::new(),
            package_root,
        }
    }

    /// Activates every signal root owned by a state.
    ///
    /// # Errors
    /// Returns an error for invalid signal types, file operations, or graph references.
    pub fn activate_state(&mut self, state: &str) -> Result<SignalExecution, String> {
        self.inputs.clear();
        let roots = self
            .definition
            .state_roots
            .get(state)
            .cloned()
            .unwrap_or_default();
        let mut execution = SignalExecution::default();
        for root in roots {
            self.dispatch(
                &root.target,
                &root.target_port,
                SignalValue::Bool(true),
                &mut execution,
            )?;
        }
        Ok(execution)
    }

    /// Resumes propagation after a scheduled signal becomes due.
    ///
    /// # Errors
    /// Returns an error for invalid signal types, file operations, or graph references.
    pub fn resume(&mut self, node_id: &str, value: SignalValue) -> Result<SignalExecution, String> {
        let mut execution = SignalExecution::default();
        self.emit(node_id, value, &mut execution)?;
        Ok(execution)
    }

    #[allow(clippy::too_many_lines)]
    fn dispatch(
        &mut self,
        node_id: &str,
        port: &str,
        value: SignalValue,
        execution: &mut SignalExecution,
    ) -> Result<(), String> {
        self.inputs
            .entry(node_id.to_owned())
            .or_default()
            .insert(port.to_owned(), value.clone());
        let node = self
            .definition
            .nodes
            .get(node_id)
            .cloned()
            .ok_or_else(|| format!("unknown signal node '{node_id}'"))?;
        match node {
            SignalNode::LogicalNot => {
                self.emit(node_id, SignalValue::Bool(!as_bool(&value)?), execution)
            }
            SignalNode::LogicalAnd
            | SignalNode::LogicalOr
            | SignalNode::LogicalNand
            | SignalNode::LogicalNor
            | SignalNode::LogicalXor
            | SignalNode::LogicalXnor => {
                let inputs = &self.inputs[node_id];
                let (Some(a), Some(b)) = (inputs.get("a"), inputs.get("b")) else {
                    return Ok(());
                };
                let (a, b) = (as_bool(a)?, as_bool(b)?);
                let result = match node {
                    SignalNode::LogicalAnd => a && b,
                    SignalNode::LogicalOr => a || b,
                    SignalNode::LogicalNand => !(a && b),
                    SignalNode::LogicalNor => !(a || b),
                    SignalNode::LogicalXor => a ^ b,
                    SignalNode::LogicalXnor => a == b,
                    _ => unreachable!(),
                };
                self.emit(node_id, SignalValue::Bool(result), execution)
            }
            SignalNode::Timer { duration_ns } | SignalNode::Timeout { duration_ns } => {
                execution.scheduled.push(ScheduledSignal {
                    node_id: node_id.to_owned(),
                    value: SignalValue::Bool(true),
                    delay_ns: duration_ns,
                    repeat: false,
                });
                Ok(())
            }
            SignalNode::Delay { duration_ns } => {
                execution.scheduled.push(ScheduledSignal {
                    node_id: node_id.to_owned(),
                    value,
                    delay_ns: duration_ns,
                    repeat: false,
                });
                Ok(())
            }
            SignalNode::Interval { duration_ns } => {
                execution.scheduled.push(ScheduledSignal {
                    node_id: node_id.to_owned(),
                    value: SignalValue::Bool(true),
                    delay_ns: duration_ns,
                    repeat: true,
                });
                Ok(())
            }
            SignalNode::FileRead {
                path,
                format,
                offset,
                length,
            } => {
                let path = sandboxed_path(&self.package_root, &path)?;
                let bytes = fs::read(&path)
                    .map_err(|error| format!("cannot read '{}': {error}", path.display()))?;
                let start = usize::try_from(offset).map_err(|_| "file offset is too large")?;
                if start > bytes.len() {
                    return Err("file offset exceeds file length".to_owned());
                }
                let end = length
                    .map(|length| usize::try_from(length).unwrap_or(usize::MAX))
                    .and_then(|length| start.checked_add(length))
                    .unwrap_or(bytes.len())
                    .min(bytes.len());
                self.emit(node_id, decode(&bytes[start..end], format)?, execution)
            }
            SignalNode::FileWrite {
                path,
                format,
                mode,
                create,
            } => {
                let inputs = &self.inputs[node_id];
                let Some(content) = inputs.get("b") else {
                    return Ok(());
                };
                if !as_bool(inputs.get("a").unwrap_or(&SignalValue::Bool(false)))? {
                    return Ok(());
                }
                let path = sandboxed_write_path(&self.package_root, &path)?;
                let bytes = encode(content, format)?;
                let mut options = fs::OpenOptions::new();
                options.write(true).create(create);
                match mode {
                    FileWriteMode::Overwrite => {
                        options.truncate(true);
                    }
                    FileWriteMode::Append => {
                        options.append(true);
                    }
                }
                options
                    .open(&path)
                    .and_then(|mut file| file.write_all(&bytes))
                    .map_err(|error| format!("cannot write '{}': {error}", path.display()))?;
                self.emit(node_id, SignalValue::Bool(true), execution)
            }
        }
    }

    fn emit(
        &mut self,
        source: &str,
        value: SignalValue,
        execution: &mut SignalExecution,
    ) -> Result<(), String> {
        execution.outputs.push((source.to_owned(), value.clone()));
        let mut queue = VecDeque::from([(source.to_owned(), value)]);
        while let Some((current, value)) = queue.pop_front() {
            let edges = self
                .definition
                .edges
                .iter()
                .filter(|edge| edge.source == current)
                .cloned()
                .collect::<Vec<_>>();
            for edge in edges {
                self.dispatch(&edge.target, &edge.target_port, value.clone(), execution)?;
            }
        }
        Ok(())
    }
}

fn as_bool(value: &SignalValue) -> Result<bool, String> {
    match value {
        SignalValue::Bool(value) => Ok(*value),
        _ => Err("logical signal must be boolean".to_owned()),
    }
}

fn sandboxed_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "unsafe package-relative path '{}'",
            relative.display()
        ));
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("cannot resolve package root '{}': {error}", root.display()))?;
    let candidate = root.join(relative);
    let resolved = if candidate.exists() {
        fs::canonicalize(&candidate)
            .map_err(|error| format!("cannot resolve '{}': {error}", candidate.display()))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| format!("path '{}' has no parent", candidate.display()))?;
        fs::canonicalize(parent)
            .map_err(|error| format!("cannot resolve '{}': {error}", parent.display()))?
            .join(
                candidate
                    .file_name()
                    .ok_or_else(|| "file name is required".to_owned())?,
            )
    };
    if !resolved.starts_with(&canonical_root) {
        return Err(format!(
            "path '{}' escapes package root",
            relative.display()
        ));
    }
    Ok(resolved)
}

fn sandboxed_write_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if !relative.starts_with("runtime-data") {
        return Err(format!(
            "file writes must target the package runtime-data directory: '{}'",
            relative.display()
        ));
    }
    sandboxed_path(root, relative)
}

fn decode(bytes: &[u8], format: FileFormat) -> Result<SignalValue, String> {
    match format {
        FileFormat::Bytes => Ok(SignalValue::Bytes(bytes.to_vec())),
        FileFormat::Text => String::from_utf8(bytes.to_vec())
            .map(SignalValue::Text)
            .map_err(|error| format!("file is not UTF-8: {error}")),
        FileFormat::Json => serde_json::from_slice(bytes)
            .map(SignalValue::Json)
            .map_err(|error| format!("file is not valid JSON: {error}")),
    }
}

fn encode(value: &SignalValue, format: FileFormat) -> Result<Vec<u8>, String> {
    match (format, value) {
        (FileFormat::Bytes, SignalValue::Bytes(value)) => Ok(value.clone()),
        (FileFormat::Text, SignalValue::Text(value)) => Ok(value.as_bytes().to_vec()),
        (FileFormat::Json, SignalValue::Json(value)) => {
            serde_json::to_vec(value).map_err(|error| error.to_string())
        }
        _ => Err("file value does not match configured format".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use super::{
        FileFormat, FileWriteMode, SignalEdge, SignalGraph, SignalGraphDefinition, SignalNode,
        SignalValue, StateSignalRoot,
    };

    #[test]
    fn evaluates_boolean_nodes_and_schedules_virtual_time_nodes() {
        let definition = SignalGraphDefinition {
            nodes: BTreeMap::from([
                ("not".to_owned(), SignalNode::LogicalNot),
                ("and".to_owned(), SignalNode::LogicalAnd),
                ("timer".to_owned(), SignalNode::Timer { duration_ns: 1_000 }),
            ]),
            edges: vec![SignalEdge {
                source: "not".to_owned(),
                target: "and".to_owned(),
                target_port: "b".to_owned(),
            }],
            state_roots: BTreeMap::from([(
                "ready".to_owned(),
                vec![
                    StateSignalRoot {
                        target: "not".to_owned(),
                        target_port: "in".to_owned(),
                    },
                    StateSignalRoot {
                        target: "and".to_owned(),
                        target_port: "a".to_owned(),
                    },
                    StateSignalRoot {
                        target: "timer".to_owned(),
                        target_port: "in".to_owned(),
                    },
                ],
            )]),
        };
        let mut graph = SignalGraph::new(definition, std::env::temp_dir());
        let execution = graph.activate_state("ready").expect("graph should execute");
        assert!(
            execution
                .outputs
                .contains(&("not".to_owned(), SignalValue::Bool(false)))
        );
        assert!(
            execution
                .outputs
                .contains(&("and".to_owned(), SignalValue::Bool(false)))
        );
        assert_eq!(execution.scheduled[0].delay_ns, 1_000);
    }

    #[test]
    fn reads_and_writes_only_package_relative_files() {
        let root = std::env::temp_dir().join(format!("vds4e-signal-graph-{}", std::process::id()));
        fs::create_dir_all(root.join("runtime-data")).expect("temporary package root");
        fs::write(root.join("input.txt"), "signal data").expect("input fixture");
        let definition = SignalGraphDefinition {
            nodes: BTreeMap::from([
                (
                    "read".to_owned(),
                    SignalNode::FileRead {
                        path: "input.txt".into(),
                        format: FileFormat::Text,
                        offset: 0,
                        length: None,
                    },
                ),
                (
                    "write".to_owned(),
                    SignalNode::FileWrite {
                        path: "runtime-data/output.txt".into(),
                        format: FileFormat::Text,
                        mode: FileWriteMode::Overwrite,
                        create: true,
                    },
                ),
            ]),
            edges: vec![SignalEdge {
                source: "read".to_owned(),
                target: "write".to_owned(),
                target_port: "b".to_owned(),
            }],
            state_roots: BTreeMap::from([(
                "ready".to_owned(),
                vec![
                    StateSignalRoot {
                        target: "write".to_owned(),
                        target_port: "a".to_owned(),
                    },
                    StateSignalRoot {
                        target: "read".to_owned(),
                        target_port: "in".to_owned(),
                    },
                ],
            )]),
        };
        let mut graph = SignalGraph::new(definition, root.clone());
        graph
            .activate_state("ready")
            .expect("file graph should execute");
        assert_eq!(
            fs::read_to_string(root.join("runtime-data/output.txt")).expect("written output"),
            "signal data"
        );

        let unsafe_definition = SignalGraphDefinition {
            nodes: BTreeMap::from([(
                "read".to_owned(),
                SignalNode::FileRead {
                    path: "../escape.txt".into(),
                    format: FileFormat::Text,
                    offset: 0,
                    length: None,
                },
            )]),
            edges: Vec::new(),
            state_roots: BTreeMap::from([(
                "ready".to_owned(),
                vec![StateSignalRoot {
                    target: "read".to_owned(),
                    target_port: "in".to_owned(),
                }],
            )]),
        };
        assert!(
            SignalGraph::new(unsafe_definition, root.clone())
                .activate_state("ready")
                .expect_err("path escape must fail")
                .contains("unsafe package-relative path")
        );
        fs::remove_dir_all(root).expect("remove temporary package root");
    }
}
