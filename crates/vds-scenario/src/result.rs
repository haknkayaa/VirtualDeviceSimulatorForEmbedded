//! Structured scenario and step execution results.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepFailureKind {
    Assertion,
    Execution,
    /// The scenario or an event wait exceeded its virtual-time budget.
    Timeout,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum CommandResult {
    Response { bytes: Vec<u8> },
    Error { code: String, message: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StepResult {
    pub step_id: String,
    pub action: String,
    pub status: ResultStatus,
    pub started_virtual_ns: u64,
    pub completed_virtual_ns: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip)]
    pub failure_kind: Option<StepFailureKind>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ScenarioResult {
    pub scenario_id: String,
    pub status: ResultStatus,
    pub started_virtual_ns: u64,
    pub completed_virtual_ns: u64,
    pub duration_virtual_ns: u64,
    pub steps_total: usize,
    pub steps_passed: usize,
    pub steps_failed: usize,
    pub steps_skipped: usize,
    pub steps: Vec<StepResult>,
}

impl ScenarioResult {
    /// Whether any step failed because a virtual-time budget was exhausted.
    #[must_use]
    pub fn timed_out(&self) -> bool {
        self.steps
            .iter()
            .any(|step| step.failure_kind == Some(StepFailureKind::Timeout))
    }

    /// Serializes this result as human-readable JSON.
    ///
    /// # Errors
    /// Returns an error if serialization fails.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
