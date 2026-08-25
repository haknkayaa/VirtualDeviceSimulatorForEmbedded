//! Serializable scenario documents, steps, and actions.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::ScenarioError;

const SCHEMA: &str = include_str!("../../../schemas/scenario.schema.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioDocument {
    pub schema_version: u32,
    pub scenario: ScenarioDefinition,
    pub steps: Vec<ScenarioStep>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioDefinition {
    pub id: String,
    pub name: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ScenarioStep {
    pub id: String,
    #[serde(default)]
    pub continue_on_failure: bool,
    #[serde(flatten)]
    pub action: ScenarioAction,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScenarioAction {
    ResetDevice {
        device: String,
    },
    SendSpi {
        device: String,
        tx: String,
        save_as: String,
    },
    AdvanceTime {
        duration_ms: u64,
    },
    EnableFault {
        fault: String,
    },
    DisableFault {
        fault: String,
    },
    AssertRegister {
        device: String,
        register: String,
        expected: u64,
    },
    AssertState {
        device: String,
        expected: String,
    },
    AssertResponse {
        source: String,
        expected: String,
    },
    AssertError {
        source: String,
        expected_code: String,
    },
    WaitForEvent {
        #[serde(default)]
        device: Option<String>,
        event: String,
        timeout_ms: u64,
    },
}

impl ScenarioAction {
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::ResetDevice { .. } => "reset_device",
            Self::SendSpi { .. } => "send_spi",
            Self::AdvanceTime { .. } => "advance_time",
            Self::EnableFault { .. } => "enable_fault",
            Self::DisableFault { .. } => "disable_fault",
            Self::AssertRegister { .. } => "assert_register",
            Self::AssertState { .. } => "assert_state",
            Self::AssertResponse { .. } => "assert_response",
            Self::AssertError { .. } => "assert_error",
            Self::WaitForEvent { .. } => "wait_for_event",
        }
    }

    #[must_use]
    pub fn device(&self) -> Option<&str> {
        match self {
            Self::ResetDevice { device }
            | Self::SendSpi { device, .. }
            | Self::AssertRegister { device, .. }
            | Self::AssertState { device, .. } => Some(device),
            Self::WaitForEvent { device, .. } => device.as_deref(),
            Self::AdvanceTime { .. }
            | Self::EnableFault { .. }
            | Self::DisableFault { .. }
            | Self::AssertResponse { .. }
            | Self::AssertError { .. } => None,
        }
    }
}

impl ScenarioDocument {
    #[must_use]
    pub fn referenced_devices(&self) -> Vec<String> {
        let mut devices = self
            .steps
            .iter()
            .filter_map(|step| step.action.device().map(str::to_owned))
            .collect::<Vec<_>>();
        devices.sort();
        devices.dedup();
        devices
    }

    /// Parses, schema-validates, and semantically validates scenario YAML.
    ///
    /// # Errors
    /// Returns an error for invalid YAML, schema violations, or duplicate IDs.
    pub fn from_yaml(yaml: &str) -> Result<Self, ScenarioError> {
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml)?;
        let instance = serde_json::to_value(yaml_value)?;
        Self::from_json_value(instance)
    }

    /// Parses, schema-validates, and semantically validates a JSON scenario value.
    ///
    /// # Errors
    /// Returns an error for schema violations, unknown fields, or duplicate IDs.
    pub fn from_json_value(instance: serde_json::Value) -> Result<Self, ScenarioError> {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA)
            .map_err(|error| ScenarioError::InvalidSchema(error.to_string()))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| ScenarioError::InvalidSchema(error.to_string()))?;
        let errors = validator
            .iter_errors(&instance)
            .map(|error| format!("- {}: {error}", error.instance_path))
            .collect::<Vec<_>>();
        if !errors.is_empty() {
            return Err(ScenarioError::Validation(errors.join("\n")));
        }
        let document: Self = serde_json::from_value(instance)?;
        document.validate()?;
        Ok(document)
    }

    fn validate(&self) -> Result<(), ScenarioError> {
        let mut step_ids = HashSet::new();
        let mut result_names = HashSet::new();
        for step in &self.steps {
            if !step_ids.insert(&step.id) {
                return Err(ScenarioError::DuplicateStepId(step.id.clone()));
            }
            if let ScenarioAction::SendSpi { save_as, .. } = &step.action {
                if !result_names.insert(save_as) {
                    return Err(ScenarioError::DuplicateResultName(save_as.clone()));
                }
            }
        }
        Ok(())
    }
}
