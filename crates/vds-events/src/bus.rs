//! Non-blocking in-memory event distribution and replay.

use std::{
    collections::{HashSet, VecDeque},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender, TrySendError},
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, params};
use tokio::sync::broadcast;

use crate::{DomainEvent, EventDraft, EventType};

pub const DEFAULT_RING_CAPACITY: usize = 10_000;
const DEFAULT_SUBSCRIBER_CAPACITY: usize = 1_024;
const PERSISTENCE_QUEUE_CAPACITY: usize = 65_536;
const PERSISTENCE_BATCH_SIZE: usize = 512;
const PERSISTENCE_BATCH_WAIT: Duration = Duration::from_millis(10);
const CLEANUP_BATCH_SIZE: u64 = 10_000;
const MAX_CLEANUP_CHUNKS: usize = 8;

#[derive(Clone, Copy, Debug)]
pub struct EventPersistencePolicy {
    pub max_size_bytes: u64,
    pub max_events: u64,
    pub cleanup_interval: Duration,
    pub transaction_retention: Duration,
    pub register_read_retention: Duration,
    pub critical_retention: Duration,
    pub register_read_sample_rate: u64,
}

impl Default for EventPersistencePolicy {
    fn default() -> Self {
        Self {
            max_size_bytes: 1_024 * 1_024 * 1_024,
            max_events: 1_000_000,
            cleanup_interval: Duration::from_secs(60),
            transaction_retention: Duration::from_secs(24 * 60 * 60),
            register_read_retention: Duration::from_secs(60 * 60),
            critical_retention: Duration::from_secs(30 * 24 * 60 * 60),
            register_read_sample_rate: 100,
        }
    }
}

struct PersistedEvent {
    event_id: u64,
    timestamp_wall_ns: u64,
    event_type: String,
    event_json: String,
}

enum PersistenceMessage {
    Event(PersistedEvent),
    Shutdown,
}

#[derive(Default)]
struct PersistenceHealth {
    dropped_events: AtomicU64,
    failed_batches: AtomicU64,
}

/// Snapshot of `SQLite` persistence health. Telemetry loss never stops the simulator.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PersistenceStatus {
    pub enabled: bool,
    pub dropped_events: u64,
    pub failed_batches: u64,
}

impl PersistenceStatus {
    #[must_use]
    pub const fn degraded(&self) -> bool {
        self.dropped_events > 0 || self.failed_batches > 0
    }
}

struct PersistenceWorker {
    sender: SyncSender<PersistenceMessage>,
    handle: Mutex<Option<JoinHandle<()>>>,
    health: Arc<PersistenceHealth>,
}

fn write_batch(
    connection: &mut Connection,
    pending: &[PersistedEvent],
    policy: EventPersistencePolicy,
) -> Result<(), rusqlite::Error> {
    let transaction = connection.transaction()?;
    {
        let mut statement = transaction.prepare_cached(
            "INSERT INTO domain_events(event_id, timestamp_wall_ns, event_type, event_json)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        for event in pending {
            let persist_payload = event.event_type != "register_read"
                || event.event_id % policy.register_read_sample_rate.max(1) == 0;
            if persist_payload {
                statement.execute(params![
                    i64::try_from(event.event_id).unwrap_or(i64::MAX),
                    i64::try_from(event.timestamp_wall_ns).unwrap_or(i64::MAX),
                    event.event_type,
                    event.event_json
                ])?;
            }
            transaction.execute(
                "INSERT INTO event_store_meta(key, value) VALUES ('last_event_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [i64::try_from(event.event_id).unwrap_or(i64::MAX)],
            )?;
        }
    }
    transaction.commit()
}

