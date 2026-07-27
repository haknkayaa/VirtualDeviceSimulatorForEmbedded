use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

const DEVICE_PACKAGE_SCHEMA: &str = include_str!("../../../schemas/device-package.schema.json");
const MANIFEST_FILE: &str = "device-package.yaml";
const EXAMPLE_MARKER_FILE: &str = ".vds4e-managed-example";
static EXAMPLE_INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static EXAMPLE_STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageManifest {
    pub api_version: String,
    pub kind: String,
    pub metadata: DevicePackageMetadata,
    pub spec: DevicePackageSpec,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageMetadata {
    pub id: String,
    pub display_name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageSpec {
    pub bus: DevicePackageBus,
    pub runtime: DevicePackageRuntime,
    #[serde(default)]
    pub authoring: DevicePackageAuthoring,
    #[serde(default)]
    pub validation: DevicePackageValidation,
    pub documentation: Option<PathBuf>,
    pub assets: Option<PathBuf>,
    #[serde(default)]
    pub extensions: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageBus {
    #[serde(rename = "type")]
    pub kind: DeviceBusKind,
    pub profile: Option<String>,
    #[serde(default)]
    pub options: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceBusKind {
    Spi,
    I2c,
    Gpio,
    Ethernet,
    Uart,
    Can,
    Usb,
    Custom,
}

impl DeviceBusKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Spi => "spi",
            Self::I2c => "i2c",
            Self::Gpio => "gpio",
            Self::Ethernet => "ethernet",
            Self::Uart => "uart",
            Self::Can => "can",
            Self::Usb => "usb",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageRuntime {
    pub driver: String,
    pub model: PathBuf,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageAuthoring {
    pub behavior_flow: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DevicePackageValidation {
    pub scenarios: Option<PathBuf>,
    pub fixtures: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct DevicePackage {
    root: PathBuf,
    manifest: DevicePackageManifest,
}

impl DevicePackage {
    /// Loads and validates a portable package manifest and its declared paths.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid manifests, unsafe paths, or missing required
    /// package resources.
    pub fn load(root: impl AsRef<Path>) -> Result<Self, DevicePackageError> {
        let root = root.as_ref().to_path_buf();
        let manifest_path = root.join(MANIFEST_FILE);
        let yaml =
            fs::read_to_string(&manifest_path).map_err(|source| DevicePackageError::Read {
                path: manifest_path.clone(),
                source,
            })?;
        let yaml_value: serde_yaml::Value = serde_yaml::from_str(&yaml)?;
        let instance = serde_json::to_value(yaml_value)?;
        let schema: serde_json::Value = serde_json::from_str(DEVICE_PACKAGE_SCHEMA)
            .map_err(|error| DevicePackageError::Schema(error.to_string()))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| DevicePackageError::Schema(error.to_string()))?;
        let errors = validator
            .iter_errors(&instance)
            .map(|error| format!("- {}: {}", error.instance_path, error))
            .collect::<Vec<_>>();
        if !errors.is_empty() {
            return Err(DevicePackageError::Validation(errors.join("\n")));
        }
        let manifest: DevicePackageManifest = serde_json::from_value(instance)?;
        let package = Self { root, manifest };
        package.validate_path(&package.manifest.spec.runtime.model, true)?;
        if let Some(path) = &package.manifest.spec.authoring.behavior_flow {
            package.validate_path(path, true)?;
        }
        for path in [
            package.manifest.spec.validation.scenarios.as_ref(),
            package.manifest.spec.validation.fixtures.as_ref(),
            package.manifest.spec.documentation.as_ref(),
            package.manifest.spec.assets.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            package.validate_path(path, false)?;
        }
        Ok(package)
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub const fn manifest(&self) -> &DevicePackageManifest {
        &self.manifest
    }

    #[must_use]
    pub fn model_path(&self) -> PathBuf {
        self.root.join(&self.manifest.spec.runtime.model)
    }

    #[must_use]
    pub fn behavior_flow_path(&self) -> Option<PathBuf> {
        self.manifest
            .spec
            .authoring
            .behavior_flow
            .as_ref()
            .map(|path| self.root.join(path))
    }

    /// Returns package scenario documents in stable lexical order.
    ///
    /// # Errors
    ///
    /// Returns an error when the declared scenario directory cannot be read.
    pub fn scenario_paths(&self) -> Result<Vec<PathBuf>, DevicePackageError> {
        let Some(relative) = &self.manifest.spec.validation.scenarios else {
            return Ok(Vec::new());
        };
        let directory = self.root.join(relative);
        let entries = fs::read_dir(&directory).map_err(|source| DevicePackageError::Read {
            path: directory.clone(),
            source,
        })?;
        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|source| DevicePackageError::Read {
                path: directory.clone(),
                source,
            })?;
            let path = entry.path();
            if !matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("yaml" | "yml")
            ) {
                continue;
            }
            let relative = path
                .strip_prefix(&self.root)
                .map_err(|_| DevicePackageError::UnsafePath(path.clone()))?;
            self.validate_path(relative, true)?;
            paths.push(path);
        }
        paths.sort();
        Ok(paths)
    }

    fn validate_path(&self, relative: &Path, file: bool) -> Result<(), DevicePackageError> {
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(DevicePackageError::UnsafePath(relative.to_path_buf()));
        }
        let path = self.root.join(relative);
        let valid = if file { path.is_file() } else { path.is_dir() };
        if !valid {
            return Err(DevicePackageError::MissingResource(path));
        }
        let canonical_root =
            fs::canonicalize(&self.root).map_err(|source| DevicePackageError::Read {
                path: self.root.clone(),
                source,
            })?;
        let canonical_path =
            fs::canonicalize(&path).map_err(|source| DevicePackageError::Read {
                path: path.clone(),
                source,
            })?;
        if !canonical_path.starts_with(canonical_root) {
            return Err(DevicePackageError::UnsafePath(relative.to_path_buf()));
        }
        Ok(())
    }
}

/// Installs a repository example package into the per-user package store.
/// Non-example paths are returned unchanged.
///
/// # Errors
/// Returns an error when the package cannot be inspected or copied.
pub fn install_example_package(root: &Path) -> crate::Result<PathBuf> {
    if !is_example_package(root) {
        return Ok(root.to_path_buf());
    }
    let package = DevicePackage::load(root)?;
    let store = device_store_root()?;
    install_example_package_into(root, &package, &store)
}

/// Validates and installs a package directory into the per-user device store.
///
/// # Errors
/// Returns an error when the package is invalid, already installed, or cannot
/// be copied into the store.
pub fn install_device_package(root: &Path) -> crate::Result<PathBuf> {
    let package = DevicePackage::load(root)?;
    let store = device_store_root()?;
    let target = store.join(&package.manifest().metadata.id);
    if target.exists() {
        return Err(crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: target,
            source: std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "a package with the same ID is already installed",
            ),
        });
    }
    fs::create_dir_all(&target).map_err(|source| crate::Error::DevicePackageInstall {
        source_path: root.to_path_buf(),
        target_path: target.clone(),
        source,
    })?;
    if let Err(error) = copy_package_tree(root, &target, root, &target) {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    Ok(target)
}

/// Loads every valid package from the per-user device store.
///
/// # Errors
/// Returns an error when the store cannot be read or an installed package is
/// invalid.
pub fn installed_device_packages() -> crate::Result<Vec<DevicePackage>> {
    let store = device_store_root()?;
    if !store.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&store).map_err(|source| crate::Error::DevicePackageInstall {
        source_path: store.clone(),
        target_path: store.clone(),
        source,
    })?;
    let mut packages = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|source| crate::Error::DevicePackageInstall {
            source_path: store.clone(),
            target_path: store.clone(),
            source,
        })?;
        if entry
            .file_type()
            .map_err(|source| crate::Error::DevicePackageInstall {
                source_path: entry.path(),
                target_path: store.clone(),
                source,
            })?
            .is_dir()
        {
            packages.push(DevicePackage::load(entry.path())?);
        }
    }
    packages.sort_by(|left, right| {
        left.manifest()
            .metadata
            .id
            .cmp(&right.manifest().metadata.id)
    });
    Ok(packages)
}

