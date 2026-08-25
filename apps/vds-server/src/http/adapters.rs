//! Host-adapter lifecycle, persistence, and native driver management.

use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use vds_core::config::ServerConfig;

static STATE_WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterState {
    Unloaded,
    Loading,
    Loaded,
    Unloading,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DriverReadiness {
    Ready,
    AuthorizationRequired,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdapterBinding {
    pub device_id: String,
    pub endpoint: u16,
    pub device_path: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub line_names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AdapterSnapshot {
    pub id: String,
    pub name: String,
    pub bus_type: String,
    pub driver: String,
    pub state: AdapterState,
    pub readiness: DriverReadiness,
    pub bus_number: u16,
    pub line_count: Option<u16>,
    pub max_frequency_hz: Option<u32>,
    pub device_path: Option<String>,
    pub bindings: Vec<AdapterBinding>,
    pub daemon_pids: Vec<u32>,
    pub error: Option<String>,
}

impl AdapterSnapshot {
    fn spi(id: String, name: String, bus_number: u16, max_frequency_hz: Option<u32>) -> Self {
        Self {
            id,
            name,
            bus_type: "spi".to_owned(),
            driver: "cuse".to_owned(),
            state: AdapterState::Unloaded,
            readiness: DriverReadiness::Unavailable,
            bus_number,
            line_count: None,
            max_frequency_hz,
            device_path: None,
            bindings: Vec::new(),
            daemon_pids: Vec::new(),
            error: None,
        }
    }

    fn gpio(id: String, name: String, line_count: u16) -> Self {
        Self {
            id,
            name,
            bus_type: "gpio".to_owned(),
            driver: "gpio-sim".to_owned(),
            state: AdapterState::Unloaded,
            readiness: DriverReadiness::Unavailable,
            bus_number: 0,
            line_count: Some(line_count),
            max_frequency_hz: None,
            device_path: None,
            bindings: Vec::new(),
            daemon_pids: Vec::new(),
            error: None,
        }
    }

    fn i2c(id: String, name: String, bus_number: u16, max_frequency_hz: Option<u32>) -> Self {
        Self {
            id,
            name,
            bus_type: "i2c".to_owned(),
            driver: "cuse".to_owned(),
            state: AdapterState::Unloaded,
            readiness: DriverReadiness::Unavailable,
            bus_number,
            line_count: None,
            max_frequency_hz,
            device_path: None,
            bindings: Vec::new(),
            daemon_pids: Vec::new(),
            error: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdapterError {
    NotFound(String),
    Duplicate(String),
    Invalid(String),
    Conflict(String),
    AuthorizationRequired(String),
    DriverUnavailable(String),
    Process(String),
    Persistence(String),
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(message)
            | Self::Duplicate(message)
            | Self::Invalid(message)
            | Self::Conflict(message)
            | Self::AuthorizationRequired(message)
            | Self::DriverUnavailable(message)
            | Self::Process(message)
            | Self::Persistence(message) => formatter.write_str(message),
        }
    }
}

pub trait AdapterDriver: Send + Sync {
    fn readiness(&self) -> DriverReadiness;
    fn readiness_for(&self, _adapter: &AdapterSnapshot) -> DriverReadiness {
        self.readiness()
    }
    fn loaded_device_path(&self, _adapter: &AdapterSnapshot) -> Option<String> {
        None
    }
    /// Starts all endpoint processes for an adapter.
    ///
    /// # Errors
    /// Returns an error when authorization, driver startup, or process creation fails.
    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError>;
    /// Starts one endpoint while its adapter remains loaded.
    ///
    /// # Errors
    /// Returns an error when the endpoint process cannot be started.
    fn attach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        let mut endpoint = adapter.clone();
        endpoint.bindings = vec![binding.clone()];
        self.load(&endpoint)?.into_iter().next().ok_or_else(|| {
            AdapterError::Process("endpoint started without a process ID".to_owned())
        })
    }
    /// Stops one endpoint while the other adapter endpoints remain loaded.
    ///
    /// # Errors
    /// Returns an error when the endpoint process cannot be stopped.
    fn detach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
    ) -> Result<u32, AdapterError>;
    /// Stops all endpoint processes owned by an adapter.
    ///
    /// # Errors
    /// Returns an error when the managed processes cannot be stopped.
    fn unload(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError>;
}

pub struct SystemAdapterDriver {
    spi: SystemCuseDriver,
    i2c: SystemI2cCuseDriver,
    gpio: SystemGpioSimDriver,
}

impl SystemAdapterDriver {
    fn from_config(config: &ServerConfig) -> Self {
        Self {
            spi: SystemCuseDriver::from_config(config),
            i2c: SystemI2cCuseDriver::from_config(config),
            gpio: SystemGpioSimDriver::from_config(config),
        }
    }

    fn driver(&self, adapter: &AdapterSnapshot) -> Result<&dyn AdapterDriver, AdapterError> {
        match adapter.bus_type.as_str() {
            "spi" => Ok(&self.spi),
            "i2c" => Ok(&self.i2c),
            "gpio" => Ok(&self.gpio),
            bus => Err(AdapterError::DriverUnavailable(format!(
                "no host adapter driver is registered for bus '{bus}'"
            ))),
        }
    }
}

impl AdapterDriver for SystemAdapterDriver {
    fn readiness(&self) -> DriverReadiness {
        DriverReadiness::Ready
    }

    fn readiness_for(&self, adapter: &AdapterSnapshot) -> DriverReadiness {
        self.driver(adapter)
            .map_or(DriverReadiness::Unavailable, AdapterDriver::readiness)
    }

    fn loaded_device_path(&self, adapter: &AdapterSnapshot) -> Option<String> {
        self.driver(adapter)
            .ok()
            .and_then(|driver| driver.loaded_device_path(adapter))
    }

    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        self.driver(adapter)?.load(adapter)
    }

    fn attach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        self.driver(adapter)?.attach_endpoint(adapter, binding)
    }

    fn detach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        self.driver(adapter)?.detach_endpoint(adapter, binding)
    }

    fn unload(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        self.driver(adapter)?.unload(adapter)
    }
}

pub struct SystemCuseDriver {
    executable: PathBuf,
    socket_path: PathBuf,
    children: Mutex<HashMap<String, Vec<ManagedChild>>>,
}

struct ManagedChild {
    child: Child,
    device_id: String,
    privileged: bool,
}

impl SystemCuseDriver {
    #[must_use]
    pub fn from_config(config: &ServerConfig) -> Self {
        let executable = std::env::var_os("VDS4E_SPI_CUSE_EXECUTABLE").map_or_else(
            || {
                [
                    PathBuf::from("build/adapters/spi-cuse/vds4e-spi-cuse"),
                    PathBuf::from("/usr/local/bin/vds4e-spi-cuse"),
                    PathBuf::from("/usr/bin/vds4e-spi-cuse"),
                ]
                .into_iter()
                .find(|candidate| candidate.is_file())
                .unwrap_or_else(|| PathBuf::from("build/adapters/spi-cuse/vds4e-spi-cuse"))
            },
            PathBuf::from,
        );
        Self {
            executable,
            socket_path: config.data_plane.unix_socket.clone(),
            children: Mutex::new(HashMap::new()),
        }
    }

    fn cuse_accessible() -> bool {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/cuse")
            .is_ok()
    }

    fn uses_sudo_authorization() -> bool {
        std::env::var("VDS4E_ADAPTER_AUTH").is_ok_and(|value| value == "sudo")
    }

