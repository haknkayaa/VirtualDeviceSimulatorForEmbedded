//! Scenario-run lifecycle and result retrieval endpoints.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;
use tokio::sync::Semaphore;
use vds_core::{clock::ManualClock, config::ServerConfig};
use vds_events::EventBus;
use vds_scenario::{
    RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor, ScenarioResult,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Passed,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunRecord {
    pub run_id: String,
    pub scenario_id: String,
    pub status: RunStatus,
    #[serde(skip)]
    pub scenario_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ScenarioResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct RunManager {
    next_id: AtomicU64,
    records: Arc<Mutex<HashMap<String, RunRecord>>>,
    permit: Arc<Semaphore>,
}

impl Default for RunManager {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            records: Arc::new(Mutex::new(HashMap::new())),
            permit: Arc::new(Semaphore::new(1)),
        }
    }
}

impl RunManager {
    pub fn start(
        &self,
        scenario: ScenarioDocument,
        scenario_revision: u64,
        config: ServerConfig,
        events: Arc<EventBus>,
    ) -> RunRecord {
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed);
        let run_id = format!("run-{sequence:06}");
        let record = RunRecord {
            run_id: run_id.clone(),
            scenario_id: scenario.scenario.id.clone(),
            status: RunStatus::Queued,
            scenario_revision,
            result: None,
            error: None,
        };
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(run_id.clone(), record.clone());
        let records = Arc::clone(&self.records);
        let permit = Arc::clone(&self.permit);
        tokio::spawn(async move {
            let Ok(_permit) = permit.acquire_owned().await else {
                update_failed(&records, &run_id, "scenario runner is unavailable");
                return;
            };
            update_status(&records, &run_id, RunStatus::Running);
            let task_run_id = run_id.clone();
            let outcome = tokio::task::spawn_blocking(move || {
                let clock = Arc::new(ManualClock::default());
                let registry = crate::load_registry_with_clock(&config, clock.clone())
                    .map_err(|error| error.to_string())?;
                let runtime = RegistryRuntime::new(Arc::new(registry), clock);
                let mut executor =
                    ScenarioExecutor::new(runtime).with_event_bus(events, task_run_id);
                Ok::<_, String>(executor.run(&scenario))
            })
            .await;
            match outcome {
                Ok(Ok(result)) => {
                    let timed_out = result.steps.iter().any(|step| {
                        step.error
                            .as_deref()
                            .is_some_and(|error| error.contains("timeout"))
                    });
                    let status = if timed_out {
                        RunStatus::TimedOut
                    } else if result.status == ResultStatus::Passed {
                        RunStatus::Passed
                    } else {
                        RunStatus::Failed
                    };
                    let mut guard = records
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if let Some(record) = guard.get_mut(&run_id) {
                        record.status = status;
                        record.result = Some(result);
                    }
                }
                Ok(Err(error)) => update_failed(&records, &run_id, &error),
                Err(error) => update_failed(&records, &run_id, &error.to_string()),
            }
        });
        record
    }

    #[must_use]
    pub fn get(&self, run_id: &str) -> Option<RunRecord> {
        self.records
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(run_id)
            .cloned()
    }
}

fn update_status(records: &Mutex<HashMap<String, RunRecord>>, run_id: &str, status: RunStatus) {
    if let Some(record) = records
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get_mut(run_id)
    {
        record.status = status;
    }
}

fn update_failed(records: &Mutex<HashMap<String, RunRecord>>, run_id: &str, error: &str) {
    let mut guard = records
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(record) = guard.get_mut(run_id) {
        record.status = RunStatus::Failed;
        record.error = Some(error.to_owned());
    }
}
