use std::{env, fs, path::PathBuf, process::ExitCode, sync::Arc};

use tokio::net::UnixStream;
use vds_core::{
    clock::ManualClock,
    config::ServerConfig,
    device_package::{DeviceBusKind, DevicePackage},
};
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ServerResponse, SpiLaneWidth, SpiTransferRate,
        SpiTransferRequest, SpiWireConfig, client_request, server_response,
    },
};
use vds_scenario::{
    JUnitReportMetadata, RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor,
    to_junit_xml,
};

enum Arguments {
    SpiTransfer(SpiTransferArguments),
    ScenarioRun(ScenarioRunArguments),
    DevicePackageValidate(PathBuf),
    DevicePackageNew(DevicePackageNewArguments),
}

struct SpiTransferArguments {
    socket: PathBuf,
    device_id: String,
    tx: Vec<u8>,
    rx_length: u32,
    wire: SpiWireConfig,
}

struct ScenarioRunArguments {
    scenario: PathBuf,
    config: PathBuf,
    json_output: Option<PathBuf>,
    junit_output: Option<PathBuf>,
    run_id: String,
    revision: u64,
}

struct DevicePackageNewArguments {
    path: PathBuf,
    id: String,
    name: String,
    bus: DeviceBusKind,
}

impl Arguments {
    fn parse() -> Result<Self, String> {
        let mut args = env::args().skip(1);
        match args.next().as_deref() {
            Some("spi-transfer") => Self::parse_spi_transfer(args).map(Self::SpiTransfer),
            Some("scenario") if args.next().as_deref() == Some("run") => {
                Self::parse_scenario_run(args).map(Self::ScenarioRun)
            }
            Some("device-package") => match args.next().as_deref() {
                Some("validate") => args
                    .next()
                    .map(PathBuf::from)
                    .map(Self::DevicePackageValidate)
                    .ok_or_else(|| "package path is required".to_owned()),
                Some("new") => Self::parse_device_package_new(args).map(Self::DevicePackageNew),
                Some(command) => Err(format!("unknown device-package command: {command}")),
                None => Err("device-package command is required".to_owned()),
            },
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
        let mut rx_length = 0;
        let mut wire = SpiWireConfig {
            mode: 0,
            bits_per_word: 8,
            max_speed_hz: 0,
            command_width: SpiLaneWidth::Single.into(),
            address_width: SpiLaneWidth::Single.into(),
            data_width: SpiLaneWidth::Single.into(),
            rate: SpiTransferRate::Str.into(),
            dummy_cycles: 0,
            lsb_first: false,
        };
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--socket" => socket = args.next().map(PathBuf::from),
                "--device" => device_id = args.next(),
                "--tx" => tx = args.next().map(|value| parse_hex(&value)).transpose()?,
                "--rx-length" => {
                    rx_length = required_value(&mut args, "--rx-length")?
                        .parse()
                        .map_err(|_| "--rx-length must be an integer".to_owned())?;
                }
                "--mode" => {
                    wire.mode = required_value(&mut args, "--mode")?
                        .parse()
                        .map_err(|_| "--mode must be 0..3".to_owned())?;
                }
                "--bits" => {
                    wire.bits_per_word = required_value(&mut args, "--bits")?
                        .parse()
                        .map_err(|_| "--bits must be an integer".to_owned())?;
                }
                "--speed-hz" => {
                    wire.max_speed_hz = required_value(&mut args, "--speed-hz")?
                        .parse()
                        .map_err(|_| "--speed-hz must be an integer".to_owned())?;
                }
                "--command-width" => {
                    wire.command_width =
                        parse_lane(&required_value(&mut args, "--command-width")?)?;
                }
                "--address-width" => {
                    wire.address_width =
                        parse_lane(&required_value(&mut args, "--address-width")?)?;
                }
                "--data-width" => {
                    wire.data_width = parse_lane(&required_value(&mut args, "--data-width")?)?;
                }
                "--rate" => {
                    wire.rate = match required_value(&mut args, "--rate")?.as_str() {
                        "str" => SpiTransferRate::Str.into(),
                        "dtr" => SpiTransferRate::Dtr.into(),
                        _ => return Err("--rate must be str or dtr".to_owned()),
                    };
                }
                "--dummy-cycles" => {
                    wire.dummy_cycles = required_value(&mut args, "--dummy-cycles")?
                        .parse()
                        .map_err(|_| "--dummy-cycles must be an integer".to_owned())?;
                }
                "--lsb-first" => wire.lsb_first = true,
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }

        Ok(SpiTransferArguments {
            socket: socket.ok_or_else(|| "--socket is required".to_owned())?,
            device_id: device_id.ok_or_else(|| "--device is required".to_owned())?,
            tx: tx.ok_or_else(|| "--tx is required".to_owned())?,
            rx_length,
            wire,
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

    fn parse_device_package_new(
        mut args: impl Iterator<Item = String>,
    ) -> Result<DevicePackageNewArguments, String> {
        let path = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| "package path is required".to_owned())?;
        let mut id = None;
        let mut name = None;
        let mut bus = None;
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--id" => id = args.next(),
                "--name" => name = args.next(),
                "--bus" => bus = args.next().map(|value| parse_bus(&value)).transpose()?,
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }
        Ok(DevicePackageNewArguments {
            path,
            id: id.ok_or_else(|| "--id is required".to_owned())?,
            name: name.ok_or_else(|| "--name is required".to_owned())?,
            bus: bus.ok_or_else(|| "--bus is required".to_owned())?,
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
        Arguments::DevicePackageValidate(path) => match validate_device_package(&path) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("error: {error}");
                ExitCode::FAILURE
            }
        },
        Arguments::DevicePackageNew(arguments) => match create_device_package(&arguments) {
            Ok(()) => ExitCode::SUCCESS,
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
            wire: Some(arguments.wire),
            rx_length: arguments.rx_length,
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

fn validate_device_package(path: &PathBuf) -> Result<(), String> {
    let package = DevicePackage::load(path).map_err(|error| error.to_string())?;
    let manifest = package.manifest();
    println!(
        "valid DevicePackage: {} {} ({}, driver {})",
        manifest.metadata.id,
        manifest.metadata.version,
        manifest.spec.bus.kind.as_str(),
        manifest.spec.runtime.driver
    );
    println!("model: {}", package.model_path().display());
    println!(
        "scenarios: {}",
        package
            .scenario_paths()
            .map_err(|error| error.to_string())?
            .len()
    );
    println!(
        "behavior flow: {}",
        package
            .behavior_flow_path()
            .map_or_else(|| "none".to_owned(), |path| path.display().to_string())
    );
    Ok(())
}

fn create_device_package(arguments: &DevicePackageNewArguments) -> Result<(), String> {
    if arguments.path.exists() {
        return Err(format!(
            "target package directory '{}' already exists",
            arguments.path.display()
        ));
    }
    for directory in ["model", "flows", "scenarios", "fixtures", "docs", "assets"] {
        fs::create_dir_all(arguments.path.join(directory))
            .map_err(|error| format!("failed to create package directory: {error}"))?;
    }
    let driver = match arguments.bus {
        DeviceBusKind::Spi => "generic-spi-command",
        DeviceBusKind::I2c => "generic-i2c-register",
        DeviceBusKind::Gpio => "generic-gpio-bank",
        DeviceBusKind::Ethernet => "generic-ethernet-endpoint",
        DeviceBusKind::Uart => "generic-uart-stream",
        DeviceBusKind::Can => "generic-can-node",
        DeviceBusKind::Usb => "generic-usb-function",
        DeviceBusKind::Custom => "custom-runtime",
    };
    let quoted_name = serde_json::to_string(&arguments.name).map_err(|error| error.to_string())?;
    let manifest = format!(
        "api_version: vds4e.dev/v1alpha1\nkind: DevicePackage\nmetadata:\n  id: {}\n  display_name: {}\n  version: 0.1.0\n  description: \"\"\n  license: Apache-2.0\n  authors: []\n  tags: [{}]\nspec:\n  bus:\n    type: {}\n    options: {{}}\n  runtime:\n    driver: {}\n    model: model/device.yaml\n  validation:\n    scenarios: scenarios\n    fixtures: fixtures\n  documentation: docs\n  assets: assets\n  extensions: {{}}\n",
        arguments.id,
        quoted_name,
        arguments.bus.as_str(),
        arguments.bus.as_str(),
        driver
    );
    fs::write(arguments.path.join("device-package.yaml"), manifest)
        .map_err(|error| format!("failed to write package manifest: {error}"))?;
    let model = format!(
        "# Implement the {} runtime model contract for this package.\nschema_version: 1\ndevice:\n  id: {}\n  name: {}\n  bus: {}\n  model: {}\n  commands: []\n",
        arguments.bus.as_str(),
        arguments.id,
        quoted_name,
        arguments.bus.as_str(),
        driver
    );
    fs::write(arguments.path.join("model/device.yaml"), model)
        .map_err(|error| format!("failed to write model template: {error}"))?;
    fs::write(
        arguments.path.join("README.md"),
        format!(
            "# {}\n\nPortable VDS4E {} device package.\n",
            arguments.name,
            arguments.bus.as_str().to_uppercase()
        ),
    )
    .map_err(|error| format!("failed to write package README: {error}"))?;
    println!("created {}", arguments.path.display());
    println!(
        "next: vds-cli device-package validate {}",
        arguments.path.display()
    );
    Ok(())
}

fn parse_bus(value: &str) -> Result<DeviceBusKind, String> {
    match value.to_ascii_lowercase().as_str() {
        "spi" => Ok(DeviceBusKind::Spi),
        "i2c" => Ok(DeviceBusKind::I2c),
        "gpio" => Ok(DeviceBusKind::Gpio),
        "ethernet" | "eth" => Ok(DeviceBusKind::Ethernet),
        "uart" => Ok(DeviceBusKind::Uart),
        "can" => Ok(DeviceBusKind::Can),
        "usb" => Ok(DeviceBusKind::Usb),
        "custom" => Ok(DeviceBusKind::Custom),
        _ => Err(format!(
            "unsupported bus '{value}'; expected spi, i2c, gpio, ethernet, uart, can, usb, or custom"
        )),
    }
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

fn parse_lane(value: &str) -> Result<i32, String> {
    match value {
        "1" | "single" => Ok(SpiLaneWidth::Single.into()),
        "2" | "dual" => Ok(SpiLaneWidth::Dual.into()),
        "4" | "quad" => Ok(SpiLaneWidth::Quad.into()),
        _ => Err("SPI lane width must be single/1, dual/2, or quad/4".to_owned()),
    }
}

fn print_usage() {
    println!(
        "vds-cli\n\nUSAGE:\n    vds-cli spi-transfer --socket PATH --device ID --tx HEX [--rx-length N] [--mode 0..3] [--bits N] [--speed-hz HZ] [--command-width 1|2|4] [--address-width 1|2|4] [--data-width 1|2|4] [--rate str|dtr] [--dummy-cycles N] [--lsb-first]\n    vds-cli scenario run SCENARIO [--config PATH] [--json-output PATH] [--junit-output PATH] [--run-id ID] [--revision N]\n    vds-cli device-package validate PATH\n    vds-cli device-package new PATH --id ID --name NAME --bus BUS"
    );
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        DeviceBusKind, DevicePackage, DevicePackageNewArguments, ScenarioRunArguments,
        create_device_package, parse_hex, run_scenario,
    };
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
    fn scaffolds_a_valid_package_for_every_supported_bus() {
        let parent = std::env::temp_dir().join(format!(
            "vds4e-device-package-scaffold-{}",
            std::process::id()
        ));
        for bus in [
            DeviceBusKind::Spi,
            DeviceBusKind::I2c,
            DeviceBusKind::Gpio,
            DeviceBusKind::Ethernet,
            DeviceBusKind::Uart,
            DeviceBusKind::Can,
            DeviceBusKind::Usb,
            DeviceBusKind::Custom,
        ] {
            let id = format!("example-{}", bus.as_str());
            let path = parent.join(bus.as_str());
            create_device_package(&DevicePackageNewArguments {
                path: path.clone(),
                id: id.clone(),
                name: format!("Example {}", bus.as_str()),
                bus,
            })
            .expect("scaffold");
            let package = DevicePackage::load(path).expect("generated package");
            assert_eq!(package.manifest().metadata.id, id);
            assert_eq!(package.manifest().spec.bus.kind, bus);
        }
        fs::remove_dir_all(parent).expect("cleanup");
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
                "schema_version: 1\nserver: {{ control_address: '127.0.0.1:0' }}\ndata_plane: {{ unix_socket: /tmp/vds4e-cli-test.sock }}\nobservability: {{ log_level: info }}\ndevice_packages: ['{}']\n",
                root.join("device-models/examples/generic-spi-flash").display()
            ),
        )
        .unwrap();
        let status = run_scenario(&ScenarioRunArguments {
            scenario: root
                .join("device-models/examples/generic-spi-flash/scenarios/01-read-id.yaml"),
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
