use std::{
    io::ErrorKind,
    os::unix::fs::FileTypeExt,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use tokio::net::{UnixListener, UnixStream};
use tracing::{debug, info, warn};
use vds_core::{
    clock::{RealTimeClock, SimulatorClock},
    config::ServerConfig,
    device::{
        DeviceError, FaultErrorCode, RegisterErrorCode, SpiLaneWidth, SpiTransferRate,
        SpiWireConfig, StateErrorCode, TimingErrorCode,
    },
    device_package::DevicePackage,
    event::DeviceEvent,
    registry::DeviceRegistry,
    transaction::{Transaction, TransactionResult},
};
use vds_device_model::{DeviceModel, ModelError};
use vds_events::{EventBus, EventDraft, EventPayload};
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ErrorResponse, ServerResponse, SpiTransferResponse,
        client_request, server_response,
    },
};

pub mod http;

/// Builds a registry from all configured declarative device models.
///
/// # Errors
///
/// Returns an error when a model is invalid, unsupported, or has a duplicate
/// device identifier.
pub fn load_registry(config: &ServerConfig) -> Result<DeviceRegistry, ServerError> {
    load_registry_with_clock(config, Arc::new(RealTimeClock::new()))
}

/// Builds a registry whose devices share the supplied simulator clock.
///
/// # Errors
/// Returns an error when a model is invalid or has a duplicate device ID.
pub fn load_registry_with_clock(
    config: &ServerConfig,
    clock: Arc<dyn SimulatorClock>,
) -> Result<DeviceRegistry, ServerError> {
    let registry = DeviceRegistry::new();
    for package in config.resolved_device_packages()? {
        let model = load_package_runtime_model(&package)?;
        validate_device_package_model(&package, &model).map_err(ServerError::PackageContract)?;
        let device = model.into_spi_device_with_clock(Arc::clone(&clock))?;
        registry.register(Arc::new(device))?;
    }
    drop(clock);
    Ok(registry)
}

pub(crate) fn load_package_runtime_model(
    package: &DevicePackage,
) -> Result<DeviceModel, ServerError> {
    let mut model = DeviceModel::load(package.model_path())?;
    if let Some(flow_path) = package.behavior_flow_path() {
        let yaml = std::fs::read_to_string(flow_path)?;
        model.apply_behavior_flow(&yaml, package.root())?;
    }
    Ok(model)
}

pub(crate) fn validate_device_package_model(
    package: &DevicePackage,
    model: &DeviceModel,
) -> Result<(), String> {
    let manifest = package.manifest();
    if manifest.metadata.id != model.device.id {
        return Err(format!(
            "device package '{}' metadata.id does not match model device.id '{}'",
            manifest.metadata.id, model.device.id
        ));
    }
    if manifest.spec.bus.kind.as_str() != model.device.bus {
        return Err(format!(
            "device package '{}' declares bus '{}' but its model declares '{}'",
            manifest.metadata.id,
            manifest.spec.bus.kind.as_str(),
            model.device.bus
        ));
    }
    if manifest.spec.runtime.driver != model.device.model {
        return Err(format!(
            "device package '{}' declares runtime driver '{}' but its model declares '{}'",
            manifest.metadata.id, manifest.spec.runtime.driver, model.device.model
        ));
    }
    Ok(())
}

