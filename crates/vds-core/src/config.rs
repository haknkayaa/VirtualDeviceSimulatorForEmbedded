//! Server configuration loading, defaults, and validation.

use std::{fs, path::Path, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    Error, Result,
    device_package::{DevicePackage, install_example_package},
};

const SERVER_CONFIG_SCHEMA: &str = include_str!("../../../schemas/server-config.schema.json");

/// Validated configuration for the headless simulator daemon.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    pub schema_version: u32,
    pub server: ServerSettings,
    pub data_plane: DataPlaneSettings,
    pub observability: ObservabilitySettings,
    #[serde(default)]
    pub event_store: EventStoreSettings,
    pub device_packages: Vec<PathBuf>,
    /// Optional board topology connecting public device signal ports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topology: Option<PathBuf>,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct EventStoreSettings {
    pub enabled: bool,
    pub max_size_mb: u64,
    pub max_events: u64,
    pub cleanup_interval_seconds: u64,
    pub transaction_retention_hours: u64,
    pub register_read_retention_hours: u64,
    pub critical_retention_days: u64,
    pub register_read_sample_rate: u64,
}

impl Default for EventStoreSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            max_size_mb: 1_024,
            max_events: 1_000_000,
            cleanup_interval_seconds: 60,
            transaction_retention_hours: 24,
            register_read_retention_hours: 1,
            critical_retention_days: 30,
            register_read_sample_rate: 100,
        }
    }
}

impl ServerConfig {
    /// Loads and validates every configured package manifest.
    ///
    /// # Errors
    ///
    /// Returns an error when a package manifest or declared resource is invalid.
    pub fn resolved_device_packages(&self) -> Result<Vec<DevicePackage>> {
        self.device_packages
            .iter()
            .map(|path| {
                install_example_package(path)
                    .and_then(|path| DevicePackage::load(path).map_err(Error::from))
            })
            .collect::<std::result::Result<Vec<_>, _>>()
    }

    /// Returns every YAML scenario declared by configured device packages.
    ///
    /// # Errors
    ///
    /// Returns an error when a package scenario directory exists but cannot be
    /// read.
    pub fn resolved_scenarios(&self) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();
        for package in self.resolved_device_packages()? {
            paths.extend(package.scenario_paths()?);
        }
        Ok(paths)
    }

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

    use super::{EventStoreSettings, ServerConfig};
    use crate::Error;

    const VALID_CONFIG: &str = r"
schema_version: 1
server:
  control_address: 127.0.0.1:8080
data_plane:
  unix_socket: /tmp/vds4e.sock
observability:
  log_level: info
device_packages:
  - device-models/examples/micron-mt25ql256aba8esf-0sit
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
            config.device_packages,
            vec![PathBuf::from(
                "device-models/examples/micron-mt25ql256aba8esf-0sit"
            )]
        );
        assert_eq!(config.event_store, EventStoreSettings::default());
    }

    #[test]
    fn accepts_an_explicit_event_store_policy() {
        let yaml = VALID_CONFIG.replace(
            "device_packages:",
            "event_store:\n  enabled: false\n  max_size_mb: 64\n  max_events: 5000\n  cleanup_interval_seconds: 5\n  transaction_retention_hours: 2\n  register_read_retention_hours: 1\n  critical_retention_days: 7\n  register_read_sample_rate: 25\ndevice_packages:",
        );
        let config = ServerConfig::from_yaml(&yaml).expect("event store policy should be valid");
        assert!(!config.event_store.enabled);
        assert_eq!(config.event_store.max_size_mb, 64);
        assert_eq!(config.event_store.max_events, 5_000);
        assert_eq!(config.event_store.register_read_sample_rate, 25);
    }

    #[test]
    fn rejects_legacy_device_models() {
        let invalid = VALID_CONFIG.replace(
            "device_packages:\n  - device-models/examples/micron-mt25ql256aba8esf-0sit",
            "device_models:\n  - device-models/examples/micron-mt25ql256aba8esf-0sit/model/device.yaml",
        );
        let error = ServerConfig::from_yaml(&invalid).expect_err("legacy models must be rejected");
        assert!(matches!(error, Error::ConfigValidation { .. }));
        assert!(error.to_string().contains("device_models"));
    }

    #[test]
    fn rejects_global_scenarios() {
        let invalid = format!("{VALID_CONFIG}scenarios: []\n");
        let error =
            ServerConfig::from_yaml(&invalid).expect_err("global scenarios must be rejected");
        assert!(matches!(error, Error::ConfigValidation { .. }));
        assert!(error.to_string().contains("scenarios"));
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
