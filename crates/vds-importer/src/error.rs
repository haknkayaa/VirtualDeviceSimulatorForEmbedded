//! Error types for VDS4E hardware importers.

use thiserror::Error;

/// Result alias for operations in `vds-importer`.
pub type Result<T> = std::result::Result<T, ImporterError>;

/// Errors that can occur when importing hardware definitions from SVD or DTS.
#[derive(Debug, Error)]
pub enum ImporterError {
    /// Failure during XML parsing.
    #[error("XML parsing error: {0}")]
    XmlParse(String),

    /// Missing or invalid CMSIS-SVD element or attribute.
    #[error("Invalid SVD content: {0}")]
    InvalidSvd(String),

    /// Failure during Device Tree parsing.
    #[error("Device Tree parsing error: {0}")]
    DtsParse(String),

    /// Invalid Device Tree structure or unexpected property values.
    #[error("Invalid Device Tree structure: {0}")]
    InvalidDts(String),

    /// Failed to map imported hardware into a valid device model.
    #[error("Model conversion error: {0}")]
    Conversion(String),

    /// Device model schema validation failure.
    #[error("Schema validation error: {0}")]
    Validation(String),

    /// I/O error when reading input files.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// YAML serialization / deserialization error.
    #[error("YAML serialization error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    /// JSON serialization / deserialization error.
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
}