/// Runs the Unix domain socket data plane until Ctrl-C is received.
///
/// # Errors
///
/// Returns an error when models cannot be loaded, the socket cannot be created,
/// or the listener fails.
pub async fn run(config: ServerConfig) -> Result<(), ServerError> {
    let clock: Arc<dyn SimulatorClock> = Arc::new(RealTimeClock::new());
    let registry = Arc::new(load_registry_with_clock(&config, Arc::clone(&clock))?);
    let event_store_path = std::env::var_os("HOME")
        .map_or_else(|| PathBuf::from("."), PathBuf::from)
        .join(".vsd4e/events.sqlite3");
    if let Some(parent) = event_store_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let events = if config.event_store.enabled {
        let settings = &config.event_store;
        let policy = vds_events::EventPersistencePolicy {
            max_size_bytes: settings.max_size_mb.saturating_mul(1024 * 1024),
            max_events: settings.max_events,
            cleanup_interval: std::time::Duration::from_secs(settings.cleanup_interval_seconds),
            transaction_retention: std::time::Duration::from_secs(
                settings.transaction_retention_hours.saturating_mul(60 * 60),
            ),
            register_read_retention: std::time::Duration::from_secs(
                settings
                    .register_read_retention_hours
                    .saturating_mul(60 * 60),
            ),
            critical_retention: std::time::Duration::from_secs(
                settings
                    .critical_retention_days
                    .saturating_mul(24 * 60 * 60),
            ),
            register_read_sample_rate: settings.register_read_sample_rate,
        };
        let bus = EventBus::persistent_with_policy(
            &event_store_path,
            vds_events::DEFAULT_RING_CAPACITY,
            1_024,
            policy,
        )
        .map_err(|error| ServerError::Api(format!("event store initialization failed: {error}")))?;
        info!(
            component = "domain_events",
            path = %event_store_path.display(),
            max_events = settings.max_events,
            max_size_mb = settings.max_size_mb,
            register_read_sample_rate = settings.register_read_sample_rate,
            "SQLite event store ready"
        );
        Arc::new(bus)
    } else {
        info!(
            component = "domain_events",
            "SQLite event persistence disabled"
        );
        Arc::new(EventBus::new(vds_events::DEFAULT_RING_CAPACITY, 1_024))
    };
    spawn_event_logger(Arc::clone(&events));
    let api_state = http::ApiState::new(
        config.clone(),
        Arc::clone(&registry),
        Arc::clone(&events),
        clock,
    )
    .map_err(ServerError::Api)?;
    let control_listener = tokio::net::TcpListener::bind(&config.server.control_address).await?;
    let control_address = control_listener.local_addr()?;
    let api = http::router(api_state);
    let http_server = async move { axum::serve(control_listener, api).await };
    tokio::pin!(http_server);

    let socket_path = config.data_plane.unix_socket.clone();
    prepare_socket(&socket_path).await?;
    let listener = UnixListener::bind(&socket_path)?;
    let _socket_guard = SocketGuard(socket_path.clone());
    let transaction_ids = Arc::new(AtomicU64::new(1));

    info!(
        component = "data_plane",
        unix_socket = %socket_path.display(),
        device_count = registry.len(),
        "Unix socket data plane listening"
    );
    info!(component = "control_plane", %control_address, "REST and WebSocket control plane listening");

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let registry = Arc::clone(&registry);
                let transaction_ids = Arc::clone(&transaction_ids);
                let events = Arc::clone(&events);
                tokio::spawn(async move {
                    if let Err(error) = serve_connection(stream, registry, transaction_ids, events).await {
                        warn!(component = "data_plane", %error, "client connection closed with error");
                    }
                });
            }
            result = &mut http_server => return result.map_err(ServerError::Io),
            signal = tokio::signal::ctrl_c() => {
                signal?;
                info!(component = "vds-server", "shutdown signal received");
                return Ok(());
            }
        }
    }
}

fn spawn_event_logger(events: Arc<EventBus>) {
    tokio::spawn(async move {
        let mut subscription = events.subscribe_from(0);
        while let Some(event) = subscription.recv().await {
            debug!(
                component = "domain_events",
                event_id = event.event_id,
                event = event.event_type.as_str(),
                virtual_time_ns = event.timestamp_virtual_ns,
                wall_time_ns = event.timestamp_wall_ns,
                device_id = event.device_id.as_deref().unwrap_or(""),
                scenario_run_id = event.scenario_run_id.as_deref().unwrap_or(""),
                "domain event published"
            );
        }
    });
}

async fn prepare_socket(path: &Path) -> Result<(), ServerError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_socket() => tokio::fs::remove_file(path).await?,
        Ok(_) => return Err(ServerError::UnsafeSocketPath(path.to_path_buf())),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

