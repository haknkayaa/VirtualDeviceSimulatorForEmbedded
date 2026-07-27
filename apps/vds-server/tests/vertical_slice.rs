use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tokio::net::UnixStream;
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ServerResponse, SpiTransferRequest, client_request,
        server_response,
    },
};

struct TestServer {
    child: Child,
    config: PathBuf,
    temporary_package: PathBuf,
    socket: PathBuf,
}

fn copy_directory(source: &Path, target: &Path) {
    fs::create_dir_all(target).expect("package directory should be created");
    for entry in fs::read_dir(source).expect("package directory should be readable") {
        let entry = entry.expect("package entry should be readable");
        let destination = target.join(entry.file_name());
        if entry
            .file_type()
            .expect("package entry type should be readable")
            .is_dir()
        {
            copy_directory(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).expect("package file should be copied");
        }
    }
}

impl TestServer {
    async fn start() -> Self {
        let model = example_model_yaml().replace("delay_us: 5000", "delay_us: 0");
        Self::start_with_model(Some(&model)).await
    }

    async fn start_with_model(model_yaml: Option<&str>) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let socket = std::env::temp_dir().join(format!("vds4e-{unique}.sock"));
        let config = std::env::temp_dir().join(format!("vds4e-{unique}.yaml"));
        let temporary_package = std::env::temp_dir().join(format!("vds4e-package-{unique}"));
        let source_package = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/spi-flash")
            .canonicalize()
            .expect("test package should exist");
        copy_directory(&source_package, &temporary_package);
        if let Some(yaml) = model_yaml {
            fs::write(temporary_package.join("model/device.yaml"), yaml)
                .expect("test model should be written");
        }
        fs::write(
            &config,
            format!(
                "schema_version: 1\nserver:\n  control_address: 127.0.0.1:0\ndata_plane:\n  unix_socket: {}\nobservability:\n  log_level: info\ndevice_packages:\n  - {}\n",
                socket.display(),
                temporary_package.display()
            ),
        )
        .expect("test configuration should be written");

        let mut child = Command::new(env!("CARGO_BIN_EXE_vds-server"))
            .args([
                "--config",
                config.to_str().expect("config path should be UTF-8"),
            ])
            .env("HOME", &temporary_package)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("server should start");

        // JSON-schema compilation is CPU-heavy when the integration tests start
        // several isolated server processes in parallel on a small CI runner.
        for _ in 0..500 {
            if socket.exists() {
                return Self {
                    child,
                    config,
                    temporary_package,
                    socket,
                };
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let _ = child.kill();
        let _ = child.wait();
        let mut startup_logs = String::new();
        if let Some(mut stdout) = child.stdout.take() {
            let _ = stdout.read_to_string(&mut startup_logs);
        }
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut startup_logs);
        }
        let _ = fs::remove_file(&config);
        let _ = fs::remove_dir_all(temporary_package);
        panic!("server socket was not created; startup logs:\n{startup_logs}");
    }

    async fn transfer(&self, request_id: u64, tx: Vec<u8>) -> ServerResponse {
        transfer_to_socket(&self.socket, request_id, tx).await
    }

    fn stop_and_logs(mut self) -> String {
        self.child.kill().expect("server should stop");
        self.child.wait().expect("server should be reaped");
        let mut logs = String::new();
        self.child
            .stdout
            .take()
            .expect("server stdout should be captured")
            .read_to_string(&mut logs)
            .expect("server stdout should be readable");
        self.child
            .stderr
            .take()
            .expect("server stderr should be captured")
            .read_to_string(&mut logs)
            .expect("server stderr should be readable");
        logs
    }
}

fn example_model_yaml() -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/spi-flash/model/device.yaml"),
    )
    .expect("example model should be readable")
}

async fn transfer_to_socket(socket: &Path, request_id: u64, tx: Vec<u8>) -> ServerResponse {
    let mut stream = UnixStream::connect(socket)
        .await
        .expect("client should connect");
    let request = ClientRequest {
        request_id,
        payload: Some(client_request::Payload::SpiTransfer(SpiTransferRequest {
            device_id: "spi-flash-0".to_owned(),
            tx,
            wire: None,
            rx_length: 0,
        })),
    };
    write_message(&mut stream, &request)
        .await
        .expect("request should be sent");
    read_message(&mut stream)
        .await
        .expect("response should be received")
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.config);
        let _ = fs::remove_dir_all(&self.temporary_package);
        let _ = fs::remove_file(&self.socket);
    }
}

