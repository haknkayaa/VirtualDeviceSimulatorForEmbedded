use std::{collections::HashMap, sync::Arc};

use tracing::{info, warn};
use vds_events::{EventBus, EventDraft, EventPayload};

use crate::{
    CommandResult, ObservedEvent, ResultStatus, ScenarioAction, ScenarioDocument, ScenarioResult,
    ScenarioRuntime, StepFailureKind, StepResult,
};

pub struct ScenarioExecutor<R> {
    runtime: R,
    results: HashMap<String, CommandResult>,
    events: Vec<ObservedEvent>,
    event_cursor: usize,
    event_bus: Option<Arc<EventBus>>,
    scenario_run_id: Option<String>,
}

impl<R: ScenarioRuntime> ScenarioExecutor<R> {
    #[must_use]
    pub fn new(runtime: R) -> Self {
        Self {
            runtime,
            results: HashMap::new(),
            events: Vec::new(),
            event_cursor: 0,
            event_bus: None,
            scenario_run_id: None,
        }
    }

    #[must_use]
    pub fn with_event_bus(mut self, event_bus: Arc<EventBus>, scenario_run_id: String) -> Self {
        self.event_bus = Some(event_bus);
        self.scenario_run_id = Some(scenario_run_id);
        self
    }

    pub fn run(&mut self, document: &ScenarioDocument) -> ScenarioResult {
        self.results.clear();
        self.events.clear();
        self.event_cursor = 0;
        let started = self.runtime.now_ns();
        let deadline =
            started.saturating_add(document.scenario.timeout_ms.saturating_mul(1_000_000));
        info!(component = "scenario", event = "scenario_started", scenario_id = %document.scenario.id, virtual_time_ns = started, "scenario started");
        self.publish(
            None,
            EventPayload::ScenarioStarted {
                scenario_id: document.scenario.id.clone(),
            },
        );
        let mut steps = Vec::with_capacity(document.steps.len());
        let mut stopped = false;
        for step in &document.steps {
            if stopped {
                let now = self.runtime.now_ns();
                steps.push(StepResult {
                    step_id: step.id.clone(),
                    action: step.action.name().to_owned(),
                    status: ResultStatus::Skipped,
                    started_virtual_ns: now,
                    completed_virtual_ns: now,
                    error: None,
                    failure_kind: None,
                });
                continue;
            }
            let step_started = self.runtime.now_ns();
            self.publish(
                None,
                EventPayload::ScenarioStepStarted {
                    step_id: step.id.clone(),
                    action: step.action.name().to_owned(),
                },
            );
            let outcome = if step_started > deadline {
                Err("scenario timeout exceeded".to_owned())
            } else {
                self.execute(&step.action, deadline)
            };
            let completed = self.runtime.now_ns();
            let (status, error, failure_kind) = match outcome {
                Ok(()) => (ResultStatus::Passed, None, None),
                Err(error) => {
                    if !step.continue_on_failure {
                        stopped = true;
                    }
                    let kind = classify_failure(&step.action, &error);
                    (ResultStatus::Failed, Some(error), Some(kind))
                }
            };
            log_step(
                &document.scenario.id,
                &step.id,
                step.action.name(),
                status,
                step_started,
                completed,
                error.as_deref(),
            );
            self.publish(
                None,
                EventPayload::ScenarioStepCompleted {
                    step_id: step.id.clone(),
                    action: step.action.name().to_owned(),
                    status: status_name(status).to_owned(),
                    error: error.clone(),
                },
            );
            steps.push(StepResult {
                step_id: step.id.clone(),
                action: step.action.name().to_owned(),
                status,
                started_virtual_ns: step_started,
                completed_virtual_ns: completed,
                error,
                failure_kind,
            });
        }
        self.finish_result(document, started, steps)
    }