fn install_example_package_into(
    root: &Path,
    package: &DevicePackage,
    store: &Path,
) -> crate::Result<PathBuf> {
    let _install_guard = EXAMPLE_INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let target = store.join(&package.manifest().metadata.id);
    let marker =
        example_source_marker(root).map_err(|source| crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: target.clone(),
            source,
        })?;
    let managed = target.join(EXAMPLE_MARKER_FILE).is_file();
    if managed
        && fs::read_to_string(target.join(EXAMPLE_MARKER_FILE))
            .is_ok_and(|installed_marker| installed_marker == marker)
        && DevicePackage::load(&target).is_ok()
    {
        return Ok(target);
    }
    if target.exists()
        && !managed
        && fs::read_dir(&target)
            .map_err(|source| crate::Error::DevicePackageInstall {
                source_path: root.to_path_buf(),
                target_path: target.clone(),
                source,
            })?
            .next()
            .is_some()
    {
        return Err(crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: target,
            source: std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "target contains an unmanaged package with the same ID",
            ),
        });
    }
    fs::create_dir_all(store).map_err(|source| crate::Error::DevicePackageInstall {
        source_path: root.to_path_buf(),
        target_path: target.clone(),
        source,
    })?;
    let sequence = EXAMPLE_STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let staging = store.parent().unwrap_or(store).join(format!(
        ".{}-{}-{sequence}.staging",
        package.manifest().metadata.id,
        std::process::id()
    ));
    fs::create_dir_all(&staging).map_err(|source| crate::Error::DevicePackageInstall {
        source_path: root.to_path_buf(),
        target_path: staging.clone(),
        source,
    })?;
    if let Err(error) = copy_package_tree(root, &staging, root, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    fs::write(staging.join(EXAMPLE_MARKER_FILE), marker).map_err(|source| {
        crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: staging.clone(),
            source,
        }
    })?;
    if target.exists() {
        let removal = if managed {
            fs::remove_dir_all(&target)
        } else {
            fs::remove_dir(&target)
        };
        removal.map_err(|source| crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: target.clone(),
            source,
        })?;
    }
    fs::rename(&staging, &target).map_err(|source| {
        let _ = fs::remove_dir_all(&staging);
        crate::Error::DevicePackageInstall {
            source_path: root.to_path_buf(),
            target_path: target.clone(),
            source,
        }
    })?;
    Ok(target)
}

