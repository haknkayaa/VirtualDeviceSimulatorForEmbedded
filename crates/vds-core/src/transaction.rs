use std::time::{SystemTime, UNIX_EPOCH};

use crate::device::RegisterTrace;

/// Normalized operation families recorded by the simulator.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Operation {
    SpiTransfer,
}

/// Result metadata associated with a normalized transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransactionResult {
    Success,
    Error { code: &'static str, message: String },
}

/// Shared transaction representation used for logs and future event streams.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transaction {
    pub id: u64,
    pub timestamp_unix_nanos: u128,
    pub bus_id: String,
    pub device_id: String,
    pub operation: Operation,
    pub request: Vec<u8>,
    pub response: Vec<u8>,
    pub register: Option<RegisterTrace>,
    pub result: TransactionResult,
}

impl Transaction {
    #[must_use]
    pub fn now(id: u64, device_id: String, request: Vec<u8>) -> Self {
        let timestamp_unix_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        Self {
            id,
            timestamp_unix_nanos,
            bus_id: "spi".to_owned(),
            device_id,
            operation: Operation::SpiTransfer,
            request,
            response: Vec::new(),
            register: None,
            result: TransactionResult::Success,
        }
    }
}
