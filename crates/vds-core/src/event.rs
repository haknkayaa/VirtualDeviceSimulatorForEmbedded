use std::collections::{BTreeMap, HashMap};

use crate::device::RegisterTrace;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EventId(u64);

/// One due event returned from the generic scheduler.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduledEvent<E> {
    pub id: EventId,
    pub deadline_ns: u64,
    pub payload: E,
}

/// Generic deterministic one-shot scheduler.
///
/// The monotonically increasing event id is also the equal-deadline sequence,
/// so draining a `BTreeMap` preserves insertion order deterministically.
#[derive(Debug)]
pub struct EventScheduler<E> {
    next_id: u64,
    events: BTreeMap<(u64, EventId), E>,
    locations: HashMap<EventId, u64>,
}

impl<E> Default for EventScheduler<E> {
    fn default() -> Self {
        Self {
            next_id: 1,
            events: BTreeMap::new(),
            locations: HashMap::new(),
        }
    }
}

impl<E> EventScheduler<E> {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Schedules a one-shot payload at an absolute virtual deadline.
    ///
    /// # Errors
    ///
    /// Returns an error if the event-id sequence is exhausted.
    pub fn schedule_at(&mut self, deadline_ns: u64, payload: E) -> Result<EventId, SchedulerError> {
        let id = EventId(self.next_id);
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or(SchedulerError::EventIdExhausted)?;
        self.events.insert((deadline_ns, id), payload);
        self.locations.insert(id, deadline_ns);
        Ok(id)
    }

    pub fn cancel(&mut self, event_id: EventId) -> bool {
        self.locations
            .remove(&event_id)
            .and_then(|deadline| self.events.remove(&(deadline, event_id)))
            .is_some()
    }

    /// Removes and returns every event due at or before `now_ns`.
    pub fn drain_due(&mut self, now_ns: u64) -> Vec<ScheduledEvent<E>> {
        let due_keys = self
            .events
            .range(..=(now_ns, EventId(u64::MAX)))
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        due_keys
            .into_iter()
            .filter_map(|(deadline_ns, id)| {
                self.locations.remove(&id);
                self.events
                    .remove(&(deadline_ns, id))
                    .map(|payload| ScheduledEvent {
                        id,
                        deadline_ns,
                        payload,
                    })
            })
            .collect()
    }

    pub fn clear(&mut self) -> usize {
        let count = self.events.len();
        self.events.clear();
        self.locations.clear();
        count
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    #[must_use]
    pub fn next_deadline_ns(&self) -> Option<u64> {
        self.events
            .first_key_value()
            .map(|((deadline, _), _)| *deadline)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SchedulerError {
    #[error("scheduled event id space is exhausted")]
    EventIdExhausted,
}

/// Observable device timing events emitted at operation boundaries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DeviceEvent {
    OperationStarted {
        command: String,
        scheduled_duration_ns: u64,
        started_at_ns: u64,
        busy: bool,
    },
    OperationCompleted {
        command: String,
        scheduled_duration_ns: u64,
        started_at_ns: u64,
        completed_at_ns: u64,
        busy: bool,
        register: RegisterTrace,
        result: &'static str,
    },
    StateTransition {
        from_state: String,
        to_state: String,
        trigger: String,
        virtual_time_ns: u64,
        result: &'static str,
    },
    FaultTriggered {
        fault_id: String,
        command: String,
        trigger: &'static str,
        trigger_count: u64,
        action: &'static str,
        virtual_time_ns: u64,
        result: &'static str,
    },
    FaultDelayCompleted {
        fault_id: String,
        command: String,
        scheduled_duration_ns: u64,
        started_at_ns: u64,
        completed_at_ns: u64,
    },
}

impl DeviceEvent {
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::OperationStarted { .. } => "device_operation_started",
            Self::OperationCompleted { .. } => "device_operation_completed",
            Self::StateTransition { .. } => "state_transition",
            Self::FaultTriggered { .. } => "fault_triggered",
            Self::FaultDelayCompleted { .. } => "fault_delay_completed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::EventScheduler;

    #[test]
    fn events_do_not_fire_early() {
        let mut scheduler = EventScheduler::new();
        scheduler
            .schedule_at(10, "event")
            .expect("event should schedule");

        assert!(scheduler.drain_due(9).is_empty());
    }

    #[test]
    fn events_fire_at_the_exact_deadline() {
        let mut scheduler = EventScheduler::new();
        scheduler
            .schedule_at(10, "event")
            .expect("event should schedule");

        assert_eq!(scheduler.drain_due(10)[0].payload, "event");
    }

    #[test]
    fn same_deadline_events_preserve_insertion_order() {
        let mut scheduler = EventScheduler::new();
        for payload in ["first", "second", "third"] {
            scheduler
                .schedule_at(10, payload)
                .expect("event should schedule");
        }

        let payloads = scheduler
            .drain_due(10)
            .into_iter()
            .map(|event| event.payload)
            .collect::<Vec<_>>();
        assert_eq!(payloads, ["first", "second", "third"]);
    }

    #[test]
    fn cancelled_events_do_not_execute() {
        let mut scheduler = EventScheduler::new();
        let cancelled = scheduler
            .schedule_at(10, "cancelled")
            .expect("event should schedule");
        scheduler
            .schedule_at(10, "kept")
            .expect("event should schedule");

        assert!(scheduler.cancel(cancelled));
        assert_eq!(scheduler.drain_due(10)[0].payload, "kept");
    }
}