fn example_source_marker(root: &Path) -> std::io::Result<String> {
    fn newest_modified_ns(path: &Path, newest: &mut u128) -> std::io::Result<()> {
        let metadata = fs::metadata(path)?;
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        *newest = (*newest).max(modified);
        if metadata.is_dir() {
            for entry in fs::read_dir(path)? {
                newest_modified_ns(&entry?.path(), newest)?;
            }
        }
        Ok(())
    }

    let mut modified_ns = 0;
    newest_modified_ns(root, &mut modified_ns)?;
    Ok(format!(
        "source={}\nmodified_ns={modified_ns}\n",
        root.display()
    ))
}

fn device_store_root() -> crate::Result<PathBuf> {
    if let Some(path) = std::env::var_os("VDS4E_DEVICE_STORE") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| crate::Error::DevicePackageInstall {
        source_path: PathBuf::from("device-models/examples"),
        target_path: PathBuf::from("~/vsd4e/devices"),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "HOME is not set and VDS4E_DEVICE_STORE was not provided",
        ),
    })?;
    Ok(PathBuf::from(home).join("vsd4e/devices"))
}

fn is_example_package(root: &Path) -> bool {
    let components = root.components().collect::<Vec<_>>();
    components
        .windows(2)
        .any(|pair| pair[0].as_os_str() == "device-models" && pair[1].as_os_str() == "examples")
}