    fn authorization_program() -> Result<&'static str, AdapterError> {
        let program = if Self::uses_sudo_authorization() {
            "/usr/bin/sudo"
        } else {
            "/usr/bin/pkexec"
        };
        if !Path::new(program).is_file() {
            return Err(AdapterError::AuthorizationRequired(format!(
                "authorization program '{program}' is unavailable"
            )));
        }
        Ok(program)
    }

    fn elevated_command(program: impl AsRef<std::ffi::OsStr>) -> Result<Command, AdapterError> {
        let mut command = Command::new(Self::authorization_program()?);
        if Self::uses_sudo_authorization() {
            // run.sh obtains the credential once with `sudo -v`; helpers must
            // never prompt independently from the server process.
            command.arg("-n");
        }
        command.arg(program);
        Ok(command)
    }

    fn stop_children(children: &mut [ManagedChild]) -> Result<(), AdapterError> {
        for managed in children {
            if managed
                .child
                .try_wait()
                .map_err(|error| {
                    AdapterError::Process(format!(
                        "failed to inspect CUSE endpoint during shutdown: {error}"
                    ))
                })?
                .is_some()
            {
                continue;
            }
            if managed.privileged {
                let status = Self::elevated_command("/bin/kill")?
                    .arg("-TERM")
                    .arg(managed.child.id().to_string())
                    .status()
                    .map_err(|error| {
                        AdapterError::Process(format!(
                            "failed to request endpoint shutdown authorization: {error}"
                        ))
                    })?;
                if !status.success() {
                    return Err(AdapterError::AuthorizationRequired(
                        "operating-system authorization was cancelled while unloading the adapter"
                            .to_owned(),
                    ));
                }
            } else {
                managed.child.kill().map_err(|error| {
                    AdapterError::Process(format!("failed to stop CUSE endpoint: {error}"))
                })?;
            }
            let _ = managed.child.wait();
        }
        Ok(())
    }

    fn process_argument(arguments: &[String], option: &str) -> Option<String> {
        arguments
            .windows(2)
            .find(|pair| pair[0] == option)
            .map(|pair| pair[1].clone())
    }

    fn matching_daemon_pids(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        let executable = self.executable.canonicalize().map_err(|error| {
            AdapterError::DriverUnavailable(format!(
                "failed to resolve CUSE adapter executable '{}': {error}",
                self.executable.display()
            ))
        })?;
        let expected_names = adapter
            .bindings
            .iter()
            .map(|binding| format!("spidev{}.{}", adapter.bus_number, binding.endpoint))
            .collect::<Vec<_>>();
        let mut matches = Vec::new();
        let processes = fs::read_dir("/proc").map_err(|error| {
            AdapterError::Process(format!("failed to inspect host processes: {error}"))
        })?;
        for process in processes.flatten() {
            let Some(pid) = process
                .file_name()
                .to_str()
                .and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(command_line) = fs::read(process.path().join("cmdline")) else {
                continue;
            };
            let arguments = command_line
                .split(|byte| *byte == 0)
                .filter(|argument| !argument.is_empty())
                .map(|argument| String::from_utf8_lossy(argument).into_owned())
                .collect::<Vec<_>>();
            let Some(program) = arguments.first() else {
                continue;
            };
            if Path::new(program).canonicalize().ok().as_ref() != Some(&executable) {
                continue;
            }
            let name = Self::process_argument(&arguments, "--name");
            let socket = Self::process_argument(&arguments, "--socket");
            if name.is_some_and(|value| expected_names.contains(&value))
                && socket.as_deref() == self.socket_path.to_str()
            {
                matches.push(pid);
            }
        }
        Ok(matches)
    }

    fn stop_orphaned_endpoints(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        for pid in self.matching_daemon_pids(adapter)? {
            let status = Self::elevated_command("/bin/kill")?
                .arg("-TERM")
                .arg(pid.to_string())
                .status()
                .map_err(|error| {
                    AdapterError::Process(format!(
                        "failed to request stale endpoint shutdown authorization: {error}"
                    ))
                })?;
            if !status.success() {
                return Err(AdapterError::AuthorizationRequired(format!(
                    "operating-system authorization was cancelled while stopping stale endpoint process {pid}"
                )));
            }
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while adapter
            .bindings
            .iter()
            .any(|binding| Path::new(&binding.device_path).exists())
        {
            if Instant::now() >= deadline {
                return Err(AdapterError::Process(
                    "CUSE endpoint still exists after its daemon was stopped".to_owned(),
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
        Ok(())
    }

    fn authorize_cuse() -> Result<(), AdapterError> {
        let status = Self::elevated_command("/usr/sbin/modprobe")?
            .arg("cuse")
            .status()
            .map_err(|error| {
                AdapterError::Process(format!(
                    "failed to start operating-system authorization: {error}"
                ))
            })?;
        if !status.success() {
            return Err(AdapterError::AuthorizationRequired(
                "operating-system authorization was cancelled or denied".to_owned(),
            ));
        }
        Ok(())
    }

    fn spawn_endpoint(
        &self,
        executable: &Path,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
        privileged: bool,
    ) -> Result<ManagedChild, AdapterError> {
        let device_name = format!("spidev{}.{}", adapter.bus_number, binding.endpoint);
        let mut command = if privileged {
            Self::elevated_command(executable)?
        } else {
            Command::new(executable)
        };
        let child = command
            .arg("--name")
            .arg(device_name)
            .arg("--device-id")
            .arg(&binding.device_id)
            .arg("--socket")
            .arg(&self.socket_path)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AdapterError::Process(format!("failed to start CUSE endpoint: {error}"))
            })?;
        Ok(ManagedChild {
            child,
            device_id: binding.device_id.clone(),
            privileged,
        })
    }

    fn wait_for_endpoints(
        adapter: &AdapterSnapshot,
        spawned: &mut [ManagedChild],
    ) -> Result<(), AdapterError> {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            for managed in &mut *spawned {
                if let Some(status) = managed.child.try_wait().map_err(|error| {
                    AdapterError::Process(format!("failed to inspect CUSE endpoint: {error}"))
                })? {
                    let mut stderr = String::new();
                    if let Some(mut output) = managed.child.stderr.take() {
                        let _ = output.read_to_string(&mut stderr);
                    }
                    let detail = stderr.trim();
                    return Err(AdapterError::Process(format!(
                        "CUSE endpoint exited during startup with {status}{}",
                        if detail.is_empty() {
                            String::new()
                        } else {
                            format!(": {detail}")
                        }
                    )));
                }
            }
            if adapter
                .bindings
                .iter()
                .all(|binding| Path::new(&binding.device_path).exists())
            {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(AdapterError::Process(
                    "timed out waiting for CUSE endpoint creation".to_owned(),
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
    }
}

impl AdapterDriver for SystemCuseDriver {
    fn readiness(&self) -> DriverReadiness {
        if !self.executable.is_file() {
            return DriverReadiness::Unavailable;
        }
        if !Path::new("/dev/cuse").exists() || !Self::cuse_accessible() {
            return DriverReadiness::AuthorizationRequired;
        }
        DriverReadiness::Ready
    }

    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        if !self.executable.is_file() {
            return Err(AdapterError::DriverUnavailable(format!(
                "CUSE adapter executable '{}' is unavailable",
                self.executable.display()
            )));
        }
        if !Path::new("/dev/cuse").exists() {
            Self::authorize_cuse()?;
        }
        let privileged = !Self::cuse_accessible();
        if !Path::new("/dev/cuse").exists() {
            return Err(AdapterError::DriverUnavailable(
                "the CUSE kernel device did not appear after authorization".to_owned(),
            ));
        }
        if privileged {
            Self::authorization_program()?;
        }
        let executable = self.executable.canonicalize().map_err(|error| {
            AdapterError::DriverUnavailable(format!(
                "failed to resolve CUSE adapter executable '{}': {error}",
                self.executable.display()
            ))
        })?;
        if let Some(binding) = adapter
            .bindings
            .iter()
            .find(|binding| Path::new(&binding.device_path).exists())
        {
            return Err(AdapterError::Conflict(format!(
                "endpoint '{}' already exists; reset the adapter to stop its stale VDS CUSE daemon",
                binding.device_path
            )));
        }
        let mut spawned = Vec::new();
        for binding in &adapter.bindings {
            match self.spawn_endpoint(&executable, adapter, binding, privileged) {
                Ok(child) => spawned.push(child),
                Err(error) => {
                    let _ = Self::stop_children(&mut spawned);
                    return Err(error);
                }
            }
        }
        if let Err(error) = Self::wait_for_endpoints(adapter, &mut spawned) {
            let _ = Self::stop_children(&mut spawned);
            return Err(error);
        }
        let pids = spawned
            .iter()
            .map(|managed| managed.child.id())
            .collect::<Vec<_>>();
        self.children
            .lock()
            .map_err(|_| AdapterError::Process("adapter process lock is poisoned".to_owned()))?
            .entry(adapter.id.clone())
            .or_default()
            .extend(spawned);
        Ok(pids)
    }

    fn detach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| AdapterError::Process("adapter process lock is poisoned".to_owned()))?;
        let processes = children.get_mut(&adapter.id).ok_or_else(|| {
            AdapterError::Process(format!(
                "adapter '{}' has no managed endpoint processes",
                adapter.id
            ))
        })?;
        let position = processes
            .iter()
            .position(|managed| managed.device_id == binding.device_id)
            .ok_or_else(|| {
                AdapterError::Process(format!(
                    "device '{}' has no managed endpoint process",
                    binding.device_id
                ))
            })?;
        let mut managed = processes.remove(position);
        let remove_adapter_entry = processes.is_empty();
        let pid = managed.child.id();
        if remove_adapter_entry {
            children.remove(&adapter.id);
        }
        drop(children);
        Self::stop_children(std::slice::from_mut(&mut managed))?;
        let mut endpoint = adapter.clone();
        endpoint.bindings = vec![binding.clone()];
        self.stop_orphaned_endpoints(&endpoint)?;
        Ok(pid)
    }

    fn unload(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| AdapterError::Process("adapter process lock is poisoned".to_owned()))?;
        if let Some(mut processes) = children.remove(&adapter.id) {
            Self::stop_children(&mut processes)?;
        }
        drop(children);
        self.stop_orphaned_endpoints(adapter)
    }
}

pub struct SystemI2cCuseDriver {
    executable: PathBuf,
    socket_path: PathBuf,
    children: Mutex<HashMap<String, Vec<ManagedChild>>>,
}

impl SystemI2cCuseDriver {
    fn from_config(config: &ServerConfig) -> Self {
        let executable = std::env::var_os("VDS4E_I2C_CUSE_EXECUTABLE").map_or_else(
            || {
                [
                    PathBuf::from("build/adapters/i2c-cuse/vds4e-i2c-cuse"),
                    PathBuf::from("/usr/local/bin/vds4e-i2c-cuse"),
                    PathBuf::from("/usr/bin/vds4e-i2c-cuse"),
                ]
                .into_iter()
                .find(|candidate| candidate.is_file())
                .unwrap_or_else(|| PathBuf::from("build/adapters/i2c-cuse/vds4e-i2c-cuse"))
            },
            PathBuf::from,
        );
        Self {
            executable,
            socket_path: config.data_plane.unix_socket.clone(),
            children: Mutex::new(HashMap::new()),
        }
    }

    fn bus_path(adapter: &AdapterSnapshot) -> String {
        format!("/dev/i2c-{}", adapter.bus_number)
    }
}

impl AdapterDriver for SystemI2cCuseDriver {
    fn readiness(&self) -> DriverReadiness {
        if !self.executable.is_file() {
            return DriverReadiness::Unavailable;
        }
        if !Path::new("/dev/cuse").exists() || !SystemCuseDriver::cuse_accessible() {
            return DriverReadiness::AuthorizationRequired;
        }
        DriverReadiness::Ready
    }

    fn loaded_device_path(&self, adapter: &AdapterSnapshot) -> Option<String> {
        Some(Self::bus_path(adapter))
    }

    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        if !self.executable.is_file() {
            return Err(AdapterError::DriverUnavailable(format!(
                "I2C CUSE executable '{}' is unavailable",
                self.executable.display()
            )));
        }
        if !Path::new("/dev/cuse").exists() {
            SystemCuseDriver::authorize_cuse()?;
        }
        let privileged = !SystemCuseDriver::cuse_accessible();
        let executable = self.executable.canonicalize().map_err(|error| {
            AdapterError::DriverUnavailable(format!(
                "failed to resolve I2C CUSE executable: {error}"
            ))
        })?;
        let mut command = if privileged {
            SystemCuseDriver::elevated_command(&executable)?
        } else {
            Command::new(&executable)
        };
        command
            .arg("--name")
            .arg(format!("i2c-{}", adapter.bus_number))
            .arg("--socket")
            .arg(&self.socket_path)
            .arg("--parent-pid")
            .arg(std::process::id().to_string());
        for binding in &adapter.bindings {
            command
                .arg("--binding")
                .arg(format!("{:#x}={}", binding.endpoint, binding.device_id));
        }
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AdapterError::Process(format!("failed to start I2C CUSE adapter: {error}"))
            })?;
        let mut managed = ManagedChild {
            child,
            device_id: adapter.id.clone(),
            privileged,
        };
        let path = Self::bus_path(adapter);
        let deadline = Instant::now() + Duration::from_secs(120);
        while !Path::new(&path).exists() {
            if let Some(status) = managed.child.try_wait().map_err(|error| {
                AdapterError::Process(format!("failed to inspect I2C CUSE adapter: {error}"))
            })? {
                let mut stderr = String::new();
                if let Some(mut output) = managed.child.stderr.take() {
                    let _ = output.read_to_string(&mut stderr);
                }
                return Err(AdapterError::Process(format!(
                    "I2C CUSE adapter exited during startup with {status}: {}",
                    stderr.trim()
                )));
            }
            if Instant::now() >= deadline {
                let _ = SystemCuseDriver::stop_children(std::slice::from_mut(&mut managed));
                return Err(AdapterError::Process(format!(
                    "timed out waiting for '{path}'"
                )));
            }
            thread::sleep(Duration::from_millis(50));
        }
        let pid = managed.child.id();
        self.children
            .lock()
            .map_err(|_| AdapterError::Process("I2C adapter lock is poisoned".to_owned()))?
            .insert(adapter.id.clone(), vec![managed]);
        Ok(vec![pid])
    }

    fn attach_endpoint(
        &self,
        _adapter: &AdapterSnapshot,
        _binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        Err(AdapterError::Conflict(
            "unload the I2C adapter before changing address bindings".to_owned(),
        ))
    }

    fn detach_endpoint(
        &self,
        _adapter: &AdapterSnapshot,
        _binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        Err(AdapterError::Conflict(
            "unload the I2C adapter before changing address bindings".to_owned(),
        ))
    }

    fn unload(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        if let Some(mut children) = self
            .children
            .lock()
            .map_err(|_| AdapterError::Process("I2C adapter lock is poisoned".to_owned()))?
            .remove(&adapter.id)
        {
            SystemCuseDriver::stop_children(&mut children)?;
        }
        Ok(())
    }
}