impl PersistenceWorker {
    fn start(connection: Connection, policy: EventPersistencePolicy) -> Self {
        let (sender, receiver) = mpsc::sync_channel(PERSISTENCE_QUEUE_CAPACITY);
        let health = Arc::new(PersistenceHealth::default());
        let worker_health = Arc::clone(&health);
        let handle = thread::Builder::new()
            .name("vds-event-persistence".to_owned())
            .spawn(move || {
                let mut connection = connection;
                let mut pending = Vec::with_capacity(PERSISTENCE_BATCH_SIZE);
                let mut last_cleanup = std::time::Instant::now();
                loop {
                    let message = if pending.is_empty() {
                        receiver.recv().ok()
                    } else {
                        receiver.recv_timeout(PERSISTENCE_BATCH_WAIT).ok()
                    };
                    let mut shutdown = false;
                    match message {
                        Some(PersistenceMessage::Event(event)) => pending.push(event),
                        Some(PersistenceMessage::Shutdown) | None => shutdown = true,
                    }
                    while pending.len() < PERSISTENCE_BATCH_SIZE {
                        match receiver.try_recv() {
                            Ok(PersistenceMessage::Event(event)) => pending.push(event),
                            Ok(PersistenceMessage::Shutdown) => {
                                shutdown = true;
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                    if !pending.is_empty() {
                        if let Err(error) = write_batch(&mut connection, &pending, policy) {
                            worker_health.failed_batches.fetch_add(1, Ordering::Relaxed);
                            worker_health.dropped_events.fetch_add(
                                u64::try_from(pending.len()).unwrap_or(u64::MAX),
                                Ordering::Relaxed,
                            );
                            tracing_stderr(&format!("event persistence batch failed: {error}"));
                        }
                        pending.clear();
                    }
                    if last_cleanup.elapsed() >= policy.cleanup_interval {
                        if let Err(error) = cleanup_events(&mut connection, policy) {
                            worker_health.failed_batches.fetch_add(1, Ordering::Relaxed);
                            tracing_stderr(&format!("event retention cleanup failed: {error}"));
                        }
                        last_cleanup = std::time::Instant::now();
                    }
                    if shutdown {
                        break;
                    }
                }
            })
            .expect("event persistence worker should start");
        Self {
            sender,
            handle: Mutex::new(Some(handle)),
            health,
        }
    }

    /// Queues one event without ever blocking; overflow is counted and dropped.
    fn persist(&self, event: &DomainEvent) {
        let Ok(event_json) = serde_json::to_string(event) else {
            self.health.dropped_events.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let message = PersistenceMessage::Event(PersistedEvent {
            event_id: event.event_id,
            timestamp_wall_ns: event.timestamp_wall_ns,
            event_type: event.event_type.as_str().to_owned(),
            event_json,
        });
        match self.sender.try_send(message) {
            Ok(()) => {}
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                self.health.dropped_events.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    fn status(&self) -> PersistenceStatus {
        PersistenceStatus {
            enabled: true,
            dropped_events: self.health.dropped_events.load(Ordering::Relaxed),
            failed_batches: self.health.failed_batches.load(Ordering::Relaxed),
        }
    }
}

/// Reads a non-negative `SQLite` integer as `u64` (`rusqlite` no longer maps `u64`).
fn read_u64(row: &rusqlite::Row<'_>) -> rusqlite::Result<u64> {
    let value: i64 = row.get(0)?;
    u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, value))
}

fn tracing_stderr(message: &str) {
    eprintln!("vds-events: {message}");
}

fn cutoff_ns(retention: Duration) -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let cutoff = now.saturating_sub(retention.as_nanos());
    i64::try_from(cutoff).unwrap_or(i64::MAX)
}

fn delete_chunk(
    connection: &Connection,
    predicate: &str,
    cutoff: i64,
) -> Result<usize, rusqlite::Error> {
    connection.execute(
        &format!(
            "DELETE FROM domain_events WHERE event_id IN (
               SELECT event_id FROM domain_events
               WHERE {predicate} AND timestamp_wall_ns < ?1
               ORDER BY event_id LIMIT ?2
             )"
        ),
        params![
            cutoff,
            i64::try_from(CLEANUP_BATCH_SIZE).unwrap_or(i64::MAX)
        ],
    )
}

fn delete_expired(
    connection: &Connection,
    predicate: &str,
    cutoff: i64,
) -> Result<(), rusqlite::Error> {
    let cleanup_batch_size = usize::try_from(CLEANUP_BATCH_SIZE).unwrap_or(usize::MAX);
    for _ in 0..MAX_CLEANUP_CHUNKS {
        if delete_chunk(connection, predicate, cutoff)? < cleanup_batch_size {
            break;
        }
    }
    Ok(())
}

fn cleanup_events(
    connection: &mut Connection,
    policy: EventPersistencePolicy,
) -> Result<(), rusqlite::Error> {
    let transaction = connection.transaction()?;
    delete_expired(
        &transaction,
        "event_type = 'register_read'",
        cutoff_ns(policy.register_read_retention),
    )?;
    delete_expired(
        &transaction,
        "event_type IN ('transaction_started', 'transaction_completed', 'operation_started', 'operation_completed', 'signal_changed')",
        cutoff_ns(policy.transaction_retention),
    )?;
    delete_expired(
        &transaction,
        "event_type NOT IN ('register_read', 'transaction_started', 'transaction_completed', 'operation_started', 'operation_completed', 'signal_changed')",
        cutoff_ns(policy.critical_retention),
    )?;
    let count = transaction.query_row("SELECT COUNT(*) FROM domain_events", [], |row| {
        read_u64(row)
    })?;
    let mut overflow = count.saturating_sub(policy.max_events);
    for _ in 0..MAX_CLEANUP_CHUNKS {
        if overflow == 0 {
            break;
        }
        let requested = overflow.min(CLEANUP_BATCH_SIZE);
        let deleted = transaction.execute(
            "DELETE FROM domain_events WHERE event_id IN (
               SELECT event_id FROM domain_events ORDER BY event_id LIMIT ?1
             )",
            [i64::try_from(requested).unwrap_or(i64::MAX)],
        )? as u64;
        overflow = overflow.saturating_sub(deleted);
        if deleted < requested {
            break;
        }
    }
    let page_count = transaction.query_row("PRAGMA page_count", [], read_u64)?;
    let freelist_count = transaction.query_row("PRAGMA freelist_count", [], read_u64)?;
    let page_size = transaction.query_row("PRAGMA page_size", [], read_u64)?;
    let logical_size = page_count
        .saturating_sub(freelist_count)
        .saturating_mul(page_size);
    if logical_size > policy.max_size_bytes {
        transaction.execute(
            "DELETE FROM domain_events WHERE event_id IN (
               SELECT event_id FROM domain_events ORDER BY event_id LIMIT ?1
             )",
            [i64::try_from(CLEANUP_BATCH_SIZE).unwrap_or(i64::MAX)],
        )?;
    }
    transaction.commit()?;
    if logical_size > policy.max_size_bytes {
        connection.execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE);
             PRAGMA incremental_vacuum(1000);",
        )?;
    }
    Ok(())
}