fn copy_package_tree(
    source: &Path,
    target: &Path,
    source_root: &Path,
    target_root: &Path,
) -> crate::Result<()> {
    for entry in fs::read_dir(source).map_err(|source| crate::Error::DevicePackageInstall {
        source_path: source_root.to_path_buf(),
        target_path: target_root.to_path_buf(),
        source,
    })? {
        let entry = entry.map_err(|source| crate::Error::DevicePackageInstall {
            source_path: source_root.to_path_buf(),
            target_path: target_root.to_path_buf(),
            source,
        })?;
        let destination = target.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|source| crate::Error::DevicePackageInstall {
                source_path: source_root.to_path_buf(),
                target_path: target_root.to_path_buf(),
                source,
            })?
            .is_dir()
        {
            fs::create_dir_all(&destination).map_err(|source| {
                crate::Error::DevicePackageInstall {
                    source_path: source_root.to_path_buf(),
                    target_path: target_root.to_path_buf(),
                    source,
                }
            })?;
            copy_package_tree(&entry.path(), &destination, source_root, target_root)?;
        } else {
            fs::copy(entry.path(), &destination).map_err(|source| {
                crate::Error::DevicePackageInstall {
                    source_path: source_root.to_path_buf(),
                    target_path: target_root.to_path_buf(),
                    source,
                }
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{DeviceBusKind, DevicePackage, install_example_package_into};

    #[test]
    fn loads_reference_package_and_resolves_declared_resources() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../device-models/examples/generic-spi-flash");
        let package = DevicePackage::load(root).expect("reference package should be valid");

        assert_eq!(package.manifest().spec.bus.kind, DeviceBusKind::Spi);
        assert!(package.model_path().ends_with("model/device.yaml"));
        assert!(
            package
                .behavior_flow_path()
                .expect("behavior flow")
                .ends_with("flows/behavior.yaml")
        );
        assert_eq!(package.scenario_paths().expect("scenarios").len(), 10);
    }

    #[test]
    fn rejects_paths_that_escape_the_package() {
        let root = std::env::temp_dir().join(format!(
            "vds4e-unsafe-device-package-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("model")).expect("package directory");
        std::fs::write(root.join("model/device.yaml"), "placeholder").expect("model");
        std::fs::write(
            root.join("device-package.yaml"),
            r"api_version: vds4e.dev/v1alpha1
kind: DevicePackage
metadata:
  id: unsafe
  display_name: Unsafe
  version: 0.1.0
spec:
  bus:
    type: gpio
  runtime:
    driver: generic-gpio-bank
    model: ../outside.yaml
",
        )
        .expect("manifest");

        let error = DevicePackage::load(&root).expect_err("escaping path must fail");
        assert!(error.to_string().contains("must stay inside"));
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn installs_an_example_copy_into_the_device_store() {
        let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../device-models/examples/generic-spi-flash");
        let package = DevicePackage::load(&source).expect("reference package");
        let store =
            std::env::temp_dir().join(format!("vds4e-device-store-test-{}", std::process::id()));
        if store.exists() {
            std::fs::remove_dir_all(&store).expect("clean old store");
        }
        let installed = install_example_package_into(&source, &package, &store)
            .expect("example should install");
        assert!(installed.join("device-package.yaml").is_file());
        assert!(installed.join(".vds4e-managed-example").is_file());
        assert_eq!(
            DevicePackage::load(&installed)
                .expect("installed package should validate")
                .manifest()
                .metadata
                .id,
            "generic-spi-flash-128m"
        );
        std::fs::remove_file(installed.join("model/device.yaml"))
            .expect("installed model should be removable");
        let refreshed = install_example_package_into(&source, &package, &store)
            .expect("invalid managed copy should refresh");
        assert!(refreshed.join("model/device.yaml").is_file());
        std::fs::remove_dir_all(store).expect("cleanup");
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DevicePackageError {
    #[error("failed to read device package resource '{path}': {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("device package manifest is not valid YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("device package manifest has an incompatible shape: {0}")]
    Shape(#[from] serde_json::Error),
    #[error("embedded device package schema is invalid: {0}")]
    Schema(String),
    #[error("device package failed schema validation:\n{0}")]
    Validation(String),
    #[error("device package path must stay inside the package: '{0}'")]
    UnsafePath(PathBuf),
    #[error("device package resource does not exist or has the wrong type: '{0}'")]
    MissingResource(PathBuf),
}