pub struct SystemGpioSimDriver {
    executable: PathBuf,
    configfs_root: PathBuf,
    socket_path: PathBuf,
    children: Mutex<HashMap<String, ManagedGpioChip>>,
}

struct ManagedGpioChip {
    child: Child,
    device_path: String,
    privileged: bool,
}

impl SystemGpioSimDriver {
    fn from_config(config: &ServerConfig) -> Self {
        let executable = std::env::var_os("VDS4E_GPIO_SIM_EXECUTABLE").map_or_else(
            || {
                [
                    PathBuf::from("build/adapters/gpio-sim/vds4e-gpio-sim"),
                    PathBuf::from("/usr/local/bin/vds4e-gpio-sim"),
                    PathBuf::from("/usr/bin/vds4e-gpio-sim"),
                ]
                .into_iter()
                .find(|candidate| candidate.is_file())
                .unwrap_or_else(|| PathBuf::from("build/adapters/gpio-sim/vds4e-gpio-sim"))
            },
            PathBuf::from,
        );
        let configfs_root = std::env::var_os("VDS4E_GPIO_SIM_CONFIGFS").map_or_else(
            || PathBuf::from("/sys/kernel/config/gpio-sim"),
            PathBuf::from,
        );
        Self {
            executable,
            configfs_root,
            socket_path: config.data_plane.unix_socket.clone(),
            children: Mutex::new(HashMap::new()),
        }
    }

