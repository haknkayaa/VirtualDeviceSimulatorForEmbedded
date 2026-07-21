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
use tracing::{info, warn};
use vds_core::{
    config::ServerConfig,
    device::{Device, DeviceError, RegisterErrorCode, StateErrorCode, TimingErrorCode},
    event::DeviceEvent,
    registry::DeviceRegistry,
    transaction::{Transaction, TransactionResult},
};
use vds_device_model::{DeviceModel, ModelError};
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ErrorResponse, ServerResponse, SpiTransferResponse,
        client_request, server_response,
    },
};

/// Builds a registry from all configured declarative device models.
///
/// # Errors
///
/// Returns an error when a model is invalid, unsupported, or has a duplicate
/// device identifier.
pub fn load_registry(config: &ServerConfig) -> Result<DeviceRegistry, ServerError> {
    let mut registry = DeviceRegistry::new();
    for path in &config.device_models {
        let model = DeviceModel::load(path)?;
        let device = model.into_spi_device()?;
        info!(
            component = "device_registry",
            device_id = device.id(),
            model_path = %path.display(),
            "device model loaded"
        );
        registry.register(Arc::new(device))?;
    }
    Ok(registry)
}

/// Runs the Unix domain socket data plane until Ctrl-C is received.
///
/// # Errors
///
/// Returns an error when models cannot be loaded, the socket cannot be created,
/// or the listener fails.
pub async fn run(config: ServerConfig) -> Result<(), ServerError> {
    let registry = Arc::new(load_registry(&config)?);
    let socket_path = config.data_plane.unix_socket;
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

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let registry = Arc::clone(&registry);
                let transaction_ids = Arc::clone(&transaction_ids);
                tokio::spawn(async move {
                    if let Err(error) = serve_connection(stream, registry, transaction_ids).await {
                        warn!(component = "data_plane", %error, "client connection closed with error");
                    }
                });
            }
            signal = tokio::signal::ctrl_c() => {
                signal?;
                info!(component = "vds-server", "shutdown signal received");
                return Ok(());
            }
        }
    }
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
) -> Result<(), ServerError> {
    loop {
        let request: ClientRequest = match read_message(&mut stream).await {
            Ok(request) => request,
            Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let response = handle_request(request, &registry, &transaction_ids);
        write_message(&mut stream, &response).await?;
    }
}

fn handle_request(
    request: ClientRequest,
    registry: &DeviceRegistry,
    transaction_ids: &AtomicU64,
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
    match registry.transfer(&spi.device_id, &spi.tx) {
        Ok(transfer) => {
            transaction.response.clone_from(&transfer.response);
            transaction.register.clone_from(&transfer.register);
            log_device_events(&spi.device_id, &transfer.events);
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
            log_transaction(&transaction);
            error_response(request_id, code, error.to_string())
        }
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
        }
    }
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
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Model(#[from] ModelError),

    #[error(transparent)]
    Device(#[from] DeviceError),

    #[error("refusing to replace non-socket path '{0}'")]
    UnsafeSocketPath(PathBuf),
}
