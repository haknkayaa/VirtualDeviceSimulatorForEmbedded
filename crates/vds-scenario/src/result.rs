use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Passed,
    Failed,
    Skipped,
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
    /// Serializes this result as human-readable JSON.
    ///
    /// # Errors
    /// Returns an error if serialization fails.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