impl Drop for PersistenceWorker {
    fn drop(&mut self) {
        let _ = self.sender.send(PersistenceMessage::Shutdown);
        if let Some(handle) = self
            .handle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            let _ = handle.join();
        }
    }
}

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
    events: Arc<Mutex<VecDeque<Arc<DomainEvent>>>>,
    sender: broadcast::Sender<Arc<DomainEvent>>,
    persistence: Option<PersistenceWorker>,
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
            events: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            sender,
            persistence: None,
        }
    }

    /// Opens a SQLite-backed event bus and restores the newest retained events.
    ///
    /// # Errors
    /// Returns an error when the database cannot be opened, initialized, or read.
    ///
    /// # Panics
    /// Panics when either capacity is zero.
    pub fn persistent(
        path: impl AsRef<Path>,
        capacity: usize,
        subscriber_capacity: usize,
    ) -> Result<Self, rusqlite::Error> {
        Self::persistent_with_policy(
            path,
            capacity,
            subscriber_capacity,
            EventPersistencePolicy::default(),
        )
    }

    /// Opens a SQLite-backed event bus with an explicit retention and sampling policy.
    ///
    /// # Errors
    /// Returns an error when the database cannot be opened, initialized, or read.
    ///
    /// # Panics
    /// Panics when either the event ring capacity or subscriber capacity is zero.
    pub fn persistent_with_policy(
        path: impl AsRef<Path>,
        capacity: usize,
        subscriber_capacity: usize,
        policy: EventPersistencePolicy,
    ) -> Result<Self, rusqlite::Error> {
        assert!(capacity > 0, "event ring capacity must be positive");
        assert!(
            subscriber_capacity > 0,
            "subscriber capacity must be positive"
        );
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS domain_events (
               event_id INTEGER PRIMARY KEY,
               timestamp_wall_ns INTEGER NOT NULL,
               event_type TEXT NOT NULL DEFAULT '',
               event_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS event_store_meta (
               key TEXT PRIMARY KEY,
               value INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_domain_events_wall_time
               ON domain_events(timestamp_wall_ns);",
        )?;
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_domain_events_type_time
             ON domain_events(event_type, timestamp_wall_ns)",
            [],
        )?;
        let mut statement = connection.prepare(
            "SELECT event_json FROM domain_events
             ORDER BY event_id DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([i64::try_from(capacity).unwrap_or(i64::MAX)], |row| {
            row.get::<_, String>(0)
        })?;
        let mut restored = rows
            .filter_map(Result::ok)
            .filter_map(|json| serde_json::from_str::<DomainEvent>(&json).ok())
            .collect::<Vec<_>>();
        restored.reverse();
        let maximum_id = connection.query_row(
            "SELECT MAX(
               COALESCE((SELECT MAX(event_id) FROM domain_events), 0),
               COALESCE((SELECT value FROM event_store_meta WHERE key = 'last_event_id'), 0)
             )",
            [],
            read_u64,
        )?;
        let next_id = maximum_id.saturating_add(1);
        let (sender, _) = broadcast::channel(subscriber_capacity);
        drop(statement);
        Ok(Self {
            next_id: AtomicU64::new(next_id),
            capacity,
            events: Arc::new(Mutex::new(restored.into_iter().map(Arc::new).collect())),
            sender,
            persistence: Some(PersistenceWorker::start(connection, policy)),
        })
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
        if let Some(persistence) = &self.persistence {
            persistence.persist(event.as_ref());
        }
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

    /// Reports persistence health; in-memory buses are never degraded.
    #[must_use]
    pub fn persistence_status(&self) -> PersistenceStatus {
        self.persistence
            .as_ref()
            .map_or_else(PersistenceStatus::default, PersistenceWorker::status)
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
            ring: Arc::clone(&self.events),
            last_event_id: after_event_id,
            filter,
            gap: None,
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(DEFAULT_RING_CAPACITY, DEFAULT_SUBSCRIBER_CAPACITY)
    }
}