    fn configfs_accessible(&self) -> bool {
        let effective_uid = fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|status| {
                status
                    .lines()
                    .find(|line| line.starts_with("Uid:"))
                    .and_then(|line| line.split_whitespace().nth(2))
                    .and_then(|value| value.parse::<u32>().ok())
            });
        self.configfs_root.is_dir() && effective_uid == Some(0)
    }

    fn authorize_gpio_sim(&self) -> Result<(), AdapterError> {
        if self.configfs_root.exists() {
            return Ok(());
        }
        let modprobe = ["/usr/sbin/modprobe", "/sbin/modprobe"]
            .into_iter()
            .find(|candidate| Path::new(candidate).is_file())
            .ok_or_else(|| {
                AdapterError::DriverUnavailable(
                    "modprobe is unavailable; load the gpio-sim kernel module manually".to_owned(),
                )
            })?;
        let status = SystemCuseDriver::elevated_command(modprobe)?
            .arg("gpio-sim")
            .status()
            .map_err(|error| {
                AdapterError::Process(format!(
                    "failed to request gpio-sim module authorization: {error}"
                ))
            })?;
        if !status.success() {
            return Err(AdapterError::AuthorizationRequired(
                "operating-system authorization was cancelled while loading gpio-sim".to_owned(),
            ));
        }
        Ok(())
    }

    fn stop_chip(managed: &mut ManagedGpioChip) -> Result<(), AdapterError> {
        if managed
            .child
            .try_wait()
            .map_err(|error| {
                AdapterError::Process(format!(
                    "failed to inspect gpio-sim adapter during shutdown: {error}"
                ))
            })?
            .is_some()
        {
            return Ok(());
        }
        if managed.privileged {
            let status = SystemCuseDriver::elevated_command("/bin/kill")?
                .arg("-TERM")
                .arg(managed.child.id().to_string())
                .status()
                .map_err(|error| {
                    AdapterError::Process(format!(
                        "failed to request gpio-sim shutdown authorization: {error}"
                    ))
                })?;
            if !status.success() {
                return Err(AdapterError::AuthorizationRequired(
                    "operating-system authorization was cancelled while unloading gpio-sim"
                        .to_owned(),
                ));
            }
        } else {
            let status = Command::new("/bin/kill")
                .arg("-TERM")
                .arg(managed.child.id().to_string())
                .status()
                .map_err(|error| {
                    AdapterError::Process(format!("failed to signal gpio-sim adapter: {error}"))
                })?;
            if !status.success() {
                return Err(AdapterError::Process(
                    "gpio-sim adapter rejected SIGTERM".to_owned(),
                ));
            }
        }
        let _ = managed.child.wait();
        Ok(())
    }
}

impl AdapterDriver for SystemGpioSimDriver {
    fn readiness(&self) -> DriverReadiness {
        if !self.executable.is_file() {
            return DriverReadiness::Unavailable;
        }
        if self.configfs_accessible() {
            DriverReadiness::Ready
        } else {
            DriverReadiness::AuthorizationRequired
        }
    }

    fn loaded_device_path(&self, adapter: &AdapterSnapshot) -> Option<String> {
        self.children
            .lock()
            .ok()?
            .get(&adapter.id)
            .map(|managed| managed.device_path.clone())
    }

    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        if !self.executable.is_file() {
            return Err(AdapterError::DriverUnavailable(format!(
                "GPIO simulator executable '{}' is unavailable",
                self.executable.display()
            )));
        }
        self.authorize_gpio_sim()?;
        let privileged = !self.configfs_accessible();
        if privileged {
            SystemCuseDriver::authorization_program()?;
        }
        let executable = self.executable.canonicalize().map_err(|error| {
            AdapterError::DriverUnavailable(format!(
                "failed to resolve GPIO simulator executable '{}': {error}",
                self.executable.display()
            ))
        })?;
        let line_count = adapter.line_count.ok_or_else(|| {
            AdapterError::Invalid("GPIO adapter line_count is missing".to_owned())
        })?;
        let binding = adapter.bindings.first().ok_or_else(|| {
            AdapterError::Invalid(
                "attach one GPIO runtime device before loading the adapter".to_owned(),
            )
        })?;
        let helper_name = format!("vds4e-{}", adapter.id.replace('.', "-"));
        let mut command = if privileged {
            SystemCuseDriver::elevated_command(&executable)?
        } else {
            Command::new(&executable)
        };
        command
            .arg("--name")
            .arg(helper_name)
            .arg("--label")
            .arg(&adapter.name)
            .arg("--lines")
            .arg(line_count.to_string())
            .arg("--configfs-root")
            .arg(&self.configfs_root)
            .arg("--device-id")
            .arg(&binding.device_id)
            .arg("--socket")
            .arg(&self.socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        for line_name in &binding.line_names {
            command.arg("--line-name").arg(line_name);
        }
        let mut child = command.spawn().map_err(|error| {
            AdapterError::Process(format!("failed to start GPIO simulator: {error}"))
        })?;
        let mut device_path = String::new();
        let stdout = child.stdout.take().ok_or_else(|| {
            AdapterError::Process("GPIO simulator stdout is unavailable".to_owned())
        })?;
        BufReader::new(stdout)
            .read_line(&mut device_path)
            .map_err(|error| {
                AdapterError::Process(format!(
                    "failed to read GPIO simulator device path: {error}"
                ))
            })?;
        let device_path = device_path.trim().to_owned();
        if !device_path.starts_with("/dev/gpiochip") {
            let status = child.wait().map_err(|error| {
                AdapterError::Process(format!("failed to collect GPIO simulator failure: {error}"))
            })?;
            return Err(AdapterError::Process(format!(
                "GPIO simulator did not create a gpiochip device (status {status})"
            )));
        }
        let pid = child.id();
        self.children
            .lock()
            .map_err(|_| AdapterError::Process("GPIO adapter lock is poisoned".to_owned()))?
            .insert(
                adapter.id.clone(),
                ManagedGpioChip {
                    child,
                    device_path,
                    privileged,
                },
            );
        Ok(vec![pid])
    }

    fn detach_endpoint(
        &self,
        _adapter: &AdapterSnapshot,
        _binding: &AdapterBinding,
    ) -> Result<u32, AdapterError> {
        Err(AdapterError::Invalid(
            "unload the GPIO adapter before detaching its runtime device".to_owned(),
        ))
    }

    fn unload(&self, adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        let mut managed = self
            .children
            .lock()
            .map_err(|_| AdapterError::Process("GPIO adapter lock is poisoned".to_owned()))?
            .remove(&adapter.id);
        if let Some(managed) = managed.as_mut() {
            Self::stop_chip(managed)?;
        }
        Ok(())
    }
}