#[tokio::test]
async fn read_id_round_trips_over_the_unix_socket() {
    let server = TestServer::start().await;

    let response = server.transfer(41, vec![0x9f]).await;

    assert_eq!(response.request_id, 41);
    match response.result {
        Some(server_response::Result::SpiTransfer(spi)) => {
            assert_eq!(spi.rx, vec![0xef, 0x40, 0x18]);
        }
        other => panic!("expected SPI response, got {other:?}"),
    }

    let logs = server.stop_and_logs();
    assert!(logs.contains("\"component\":\"transaction\""));
    assert!(logs.contains("\"request\":\"9F\""));
    assert!(logs.contains("\"response\":\"EF 40 18\""));
}

#[tokio::test]
async fn unknown_opcode_returns_a_structured_error() {
    let server = TestServer::start().await;

    let response = server.transfer(42, vec![0x00]).await;

    match response.result {
        Some(server_response::Result::Error(error)) => {
            assert_eq!(error.code, ErrorCode::UnknownOpcode as i32);
            assert!(error.message.contains("0x00"));
        }
        other => panic!("expected error response, got {other:?}"),
    }
}

#[tokio::test]
async fn spi_register_write_then_read_round_trips_and_logs_metadata() {
    let model = example_model_yaml()
        .replace("delay_us: 5000", "delay_us: 0")
        .replace("latency_us: 10000", "latency_us: 3600000000");
    let server = TestServer::start_with_model(Some(&model)).await;

    let initial = server.transfer(50, vec![0x03, 0x01]).await;
    match initial.result {
        Some(server_response::Result::SpiTransfer(spi)) => assert_eq!(spi.rx, vec![0x12]),
        other => panic!("expected initial register read, got {other:?}"),
    }

    let write = server.transfer(51, vec![0x02, 0x01, 0x5a]).await;
    match write.result {
        Some(server_response::Result::SpiTransfer(spi)) => assert!(spi.rx.is_empty()),
        other => panic!("expected register write response, got {other:?}"),
    }

    let pending = server.transfer(52, vec![0x03, 0x01]).await;
    match pending.result {
        Some(server_response::Result::SpiTransfer(spi)) => assert_eq!(spi.rx, vec![0x12]),
        other => panic!("expected pending register read, got {other:?}"),
    }

    let logs = server.stop_and_logs();
    assert!(logs.contains("\"register_name\":\"CONTROL\""));
    assert!(logs.contains("\"register_address\":1"));
    assert!(logs.contains("\"register_access\":\"rw\""));
    assert!(logs.contains("\"old_value\":\"0x12\""));
    assert!(logs.contains("\"new_value\":\"0x5A\""));
    assert!(logs.contains("\"result\":\"success\""));
    assert!(logs.contains("\"event\":\"device_operation_started\""));
    assert!(logs.contains("\"scheduled_duration_ns\":3600000000000"));
}

#[tokio::test]
async fn register_access_errors_remain_structured_over_the_socket() {
    let server = TestServer::start().await;

    let ro_write = server.transfer(60, vec![0x02, 0x00, 0x55]).await;
    match ro_write.result {
        Some(server_response::Result::Error(error)) => {
            assert_eq!(error.code, ErrorCode::RegisterWriteNotAllowed as i32);
            assert!(error.message.contains("STATUS"));
        }
        other => panic!("expected RO write error, got {other:?}"),
    }

    let wo_read = server.transfer(61, vec![0x03, 0x03]).await;
    match wo_read.result {
        Some(server_response::Result::Error(error)) => {
            assert_eq!(error.code, ErrorCode::RegisterReadNotAllowed as i32);
            assert!(error.message.contains("COMMAND"));
        }
        other => panic!("expected WO read error, got {other:?}"),
    }

    let unknown = server.transfer(62, vec![0x03, 0x7f]).await;
    match unknown.result {
        Some(server_response::Result::Error(error)) => {
            assert_eq!(error.code, ErrorCode::RegisterUnknownAddress as i32);
            assert!(error.message.contains("0x7F"));
        }
        other => panic!("expected unknown-address error, got {other:?}"),
    }

    let logs = server.stop_and_logs();
    assert!(logs.contains("\"register_name\":\"STATUS\""));
    assert!(logs.contains("\"register_access\":\"ro\""));
    assert!(logs.contains("\"result\":\"error\""));
    assert!(logs.contains("\"error_code\":\"register_write_not_allowed\""));
}

