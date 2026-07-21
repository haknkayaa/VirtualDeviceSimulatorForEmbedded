//! Declarative register definitions and deterministic runtime register state.

mod definition;
mod engine;
mod error;

pub use definition::{AccessType, RegisterDefinition};
pub use engine::{RegisterEngine, RegisterMetadata, RegisterRead, RegisterWrite};
pub use error::RegisterError;
