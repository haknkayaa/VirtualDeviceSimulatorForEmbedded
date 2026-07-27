//! Typed domain events and non-blocking in-memory distribution.

mod bus;
mod model;

pub use bus::{
    DEFAULT_RING_CAPACITY, EventBus, EventFilter, EventPersistencePolicy, EventSubscription,
};
pub use model::{DomainEvent, EventDraft, EventPayload, EventType};
