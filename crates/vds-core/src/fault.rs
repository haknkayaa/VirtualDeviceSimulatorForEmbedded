use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FaultTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub register: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FaultTrigger {
    Always,
    FirstN(u64),
    EveryNth(u64),
    OperationCount(u64),
}

impl FaultTrigger {
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Always => "always",
            Self::FirstN(_) => "first_n",
            Self::EveryNth(_) => "every_nth",
            Self::OperationCount(_) => "operation_count",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum FaultAction {
    Timeout {
        duration_ms: u64,
    },
    Delay {
        duration_ms: u64,
    },
    ReturnError {
        code: String,
        message: String,
    },
    Drop,
    CorruptResponse {
        xor_mask: u8,
    },
    ForceRegisterValue {
        value: u64,
    },
    StuckAt {
        value: u64,
        #[serde(default)]
        mask: Option<u64>,
    },
}

impl FaultAction {
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Timeout { .. } => "timeout",
            Self::Delay { .. } => "delay",
            Self::ReturnError { .. } => "return_error",
            Self::Drop => "drop",
            Self::CorruptResponse { .. } => "corrupt_response",
            Self::ForceRegisterValue { .. } => "force_register_value",
            Self::StuckAt { .. } => "stuck_at",
        }
    }

    #[must_use]
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Timeout { .. } | Self::ReturnError { .. } | Self::Drop
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FaultDefinition {
    pub id: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub persistent: bool,
    #[serde(default)]
    pub target: FaultTarget,
    pub trigger: FaultTrigger,
    pub action: FaultAction,
}

const fn enabled_by_default() -> bool {
    true
}

#[derive(Clone, Copy, Debug)]
pub struct FaultContext<'a> {
    pub device: &'a str,
    pub command: &'a str,
    pub register: Option<&'a str>,
    pub state: Option<&'a str>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FaultActivation {
    pub id: String,
    pub trigger: FaultTrigger,
    pub trigger_count: u64,
    pub action: FaultAction,
    pub persistent: bool,
}

#[derive(Debug)]
struct RuntimeFault {
    definition: FaultDefinition,
    yaml_index: usize,
    count: u64,
}

#[derive(Debug)]
pub struct FaultEngine {
    faults: Vec<RuntimeFault>,
}

impl FaultEngine {
    #[must_use]
    pub fn new(definitions: Vec<FaultDefinition>) -> Self {
        let mut faults = definitions
            .into_iter()
            .enumerate()
            .map(|(yaml_index, definition)| RuntimeFault {
                definition,
                yaml_index,
                count: 0,
            })
            .collect::<Vec<_>>();
        faults.sort_by_key(|fault| {
            (
                std::cmp::Reverse(fault.definition.priority),
                fault.yaml_index,
            )
        });
        Self { faults }
    }

    pub fn evaluate(&mut self, context: FaultContext<'_>) -> Vec<FaultActivation> {
        let mut activations = Vec::new();
        for fault in &mut self.faults {
            if !fault.definition.enabled || !target_matches(&fault.definition.target, context) {
                continue;
            }
            fault.count = fault.count.saturating_add(1);
            let fires = match fault.definition.trigger {
                FaultTrigger::Always => true,
                FaultTrigger::FirstN(n) => fault.count <= n,
                FaultTrigger::EveryNth(n) => n != 0 && fault.count % n == 0,
                FaultTrigger::OperationCount(n) => fault.count == n,
            };
            if fires {
                activations.push(FaultActivation {
                    id: fault.definition.id.clone(),
                    trigger: fault.definition.trigger,
                    trigger_count: fault.count,
                    action: fault.definition.action.clone(),
                    persistent: fault.definition.persistent,
                });
                if fault.definition.action.is_terminal() {
                    break;
                }
            }
        }
        activations
    }

    pub fn reset(&mut self) {
        for fault in &mut self.faults {
            if !fault.definition.persistent {
                fault.count = 0;
            }
        }
    }
}

fn target_matches(target: &FaultTarget, context: FaultContext<'_>) -> bool {
    matches_value(target.device.as_deref(), Some(context.device))
        && matches_value(target.command.as_deref(), Some(context.command))
        && matches_value(target.register.as_deref(), context.register)
        && matches_value(target.state.as_deref(), context.state)
}

fn matches_value(expected: Option<&str>, actual: Option<&str>) -> bool {
    expected
        .is_none_or(|expected| actual.is_some_and(|actual| expected.eq_ignore_ascii_case(actual)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition(trigger: FaultTrigger) -> FaultDefinition {
        FaultDefinition {
            id: "fault".into(),
            enabled: true,
            priority: 0,
            persistent: false,
            target: FaultTarget {
                command: Some("READ_ID".into()),
                ..Default::default()
            },
            trigger,
            action: FaultAction::CorruptResponse { xor_mask: 1 },
        }
    }

    #[test]
    fn disabled_fault_is_ignored() {
        let mut fault = definition(FaultTrigger::Always);
        fault.enabled = false;
        assert!(
            FaultEngine::new(vec![fault])
                .evaluate(FaultContext {
                    device: "d",
                    command: "read_id",
                    register: None,
                    state: None
                })
                .is_empty()
        );
    }

    #[test]
    fn first_n_and_every_nth_are_deterministic() {
        for (trigger, expected) in [
            (FaultTrigger::FirstN(2), vec![true, true, false, false]),
            (FaultTrigger::EveryNth(2), vec![false, true, false, true]),
        ] {
            let mut engine = FaultEngine::new(vec![definition(trigger)]);
            let actual = (0..4)
                .map(|_| {
                    !engine
                        .evaluate(FaultContext {
                            device: "d",
                            command: "READ_ID",
                            register: None,
                            state: None,
                        })
                        .is_empty()
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn priority_then_yaml_order_and_terminal_stop() {
        let mut low = definition(FaultTrigger::Always);
        low.id = "low".into();
        low.priority = 1;
        let mut first = definition(FaultTrigger::Always);
        first.id = "first".into();
        first.priority = 2;
        let mut terminal = definition(FaultTrigger::Always);
        terminal.id = "terminal".into();
        terminal.priority = 2;
        terminal.action = FaultAction::Drop;
        let ids = FaultEngine::new(vec![low, first, terminal])
            .evaluate(FaultContext {
                device: "d",
                command: "READ_ID",
                register: None,
                state: None,
            })
            .into_iter()
            .map(|a| a.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["first", "terminal"]);
    }
}
