use std::{env, fs, path::PathBuf, process::ExitCode, sync::Arc};

use tokio::net::UnixStream;
use vds_core::{clock::ManualClock, config::ServerConfig};
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ServerResponse, SpiTransferRequest, client_request,
        server_response,
    },
};
use vds_scenario::{
    JUnitReportMetadata, RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor,
    to_junit_xml,
};

enum Arguments {
    SpiTransfer(SpiTransferArguments),
    ScenarioRun(ScenarioRunArguments),
}

struct SpiTransferArguments {
    socket: PathBuf,
    device_id: String,
    tx: Vec<u8>,
}

struct ScenarioRunArguments {
    scenario: PathBuf,
    config: PathBuf,
    json_output: Option<PathBuf>,
    junit_output: Option<PathBuf>,
    run_id: String,
    revision: u64,
}

impl Arguments {
    fn parse() -> Result<Self, String> {
        let mut args = env::args().skip(1);
        match args.next().as_deref() {
            Some("spi-transfer") => Self::parse_spi_transfer(args).map(Self::SpiTransfer),
            Some("scenario") if args.next().as_deref() == Some("run") => {
                Self::parse_scenario_run(args).map(Self::ScenarioRun)
            }
            Some("--help" | "-h") | None => Err(String::new()),
            Some(command) => Err(format!("unknown command: {command}")),
        }
    }

    fn parse_spi_transfer(
        mut args: impl Iterator<Item = String>,
    ) -> Result<SpiTransferArguments, String> {
        let mut socket = None;
        let mut device_id = None;
        let mut tx = None;
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--socket" => socket = args.next().map(PathBuf::from),
                "--device" => device_id = args.next(),
                "--tx" => tx = args.next().map(|value| parse_hex(&value)).transpose()?,
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }

        Ok(SpiTransferArguments {
            socket: socket.ok_or_else(|| "--socket is required".to_owned())?,
            device_id: device_id.ok_or_else(|| "--device is required".to_owned())?,
            tx: tx.ok_or_else(|| "--tx is required".to_owned())?,
        })
    }

    fn parse_scenario_run(
        mut args: impl Iterator<Item = String>,
    ) -> Result<ScenarioRunArguments, String> {
        let scenario = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| "scenario path is required".to_owned())?;
        let mut config = PathBuf::from("config/vds-server.yaml");
        let mut json_output = None;
        let mut junit_output = None;
        let mut run_id = "cli".to_owned();
        let mut revision = 1_u64;
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--config" => config = PathBuf::from(required_value(&mut args, "--config")?),
                "--json-output" => {
                    json_output = Some(PathBuf::from(required_value(&mut args, "--json-output")?));
                }
                "--junit-output" => {
                    junit_output =
                        Some(PathBuf::from(required_value(&mut args, "--junit-output")?));
                }
                "--run-id" => run_id = required_value(&mut args, "--run-id")?,
                "--revision" => {
                    revision = required_value(&mut args, "--revision")?
                        .parse()
                        .map_err(|_| "--revision must be a positive integer".to_owned())?;
                    if revision == 0 {
                        return Err("--revision must be a positive integer".to_owned());
                    }
                }
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }
        Ok(ScenarioRunArguments {
            scenario,
            config,
            json_output,
            junit_output,
            run_id,
            revision,
        })
    }
}

fn required_value(args: &mut impl Iterator<Item = String>, option: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{option} requires a value"))
}

#[tokio::main]
async fn main() -> ExitCode {
    let arguments = match Arguments::parse() {
        Ok(arguments) => arguments,
        Err(message) if message.is_empty() => {
            print_usage();
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("error: {message}");
            print_usage();
            return ExitCode::from(2);
        }
    };

    match arguments {
        Arguments::SpiTransfer(arguments) => match transfer(arguments).await {
            Ok(rx) => {
                println!("RX: {}", format_hex(&rx));
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::FAILURE
            }
        },
        Arguments::ScenarioRun(arguments) => match run_scenario(&arguments) {
            Ok(ResultStatus::Passed) => ExitCode::SUCCESS,
            Ok(_) => ExitCode::FAILURE,
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::FAILURE
            }
        },
    }
}

async fn transfer(arguments: SpiTransferArguments) -> Result<Vec<u8>, String> {
    let mut stream = UnixStream::connect(&arguments.socket)
        .await
        .map_err(|error| {
            format!(
                "failed to connect to {}: {error}",
                arguments.socket.display()
            )
        })?;
    let request = ClientRequest {
        request_id: 1,
        payload: Some(client_request::Payload::SpiTransfer(SpiTransferRequest {
            device_id: arguments.device_id,
            tx: arguments.tx,
        })),
    };
    write_message(&mut stream, &request)
        .await
        .map_err(|error| format!("failed to send request: {error}"))?;
    let response: ServerResponse = read_message(&mut stream)
        .await
        .map_err(|error| format!("failed to read response: {error}"))?;
    if response.request_id != request.request_id {
        return Err(format!(
            "response request id {} does not match {}",
            response.request_id, request.request_id
        ));
    }

    match response.result {
        Some(server_response::Result::SpiTransfer(response)) => Ok(response.rx),
        Some(server_response::Result::Error(error)) => {
            let code = ErrorCode::try_from(error.code).unwrap_or(ErrorCode::Unspecified);
            Err(format!("server returned {code:?}: {}", error.message))
        }
        None => Err("server response has no result".to_owned()),
    }
}