pub struct AdapterManager {
    adapters: Mutex<HashMap<String, AdapterSnapshot>>,
    driver: Arc<dyn AdapterDriver>,
    state_path: Option<PathBuf>,
    load_on_startup: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedAdapterTopology {
    version: u32,
    adapters: Vec<PersistedAdapter>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedAdapter {
    id: String,
    name: String,
    bus_type: String,
    bus_number: u16,
    line_count: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    max_frequency_hz: Option<u32>,
    load_on_startup: bool,
    bindings: Vec<PersistedBinding>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedBinding {
    device_id: String,
    endpoint: u16,
    line_names: Vec<String>,
}

impl AdapterManager {
    #[must_use]
    pub fn new(driver: Arc<dyn AdapterDriver>) -> Self {
        let mut adapter = AdapterSnapshot::spi("spi0".to_owned(), "SPI 0".to_owned(), 0, None);
        adapter.readiness = driver.readiness_for(&adapter);
        Self {
            adapters: Mutex::new(HashMap::from([(adapter.id.clone(), adapter)])),
            driver,
            state_path: None,
            load_on_startup: Mutex::new(HashSet::new()),
        }
    }

    /// Creates the system adapter manager and restores its persisted topology.
    ///
    /// # Errors
    /// Returns an error when the topology store cannot be read or validated.
    pub fn system(config: &ServerConfig) -> Result<Self, AdapterError> {
        let driver: Arc<dyn AdapterDriver> = Arc::new(SystemAdapterDriver::from_config(config));
        let state_path = adapter_state_path()?;
        Self::persistent(driver, state_path)
    }

    #[must_use]
    pub fn system_ephemeral(config: &ServerConfig) -> Self {
        Self::new(Arc::new(SystemAdapterDriver::from_config(config)))
    }

    #[allow(clippy::too_many_lines)]
    fn persistent(
        driver: Arc<dyn AdapterDriver>,
        state_path: PathBuf,
    ) -> Result<Self, AdapterError> {
        let Some(topology) = read_topology(&state_path)? else {
            let mut manager = Self::new(driver);
            manager.state_path = Some(state_path);
            return Ok(manager);
        };
        if topology.version != 1 {
            return Err(AdapterError::Persistence(format!(
                "adapter topology '{}' uses unsupported version {}",
                state_path.display(),
                topology.version
            )));
        }
        let mut adapters = HashMap::new();
        let mut load_on_startup = HashSet::new();
        let mut assigned_buses = HashSet::new();
        let mut assigned_devices = HashSet::new();
        for persisted in topology.adapters {
            if !valid_id(&persisted.id) {
                return Err(AdapterError::Persistence(format!(
                    "persisted adapter id '{}' is invalid",
                    persisted.id
                )));
            }
            if matches!(persisted.bus_type.as_str(), "spi" | "i2c")
                && !assigned_buses.insert((persisted.bus_type.clone(), persisted.bus_number))
            {
                return Err(AdapterError::Persistence(format!(
                    "persisted {} bus number {} is assigned more than once",
                    persisted.bus_type.to_uppercase(),
                    persisted.bus_number
                )));
            }
            let mut adapter = match persisted.bus_type.as_str() {
                "spi" => AdapterSnapshot::spi(
                    persisted.id.clone(),
                    persisted.name,
                    persisted.bus_number,
                    persisted.max_frequency_hz,
                ),
                "i2c" => AdapterSnapshot::i2c(
                    persisted.id.clone(),
                    persisted.name,
                    persisted.bus_number,
                    persisted.max_frequency_hz,
                ),
                "gpio" => AdapterSnapshot::gpio(
                    persisted.id.clone(),
                    persisted.name,
                    persisted.line_count.filter(|count| (1..=1024).contains(count)).ok_or_else(|| {
                        AdapterError::Persistence(format!(
                            "persisted GPIO adapter '{}' must have a line_count between 1 and 1024",
                            persisted.id
                        ))
                    })?,
                ),
                bus => {
                    return Err(AdapterError::Persistence(format!(
                        "persisted adapter '{}' uses unsupported bus '{bus}'",
                        persisted.id
                    )));
                }
            };
            let mut assigned_endpoints = HashSet::new();
            for binding in &persisted.bindings {
                if binding.device_id.is_empty() {
                    return Err(AdapterError::Persistence(format!(
                        "persisted adapter '{}' has a binding with an empty device ID",
                        persisted.id
                    )));
                }
                if !assigned_devices.insert(binding.device_id.clone()) {
                    return Err(AdapterError::Persistence(format!(
                        "persisted device '{}' is attached more than once",
                        binding.device_id
                    )));
                }
                if !assigned_endpoints.insert(binding.endpoint) {
                    return Err(AdapterError::Persistence(format!(
                        "persisted adapter '{}' assigns endpoint {:#x} more than once",
                        persisted.id, binding.endpoint
                    )));
                }
                if persisted.bus_type == "i2c" && binding.endpoint > 0x3ff {
                    return Err(AdapterError::Persistence(format!(
                        "persisted I2C adapter '{}' has invalid address {:#x}",
                        persisted.id, binding.endpoint
                    )));
                }
                if persisted.bus_type == "gpio"
                    && (binding.endpoint != 0
                        || Some(binding.line_names.len()) != persisted.line_count.map(usize::from))
                {
                    return Err(AdapterError::Persistence(format!(
                        "persisted GPIO binding for '{}' does not match its line count",
                        persisted.id
                    )));
                }
            }
            if persisted.bus_type == "gpio" && persisted.bindings.len() > 1 {
                return Err(AdapterError::Persistence(format!(
                    "persisted GPIO adapter '{}' has more than one device binding",
                    persisted.id
                )));
            }
            adapter.bindings = persisted
                .bindings
                .into_iter()
                .map(|binding| AdapterBinding {
                    device_path: match adapter.bus_type.as_str() {
                        "gpio" => "/dev/gpiochipX".to_owned(),
                        "i2c" => format!("/dev/i2c-{}", adapter.bus_number),
                        _ => format!("/dev/spidev{}.{}", adapter.bus_number, binding.endpoint),
                    },
                    device_id: binding.device_id,
                    endpoint: binding.endpoint,
                    line_names: binding.line_names,
                })
                .collect();
            adapter.bindings.sort_by_key(|binding| binding.endpoint);
            adapter.readiness = driver.readiness_for(&adapter);
            if persisted.load_on_startup {
                load_on_startup.insert(adapter.id.clone());
            }
            if adapters.insert(adapter.id.clone(), adapter).is_some() {
                return Err(AdapterError::Persistence(
                    "persisted adapter topology contains duplicate IDs".to_owned(),
                ));
            }
        }
        Ok(Self {
            adapters: Mutex::new(adapters),
            driver,
            state_path: Some(state_path),
            load_on_startup: Mutex::new(load_on_startup),
        })
    }

    fn persist(&self) -> Result<(), AdapterError> {
        let Some(state_path) = self.state_path.as_ref() else {
            return Ok(());
        };
        let mut adapters = self
            .adapters
            .lock()
            .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        adapters.sort_by(|left, right| left.id.cmp(&right.id));
        let load_on_startup = self
            .load_on_startup
            .lock()
            .map_err(|_| AdapterError::Process("adapter restore lock is poisoned".to_owned()))?
            .clone();
        let topology = PersistedAdapterTopology {
            version: 1,
            adapters: adapters
                .into_iter()
                .map(|adapter| PersistedAdapter {
                    load_on_startup: load_on_startup.contains(&adapter.id),
                    id: adapter.id,
                    name: adapter.name,
                    bus_type: adapter.bus_type,
                    bus_number: adapter.bus_number,
                    line_count: adapter.line_count,
                    max_frequency_hz: adapter.max_frequency_hz,
                    bindings: adapter
                        .bindings
                        .into_iter()
                        .map(|binding| PersistedBinding {
                            device_id: binding.device_id,
                            endpoint: binding.endpoint,
                            line_names: binding.line_names,
                        })
                        .collect(),
                })
                .collect(),
        };
        write_topology(state_path, &topology)
    }

    fn set_load_on_startup(&self, adapter_id: &str, load: bool) -> Result<(), AdapterError> {
        let mut adapters = self
            .load_on_startup
            .lock()
            .map_err(|_| AdapterError::Process("adapter restore lock is poisoned".to_owned()))?;
        if load {
            adapters.insert(adapter_id.to_owned());
        } else {
            adapters.remove(adapter_id);
        }
        Ok(())
    }

    /// Reloads adapters that were loaded when the previous server stopped.
    pub fn restore_loaded(&self) -> Vec<(String, Result<AdapterSnapshot, AdapterError>)> {
        let adapter_ids = self.load_on_startup.lock().map_or_else(
            |_| Vec::new(),
            |adapters| {
                let mut adapters = adapters.iter().cloned().collect::<Vec<_>>();
                adapters.sort();
                adapters
            },
        );
        adapter_ids
            .into_iter()
            .map(|adapter_id| {
                let result = self.load(&adapter_id);
                (adapter_id, result)
            })
            .collect()
    }

    /// Returns deterministic adapter snapshots with current driver readiness.
    ///
    /// # Errors
    /// Returns an error when adapter state cannot be locked.
    pub fn list(&self) -> Result<Vec<AdapterSnapshot>, AdapterError> {
        let mut snapshots = self
            .adapters
            .lock()
            .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for adapter in &mut snapshots {
            adapter.readiness = self.driver.readiness_for(adapter);
            if adapter.state == AdapterState::Loaded {
                adapter.device_path = self.driver.loaded_device_path(adapter);
            }
        }
        snapshots.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(snapshots)
    }

    /// Creates an unloaded logical SPI adapter.
    ///
    /// # Errors
    /// Returns an error for invalid IDs or duplicate bus assignments.
    pub fn create_spi(
        &self,
        id: String,
        name: String,
        bus_number: u16,
        max_frequency_hz: Option<u32>,
    ) -> Result<AdapterSnapshot, AdapterError> {
        if !valid_id(&id) {
            return Err(AdapterError::Invalid(
                "adapter id must contain 1-64 letters, numbers, '.', '_' or '-' and start with a letter or number".to_owned(),
            ));
        }
        let adapter = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            if adapters.contains_key(&id) {
                return Err(AdapterError::Duplicate(format!(
                    "adapter '{id}' already exists"
                )));
            }
            if adapters
                .values()
                .any(|adapter| adapter.bus_type == "spi" && adapter.bus_number == bus_number)
            {
                return Err(AdapterError::Conflict(format!(
                    "SPI bus number {bus_number} is already assigned"
                )));
            }
            if max_frequency_hz == Some(0) {
                return Err(AdapterError::Invalid(
                    "SPI maximum frequency must be greater than zero".to_owned(),
                ));
            }
            let mut adapter = AdapterSnapshot::spi(id.clone(), name, bus_number, max_frequency_hz);
            adapter.readiness = self.driver.readiness_for(&adapter);
            adapters.insert(id, adapter.clone());
            adapter
        };
        self.persist()?;
        Ok(adapter)
    }

    /// Creates an unloaded logical GPIO controller backed by kernel gpio-sim.
    ///
    /// # Errors
    /// Returns an error for invalid IDs, duplicate adapters, or invalid line counts.
    pub fn create_gpio(
        &self,
        id: String,
        name: String,
        line_count: u16,
    ) -> Result<AdapterSnapshot, AdapterError> {
        if !valid_id(&id) {
            return Err(AdapterError::Invalid(
                "adapter id must contain 1-64 letters, numbers, '.', '_' or '-' and start with a letter or number".to_owned(),
            ));
        }
        if line_count == 0 || line_count > 1024 {
            return Err(AdapterError::Invalid(
                "GPIO line count must be between 1 and 1024".to_owned(),
            ));
        }
        let adapter = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            if adapters.contains_key(&id) {
                return Err(AdapterError::Duplicate(format!(
                    "adapter '{id}' already exists"
                )));
            }
            let mut adapter = AdapterSnapshot::gpio(id.clone(), name, line_count);
            adapter.readiness = self.driver.readiness_for(&adapter);
            adapters.insert(id, adapter.clone());
            adapter
        };
        self.persist()?;
        Ok(adapter)
    }

    /// Creates an unloaded logical Linux I2C controller.
    ///
    /// # Errors
    /// Returns an error for invalid IDs or duplicate I2C bus assignments.
    pub fn create_i2c(
        &self,
        id: String,
        name: String,
        bus_number: u16,
        max_frequency_hz: Option<u32>,
    ) -> Result<AdapterSnapshot, AdapterError> {
        if !valid_id(&id) {
            return Err(AdapterError::Invalid(
                "adapter id must contain 1-64 letters, numbers, '.', '_' or '-' and start with a letter or number".to_owned(),
            ));
        }
        let adapter = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            if adapters.contains_key(&id) {
                return Err(AdapterError::Duplicate(format!(
                    "adapter '{id}' already exists"
                )));
            }
            if adapters
                .values()
                .any(|adapter| adapter.bus_type == "i2c" && adapter.bus_number == bus_number)
            {
                return Err(AdapterError::Conflict(format!(
                    "I2C bus number {bus_number} is already assigned"
                )));
            }
            if max_frequency_hz == Some(0) {
                return Err(AdapterError::Invalid(
                    "I2C maximum frequency must be greater than zero".to_owned(),
                ));
            }
            let mut adapter = AdapterSnapshot::i2c(id.clone(), name, bus_number, max_frequency_hz);
            adapter.readiness = self.driver.readiness_for(&adapter);
            adapters.insert(id, adapter.clone());
            adapter
        };
        self.persist()?;
        Ok(adapter)
    }

