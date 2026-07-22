use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use vds_core::{
    device::{RegisterOperation, RegisterTrace},
    event::DeviceEvent,
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    TransactionStarted,
    TransactionCompleted,
    RegisterRead,
    RegisterWrite,
    StateTransition,
    OperationStarted,
    OperationCompleted,
    FaultTriggered,
    ScenarioStarted,
    ScenarioStepStarted,
    ScenarioStepCompleted,
    ScenarioCompleted,
    DeviceReset,
}

impl EventType {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TransactionStarted => "transaction_started",
            Self::TransactionCompleted => "transaction_completed",
            Self::RegisterRead => "register_read",
            Self::RegisterWrite => "register_write",
            Self::StateTransition => "state_transition",
            Self::OperationStarted => "operation_started",
            Self::OperationCompleted => "operation_completed",
            Self::FaultTriggered => "fault_triggered",
            Self::ScenarioStarted => "scenario_started",
            Self::ScenarioStepStarted => "scenario_step_started",
            Self::ScenarioStepCompleted => "scenario_step_completed",
            Self::ScenarioCompleted => "scenario_completed",
            Self::DeviceReset => "device_reset",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    TransactionStarted {
        transaction_id: Option<u64>,
        request: Vec<u8>,
    },
    TransactionCompleted {
        transaction_id: Option<u64>,
        response: Vec<u8>,
        result: String,
        error_code: Option<String>,
    },
    RegisterRead {
        name: Option<String>,
        address: u64,
        value: Option<u64>,
    },
    RegisterWrite {
        name: Option<String>,
        address: u64,
        old_value: Option<u64>,
        new_value: Option<u64>,
    },
    StateTransition {
        from_state: String,
        to_state: String,
        trigger: String,
        result: String,
    },
    OperationStarted {
        command: String,
        scheduled_duration_ns: u64,
        busy: bool,
    },
    OperationCompleted {
        command: String,
        scheduled_duration_ns: u64,
        result: String,
    },
    FaultTriggered {
        fault_id: String,
        command: String,
        trigger: String,
        trigger_count: u64,
        action: String,
        result: String,
    },
    ScenarioStarted {
        scenario_id: String,
    },
    ScenarioStepStarted {
        step_id: String,
        action: String,
    },
    ScenarioStepCompleted {
        step_id: String,
        action: String,
        status: String,
        error: Option<String>,
    },
    ScenarioCompleted {
        scenario_id: String,
        status: String,
        steps_passed: usize,
        steps_failed: usize,
        steps_skipped: usize,
    },
    DeviceReset {
        result: String,
    },
}

impl EventPayload {
    #[must_use]
    pub fn event_type(&self) -> EventType {
        match self {
            Self::TransactionStarted { .. } => EventType::TransactionStarted,
            Self::TransactionCompleted { .. } => EventType::TransactionCompleted,
            Self::RegisterRead { .. } => EventType::RegisterRead,
            Self::RegisterWrite { .. } => EventType::RegisterWrite,
            Self::StateTransition { .. } => EventType::StateTransition,
            Self::OperationStarted { .. } => EventType::OperationStarted,
            Self::OperationCompleted { .. } => EventType::OperationCompleted,
            Self::FaultTriggered { .. } => EventType::FaultTriggered,
            Self::ScenarioStarted { .. } => EventType::ScenarioStarted,
            Self::ScenarioStepStarted { .. } => EventType::ScenarioStepStarted,
            Self::ScenarioStepCompleted { .. } => EventType::ScenarioStepCompleted,
            Self::ScenarioCompleted { .. } => EventType::ScenarioCompleted,
            Self::DeviceReset { .. } => EventType::DeviceReset,
        }
    }

    #[must_use]
    pub fn from_device_event(event: &DeviceEvent) -> Self {
        match event {
            DeviceEvent::OperationStarted {
                command,
                scheduled_duration_ns,
                busy,
                ..
            } => Self::OperationStarted {
                command: command.clone(),
                scheduled_duration_ns: *scheduled_duration_ns,
                busy: *busy,
            },
            DeviceEvent::OperationCompleted {
                command,
                scheduled_duration_ns,
                result,
                ..
            } => Self::OperationCompleted {
                command: command.clone(),
                scheduled_duration_ns: *scheduled_duration_ns,
                result: (*result).to_owned(),
            },
            DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                result,
                ..
            } => Self::StateTransition {
                from_state: from_state.clone(),
                to_state: to_state.clone(),
                trigger: trigger.clone(),
                result: (*result).to_owned(),
            },
            DeviceEvent::FaultTriggered {
                fault_id,
                command,
                trigger,
                trigger_count,
                action,
                result,
                ..
            } => Self::FaultTriggered {
                fault_id: fault_id.clone(),
                command: command.clone(),
                trigger: (*trigger).to_owned(),
                trigger_count: *trigger_count,
                action: (*action).to_owned(),
                result: (*result).to_owned(),
            },
            DeviceEvent::FaultDelayCompleted {
                fault_id, command, ..
            } => Self::FaultTriggered {
                fault_id: fault_id.clone(),
                command: command.clone(),
                trigger: "delay_deadline".to_owned(),
                trigger_count: 0,
                action: "delay".to_owned(),
                result: "completed".to_owned(),
            },
        }
    }

    #[must_use]
    pub fn from_register(trace: &RegisterTrace) -> Self {
        match trace.operation {
            RegisterOperation::Read => Self::RegisterRead {
                name: trace.name.clone(),
                address: trace.address,
                value: trace.new_value,
            },
            RegisterOperation::Write => Self::RegisterWrite {
                name: trace.name.clone(),
                address: trace.address,
                old_value: trace.old_value,
                new_value: trace.new_value,
            },
        }
    }
}

#[derive(Clone, Debug)]
pub struct EventDraft {
    pub virtual_time_ns: u64,
    pub device_id: Option<String>,
    pub scenario_run_id: Option<String>,
    pub payload: EventPayload,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DomainEvent {
    pub event_id: u64,
    pub event_type: EventType,
    pub timestamp_virtual_ns: u64,
    pub timestamp_wall_ns: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scenario_run_id: Option<String>,
    pub payload: EventPayload,
}

impl DomainEvent {
    pub(crate) fn from_draft(event_id: u64, draft: EventDraft) -> Self {
        let timestamp_wall_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| {
                u64::try_from(duration.as_nanos()).unwrap_or(u64::MAX)
            });
        Self {
            event_id,
            event_type: draft.payload.event_type(),
            timestamp_virtual_ns: draft.virtual_time_ns,
            timestamp_wall_ns,
            device_id: draft.device_id,
            scenario_run_id: draft.scenario_run_id,
            payload: draft.payload,
        }
    }
}
