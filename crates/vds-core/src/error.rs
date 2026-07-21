use std::path::PathBuf;

/// Error type for VDS4E core foundation services.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("failed to read configuration '{path}': {source}")]
    ConfigRead {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("configuration is not valid YAML: {0}")]
    ConfigYaml(#[from] serde_yaml::Error),

    #[error("embedded server configuration schema is invalid: {0}")]
    InvalidEmbeddedSchema(String),

    #[error("configuration failed schema validation:\n{details}")]
    ConfigValidation { details: String },

    #[error("validated configuration has an incompatible shape: {0}")]
    ConfigShape(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