fn run_scenario(arguments: &ScenarioRunArguments) -> Result<ResultStatus, String> {
    let yaml = fs::read_to_string(&arguments.scenario).map_err(|error| {
        format!(
            "failed to read scenario '{}': {error}",
            arguments.scenario.display()
        )
    })?;
    let document = ScenarioDocument::from_yaml(&yaml).map_err(|error| error.to_string())?;
    let config = ServerConfig::load(&arguments.config).map_err(|error| error.to_string())?;
    let clock = Arc::new(ManualClock::default());
    let registry = vds_server::load_registry_with_clock(&config, clock.clone())
        .map_err(|error| error.to_string())?;
    let runtime = RegistryRuntime::new(Arc::new(registry), clock);
    let result = ScenarioExecutor::new(runtime).run(&document);
    let json = format!(
        "{}\n",
        result.to_json_pretty().map_err(|error| error.to_string())?
    );
    if let Some(path) = &arguments.json_output {
        fs::write(path, &json)
            .map_err(|error| format!("failed to write JSON '{}': {error}", path.display()))?;
    }
    let junit = to_junit_xml(
        &result,
        JUnitReportMetadata {
            run_id: &arguments.run_id,
            scenario_revision: arguments.revision,
        },
    );
    if let Some(path) = &arguments.junit_output {
        fs::write(path, junit)
            .map_err(|error| format!("failed to write JUnit XML '{}': {error}", path.display()))?;
    }
    if arguments.json_output.is_none() && arguments.junit_output.is_none() {
        print!("{json}");
    }
    Ok(result.status)
}

fn parse_hex(value: &str) -> Result<Vec<u8>, String> {
    let normalized = value
        .replace("0x", "")
        .replace("0X", "")
        .replace([',', ':', '-'], " ");
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err("--tx must contain at least one byte".to_owned());
    }

    if tokens.len() == 1 && tokens[0].len() > 2 {
        let token = tokens[0];
        if token.len() % 2 != 0 {
            return Err(format!("hex value '{token}' has an odd number of digits"));
        }
        return (0..token.len())
            .step_by(2)
            .map(|index| parse_byte(&token[index..index + 2]))
            .collect();
    }

    tokens.into_iter().map(parse_byte).collect()
}

fn parse_byte(value: &str) -> Result<u8, String> {
    u8::from_str_radix(value, 16).map_err(|_| format!("invalid hex byte '{value}'"))
}

fn format_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_usage() {
    println!(
        "vds-cli\n\nUSAGE:\n    vds-cli spi-transfer --socket PATH --device ID --tx HEX\n    vds-cli scenario run SCENARIO [--config PATH] [--json-output PATH] [--junit-output PATH] [--run-id ID] [--revision N]"
    );
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{ScenarioRunArguments, parse_hex, run_scenario};
    use vds_scenario::ResultStatus;

    #[test]
    fn parses_compact_and_separated_hex() {
        assert_eq!(parse_hex("9F").expect("hex should parse"), vec![0x9f]);
        assert_eq!(
            parse_hex("EF 40 18").expect("hex should parse"),
            vec![0xef, 0x40, 0x18]
        );
        assert_eq!(
            parse_hex("0xEF,0x40,0x18").expect("hex should parse"),
            vec![0xef, 0x40, 0x18]
        );
    }

    #[test]
    fn scenario_command_writes_json_and_junit_files() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let directory =
            std::env::temp_dir().join(format!("vds4e-cli-junit-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let json = directory.join("result.json");
        let junit = directory.join("result.xml");
        let config = directory.join("vds-server.yaml");
        fs::write(
            &config,
            format!(
                "schema_version: 1\nserver: {{ control_address: '127.0.0.1:0' }}\ndata_plane: {{ unix_socket: /tmp/vds4e-cli-test.sock }}\nobservability: {{ log_level: info }}\ndevice_models: ['{}']\n",
                root.join("device-models/examples/spi-flash.yaml").display()
            ),
        )
        .unwrap();
        let status = run_scenario(&ScenarioRunArguments {
            scenario: root.join("scenarios/examples/delayed-write-with-timeout.yaml"),
            config,
            json_output: Some(json.clone()),
            junit_output: Some(junit.clone()),
            run_id: "cli-test".to_owned(),
            revision: 3,
        })
        .unwrap();
        assert_eq!(status, ResultStatus::Passed);
        assert!(
            fs::read_to_string(json)
                .unwrap()
                .contains("\"status\": \"passed\"")
        );
        let xml = fs::read_to_string(junit).unwrap();
        assert!(xml.contains("name=\"vds4e.run_id\" value=\"cli-test\""));
        assert!(xml.contains("name=\"vds4e.scenario_revision\" value=\"3\""));
        fs::remove_dir_all(directory).unwrap();
    }
}