    /// Attaches one runtime device to a unique adapter endpoint.
    ///
    /// # Errors
    /// Returns an error when the device/endpoint is already assigned or topology is transitioning.
    pub fn attach(
        &self,
        adapter_id: &str,
        device_id: String,
        endpoint: u16,
    ) -> Result<AdapterSnapshot, AdapterError> {
        self.attach_with_line_names(adapter_id, device_id, endpoint, Vec::new())
    }

    /// Attaches one declarative GPIO bank and its line metadata.
    ///
    /// # Errors
    /// Returns an error when the GPIO width differs from the adapter.
    pub fn attach_gpio(
        &self,
        adapter_id: &str,
        device_id: String,
        line_names: Vec<String>,
    ) -> Result<AdapterSnapshot, AdapterError> {
        let expected = self
            .adapters
            .lock()
            .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?
            .get(adapter_id)
            .ok_or_else(|| AdapterError::NotFound(format!("adapter '{adapter_id}' was not found")))?
            .line_count;
        if expected != u16::try_from(line_names.len()).ok() {
            return Err(AdapterError::Invalid(format!(
                "GPIO adapter expects {} lines but device '{}' declares {}",
                expected.unwrap_or(0),
                device_id,
                line_names.len()
            )));
        }
        self.attach_with_line_names(adapter_id, device_id, 0, line_names)
    }

