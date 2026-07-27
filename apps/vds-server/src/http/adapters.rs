use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use vds_core::config::ServerConfig;

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
    pub bindings: Vec<AdapterBinding>,
    pub daemon_pids: Vec<u32>,
    pub error: Option<String>,
}

impl AdapterSnapshot {
    fn spi(id: String, name: String, bus_number: u16) -> Self {
        Self {
            id,
            name,
            bus_type: "spi".to_owned(),
            driver: "cuse".to_owned(),
            state: AdapterState::Unloaded,
            readiness: DriverReadiness::Unavailable,
            bus_number,
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
            | Self::Process(message) => formatter.write_str(message),
        }
    }
}

pub trait AdapterDriver: Send + Sync {
    fn readiness(&self) -> DriverReadiness;
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
        let executable = std::env::var_os("VDS4E_SPI_CUSE_EXECUTABLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                [
                    PathBuf::from(".vds4e-build/spi-cuse/vds4e-spi-cuse"),
                    PathBuf::from("build/spi-cuse/vds4e-spi-cuse"),
                    PathBuf::from("/usr/local/bin/vds4e-spi-cuse"),
                    PathBuf::from("/usr/bin/vds4e-spi-cuse"),
                ]
                .into_iter()
                .find(|candidate| candidate.is_file())
                .unwrap_or_else(|| {
                    PathBuf::from(".vds4e-build/spi-cuse/vds4e-spi-cuse")
                })
            });
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
                let status = Command::new("/usr/bin/pkexec")
                    .arg("/bin/kill")
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
            let status = Command::new("/usr/bin/pkexec")
                .arg("/bin/kill")
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
        if !Path::new("/usr/bin/pkexec").is_file() {
            return Err(AdapterError::AuthorizationRequired(
                "Polkit pkexec is unavailable; load cuse and grant /dev/cuse access outside VDS4E"
                    .to_owned(),
            ));
        }
        let status = Command::new("/usr/bin/pkexec")
            .arg("/usr/sbin/modprobe")
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
            let mut command = Command::new("/usr/bin/pkexec");
            command.arg(executable);
            command
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
        if privileged && !Path::new("/usr/bin/pkexec").is_file() {
            return Err(AdapterError::AuthorizationRequired(
                "Polkit pkexec is unavailable; run the CUSE adapter with operating-system privileges"
                    .to_owned(),
            ));
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

pub struct AdapterManager {
    adapters: Mutex<HashMap<String, AdapterSnapshot>>,
    driver: Arc<dyn AdapterDriver>,
}

impl AdapterManager {
    #[must_use]
    pub fn new(driver: Arc<dyn AdapterDriver>) -> Self {
        let readiness = driver.readiness();
        let mut adapter = AdapterSnapshot::spi("spi0".to_owned(), "SPI 0".to_owned(), 0);
        adapter.readiness = readiness;
        Self {
            adapters: Mutex::new(HashMap::from([(adapter.id.clone(), adapter)])),
            driver,
        }
    }

    #[must_use]
    pub fn system(config: &ServerConfig) -> Self {
        Self::new(Arc::new(SystemCuseDriver::from_config(config)))
    }

    /// Returns deterministic adapter snapshots with current driver readiness.
    ///
    /// # Errors
    /// Returns an error when adapter state cannot be locked.
    pub fn list(&self) -> Result<Vec<AdapterSnapshot>, AdapterError> {
        let readiness = self.driver.readiness();
        let mut snapshots = self
            .adapters
            .lock()
            .map_err(|_| AdapterError::Process("adapter state lock is poisoned".to_owned()))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for adapter in &mut snapshots {
            adapter.readiness = readiness;
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
    ) -> Result<AdapterSnapshot, AdapterError> {
        if !valid_id(&id) {
            return Err(AdapterError::Invalid(
                "adapter id must contain 1-64 letters, numbers, '.', '_' or '-' and start with a letter or number".to_owned(),
            ));
        }
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
        let mut adapter = AdapterSnapshot::spi(id.clone(), name, bus_number);
        adapter.readiness = self.driver.readiness();
        adapters.insert(id, adapter.clone());
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
            if adapter
                .bindings
                .iter()
                .any(|binding| binding.endpoint == endpoint)
            {
                return Err(AdapterError::Conflict(format!(
                    "chip-select {endpoint} is already occupied"
                )));
            }
            (
                adapter.clone(),
                AdapterBinding {
                    device_id,
                    endpoint,
                    device_path: format!("/dev/spidev{}.{}", adapter.bus_number, endpoint),
                },
            )
        };
        let pid = if snapshot.state == AdapterState::Loaded {
            Some(self.driver.attach_endpoint(&snapshot, &binding)?)
        } else {
            None
        };
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
        Ok(adapter.clone())
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
        Ok(adapter.clone())
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
            if adapter.bindings.is_empty() {
                return Err(AdapterError::Conflict(
                    "attach at least one device before loading the adapter".to_owned(),
                ));
            }
            adapter.state = AdapterState::Loading;
            adapter.error = None;
            adapter.clone()
        };
        match self.driver.load(&snapshot) {
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
        adapter.readiness = self.driver.readiness();
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
        match self.driver.unload(&snapshot) {
            Ok(()) => self.finish_load(adapter_id, AdapterState::Unloaded, Vec::new(), None),
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
        }
    }
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
    use super::*;

    struct FakeDriver;

    impl AdapterDriver for FakeDriver {
        fn readiness(&self) -> DriverReadiness {
            DriverReadiness::Ready
        }

        fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
            Ok((1000_u32..)
                .zip(adapter.bindings.iter())
                .map(|(pid, _)| pid)
                .collect())
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
}
