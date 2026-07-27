//! Backend-independent foundations shared by VDS4E simulator components.

pub mod clock;
pub mod config;
pub mod device;
pub mod device_package;
pub mod error;
pub mod event;
pub mod fault;
pub mod registry;
pub mod state_machine;
pub mod transaction;

pub use error::{Error, Result};
