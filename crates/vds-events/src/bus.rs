use std::{
    collections::{HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use tokio::sync::broadcast;

use crate::{DomainEvent, EventDraft, EventType};

pub const DEFAULT_RING_CAPACITY: usize = 10_000;
const DEFAULT_SUBSCRIBER_CAPACITY: usize = 1_024;

#[derive(Clone, Debug, Default)]
pub struct EventFilter {
    pub event_types: Option<HashSet<EventType>>,
    pub device_id: Option<String>,
    pub scenario_run_id: Option<String>,
}

impl EventFilter {
    fn matches(&self, event: &DomainEvent) -> bool {
        self.event_types
            .as_ref()
            .is_none_or(|types| types.contains(&event.event_type))
            && self
                .device_id
                .as_ref()
                .is_none_or(|id| event.device_id.as_ref() == Some(id))
            && self
                .scenario_run_id
                .as_ref()
                .is_none_or(|id| event.scenario_run_id.as_ref() == Some(id))
    }
}

pub struct EventBus {
    next_id: AtomicU64,
    capacity: usize,
    events: Mutex<VecDeque<Arc<DomainEvent>>>,
    sender: broadcast::Sender<Arc<DomainEvent>>,
}

impl EventBus {
    #[must_use]
    /// Creates a bounded event bus.
    ///
    /// # Panics
    /// Panics when either capacity is zero.
    pub fn new(capacity: usize, subscriber_capacity: usize) -> Self {
        assert!(capacity > 0, "event ring capacity must be positive");
        assert!(
            subscriber_capacity > 0,
            "subscriber capacity must be positive"
        );
        let (sender, _) = broadcast::channel(subscriber_capacity);
        Self {
            next_id: AtomicU64::new(1),
            capacity,
            events: Mutex::new(VecDeque::with_capacity(capacity)),
            sender,
        }
    }

    #[must_use]
    /// Assigns an ID, retains, and broadcasts one domain event without waiting.
    ///
    /// # Panics
    /// Panics only if the process exhausts the `u64` event ID space.
    pub fn publish(&self, draft: EventDraft) -> Arc<DomainEvent> {
        let mut events = self
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let id = self
            .next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .expect("domain event ID space exhausted");
        let event = Arc::new(DomainEvent::from_draft(id, draft));
        if events.len() == self.capacity {
            events.pop_front();
        }
        events.push_back(Arc::clone(&event));
        // Sending while the ring lock is held preserves the same total order in
        // replay storage and live delivery. Broadcast send is synchronous and
        // never waits for subscribers.
        let _ = self.sender.send(Arc::clone(&event));
        drop(events);
        event
    }

    #[must_use]
    pub fn events_after(&self, event_id: u64) -> Vec<Arc<DomainEvent>> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|event| event.event_id > event_id)
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn subscribe_from(&self, after_event_id: u64) -> EventSubscription {
        self.subscribe_filtered(after_event_id, EventFilter::default())
    }

    #[must_use]
    pub fn subscribe_filtered(
        &self,
        after_event_id: u64,
        filter: EventFilter,
    ) -> EventSubscription {
        let receiver = self.sender.subscribe();
        let replay = self
            .events_after(after_event_id)
            .into_iter()
            .filter(|event| filter.matches(event))
            .collect();
        EventSubscription {
            replay,
            receiver,
            last_event_id: after_event_id,
            filter,
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(DEFAULT_RING_CAPACITY, DEFAULT_SUBSCRIBER_CAPACITY)
    }
}

pub struct EventSubscription {
    replay: VecDeque<Arc<DomainEvent>>,
    receiver: broadcast::Receiver<Arc<DomainEvent>>,
    last_event_id: u64,
    filter: EventFilter,
}

impl EventSubscription {
    pub async fn recv(&mut self) -> Option<Arc<DomainEvent>> {
        if let Some(event) = self.replay.pop_front() {
            self.last_event_id = event.event_id;
            return Some(event);
        }
        loop {
            match self.receiver.recv().await {
                Ok(event) if event.event_id > self.last_event_id && self.filter.matches(&event) => {
                    self.last_event_id = event.event_id;
                    return Some(event);
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventPayload;

    fn draft(value: u64) -> EventDraft {
        EventDraft {
            virtual_time_ns: value,
            device_id: None,
            scenario_run_id: None,
            payload: EventPayload::DeviceReset {
                result: "success".into(),
            },
        }
    }

    #[tokio::test]
    async fn event_ids_are_ordered_and_replay_is_exclusive() {
        let bus = EventBus::new(4, 4);
        assert_eq!(bus.publish(draft(1)).event_id, 1);
        assert_eq!(bus.publish(draft(2)).event_id, 2);
        let mut subscription = bus.subscribe_from(1);
        assert_eq!(subscription.recv().await.unwrap().event_id, 2);
    }

    #[test]
    fn ring_eviction_is_fifo_and_deterministic() {
        let bus = EventBus::new(2, 2);
        for value in 1..=3 {
            let _ = bus.publish(draft(value));
        }
        assert_eq!(
            bus.events_after(0)
                .iter()
                .map(|event| event.event_id)
                .collect::<Vec<_>>(),
            [2, 3]
        );
    }

    #[test]
    fn concurrent_publishers_preserve_event_id_order_in_the_ring() {
        let bus = Arc::new(EventBus::new(128, 128));
        let workers = (0..4)
            .map(|worker| {
                let bus = Arc::clone(&bus);
                std::thread::spawn(move || {
                    for offset in 0..25 {
                        let _ = bus.publish(draft(worker * 25 + offset));
                    }
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        let ids = bus
            .events_after(0)
            .iter()
            .map(|event| event.event_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, (1..=100).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn slow_subscriber_does_not_block_publishers_or_other_subscribers() {
        let bus = EventBus::new(8, 2);
        let mut slow = bus.subscribe_from(0);
        let mut current = bus.subscribe_from(0);
        for value in 0..6 {
            let published = bus.publish(draft(value));
            assert_eq!(current.recv().await.unwrap().event_id, published.event_id);
        }
        assert_eq!(slow.recv().await.unwrap().event_id, 5);
        assert_eq!(bus.events_after(0).len(), 6);
    }
}