async fn serve_connection(
    mut stream: UnixStream,
    registry: Arc<DeviceRegistry>,
    transaction_ids: Arc<AtomicU64>,
    events: Arc<EventBus>,
) -> Result<(), ServerError> {
    loop {
        let request: ClientRequest = match read_message(&mut stream).await {
            Ok(request) => request,
            Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let response = handle_request(request, &registry, &transaction_ids, &events);
        write_message(&mut stream, &response).await?;
    }
}

fn handle_request(
    request: ClientRequest,
    registry: &DeviceRegistry,
    transaction_ids: &AtomicU64,
    events: &EventBus,
) -> ServerResponse {
    let request_id = request.request_id;
    let Some(client_request::Payload::SpiTransfer(spi)) = request.payload else {
        return error_response(
            request_id,
            ErrorCode::InvalidRequest,
            "request payload is missing".to_owned(),
        );
    };

    let transaction_id = transaction_ids.fetch_add(1, Ordering::Relaxed);
    let mut transaction = Transaction::now(transaction_id, spi.device_id.clone(), spi.tx.clone());
    let virtual_time_ns = registry.virtual_time_ns(&spi.device_id).unwrap_or(0);
    let _ = events.publish(EventDraft {
        virtual_time_ns,
        device_id: Some(spi.device_id.clone()),
        scenario_run_id: None,
        payload: EventPayload::TransactionStarted {
            transaction_id: Some(transaction_id),
            request: spi.tx.clone(),
        },
    });
    let wire = match decode_spi_wire(spi.wire.as_ref()) {
        Ok(wire) => wire,
        Err(message) => return error_response(request_id, ErrorCode::InvalidRequest, message),
    };
    let rx_length = usize::try_from(spi.rx_length).unwrap_or(usize::MAX);
    match registry.transfer_spi(&spi.device_id, &spi.tx, rx_length, wire) {
        Ok(transfer) => {
            transaction.response.clone_from(&transfer.response);
            transaction.register.clone_from(&transfer.register);
            log_device_events(&spi.device_id, &transfer.events);
            let _ = events.publish(EventDraft {
                virtual_time_ns,
                device_id: Some(spi.device_id.clone()),
                scenario_run_id: None,
                payload: EventPayload::TransactionCompleted {
                    transaction_id: Some(transaction_id),
                    response: transfer.response.clone(),
                    result: "success".to_owned(),
                    error_code: None,
                },
            });
            if let Some(register) = &transfer.register {
                let _ = events.publish(EventDraft {
                    virtual_time_ns,
                    device_id: Some(spi.device_id.clone()),
                    scenario_run_id: None,
                    payload: EventPayload::from_register(register),
                });
            }
            publish_device_events(events, &spi.device_id, &transfer.events, virtual_time_ns);
            log_transaction(&transaction);
            ServerResponse {
                request_id,
                result: Some(server_response::Result::SpiTransfer(SpiTransferResponse {
                    rx: transfer.response,
                })),
            }
        }
        Err(error) => {
            let (code, code_name) = protocol_error_code(&error);
            if let DeviceError::Register(failure) = &error {
                transaction.register = Some(failure.trace.clone());
            }
            transaction.result = TransactionResult::Error {
                code: code_name,
                message: error.to_string(),
            };
            if let DeviceError::Fault(failure) = &error {
                log_fault_failure(&spi.device_id, failure);
                let _ = events.publish(EventDraft {
                    virtual_time_ns: failure.virtual_time_ns,
                    device_id: Some(spi.device_id.clone()),
                    scenario_run_id: None,
                    payload: EventPayload::FaultTriggered {
                        fault_id: failure.fault_id.clone(),
                        command: failure.command.clone(),
                        trigger: failure.trigger.to_owned(),
                        trigger_count: failure.trigger_count,
                        action: failure.action.to_owned(),
                        result: "applied".to_owned(),
                    },
                });
            }
            let _ = events.publish(EventDraft {
                virtual_time_ns,
                device_id: Some(spi.device_id.clone()),
                scenario_run_id: None,
                payload: EventPayload::TransactionCompleted {
                    transaction_id: Some(transaction_id),
                    response: Vec::new(),
                    result: "error".to_owned(),
                    error_code: Some(code_name.to_owned()),
                },
            });
            log_transaction(&transaction);
            error_response(request_id, code, error.to_string())
        }
    }
}

fn decode_spi_wire(
    wire: Option<&vds_protocol::v1::SpiWireConfig>,
) -> Result<SpiWireConfig, String> {
    let Some(wire) = wire else {
        return Ok(SpiWireConfig::default());
    };
    let lane = |value| match vds_protocol::v1::SpiLaneWidth::try_from(value) {
        Ok(
            vds_protocol::v1::SpiLaneWidth::Unspecified | vds_protocol::v1::SpiLaneWidth::Single,
        ) => Ok(SpiLaneWidth::Single),
        Ok(vds_protocol::v1::SpiLaneWidth::Dual) => Ok(SpiLaneWidth::Dual),
        Ok(vds_protocol::v1::SpiLaneWidth::Quad) => Ok(SpiLaneWidth::Quad),
        Err(_) => Err(format!("invalid SPI lane width {value}")),
    };
    let rate = match vds_protocol::v1::SpiTransferRate::try_from(wire.rate) {
        Ok(
            vds_protocol::v1::SpiTransferRate::Unspecified | vds_protocol::v1::SpiTransferRate::Str,
        ) => SpiTransferRate::Str,
        Ok(vds_protocol::v1::SpiTransferRate::Dtr) => SpiTransferRate::Dtr,
        Err(_) => return Err(format!("invalid SPI transfer rate {}", wire.rate)),
    };
    Ok(SpiWireConfig {
        mode: u8::try_from(wire.mode).map_err(|_| "SPI mode exceeds 8 bits".to_owned())?,
        bits_per_word: u8::try_from(wire.bits_per_word)
            .map_err(|_| "SPI bits-per-word exceeds 8 bits".to_owned())?,
        max_speed_hz: wire.max_speed_hz,
        command_width: lane(wire.command_width)?,
        address_width: lane(wire.address_width)?,
        data_width: lane(wire.data_width)?,
        rate,
        dummy_cycles: u16::try_from(wire.dummy_cycles)
            .map_err(|_| "SPI dummy-cycle count exceeds 16 bits".to_owned())?,
        lsb_first: wire.lsb_first,
    })
}

fn publish_device_events(
    bus: &EventBus,
    device_id: &str,
    events: &[DeviceEvent],
    fallback_time_ns: u64,
) {
    for event in events {
        let virtual_time_ns = match event {
            DeviceEvent::OperationStarted { started_at_ns, .. } => *started_at_ns,
            DeviceEvent::OperationCompleted {
                completed_at_ns, ..
            }
            | DeviceEvent::FaultDelayCompleted {
                completed_at_ns, ..
            } => *completed_at_ns,
            DeviceEvent::StateTransition {
                virtual_time_ns, ..
            }
            | DeviceEvent::FaultTriggered {
                virtual_time_ns, ..
            } => *virtual_time_ns,
        };
        let _ = bus.publish(EventDraft {
            virtual_time_ns: virtual_time_ns.max(fallback_time_ns),
            device_id: Some(device_id.to_owned()),
            scenario_run_id: None,
            payload: EventPayload::from_device_event(event),
        });
    }
}

fn protocol_error_code(error: &DeviceError) -> (ErrorCode, &'static str) {
    match error {
        DeviceError::NotFound(_) => (ErrorCode::DeviceNotFound, "device_not_found"),
        DeviceError::UnknownOpcode(_) => (ErrorCode::UnknownOpcode, "unknown_opcode"),
        DeviceError::EmptyRequest | DeviceError::InvalidRequest(_) => {
            (ErrorCode::InvalidRequest, "invalid_request")
        }
        DeviceError::Register(failure) => match failure.code {
            RegisterErrorCode::UnknownAddress => (
                ErrorCode::RegisterUnknownAddress,
                "register_unknown_address",
            ),
            RegisterErrorCode::ReadNotAllowed => (
                ErrorCode::RegisterReadNotAllowed,
                "register_read_not_allowed",
            ),
            RegisterErrorCode::WriteNotAllowed => (
                ErrorCode::RegisterWriteNotAllowed,
                "register_write_not_allowed",
            ),
            RegisterErrorCode::ValueOverflow => {
                (ErrorCode::RegisterValueOverflow, "register_value_overflow")
            }
            RegisterErrorCode::Internal => (ErrorCode::Internal, "register_internal"),
        },
        DeviceError::Timing(failure) => match failure.code {
            TimingErrorCode::DeviceBusy => (ErrorCode::DeviceBusy, "device_busy"),
            TimingErrorCode::DeadlineOverflow | TimingErrorCode::Scheduler => {
                (ErrorCode::TimingError, "timing_error")
            }
        },
        DeviceError::State(failure) => match failure.code {
            StateErrorCode::InvalidEvent => (ErrorCode::StateInvalidEvent, "state_invalid_event"),
            StateErrorCode::GuardRejected => {
                (ErrorCode::StateGuardRejected, "state_guard_rejected")
            }
            StateErrorCode::CommandRejected => {
                (ErrorCode::StateCommandRejected, "state_command_rejected")
            }
            StateErrorCode::ActionFailed | StateErrorCode::Internal => {
                (ErrorCode::StateActionFailed, "state_action_failed")
            }
        },
        DeviceError::Fault(failure) => match failure.code {
            FaultErrorCode::Timeout => (ErrorCode::FaultTimeout, "fault_timeout"),
            FaultErrorCode::ReturnError => (ErrorCode::FaultReturnError, "fault_return_error"),
            FaultErrorCode::Dropped => (ErrorCode::FaultDropped, "fault_dropped"),
            FaultErrorCode::ActionFailed => (ErrorCode::FaultActionFailed, "fault_action_failed"),
        },
    }
}

fn log_device_events(device_id: &str, events: &[DeviceEvent]) {
    for event in events {
        match event {
            DeviceEvent::OperationStarted {
                command,
                scheduled_duration_ns,
                started_at_ns,
                busy,
            } => info!(
                component = "device_timing",
                event = "device_operation_started",
                device_id,
                command,
                scheduled_duration_ns,
                virtual_started_at_ns = started_at_ns,
                busy,
                "device operation started"
            ),
            DeviceEvent::OperationCompleted {
                command,
                scheduled_duration_ns,
                started_at_ns,
                completed_at_ns,
                busy,
                register,
                result,
            } => {
                let actual_virtual_duration_ns = completed_at_ns.saturating_sub(*started_at_ns);
                let register_name = register.name.as_deref().unwrap_or("");
                let old_value = format_register_value(register.old_value);
                let new_value = format_register_value(register.new_value);
                info!(
                    component = "device_timing",
                    event = "device_operation_completed",
                    device_id,
                    command,
                    scheduled_duration_ns,
                    actual_virtual_duration_ns,
                    virtual_started_at_ns = started_at_ns,
                    virtual_completed_at_ns = completed_at_ns,
                    busy,
                    register_name,
                    register_address = register.address,
                    register_access = %register.access_type.map_or_else(String::new, |access| access.to_string()),
                    old_value = %old_value,
                    new_value = %new_value,
                    result,
                    "device operation completed"
                );
            }
            DeviceEvent::StateTransition {
                from_state,
                to_state,
                trigger,
                virtual_time_ns,
                result,
            } => info!(
                component = "state_machine",
                event = "state_transition",
                device_id,
                from_state,
                to_state,
                trigger,
                virtual_time_ns,
                result,
                "device state transitioned"
            ),
            DeviceEvent::FaultTriggered {
                fault_id,
                command,
                trigger,
                trigger_count,
                action,
                virtual_time_ns,
                result,
            } => log_fault_triggered(
                device_id,
                fault_id,
                command,
                trigger,
                *trigger_count,
                action,
                *virtual_time_ns,
                result,
            ),
            DeviceEvent::FaultDelayCompleted {
                fault_id,
                command,
                scheduled_duration_ns,
                started_at_ns,
                completed_at_ns,
            } => log_fault_delay_completed(
                device_id,
                fault_id,
                command,
                *scheduled_duration_ns,
                *started_at_ns,
                *completed_at_ns,
            ),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn log_fault_triggered(
    device_id: &str,
    fault_id: &str,
    command: &str,
    trigger: &str,
    trigger_count: u64,
    action: &str,
    virtual_time_ns: u64,
    result: &str,
) {
    info!(
        component = "fault_engine",
        event = "fault_triggered",
        fault_id,
        device_id,
        command,
        trigger,
        trigger_count,
        action,
        virtual_time_ns,
        result,
        "fault applied"
    );
}

fn log_fault_delay_completed(
    device_id: &str,
    fault_id: &str,
    command: &str,
    scheduled_duration_ns: u64,
    started_at_ns: u64,
    completed_at_ns: u64,
) {
    info!(
        component = "fault_engine",
        event = "fault_delay_completed",
        fault_id,
        device_id,
        command,
        scheduled_duration_ns,
        virtual_started_at_ns = started_at_ns,
        virtual_completed_at_ns = completed_at_ns,
        result = "completed",
        "fault delay completed"
    );
}

fn log_fault_failure(device_id: &str, failure: &vds_core::device::FaultFailure) {
    info!(component = "fault_engine", event = "fault_triggered", fault_id = %failure.fault_id,
        device_id, command = %failure.command, trigger = failure.trigger,
        trigger_count = failure.trigger_count, action = failure.action,
        virtual_time_ns = failure.virtual_time_ns, result = "applied", "terminal fault applied");
}

fn error_response(request_id: u64, code: ErrorCode, message: String) -> ServerResponse {
    ServerResponse {
        request_id,
        result: Some(server_response::Result::Error(ErrorResponse {
            code: code as i32,
            message,
        })),
    }
}

fn log_transaction(transaction: &Transaction) {
    let request = format_bytes(&transaction.request);
    let response = format_bytes(&transaction.response);
    if let Some(register) = &transaction.register {
        let name = register.name.as_deref().unwrap_or("");
        let access_type = register
            .access_type
            .map_or_else(String::new, |access| access.to_string());
        let old_value = format_register_value(register.old_value);
        let new_value = format_register_value(register.new_value);
        match &transaction.result {
            TransactionResult::Success => info!(
                component = "transaction",
                transaction_id = transaction.id,
                bus_id = %transaction.bus_id,
                device_id = %transaction.device_id,
                operation = "spi_transfer",
                request = %request,
                response = %response,
                register_name = name,
                register_address = register.address,
                register_access = %access_type,
                register_operation = %register.operation,
                old_value = %old_value,
                new_value = %new_value,
                result = "success",
                "register transaction completed"
            ),
            TransactionResult::Error { code, message } => warn!(
                component = "transaction",
                transaction_id = transaction.id,
                bus_id = %transaction.bus_id,
                device_id = %transaction.device_id,
                operation = "spi_transfer",
                request = %request,
                response = %response,
                register_name = name,
                register_address = register.address,
                register_access = %access_type,
                register_operation = %register.operation,
                old_value = %old_value,
                new_value = %new_value,
                result = "error",
                error_code = *code,
                error = %message,
                "register transaction failed"
            ),
        }
        return;
    }
    match &transaction.result {
        TransactionResult::Success => info!(
            component = "transaction",
            transaction_id = transaction.id,
            bus_id = %transaction.bus_id,
            device_id = %transaction.device_id,
            operation = "spi_transfer",
            request = %request,
            response = %response,
            result = "success",
            "transaction completed"
        ),
        TransactionResult::Error { code, message } => warn!(
            component = "transaction",
            transaction_id = transaction.id,
            bus_id = %transaction.bus_id,
            device_id = %transaction.device_id,
            operation = "spi_transfer",
            request = %request,
            response = %response,
            result = "error",
            error_code = *code,
            error = %message,
            "transaction failed"
        ),
    }
}

fn format_register_value(value: Option<u64>) -> String {
    value.map_or_else(String::new, |value| format!("0x{value:X}"))
}

fn format_bytes(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

struct SocketGuard(PathBuf);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Core(#[from] vds_core::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Model(#[from] ModelError),

    #[error(transparent)]
    Device(#[from] DeviceError),

    #[error("refusing to replace non-socket path '{0}'")]
    UnsafeSocketPath(PathBuf),

    #[error("control API initialization failed: {0}")]
    Api(String),

    #[error("device package contract failed: {0}")]
    PackageContract(String),
}
