use std::{fs, path::Path, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

const SERVER_CONFIG_SCHEMA: &str = include_str!("../../../schemas/server-config.schema.json");

/// Validated configuration for the headless simulator daemon.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    pub schema_version: u32,
    pub server: ServerSettings,
    pub data_plane: DataPlaneSettings,
    pub observability: ObservabilitySettings,
    pub device_models: Vec<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerSettings {
    pub control_address: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DataPlaneSettings {
    pub unix_socket: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ObservabilitySettings {
    pub log_level: String,
}

impl ServerConfig {
    /// Loads a YAML file and validates it against the versioned JSON Schema.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read, the YAML cannot be parsed,
    /// or the document does not conform to the supported schema version.
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let yaml = fs::read_to_string(path).map_err(|source| Error::ConfigRead {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_yaml(&yaml)
    }

    /// Parses and validates YAML configuration content.
    ///
    /// # Errors
    ///
    /// Returns an error when the YAML cannot be parsed, the embedded schema is
    /// invalid, or the document does not conform to the schema.
    pub fn from_yaml(yaml: &str) -> Result<Self> {
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(yaml)?;
        let instance = serde_json::to_value(yaml_value)?;
        let schema: serde_json::Value = serde_json::from_str(SERVER_CONFIG_SCHEMA)
            .map_err(|error| Error::InvalidEmbeddedSchema(error.to_string()))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| Error::InvalidEmbeddedSchema(error.to_string()))?;

        let errors = validator
            .iter_errors(&instance)
            .map(|error| format!("- {}: {}", error.instance_path, error))
            .collect::<Vec<_>>();

        if !errors.is_empty() {
            return Err(Error::ConfigValidation {
                details: errors.join("\n"),
            });
        }

        serde_json::from_value(instance).map_err(Error::from)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::ServerConfig;
    use crate::Error;

    const VALID_CONFIG: &str = r"
schema_version: 1
server:
  control_address: 127.0.0.1:8080
data_plane:
  unix_socket: /tmp/vds4e.sock
observability:
  log_level: info
device_models:
  - device-models/examples/spi-flash.yaml
";

    #[test]
    fn accepts_valid_configuration() {
        let config = ServerConfig::from_yaml(VALID_CONFIG).expect("configuration should be valid");

        assert_eq!(config.schema_version, 1);
        assert_eq!(config.server.control_address, "127.0.0.1:8080");
        assert_eq!(
            config.data_plane.unix_socket.to_str(),
            Some("/tmp/vds4e.sock")
        );
        assert_eq!(config.observability.log_level, "info");
        assert_eq!(
            config.device_models,
            vec![PathBuf::from("device-models/examples/spi-flash.yaml")]
        );
    }

    #[test]
    fn rejects_unknown_fields() {
        let invalid = VALID_CONFIG.replace("  log_level: info", "  log_level: info\n  color: true");

        let error = ServerConfig::from_yaml(&invalid).expect_err("unknown field should fail");

        assert!(matches!(error, Error::ConfigValidation { .. }));
        assert!(error.to_string().contains("color"));
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let invalid = VALID_CONFIG.replace("schema_version: 1", "schema_version: 2");

        let error = ServerConfig::from_yaml(&invalid).expect_err("new schema should fail");

        assert!(matches!(error, Error::ConfigValidation { .. }));
        assert!(error.to_string().contains("schema_version"));
    }

    #[test]
    fn reports_yaml_syntax_errors() {
        let error =
            ServerConfig::from_yaml("schema_version: [").expect_err("malformed YAML should fail");

        assert!(matches!(error, Error::ConfigYaml(_)));
    }
}