    fn attach_with_line_names(
        &self,
        adapter_id: &str,
        device_id: String,
        endpoint: u16,
        line_names: Vec<String>,
    ) -> Result<AdapterSnapshot, AdapterError> {
        let (snapshot, binding) = {
            let adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            if adapters.values().any(|adapter| {
                adapter
                    .bindings
                    .iter()
                    .any(|binding| binding.device_id == device_id)
            }) {
                return Err(AdapterError::Conflict(format!(
                    "device '{device_id}' is already attached to an adapter"
                )));
            }
            let adapter = adapters.get(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            require_stable_topology(adapter)?;
            if adapter.bus_type == "i2c" && adapter.state == AdapterState::Loaded {
                return Err(AdapterError::Conflict(
                    "unload the I2C adapter before changing address bindings".to_owned(),
                ));
            }
            if adapter.bus_type == "gpio" && adapter.state == AdapterState::Loaded {
                return Err(AdapterError::Conflict(
                    "unload the GPIO adapter before changing its runtime binding".to_owned(),
                ));
            }
            if adapter
                .bindings
                .iter()
                .any(|binding| binding.endpoint == endpoint)
            {
                return Err(AdapterError::Conflict(format!(
                    "{} {endpoint:#x} is already occupied",
                    if adapter.bus_type == "i2c" {
                        "I2C address"
                    } else {
                        "chip-select"
                    }
                )));
            }
            if adapter.bus_type == "i2c" && endpoint > 0x3ff {
                return Err(AdapterError::Invalid(
                    "I2C addresses must be between 0x00 and 0x3ff".to_owned(),
                ));
            }
            if adapter.bus_type == "gpio" && !adapter.bindings.is_empty() {
                return Err(AdapterError::Conflict(
                    "a GPIO adapter can bind exactly one GPIO bank device".to_owned(),
                ));
            }
            (
                adapter.clone(),
                AdapterBinding {
                    device_id,
                    endpoint,
                    device_path: match adapter.bus_type.as_str() {
                        "gpio" => "/dev/gpiochipX".to_owned(),
                        "i2c" => format!("/dev/i2c-{}", adapter.bus_number),
                        _ => format!("/dev/spidev{}.{}", adapter.bus_number, endpoint),
                    },
                    line_names,
                },
            )
        };
        let pid = if snapshot.state == AdapterState::Loaded {
            Some(self.driver.attach_endpoint(&snapshot, &binding)?)
        } else {
            None
        };
        let adapter = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            let adapter = adapters.get_mut(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            let position = adapter
                .bindings
                .partition_point(|existing| existing.endpoint < binding.endpoint);
            adapter.bindings.insert(position, binding);
            if let Some(pid) = pid {
                adapter.daemon_pids.insert(position, pid);
            }
            adapter.error = None;
            adapter.clone()
        };
        self.persist()?;
        Ok(adapter)
    }

    /// Detaches a runtime device and hot-stops its endpoint when loaded.
    ///
    /// # Errors
    /// Returns an error when the adapter/binding is absent or topology is transitioning.
    pub fn detach(
        &self,
        adapter_id: &str,
        device_id: &str,
    ) -> Result<AdapterSnapshot, AdapterError> {
        let (snapshot, binding) = {
            let adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            let adapter = adapters.get(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            require_stable_topology(adapter)?;
            if adapter.bus_type == "i2c" && adapter.state == AdapterState::Loaded {
                return Err(AdapterError::Conflict(
                    "unload the I2C adapter before changing address bindings".to_owned(),
                ));
            }
            if adapter.bus_type == "gpio" && adapter.state == AdapterState::Loaded {
                return Err(AdapterError::Conflict(
                    "unload the GPIO adapter before changing its runtime binding".to_owned(),
                ));
            }
            let binding = adapter
                .bindings
                .iter()
                .find(|binding| binding.device_id == device_id)
                .cloned()
                .ok_or_else(|| {
                    AdapterError::NotFound(format!(
                        "device '{device_id}' is not attached to adapter '{adapter_id}'"
                    ))
                })?;
            (adapter.clone(), binding)
        };
        let stopped_pid = if snapshot.state == AdapterState::Loaded {
            Some(self.driver.detach_endpoint(&snapshot, &binding)?)
        } else {
            None
        };
        let adapter = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            let adapter = adapters.get_mut(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            adapter
                .bindings
                .retain(|existing| existing.device_id != device_id);
            if let Some(pid) = stopped_pid {
                adapter.daemon_pids.retain(|existing| *existing != pid);
            }
            if adapter.bindings.is_empty() && adapter.state == AdapterState::Loaded {
                adapter.state = AdapterState::Unloaded;
            }
            adapter.error = None;
            adapter.clone()
        };
        if adapter.bindings.is_empty() {
            self.set_load_on_startup(adapter_id, false)?;
        }
        self.persist()?;
        Ok(adapter)
    }

    /// Loads all configured endpoints through the adapter driver.
    ///
    /// # Errors
    /// Returns an error when no devices are attached or driver startup fails.
    pub fn load(&self, adapter_id: &str) -> Result<AdapterSnapshot, AdapterError> {
        let snapshot = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            let adapter = adapters.get_mut(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            require_unloaded(adapter)?;
            if adapter.bus_type != "gpio" && adapter.bindings.is_empty() {
                return Err(AdapterError::Conflict(
                    "attach at least one device before loading the adapter".to_owned(),
                ));
            }
            adapter.state = AdapterState::Loading;
            adapter.error = None;
            adapter.clone()
        };
        self.set_load_on_startup(adapter_id, true)?;
        let result = match self.driver.load(&snapshot) {
            Ok(pids) => self.finish_load(adapter_id, AdapterState::Loaded, pids, None),
            Err(error) => {
                let _ = self.finish_load(
                    adapter_id,
                    AdapterState::Error,
                    Vec::new(),
                    Some(error.to_string()),
                );
                Err(error)
            }
        };
        match (result, self.persist()) {
            (Ok(adapter), Ok(())) => Ok(adapter),
            (Ok(_), Err(error)) | (Err(error), _) => Err(error),
        }
    }

    fn finish_load(
        &self,
        adapter_id: &str,
        state: AdapterState,
        pids: Vec<u32>,
        error: Option<String>,
    ) -> Result<AdapterSnapshot, AdapterError> {
        let mut adapters = self
            .adapters
            .lock()
            .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
        let adapter = adapters.get_mut(adapter_id).ok_or_else(|| {
            AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
        })?;
        adapter.state = state;
        adapter.daemon_pids = pids;
        adapter.error = error;
        adapter.readiness = self.driver.readiness_for(adapter);
        adapter.device_path = if state == AdapterState::Loaded {
            self.driver.loaded_device_path(adapter)
        } else {
            None
        };
        if adapter.bus_type == "gpio" {
            if let (Some(binding), Some(device_path)) =
                (adapter.bindings.first_mut(), adapter.device_path.as_ref())
            {
                binding.device_path.clone_from(device_path);
            }
        }
        Ok(adapter.clone())
    }

    /// Unloads all endpoint processes managed by an adapter.
    ///
    /// # Errors
    /// Returns an error when the adapter is not loaded or process shutdown fails.
    pub fn unload(&self, adapter_id: &str) -> Result<AdapterSnapshot, AdapterError> {
        let snapshot = {
            let mut adapters = self
                .adapters
                .lock()
                .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?;
            let adapter = adapters.get_mut(adapter_id).ok_or_else(|| {
                AdapterError::NotFound(format!("adapter '{adapter_id}' was not found"))
            })?;
            if !matches!(adapter.state, AdapterState::Loaded | AdapterState::Error) {
                return Err(AdapterError::Conflict(format!(
                    "adapter '{adapter_id}' is not loaded"
                )));
            }
            adapter.state = AdapterState::Unloading;
            adapter.clone()
        };
        let result = match self.driver.unload(&snapshot) {
            Ok(()) => {
                self.set_load_on_startup(adapter_id, false)?;
                self.finish_load(adapter_id, AdapterState::Unloaded, Vec::new(), None)
            }
            Err(error) => {
                let mut adapters = self.adapters.lock().map_err(|_| {
                    AdapterError::Process("adapter state lock is poisoned".to_owned())
                })?;
                if let Some(adapter) = adapters.get_mut(adapter_id) {
                    adapter.state = AdapterState::Error;
                    adapter.error = Some(error.to_string());
                }
                Err(error)
            }
        };
        match (result, self.persist()) {
            (Ok(adapter), Ok(())) => Ok(adapter),
            (Ok(_), Err(error)) | (Err(error), _) => Err(error),
        }
    }
}

fn adapter_state_path() -> Result<PathBuf, AdapterError> {
    if let Some(path) = std::env::var_os("VDS4E_ADAPTER_STATE") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| {
        AdapterError::Persistence(
            "HOME is not set and VDS4E_ADAPTER_STATE was not provided".to_owned(),
        )
    })?;
    Ok(PathBuf::from(home).join(".vds4e/adapters.json"))
}

fn read_topology(path: &Path) -> Result<Option<PersistedAdapterTopology>, AdapterError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(AdapterError::Persistence(format!(
                "failed to read adapter topology '{}': {error}",
                path.display()
            )));
        }
    };
    serde_json::from_slice(&bytes).map(Some).map_err(|error| {
        AdapterError::Persistence(format!(
            "failed to parse adapter topology '{}': {error}",
            path.display()
        ))
    })
}

fn write_topology(path: &Path, topology: &PersistedAdapterTopology) -> Result<(), AdapterError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AdapterError::Persistence(format!(
                "failed to create adapter topology directory '{}': {error}",
                parent.display()
            ))
        })?;
    }
    let mut bytes = serde_json::to_vec_pretty(topology).map_err(|error| {
        AdapterError::Persistence(format!("failed to serialize adapter topology: {error}"))
    })?;
    bytes.push(b'\n');
    let temporary = path.with_extension(format!(
        "json.{}.{}.tmp",
        std::process::id(),
        STATE_WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temporary, bytes).map_err(|error| {
        AdapterError::Persistence(format!(
            "failed to write adapter topology staging file '{}': {error}",
            temporary.display()
        ))
    })?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        AdapterError::Persistence(format!(
            "failed to replace adapter topology '{}': {error}",
            path.display()
        ))
    })
}

fn require_unloaded(adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
    if adapter.state != AdapterState::Unloaded {
        return Err(AdapterError::Conflict(format!(
            "adapter '{}' must be unloaded before changing topology",
            adapter.id
        )));
    }
    Ok(())
}