    fn finish_result(
        &self,
        document: &ScenarioDocument,
        started: u64,
        steps: Vec<StepResult>,
    ) -> ScenarioResult {
        let completed = self.runtime.now_ns();
        let passed = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Passed)
            .count();
        let failed = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Failed)
            .count();
        let skipped = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Skipped)
            .count();
        let status = if failed == 0 {
            ResultStatus::Passed
        } else {
            ResultStatus::Failed
        };
        info!(component = "scenario", event = "scenario_completed", scenario_id = %document.scenario.id, status = ?status, virtual_time_ns = completed, "scenario completed");
        self.publish(
            None,
            EventPayload::ScenarioCompleted {
                scenario_id: document.scenario.id.clone(),
                status: status_name(status).to_owned(),
                steps_passed: passed,
                steps_failed: failed,
                steps_skipped: skipped,
            },
        );
        ScenarioResult {
            scenario_id: document.scenario.id.clone(),
            status,
            started_virtual_ns: started,
            completed_virtual_ns: completed,
            duration_virtual_ns: completed.saturating_sub(started),
            steps_total: steps.len(),
            steps_passed: passed,
            steps_failed: failed,
            steps_skipped: skipped,
            steps,
        }
    }

    fn execute(&mut self, action: &ScenarioAction, scenario_deadline: u64) -> Result<(), String> {
        match action {
            ScenarioAction::ResetDevice { device } => self.reset_device(device),
            ScenarioAction::SendSpi {
                device,
                tx,
                save_as,
            } => self.send_spi(device, tx, save_as),
            ScenarioAction::AdvanceTime { duration_ms } => {
                self.advance_checked(ms_to_ns(*duration_ms)?, scenario_deadline)
            }
            ScenarioAction::EnableFault { fault } => self.runtime.set_fault_enabled(fault, true),
            ScenarioAction::DisableFault { fault } => self.runtime.set_fault_enabled(fault, false),
            ScenarioAction::AssertRegister {
                device,
                register,
                expected,
            } => {
                let actual = self.runtime.read_register(device, register)?;
                ensure(
                    actual == *expected,
                    format!("register '{register}' expected {expected:#X}, got {actual:#X}"),
                )
            }
            ScenarioAction::AssertState { device, expected } => {
                let actual = self
                    .runtime
                    .current_state(device)?
                    .ok_or_else(|| format!("device '{device}' has no state machine"))?;
                ensure(
                    actual == *expected,
                    format!("state expected '{expected}', got '{actual}'"),
                )
            }
            ScenarioAction::AssertResponse { source, expected } => {
                let expected = parse_hex(expected)?;
                match self.results.get(source) {
                    Some(CommandResult::Response { bytes }) => ensure(
                        *bytes == expected,
                        format!(
                            "response mismatch: expected {}, got {}",
                            format_hex(&expected),
                            format_hex(bytes)
                        ),
                    ),
                    Some(CommandResult::Error { code, .. }) => Err(format!(
                        "result '{source}' is error '{code}', not a response"
                    )),
                    None => Err(format!("result '{source}' was not found")),
                }
            }
            ScenarioAction::AssertError {
                source,
                expected_code,
            } => match self.results.get(source) {
                Some(CommandResult::Error { code, .. }) => ensure(
                    code == expected_code,
                    format!("error code expected '{expected_code}', got '{code}'"),
                ),
                Some(CommandResult::Response { .. }) => {
                    Err(format!("result '{source}' is a response, not an error"))
                }
                None => Err(format!("result '{source}' was not found")),
            },
            ScenarioAction::WaitForEvent {
                device,
                event,
                timeout_ms,
            } => self.wait_for_event(
                device.as_deref(),
                event,
                ms_to_ns(*timeout_ms)?,
                scenario_deadline,
            ),
        }
    }

    fn reset_device(&mut self, device: &str) -> Result<(), String> {
        let events = self.runtime.reset_device(device)?;
        self.publish(
            Some(device),
            EventPayload::DeviceReset {
                result: "success".to_owned(),
            },
        );
        self.record_events(events);
        Ok(())
    }

    fn send_spi(&mut self, device: &str, tx: &str, save_as: &str) -> Result<(), String> {
        let bytes = parse_hex(tx)?;
        self.publish(
            Some(device),
            EventPayload::TransactionStarted {
                transaction_id: None,
                request: bytes.clone(),
            },
        );
        let result = match self.runtime.send_spi(device, &bytes) {
            Ok(transfer) => {
                self.publish(
                    Some(device),
                    EventPayload::TransactionCompleted {
                        transaction_id: None,
                        response: transfer.response.clone(),
                        result: "success".to_owned(),
                        error_code: None,
                    },
                );
                if let Some(register) = &transfer.register {
                    self.publish(Some(device), EventPayload::from_register(register));
                }
                self.record_events(
                    transfer
                        .events
                        .into_iter()
                        .map(|event| ObservedEvent {
                            device_id: device.to_owned(),
                            event,
                        })
                        .collect(),
                );
                CommandResult::Response {
                    bytes: transfer.response,
                }
            }
            Err(error) => {
                self.publish(
                    Some(device),
                    EventPayload::TransactionCompleted {
                        transaction_id: None,
                        response: Vec::new(),
                        result: "error".to_owned(),
                        error_code: Some(error.code().to_owned()),
                    },
                );
                CommandResult::Error {
                    code: error.code().to_owned(),
                    message: error.to_string(),
                }
            }
        };
        self.results.insert(save_as.to_owned(), result);
        Ok(())
    }

    fn advance_checked(&mut self, duration_ns: u64, deadline: u64) -> Result<(), String> {
        let target = self
            .runtime
            .now_ns()
            .checked_add(duration_ns)
            .ok_or_else(|| "virtual time overflow".to_owned())?;
        if target > deadline {
            return Err("scenario timeout would be exceeded".to_owned());
        }
        let events = self.runtime.advance_time(duration_ns)?;
        self.record_events(events);
        Ok(())
    }

    fn wait_for_event(
        &mut self,
        device: Option<&str>,
        kind: &str,
        timeout_ns: u64,
        scenario_deadline: u64,
    ) -> Result<(), String> {
        let local_deadline = self
            .runtime
            .now_ns()
            .saturating_add(timeout_ns)
            .min(scenario_deadline);
        loop {
            if let Some(index) = self
                .events
                .iter()
                .enumerate()
                .skip(self.event_cursor)
                .find_map(|(index, observed)| {
                    event_matches(observed, device, kind).then_some(index)
                })
            {
                self.event_cursor = index + 1;
                return Ok(());
            }
            let Some(next) = self.runtime.next_event_deadline_ns()? else {
                let remaining = local_deadline.saturating_sub(self.runtime.now_ns());
                let events = self.runtime.advance_time(remaining)?;
                self.record_events(events);
                return Err(format!("event '{kind}' was not observed before timeout"));
            };
            if next > local_deadline {
                let remaining = local_deadline.saturating_sub(self.runtime.now_ns());
                let events = self.runtime.advance_time(remaining)?;
                self.record_events(events);
                return Err(format!("event '{kind}' was not observed before timeout"));
            }
            let now = self.runtime.now_ns();
            let events = self.runtime.advance_time(next.saturating_sub(now))?;
            self.record_events(events);
        }
    }

    fn record_events(&mut self, events: Vec<ObservedEvent>) {
        for observed in &events {
            self.publish(
                Some(&observed.device_id),
                EventPayload::from_device_event(&observed.event),
            );
        }
        self.events.extend(events);
    }

    fn publish(&self, device_id: Option<&str>, payload: EventPayload) {
        if let Some(bus) = &self.event_bus {
            let _ = bus.publish(EventDraft {
                virtual_time_ns: self.runtime.now_ns(),
                device_id: device_id.map(str::to_owned),
                scenario_run_id: self.scenario_run_id.clone(),
                payload,
            });
        }
    }
}

