//! Scenario-run lifecycle and result retrieval endpoints.

use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use tokio::sync::Semaphore;
use vds_core::{clock::ManualClock, config::ServerConfig};
use vds_events::EventBus;
use vds_scenario::{
    RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor, ScenarioResult,
};

/// Finished runs retained for result retrieval before the oldest are evicted.
const MAX_RETAINED_RUNS: usize = 256;
/// Wall-clock budget for one run; guards against a runtime call that never returns.
const WALL_CLOCK_WATCHDOG: Duration = Duration::from_secs(300);

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

impl RunStatus {
    const fn is_finished(self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
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

#[derive(Default)]
struct RunStore {
    records: HashMap<String, RunRecord>,
    order: VecDeque<String>,
    cancel_flags: HashMap<String, Arc<AtomicBool>>,
}

impl RunStore {
    fn insert(&mut self, record: RunRecord, cancel: Arc<AtomicBool>) {
        self.cancel_flags.insert(record.run_id.clone(), cancel);
        self.order.push_back(record.run_id.clone());
        self.records.insert(record.run_id.clone(), record);
        self.evict_finished();
    }

    fn evict_finished(&mut self) {
        while self.order.len() > MAX_RETAINED_RUNS {
            let Some(position) = self.order.iter().position(|run_id| {
                self.records
                    .get(run_id)
                    .is_none_or(|record| record.status.is_finished())
            }) else {
                break;
            };
            if let Some(run_id) = self.order.remove(position) {
                self.records.remove(&run_id);
                self.cancel_flags.remove(&run_id);
            }
        }
    }

    /// Records a terminal state unless the run already finished (first writer wins).
    fn finish(
        &mut self,
        run_id: &str,
        status: RunStatus,
        result: Option<ScenarioResult>,
        error: Option<String>,
    ) {
        if let Some(record) = self.records.get_mut(run_id)
            && !record.status.is_finished()
        {
            record.status = status;
            record.result = result;
            record.error = error;
        }
        self.evict_finished();
    }
}

pub struct RunManager {
    next_id: AtomicU64,
    store: Arc<Mutex<RunStore>>,
    permit: Arc<Semaphore>,
    watchdog: Duration,
}

impl Default for RunManager {
    fn default() -> Self {
        Self::with_watchdog(WALL_CLOCK_WATCHDOG)
    }
}

fn lock(store: &Mutex<RunStore>) -> std::sync::MutexGuard<'_, RunStore> {
    store
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl RunManager {
    #[must_use]
    pub fn with_watchdog(watchdog: Duration) -> Self {
        Self {
            next_id: AtomicU64::new(1),
            store: Arc::new(Mutex::new(RunStore::default())),
            permit: Arc::new(Semaphore::new(1)),
            watchdog,
        }
    }

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
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.store).insert(record.clone(), Arc::clone(&cancel));
        let store = Arc::clone(&self.store);
        let permit = Arc::clone(&self.permit);
        let watchdog = self.watchdog;
        tokio::spawn(async move {
            let Ok(_permit) = permit.acquire_owned().await else {
                lock(&store).finish(
                    &run_id,
                    RunStatus::Failed,
                    None,
                    Some("scenario runner is unavailable".to_owned()),
                );
                return;
            };
            if cancel.load(Ordering::Relaxed) {
                lock(&store).finish(&run_id, RunStatus::Cancelled, None, None);
                return;
            }
            if let Some(record) = lock(&store).records.get_mut(&run_id)
                && record.status == RunStatus::Queued
            {
                record.status = RunStatus::Running;
            }
            let task_run_id = run_id.clone();
            let task_cancel = Arc::clone(&cancel);
            let task = tokio::task::spawn_blocking(move || {
                let clock = Arc::new(ManualClock::default());
                let registry = crate::load_registry_with_clock(&config, clock.clone())
                    .map_err(|error| error.to_string())?;
                crate::publish_signal_events(
                    &registry,
                    Arc::clone(&events),
                    Some(task_run_id.clone()),
                );
                let runtime = RegistryRuntime::new(Arc::new(registry), clock);
                let mut executor = ScenarioExecutor::new(runtime)
                    .with_event_bus(events, task_run_id)
                    .with_cancellation(task_cancel);
                Ok::<_, String>(executor.run(&scenario))
            });
            // A blocking thread cannot be killed; the watchdog releases the runner
            // slot so later scenarios are not stuck behind a hung runtime call.
            let outcome = tokio::time::timeout(watchdog, task).await;
            let mut guard = lock(&store);
            match outcome {
                Err(_) => {
                    cancel.store(true, Ordering::Relaxed);
                    guard.finish(
                        &run_id,
                        RunStatus::TimedOut,
                        None,
                        Some(format!(
                            "scenario exceeded the {}s wall-clock watchdog",
                            watchdog.as_secs()
                        )),
                    );
                }
                Ok(Ok(Ok(result))) => {
                    let status = if cancel.load(Ordering::Relaxed) {
                        RunStatus::Cancelled
                    } else if result.timed_out() {
                        RunStatus::TimedOut
                    } else if result.status == ResultStatus::Passed {
                        RunStatus::Passed
                    } else {
                        RunStatus::Failed
                    };
                    guard.finish(&run_id, status, Some(result), None);
                }
                Ok(Ok(Err(error))) => guard.finish(&run_id, RunStatus::Failed, None, Some(error)),
                Ok(Err(error)) => {
                    guard.finish(&run_id, RunStatus::Failed, None, Some(error.to_string()));
                }
            }
        });
        record
    }

    /// Requests cancellation. Returns the record, or `None` for an unknown run.
    ///
    /// Queued runs are cancelled immediately; running runs stop before their next step.
    #[must_use]
    pub fn cancel(&self, run_id: &str) -> Option<RunRecord> {
        let mut guard = lock(&self.store);
        let flag = guard.cancel_flags.get(run_id).cloned()?;
        let record = guard.records.get(run_id)?;
        if record.status.is_finished() {
            return Some(record.clone());
        }
        flag.store(true, Ordering::Relaxed);
        if record.status == RunStatus::Queued {
            guard.finish(run_id, RunStatus::Cancelled, None, None);
        }
        guard.records.get(run_id).cloned()
    }

    #[must_use]
    pub fn get(&self, run_id: &str) -> Option<RunRecord> {
        lock(&self.store).records.get(run_id).cloned()
    }
}