fn require_stable_topology(adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
    if !matches!(adapter.state, AdapterState::Unloaded | AdapterState::Loaded) {
        return Err(AdapterError::Conflict(format!(
            "adapter '{}' cannot change topology while it is transitioning",
            adapter.id
        )));
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.len() <= 64
        && first.is_ascii_alphanumeric()
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64 as TestAtomicU64, Ordering as TestOrdering};

    use super::*;

    static NEXT_STATE_FILE: TestAtomicU64 = TestAtomicU64::new(0);

    fn temporary_state_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "vds4e-adapters-{}-{}.json",
            std::process::id(),
            NEXT_STATE_FILE.fetch_add(1, TestOrdering::Relaxed)
        ))
    }

    struct FakeDriver;

    impl AdapterDriver for FakeDriver {
        fn readiness(&self) -> DriverReadiness {
            DriverReadiness::Ready
        }

        fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
            if adapter.bus_type == "gpio" {
                Ok(vec![2000])
            } else if adapter.bus_type == "i2c" {
                Ok(vec![3000])
            } else {
                Ok((1000_u32..)
                    .zip(adapter.bindings.iter())
                    .map(|(pid, _)| pid)
                    .collect())
            }
        }

        fn loaded_device_path(&self, adapter: &AdapterSnapshot) -> Option<String> {
            match adapter.bus_type.as_str() {
                "gpio" => Some("/dev/gpiochip7".to_owned()),
                "i2c" => Some(format!("/dev/i2c-{}", adapter.bus_number)),
                _ => None,
            }
        }

        fn attach_endpoint(
            &self,
            _adapter: &AdapterSnapshot,
            _binding: &AdapterBinding,
        ) -> Result<u32, AdapterError> {
            Ok(1002)
        }

        fn detach_endpoint(
            &self,
            adapter: &AdapterSnapshot,
            binding: &AdapterBinding,
        ) -> Result<u32, AdapterError> {
            let position = adapter
                .bindings
                .iter()
                .position(|existing| existing.device_id == binding.device_id)
                .unwrap();
            Ok(adapter.daemon_pids[position])
        }

        fn unload(&self, _adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
            Ok(())
        }
    }

    #[test]
    fn manages_multiple_spi_endpoints_and_lifecycle() {
        let manager = AdapterManager::new(Arc::new(FakeDriver));
        manager.attach("spi0", "flash-0".to_owned(), 0).unwrap();
        manager.attach("spi0", "adc-0".to_owned(), 1).unwrap();

        let loaded = manager.load("spi0").unwrap();
        assert_eq!(loaded.state, AdapterState::Loaded);
        assert_eq!(loaded.bindings.len(), 2);
        assert_eq!(loaded.daemon_pids, vec![1000, 1001]);
        let hot_attached = manager.attach("spi0", "other".to_owned(), 2).unwrap();
        assert_eq!(hot_attached.state, AdapterState::Loaded);
        assert_eq!(hot_attached.bindings.len(), 3);
        assert_eq!(hot_attached.daemon_pids, vec![1000, 1001, 1002]);

        let hot_detached = manager.detach("spi0", "other").unwrap();
        assert_eq!(hot_detached.state, AdapterState::Loaded);
        assert_eq!(hot_detached.bindings.len(), 2);
        assert_eq!(hot_detached.daemon_pids, vec![1000, 1001]);

        let unloaded = manager.unload("spi0").unwrap();
        assert_eq!(unloaded.state, AdapterState::Unloaded);
        assert!(unloaded.daemon_pids.is_empty());
    }

    #[test]
    fn prevents_duplicate_device_and_endpoint_bindings() {
        let manager = AdapterManager::new(Arc::new(FakeDriver));
        manager.attach("spi0", "flash-0".to_owned(), 0).unwrap();
        assert!(matches!(
            manager.attach("spi0", "flash-0".to_owned(), 1),
            Err(AdapterError::Conflict(_))
        ));
        assert!(matches!(
            manager.attach("spi0", "adc-0".to_owned(), 0),
            Err(AdapterError::Conflict(_))
        ));
    }

    #[test]
    fn loads_gpio_adapter_without_device_bindings() {
        let manager = AdapterManager::new(Arc::new(FakeDriver));
        let created = manager
            .create_gpio("gpio0".to_owned(), "GPIO 0".to_owned(), 32)
            .unwrap();
        assert_eq!(created.driver, "gpio-sim");
        assert_eq!(created.line_count, Some(32));
        assert!(created.bindings.is_empty());

        manager
            .attach_gpio(
                "gpio0",
                "gpio-bank".to_owned(),
                (0..32).map(|offset| format!("GPIO{offset}")).collect(),
            )
            .unwrap();
        let loaded = manager.load("gpio0").unwrap();
        assert_eq!(loaded.state, AdapterState::Loaded);
        assert_eq!(loaded.daemon_pids, vec![2000]);
        assert_eq!(loaded.device_path.as_deref(), Some("/dev/gpiochip7"));
    }

    #[test]
    fn manages_i2c_address_bindings_as_one_bus_daemon() {
        let manager = AdapterManager::new(Arc::new(FakeDriver));
        manager
            .create_i2c("i2c0".to_owned(), "I2C 0".to_owned(), 0, None)
            .unwrap();
        let attached = manager.attach("i2c0", "sensor".to_owned(), 0x50).unwrap();
        assert_eq!(attached.bindings[0].device_path, "/dev/i2c-0");
        let loaded = manager.load("i2c0").unwrap();
        assert_eq!(loaded.daemon_pids, [3000]);
        assert_eq!(loaded.device_path.as_deref(), Some("/dev/i2c-0"));
        assert!(matches!(
            manager.attach("i2c0", "other".to_owned(), 0x51),
            Err(AdapterError::Conflict(_))
        ));
    }

    #[test]
    fn persists_topology_and_restores_loaded_adapters() {
        let state_path = temporary_state_path();
        let manager = AdapterManager::persistent(Arc::new(FakeDriver), state_path.clone()).unwrap();
        manager
            .create_gpio("gpio0".to_owned(), "GPIO 0".to_owned(), 4)
            .unwrap();
        manager
            .attach_gpio(
                "gpio0",
                "gpio-bank".to_owned(),
                vec![
                    "RESET".to_owned(),
                    "READY".to_owned(),
                    "IRQ".to_owned(),
                    "POWER".to_owned(),
                ],
            )
            .unwrap();
        manager.load("gpio0").unwrap();

        let persisted = fs::read_to_string(&state_path).unwrap();
        assert!(persisted.contains("\"load_on_startup\": true"));
        assert!(!persisted.contains("daemon_pids"));
        assert!(!persisted.contains("device_path"));
        drop(manager);

        let restored =
            AdapterManager::persistent(Arc::new(FakeDriver), state_path.clone()).unwrap();
        let before_load = restored
            .list()
            .unwrap()
            .into_iter()
            .find(|adapter| adapter.id == "gpio0")
            .unwrap();
        assert_eq!(before_load.state, AdapterState::Unloaded);
        assert_eq!(before_load.bindings[0].device_path, "/dev/gpiochipX");
        assert!(before_load.daemon_pids.is_empty());

        let results = restored.restore_loaded();
        assert_eq!(results.len(), 1);
        let loaded = results.into_iter().next().unwrap().1.unwrap();
        assert_eq!(loaded.state, AdapterState::Loaded);
        assert_eq!(loaded.device_path.as_deref(), Some("/dev/gpiochip7"));
        assert_eq!(loaded.bindings[0].device_path, "/dev/gpiochip7");

        restored.unload("gpio0").unwrap();
        drop(restored);
        let unloaded =
            AdapterManager::persistent(Arc::new(FakeDriver), state_path.clone()).unwrap();
        assert!(unloaded.restore_loaded().is_empty());

        fs::remove_file(state_path).unwrap();
    }

    #[test]
    fn rejects_invalid_persisted_topology() {
        let state_path = temporary_state_path();
        fs::write(
            &state_path,
            r#"{
                "version": 1,
                "adapters": [{
                    "id": "gpio0",
                    "name": "GPIO 0",
                    "bus_type": "gpio",
                    "bus_number": 0,
                    "line_count": 2,
                    "load_on_startup": false,
                    "bindings": [{
                        "device_id": "gpio-bank",
                        "endpoint": 0,
                        "line_names": ["ONLY_ONE"]
                    }]
                }]
            }"#,
        )
        .unwrap();

        let result = AdapterManager::persistent(Arc::new(FakeDriver), state_path.clone());
        assert!(matches!(result, Err(AdapterError::Persistence(_))));

        fs::remove_file(state_path).unwrap();
    }
}
