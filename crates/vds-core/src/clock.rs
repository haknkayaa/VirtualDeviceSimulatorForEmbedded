use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

/// Monotonic simulator-time source used by schedulers and device runtimes.
pub trait SimulatorClock: Send + Sync {
    fn now_ns(&self) -> u64;
}

/// Monotonic wall-clock-backed simulator time measured from construction.
#[derive(Debug)]
pub struct RealTimeClock {
    epoch: Instant,
}

impl RealTimeClock {
    #[must_use]
    pub fn new() -> Self {
        Self {
            epoch: Instant::now(),
        }
    }
}

impl Default for RealTimeClock {
    fn default() -> Self {
        Self::new()
    }
}

impl SimulatorClock for RealTimeClock {
    fn now_ns(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_nanos()).unwrap_or(u64::MAX)
    }
}

/// Deterministic simulator clock advanced explicitly by its owner.
#[derive(Debug, Default)]
pub struct ManualClock {
    now_ns: AtomicU64,
}

impl ManualClock {
    #[must_use]
    pub fn new(start_ns: u64) -> Self {
        Self {
            now_ns: AtomicU64::new(start_ns),
        }
    }

    /// Advances virtual time without sleeping.
    ///
    /// # Errors
    ///
    /// Returns an overflow error if the duration cannot be represented in the
    /// simulator's `u64` nanosecond time domain.
    pub fn advance(&self, duration: Duration) -> Result<u64, ClockError> {
        let delta_ns = u64::try_from(duration.as_nanos()).map_err(|_| ClockError::Overflow)?;
        self.now_ns
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                current.checked_add(delta_ns)
            })
            .map(|previous| previous + delta_ns)
            .map_err(|_| ClockError::Overflow)
    }
}

impl SimulatorClock for ManualClock {
    fn now_ns(&self) -> u64 {
        self.now_ns.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ClockError {
    #[error("virtual clock overflow")]
    Overflow,
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{ManualClock, SimulatorClock};

    #[test]
    fn manual_clock_starts_at_zero_and_advances() {
        let clock = ManualClock::default();

        assert_eq!(clock.now_ns(), 0);
        assert_eq!(
            clock
                .advance(Duration::from_millis(9))
                .expect("advance should fit"),
            9_000_000
        );
        assert_eq!(clock.now_ns(), 9_000_000);
    }
}
