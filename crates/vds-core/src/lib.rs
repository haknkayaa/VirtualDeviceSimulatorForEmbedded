//! Backend-independent foundations shared by VDS4E simulator components.

/// Simulator clock abstractions and implementations.
pub mod clock;
/// Server configuration types and loading.
pub mod config;
/// Bus-neutral virtual-device contracts.
pub mod device;
/// Device-package manifests and installation.
pub mod device_package;
/// Shared core errors.
pub mod error;
/// Virtual-time device event scheduling.
pub mod event;
/// Declarative fault evaluation.
pub mod fault;
/// Runtime device registration and lookup.
pub mod registry;
/// Declarative state-machine execution.
pub mod state_machine;
/// Board topology and deterministic signal routing.
pub mod topology;
/// Bus transaction records.
pub mod transaction;

pub use error::{Error, Result};