fn classify_failure(action: &ScenarioAction, error: &str) -> StepFailureKind {
    let assertion_failed = match action {
        ScenarioAction::AssertRegister { .. } => {
            error.starts_with("register '") && error.contains(" expected ")
        }
        ScenarioAction::AssertState { .. } => error.starts_with("state expected "),
        ScenarioAction::AssertResponse { .. } => {
            error.starts_with("response mismatch:") || error.contains("not a response")
        }
        ScenarioAction::AssertError { .. } => {
            error.starts_with("error code expected ")
                || error.contains("is a response, not an error")
        }
        _ => false,
    };
    if assertion_failed {
        StepFailureKind::Assertion
    } else {
        StepFailureKind::Execution
    }
}

fn event_matches(observed: &ObservedEvent, device: Option<&str>, kind: &str) -> bool {
    device.is_none_or(|device| device == observed.device_id) && observed.event.kind() == kind
}

fn ensure(condition: bool, message: String) -> Result<(), String> {
    if condition { Ok(()) } else { Err(message) }
}

fn status_name(status: ResultStatus) -> &'static str {
    match status {
        ResultStatus::Passed => "passed",
        ResultStatus::Failed => "failed",
        ResultStatus::Skipped => "skipped",
    }
}

fn ms_to_ns(ms: u64) -> Result<u64, String> {
    ms.checked_mul(1_000_000)
        .ok_or_else(|| "duration overflows nanoseconds".to_owned())
}

fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    let compact = input.split_ascii_whitespace().collect::<String>();
    if compact.is_empty() || compact.len() % 2 != 0 {
        return Err(format!("invalid hex bytes '{input}'"));
    }
    (0..compact.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&compact[index..index + 2], 16)
                .map_err(|_| format!("invalid hex bytes '{input}'"))
        })
        .collect()
}

fn format_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn log_step(
    scenario_id: &str,
    step_id: &str,
    action: &str,
    status: ResultStatus,
    started: u64,
    completed: u64,
    error: Option<&str>,
) {
    match error {
        None => {
            info!(component = "scenario", event = "scenario_step_completed", scenario_id, step_id, action, status = ?status, started_virtual_ns = started, completed_virtual_ns = completed, "scenario step completed");
        }
        Some(error) => {
            warn!(component = "scenario", event = "scenario_step_completed", scenario_id, step_id, action, status = ?status, started_virtual_ns = started, completed_virtual_ns = completed, error, "scenario step failed");
        }
    }
}