/// Events that were lost to a slow consumer and could not be replayed from the ring.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EventGap {
    /// Last event ID the consumer saw before the loss.
    pub after_event_id: u64,
    /// First event ID the consumer will receive next.
    pub resume_event_id: u64,
}

pub struct EventSubscription {
    replay: VecDeque<Arc<DomainEvent>>,
    receiver: broadcast::Receiver<Arc<DomainEvent>>,
    ring: Arc<Mutex<VecDeque<Arc<DomainEvent>>>>,
    last_event_id: u64,
    filter: EventFilter,
    gap: Option<EventGap>,
}

impl EventSubscription {
    /// Takes the unrecoverable gap, if any, so the consumer can request a resync.
    pub fn take_gap(&mut self) -> Option<EventGap> {
        self.gap.take()
    }

    fn recover_from_ring(&mut self) {
        let ring = self
            .ring
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let oldest = ring.front().map(|event| event.event_id);
        if let Some(oldest) = oldest
            && oldest > self.last_event_id.saturating_add(1)
        {
            self.gap = Some(EventGap {
                after_event_id: self.last_event_id,
                resume_event_id: oldest,
            });
        }
        let missed = ring
            .iter()
            .filter(|event| event.event_id > self.last_event_id && self.filter.matches(event))
            .cloned()
            .collect::<Vec<_>>();
        drop(ring);
        self.replay = missed.into();
        // Everything already queued in the broadcast receiver is also in the ring.
        self.receiver = self.receiver.resubscribe();
    }

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
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    self.recover_from_ring();
                    if let Some(event) = self.replay.pop_front() {
                        self.last_event_id = event.event_id;
                        return Some(event);
                    }
                }
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

    fn register_read_draft(value: u64) -> EventDraft {
        EventDraft {
            virtual_time_ns: value,
            device_id: Some("sample-device".into()),
            scenario_run_id: None,
            payload: EventPayload::RegisterRead {
                name: Some("status".into()),
                address: 0,
                value: Some(value),
            },
        }
    }

    fn temporary_store(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "vds4e-events-{label}-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow Unix epoch")
                .as_nanos()
        ))
    }

    fn remove_temporary_store(path: &Path) {
        for candidate in [
            path.to_path_buf(),
            path.with_extension("sqlite3-wal"),
            path.with_extension("sqlite3-shm"),
        ] {
            let _ = std::fs::remove_file(candidate);
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
    fn sqlite_events_survive_reopening() {
        let path = std::env::temp_dir().join(format!(
            "vds4e-events-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow Unix epoch")
                .as_nanos()
        ));
        {
            let bus = EventBus::persistent(&path, 8, 8).expect("store should open");
            assert_eq!(bus.publish(draft(42)).event_id, 1);
        }
        let restored = EventBus::persistent(&path, 8, 8).expect("store should reopen");
        assert_eq!(restored.events_after(0).len(), 1);
        assert_eq!(restored.events_after(0)[0].timestamp_virtual_ns, 42);
        assert_eq!(restored.publish(draft(43)).event_id, 2);
        std::fs::remove_file(path).expect("temporary store should be removable");
    }

    #[test]
    fn sqlite_worker_flushes_large_batches_during_shutdown() {
        let path = std::env::temp_dir().join(format!(
            "vds4e-events-batch-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should follow Unix epoch")
                .as_nanos()
        ));
        {
            let bus = EventBus::persistent(&path, 2_048, 8).expect("store should open");
            for value in 0..2_000 {
                let _ = bus.publish(draft(value));
            }
        }
        let restored = EventBus::persistent(&path, 2_048, 8).expect("store should reopen");
        assert_eq!(restored.events_after(0).len(), 2_000);
        drop(restored);
        std::fs::remove_file(path).expect("temporary store should be removable");
    }

    #[test]
    fn sampled_register_reads_preserve_the_event_id_high_watermark() {
        let path = temporary_store("sampling");
        let policy = EventPersistencePolicy {
            register_read_sample_rate: 10,
            ..EventPersistencePolicy::default()
        };
        {
            let bus =
                EventBus::persistent_with_policy(&path, 64, 8, policy).expect("store should open");
            for value in 1..=21 {
                assert_eq!(bus.publish(register_read_draft(value)).event_id, value);
            }
        }
        let restored =
            EventBus::persistent_with_policy(&path, 64, 8, policy).expect("store should reopen");
        assert_eq!(restored.events_after(0).len(), 2);
        assert_eq!(restored.publish(draft(22)).event_id, 22);
        drop(restored);
        remove_temporary_store(&path);
    }

    #[test]
    fn cleanup_enforces_the_maximum_event_count() {
        let path = temporary_store("retention");
        let policy = EventPersistencePolicy {
            max_events: 25,
            cleanup_interval: Duration::ZERO,
            ..EventPersistencePolicy::default()
        };
        {
            let bus =
                EventBus::persistent_with_policy(&path, 128, 8, policy).expect("store should open");
            for value in 1..=100 {
                let _ = bus.publish(draft(value));
            }
        }
        let restored =
            EventBus::persistent_with_policy(&path, 128, 8, policy).expect("store should reopen");
        assert_eq!(restored.events_after(0).len(), 25);
        assert_eq!(restored.events_after(0)[0].event_id, 76);
        drop(restored);
        remove_temporary_store(&path);
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
        // The lagged subscriber is refilled from the ring instead of silently skipping.
        for expected in 1..=6 {
            assert_eq!(slow.recv().await.unwrap().event_id, expected);
        }
        assert!(slow.take_gap().is_none());
        assert_eq!(bus.events_after(0).len(), 6);
    }

    #[tokio::test]
    async fn lag_beyond_the_ring_reports_an_explicit_gap() {
        let bus = EventBus::new(3, 2);
        let mut slow = bus.subscribe_from(0);
        for value in 0..8 {
            let _ = bus.publish(draft(value));
        }
        assert_eq!(slow.recv().await.unwrap().event_id, 6);
        assert_eq!(
            slow.take_gap(),
            Some(EventGap {
                after_event_id: 0,
                resume_event_id: 6
            })
        );
        assert_eq!(slow.recv().await.unwrap().event_id, 7);
        assert_eq!(slow.recv().await.unwrap().event_id, 8);
    }

    #[test]
    fn persistence_overflow_is_counted_and_never_blocks_publishers() {
        let path = temporary_store("overflow");
        {
            let bus = EventBus::persistent(&path, 8, 8).expect("store should open");
            for value in 0..(PERSISTENCE_QUEUE_CAPACITY as u64 + 5_000) {
                let _ = bus.publish(draft(value));
            }
            let status = bus.persistence_status();
            assert!(status.enabled);
            assert_eq!(status.failed_batches, 0);
        }
        remove_temporary_store(&path);
    }
}
