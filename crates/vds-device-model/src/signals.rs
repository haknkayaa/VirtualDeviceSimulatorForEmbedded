//! Compiled public output signal ports.
//!
//! A model declares typed output ports and binds each one to internal behavior
//! (a register bit, a state, or a logical combination of those). Board topology
//! only ever sees the port, never the binding.

use std::collections::BTreeSet;

use vds_core::device::{DeviceError, SignalLevel};
use vds_registers::RegisterEngine;

use crate::{
    LogicSourceDefinition, ModelError, SignalBindingDefinition, SignalNode, SignalOutputDefinition,
    SignalSourceDefinition, SignalsDefinition, map_register_error,
};

const MAX_SOURCE_DEPTH: usize = 8;

enum Source {
    RegisterBit { address: u64, bit: u8 },
    StateEquals(String),
    Logic(SignalNode, Vec<Source>),
}

struct Output {
    name: String,
    source: Source,
}

/// Evaluates every public output port of one device.
pub(crate) struct SignalOutputs {
    outputs: Vec<Output>,
}

impl SignalOutputs {
    /// Compiles declared ports and bindings.
    ///
    /// `states` is `None` when the state machine is not yet known (model loaded
    /// before a behavior flow is applied); state references are then unchecked.
    pub(crate) fn compile(
        signals: Option<&SignalsDefinition>,
        bindings: &[SignalBindingDefinition],
        registers: &RegisterEngine,
        states: Option<&BTreeSet<String>>,
    ) -> Result<Option<Self>, ModelError> {
        let declared: &[SignalOutputDefinition] = signals.map_or(&[], |s| &s.outputs);
        if declared.is_empty() && bindings.is_empty() {
            return Ok(None);
        }
        let mut names = BTreeSet::new();
        for output in declared {
            if !names.insert(output.name.as_str()) {
                return Err(invalid(format!(
                    "signal '{}' is declared twice",
                    output.name
                )));
            }
            if output.name.is_empty() || output.name.contains('.') {
                return Err(invalid(format!(
                    "signal name '{}' must be non-empty and contain no '.'",
                    output.name
                )));
            }
        }
        let mut bound = BTreeSet::new();
        for binding in bindings {
            if !names.contains(binding.signal.as_str()) {
                return Err(invalid(format!(
                    "signal_bindings refers to undeclared signal '{}'",
                    binding.signal
                )));
            }
            if !bound.insert(binding.signal.as_str()) {
                return Err(invalid(format!(
                    "signal '{}' has more than one binding",
                    binding.signal
                )));
            }
        }
        let mut outputs = Vec::with_capacity(declared.len());
        for output in declared {
            let binding = bindings
                .iter()
                .find(|binding| binding.signal == output.name)
                .ok_or_else(|| invalid(format!("signal '{}' has no binding", output.name)))?;
            outputs.push(Output {
                name: output.name.clone(),
                source: compile_source(&binding.source, registers, states, 0)?,
            });
        }
        Ok(Some(Self { outputs }))
    }

    pub(crate) fn evaluate(
        &self,
        registers: &RegisterEngine,
        state: Option<&str>,
    ) -> Result<Vec<SignalLevel>, DeviceError> {
        self.outputs
            .iter()
            .map(|output| {
                Ok(SignalLevel {
                    name: output.name.clone(),
                    value: evaluate_source(&output.source, registers, state)?,
                })
            })
            .collect()
    }
}

fn invalid(reason: String) -> ModelError {
    ModelError::InvalidSignal { reason }
}

fn compile_source(
    definition: &SignalSourceDefinition,
    registers: &RegisterEngine,
    states: Option<&BTreeSet<String>>,
    depth: usize,
) -> Result<Source, ModelError> {
    if depth > MAX_SOURCE_DEPTH {
        return Err(invalid(format!(
            "signal source nesting exceeds {MAX_SOURCE_DEPTH} levels"
        )));
    }
    match definition {
        SignalSourceDefinition::Register(source) => {
            let metadata = registers
                .metadata_by_name(&source.register)
                .ok_or_else(|| {
                    invalid(format!(
                        "signal source register '{}' is not defined",
                        source.register
                    ))
                })?;
            if source.bit >= metadata.width_bits {
                return Err(invalid(format!(
                    "bit {} is outside register '{}' width {}",
                    source.bit, source.register, metadata.width_bits
                )));
            }
            Ok(Source::RegisterBit {
                address: metadata.address,
                bit: source.bit,
            })
        }
        SignalSourceDefinition::State(source) => {
            if let Some(states) = states
                && !states.contains(&source.state.equals)
            {
                return Err(invalid(format!(
                    "signal source state '{}' is not defined by the state machine",
                    source.state.equals
                )));
            }
            Ok(Source::StateEquals(source.state.equals.clone()))
        }
        SignalSourceDefinition::Logic(logic) => {
            let (node, inputs): (SignalNode, Vec<&SignalSourceDefinition>) = match logic {
                LogicSourceDefinition::And([a, b]) => (SignalNode::LogicalAnd, vec![a, b]),
                LogicSourceDefinition::Or([a, b]) => (SignalNode::LogicalOr, vec![a, b]),
                LogicSourceDefinition::Nand([a, b]) => (SignalNode::LogicalNand, vec![a, b]),
                LogicSourceDefinition::Nor([a, b]) => (SignalNode::LogicalNor, vec![a, b]),
                LogicSourceDefinition::Xor([a, b]) => (SignalNode::LogicalXor, vec![a, b]),
                LogicSourceDefinition::Xnor([a, b]) => (SignalNode::LogicalXnor, vec![a, b]),
                LogicSourceDefinition::Not(a) => (SignalNode::LogicalNot, vec![a]),
            };
            let inputs = inputs
                .into_iter()
                .map(|input| compile_source(input, registers, states, depth + 1))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Source::Logic(node, inputs))
        }
    }
}

fn evaluate_source(
    source: &Source,
    registers: &RegisterEngine,
    state: Option<&str>,
) -> Result<bool, DeviceError> {
    match source {
        Source::RegisterBit { address, bit } => {
            let read = registers.read_internal(*address).map_err(|error| {
                map_register_error(&error, vds_core::device::RegisterOperation::Read, None)
            })?;
            Ok((read.value >> bit) & 1 == 1)
        }
        Source::StateEquals(expected) => Ok(state == Some(expected.as_str())),
        Source::Logic(node, inputs) => {
            let a = evaluate_source(&inputs[0], registers, state)?;
            let b = match inputs.get(1) {
                Some(input) => evaluate_source(input, registers, state)?,
                None => false,
            };
            Ok(node
                .evaluate_logical(a, b)
                .expect("compiled logic nodes are logical"))
        }
    }
}