#[tokio::test]
async fn invalid_register_payload_lengths_are_rejected() {
    let server = TestServer::start().await;

    for (request_id, payload) in [(70, vec![0x03]), (71, vec![0x02, 0x01])] {
        let response = server.transfer(request_id, payload).await;
        match response.result {
            Some(server_response::Result::Error(error)) => {
                assert_eq!(error.code, ErrorCode::InvalidRequest as i32);
                assert!(error.message.contains("expects") || error.message.contains("requires"));
            }
            other => panic!("expected invalid-payload error, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn concurrent_register_reads_are_consistent() {
    let server = TestServer::start().await;

    let mut reads = Vec::new();
    for index in 0..32_u64 {
        let socket = server.socket.clone();
        reads.push(tokio::spawn(async move {
            transfer_to_socket(&socket, 100 + index, vec![0x03, 0x01]).await
        }));
    }

    for read in reads {
        let response = read.await.expect("read task should complete");
        match response.result {
            Some(server_response::Result::SpiTransfer(spi)) => assert_eq!(spi.rx, vec![0x12]),
            other => panic!("expected consistent register read, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn timed_write_logs_start_and_completion() {
    let model = example_model_yaml()
        .replace("delay_us: 5000", "delay_us: 0")
        .replace("latency_us: 10000", "latency_us: 0");
    let server = TestServer::start_with_model(Some(&model)).await;

    let response = server.transfer(90, vec![0x02, 0x01, 0x5a]).await;
    assert!(matches!(
        response.result,
        Some(server_response::Result::SpiTransfer(_))
    ));

    let logs = server.stop_and_logs();
    assert!(logs.contains("\"event\":\"device_operation_started\""));
    assert!(logs.contains("\"event\":\"device_operation_completed\""));
    assert!(logs.contains("\"actual_virtual_duration_ns\":"));
    assert!(logs.contains("\"event\":\"state_transition\""));
    assert!(logs.contains("\"from_state\":\"ready\""));
    assert!(logs.contains("\"to_state\":\"busy\""));
    assert!(logs.contains("\"trigger\":\"write_started\""));
    assert!(logs.contains("\"virtual_time_ns\":"));
    assert!(logs.contains("\"register_name\":\"CONTROL\""));
    assert!(logs.contains("\"old_value\":\"0x12\""));
    assert!(logs.contains("\"new_value\":\"0x5A\""));
}

#[tokio::test]
async fn c_client_read_id_remains_compatible() {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let build = Command::new("make")
        .args(["-C", "client/c"])
        .current_dir(&project_root)
        .output()
        .expect("C client build should run");
    assert!(
        build.status.success(),
        "C client build failed: {}",
        String::from_utf8_lossy(&build.stderr)
    );
    let server = TestServer::start().await;

    let output = Command::new(project_root.join("client/c/build/read_id"))
        .arg(&server.socket)
        .output()
        .expect("C client should run");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("TX: 9F"));
    assert!(stdout.contains("RX: EF 40 18"));
}

#[tokio::test]
async fn timeout_fault_is_structured_and_logged() {
    let model = example_model_yaml()
        .replace("delay_us: 5000", "delay_us: 0")
        .replace("enabled: false", "enabled: true")
        .replace("trigger: always", "trigger:\n        operation_count: 1");
    let server = TestServer::start_with_model(Some(&model)).await;

    let response = server.transfer(200, vec![0x9f]).await;
    match response.result {
        Some(server_response::Result::Error(error)) => {
            assert_eq!(error.code, ErrorCode::FaultTimeout as i32);
            assert!(error.message.contains("timed out"));
        }
        other => panic!("expected fault timeout, got {other:?}"),
    }

    let logs = server.stop_and_logs();
    assert!(logs.contains("\"event\":\"fault_triggered\""));
    assert!(logs.contains("\"fault_id\":\"read_id_timeout\""));
    assert!(logs.contains("\"trigger\":\"operation_count\""));
    assert!(logs.contains("\"trigger_count\":1"));
    assert!(logs.contains("\"action\":\"timeout\""));
    assert!(logs.contains("\"result\":\"applied\""));
}
