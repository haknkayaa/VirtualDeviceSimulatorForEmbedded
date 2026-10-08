//! Declarative deterministic scenario orchestration for VDS4E.

mod coverage;
mod definition;
mod executor;
mod junit;
mod result;
mod runtime;

pub use coverage::{
    CoverageMetric, CoverageTargets, DeviceCoverage, DeviceCoverageTargets, ScenarioCoverage,
    transition_label,
};
pub use definition::{ScenarioAction, ScenarioDefinition, ScenarioDocument, ScenarioStep};
pub use executor::ScenarioExecutor;
pub use junit::{JUnitReportMetadata, to_junit_xml};
pub use result::{CommandResult, ResultStatus, ScenarioResult, StepFailureKind, StepResult};
pub use runtime::{ObservedEvent, RegistryRuntime, ScenarioRuntime};

#[derive(Debug, thiserror::Error)]
pub enum ScenarioError {
    #[error("scenario YAML is invalid: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("scenario has an incompatible shape: {0}")]
    Shape(#[from] serde_json::Error),
    #[error("embedded scenario schema is invalid: {0}")]
    InvalidSchema(String),
    #[error("scenario failed schema validation:\n{0}")]
    Validation(String),
    #[error("scenario step id '{0}' is duplicated")]
    DuplicateStepId(String),
    #[error("scenario result name '{0}' is duplicated")]
    DuplicateResultName(String),
    #[error("scenario duration overflows virtual time")]
    DurationOverflow,
}
