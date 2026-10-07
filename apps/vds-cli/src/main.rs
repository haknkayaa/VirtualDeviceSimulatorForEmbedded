use std::{env, fmt::Write as _, fs, path::PathBuf, process::ExitCode, sync::Arc};

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
    ImportDts(ImportDtsArguments),
}

struct ImportDtsArguments {
    source: PathBuf,
    output: PathBuf,
    include_disabled: bool,
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
            Some("import") => match args.next().as_deref() {
                Some("dts") => Self::parse_import_dts(args).map(Self::ImportDts),
                Some(command) => Err(format!("unknown import command: {command}")),
                None => Err("import command is required".to_owned()),
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

    fn parse_import_dts(
        mut args: impl Iterator<Item = String>,
    ) -> Result<ImportDtsArguments, String> {
        let source = args
            .next()
            .map(PathBuf::from)
            .ok_or_else(|| "Device Tree source path is required".to_owned())?;
        let mut output = None;
        let mut include_disabled = false;
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--output" => output = Some(PathBuf::from(required_value(&mut args, "--output")?)),
                "--include-disabled" => include_disabled = true,
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }
        Ok(ImportDtsArguments {
            source,
            output: output.ok_or_else(|| "--output is required".to_owned())?,
            include_disabled,
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
        Arguments::ImportDts(arguments) => match import_dts(&arguments) {
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
        Some(
            server_response::Result::GpioExchange(_)
            | server_response::Result::I2cTransfer(_)
            | server_response::Result::UartTransfer(_),
        ) => Err("server returned a response for a different bus".to_owned()),
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
    let coverage = vds_server::load_coverage_targets(&config).map_err(|error| error.to_string())?;
    let runtime = RegistryRuntime::new(Arc::new(registry), clock);
    let result = ScenarioExecutor::new(runtime)
        .with_coverage(Arc::new(coverage))
        .run(&document);
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
    for line in coverage_summary(&result) {
        eprintln!("{line}");
    }
    Ok(result.status)
}

/// One `coverage <device>: commands 3/21, registers 1/9, …` line per device.
fn coverage_summary(result: &vds_scenario::ScenarioResult) -> Vec<String> {
    result
        .coverage
        .iter()
        .flat_map(|coverage| coverage.devices.iter())
        .map(|device| {
            let metrics = device
                .metrics()
                .iter()
                .map(|(name, metric)| format!("{name} {}/{}", metric.covered, metric.total))
                .collect::<Vec<_>>()
                .join(", ");
            format!("coverage {}: {metrics}", device.device_id)
        })
        .collect()
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
    let quoted_name = serde_json::to_string(&arguments.name).map_err(|error| error.to_string())?;
    let model = format!(
        "# Implement the {} runtime model contract for this package.\nschema_version: 1\ndevice:\n  id: {}\n  name: {}\n  bus: {}\n  model: {}\n  commands: []\n",
        arguments.bus.as_str(),
        arguments.id,
        quoted_name,
        arguments.bus.as_str(),
        package_driver(arguments.bus)
    );
    write_device_package(arguments, &model)?;
    println!("created {}", arguments.path.display());
    println!(
        "next: vds-cli device-package validate {}",
        arguments.path.display()
    );
    Ok(())
}

/// Runtime driver the scaffold declares for a bus.
const fn package_driver(bus: DeviceBusKind) -> &'static str {
    match bus {
        DeviceBusKind::Spi => "generic-spi-command",
        DeviceBusKind::I2c => "generic-i2c-register",
        DeviceBusKind::Gpio => "generic-gpio-bank",
        DeviceBusKind::Ethernet => "generic-ethernet-endpoint",
        DeviceBusKind::Uart => "generic-uart-stream",
        DeviceBusKind::Can => "generic-can-node",
        DeviceBusKind::Usb => "generic-usb-function",
        DeviceBusKind::Custom => "custom-runtime",
    }
}

/// Writes the package layout, manifest, README and the given model YAML.
fn write_device_package(arguments: &DevicePackageNewArguments, model: &str) -> Result<(), String> {
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
    let quoted_name = serde_json::to_string(&arguments.name).map_err(|error| error.to_string())?;
    let manifest = format!(
        "api_version: vds4e.dev/v1alpha1\nkind: DevicePackage\nmetadata:\n  id: {}\n  display_name: {}\n  version: 0.1.0\n  description: \"\"\n  license: Apache-2.0\n  authors: []\n  tags: [{}]\nspec:\n  bus:\n    type: {}\n    options: {{}}\n  runtime:\n    driver: {}\n    model: model/device.yaml\n  validation:\n    scenarios: scenarios\n    fixtures: fixtures\n  documentation: docs\n  assets: assets\n  extensions: {{}}\n",
        arguments.id,
        quoted_name,
        arguments.bus.as_str(),
        arguments.bus.as_str(),
        package_driver(arguments.bus)
    );
    fs::write(arguments.path.join("device-package.yaml"), manifest)
        .map_err(|error| format!("failed to write package manifest: {error}"))?;
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
    Ok(())
}

/// One imported Device Tree node and where its draft package went.
struct ImportedStub {
    id: String,
    bus: DeviceBusKind,
    bus_name: String,
    /// SPI chip select, I2C address, or GPIO line count, ready to print.
    endpoint: String,
    compatible: String,
    interrupts: String,
}

/// Peripheral `irq` output wired to a GPIO bank line, by package ID.
struct ImportedWire {
    device: String,
    bank: String,
    line: u32,
}

const DRAFT_HEADER: &str = "# The behavior below is a placeholder: review commands, registers and states\n# against the datasheet before relying on this model.\n";

/// Package IDs handed out so far, and draft ID (or GPIO controller) -> package ID.
#[derive(Default)]
struct DraftIds {
    used: std::collections::BTreeSet<String>,
    by_draft: std::collections::BTreeMap<String, String>,
}

/// Drafts one device package per supported, enabled Device Tree peripheral, a
/// GPIO bank and `topology.yaml` for interrupts routed to GPIO controllers, and
/// verifies that the server can load the result.
fn import_dts(arguments: &ImportDtsArguments) -> Result<(), String> {
    let board =
        vds_importer::import_dts_file(&arguments.source).map_err(|error| error.to_string())?;
    if arguments
        .output
        .read_dir()
        .is_ok_and(|mut entries| entries.next().is_some())
    {
        return Err(format!(
            "output directory '{}' is not empty",
            arguments.output.display()
        ));
    }
    fs::create_dir_all(&arguments.output)
        .map_err(|error| format!("failed to create output directory: {error}"))?;
    let interrupts = board.gpio_interrupts();
    let mut ids = DraftIds::default();
    let (mut imported, skipped) = draft_peripherals(arguments, &board, &interrupts, &mut ids)?;
    let wired = interrupts
        .into_iter()
        .filter(|interrupt| ids.by_draft.contains_key(&interrupt.device_id))
        .collect::<Vec<_>>();
    imported.extend(draft_interrupt_banks(
        &arguments.output,
        &board,
        &wired,
        &mut ids,
    )?);
    let topology = if wired.is_empty() {
        None
    } else {
        let path = arguments.output.join("topology.yaml");
        fs::write(
            &path,
            vds_importer::interrupt_topology_yaml(&wired, &ids.by_draft),
        )
        .map_err(|error| format!("failed to write topology draft: {error}"))?;
        Some(path)
    };
    let connections = wired
        .iter()
        .filter_map(|interrupt| {
            Some(ImportedWire {
                device: ids.by_draft.get(&interrupt.device_id)?.clone(),
                bank: ids.by_draft.get(&interrupt.controller)?.clone(),
                line: interrupt.line,
            })
        })
        .collect::<Vec<_>>();

    verify_imported_packages(&arguments.output, &imported, topology.as_deref())?;
    let controllers = board
        .buses
        .iter()
        .map(|bus| format!("{} ({})", bus.name, bus.bus_type))
        .collect::<Vec<_>>();
    let summary = board_summary(
        &BoardSummary {
            board: &board.name,
            source: &arguments.source,
            output: &arguments.output,
            controllers: &controllers,
            topology: topology.as_deref(),
        },
        &imported,
        &connections,
        &skipped,
    );
    fs::write(arguments.output.join("board.md"), summary)
        .map_err(|error| format!("failed to write board summary: {error}"))?;
    println!(
        "imported {} device package draft(s) from {} into {}",
        imported.len(),
        arguments.source.display(),
        arguments.output.display()
    );
    for stub in &imported {
        println!("  {} ({}, {})", stub.id, stub.bus.as_str(), stub.endpoint);
    }
    for connection in &connections {
        println!(
            "  wired {}.{} -> {}.GPIO{}",
            connection.device,
            vds_importer::IRQ_SIGNAL,
            connection.bank,
            connection.line
        );
    }
    for reason in &skipped {
        println!("  skipped {reason}");
    }
    println!("review {}", arguments.output.join("board.md").display());
    Ok(())
}

/// Writes a package per enabled peripheral on a supported bus; returns the
/// drafts and the reasons other nodes were skipped.
fn draft_peripherals(
    arguments: &ImportDtsArguments,
    board: &vds_importer::VirtualBoardDraft,
    interrupts: &[vds_importer::GpioInterruptDraft],
    ids: &mut DraftIds,
) -> Result<(Vec<ImportedStub>, Vec<String>), String> {
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    for stub in &board.devices {
        let enabled = matches!(stub.status.as_str(), "okay" | "ok");
        if !enabled && !arguments.include_disabled {
            skipped.push(format!("{}: status \"{}\"", stub.id, stub.status));
            continue;
        }
        let bus = match stub.bus_type {
            vds_importer::BusType::Spi => DeviceBusKind::Spi,
            vds_importer::BusType::I2c => DeviceBusKind::I2c,
            vds_importer::BusType::Gpio => DeviceBusKind::Gpio,
            other => {
                skipped.push(format!(
                    "{}: no VDS4E runtime draft for bus {other}",
                    stub.id
                ));
                continue;
            }
        };
        let id = unique_package_id(&mut ids.used, &stub.id, &stub.bus_name);
        let mut draft = stub.clone();
        draft.id.clone_from(&id);
        let mut model = draft.to_device_model().map_err(|error| error.to_string())?;
        if interrupts
            .iter()
            .any(|interrupt| interrupt.device_id == stub.id)
        {
            vds_importer::add_interrupt_output(&mut model);
        }
        let header = format!(
            "# Draft generated by `vds-cli import dts` for {} on {}.\n{DRAFT_HEADER}",
            stub.name, stub.bus_name
        );
        write_draft_package(&arguments.output, &id, &stub.name, bus, &header, &model)?;
        ids.by_draft.insert(stub.id.clone(), id.clone());
        imported.push(ImportedStub {
            endpoint: match (bus, stub.address) {
                (DeviceBusKind::Spi, Some(address)) => format!("chip select {address}"),
                (DeviceBusKind::I2c, Some(address)) => format!("address {address:#04x}"),
                (_, Some(address)) => format!("reg {address:#x}"),
                (_, None) => "no reg".to_owned(),
            },
            id,
            bus,
            bus_name: stub.bus_name.clone(),
            compatible: stub.compatible.join(", "),
            interrupts: interrupt_summary(&stub.interrupts, stub.interrupt_parent.as_deref()),
        });
    }
    Ok((imported, skipped))
}

/// Writes a GPIO bank draft per controller that receives a wired interrupt,
/// with those lines driven by the device.
fn draft_interrupt_banks(
    output: &std::path::Path,
    board: &vds_importer::VirtualBoardDraft,
    wired: &[vds_importer::GpioInterruptDraft],
    ids: &mut DraftIds,
) -> Result<Vec<ImportedStub>, String> {
    let mut lines = std::collections::BTreeMap::<String, std::collections::BTreeSet<u32>>::new();
    for interrupt in wired {
        lines
            .entry(interrupt.controller.clone())
            .or_default()
            .insert(interrupt.line);
    }
    let mut banks = Vec::new();
    for (controller, driven) in &lines {
        let id = unique_package_id(&mut ids.used, controller, "bank");
        let model = board.gpio_bank_model(controller, &id, driven);
        let count = model
            .device
            .gpio
            .as_ref()
            .map_or(0, |gpio| gpio.lines.len());
        let name = model.device.name.clone();
        let header = format!(
            "# Draft generated by `vds-cli import dts` for GPIO controller {controller}.\n# Lines that carry peripheral interrupts are outputs driven through topology.yaml.\n"
        );
        write_draft_package(output, &id, &name, DeviceBusKind::Gpio, &header, &model)?;
        ids.by_draft.insert(controller.clone(), id.clone());
        banks.push(ImportedStub {
            id,
            bus: DeviceBusKind::Gpio,
            bus_name: controller.clone(),
            endpoint: format!("{count} lines"),
            compatible: String::new(),
            interrupts: String::new(),
        });
    }
    Ok(banks)
}

/// A package ID not used yet; on collision the `qualifier` is prefixed.
fn unique_package_id(
    used: &mut std::collections::BTreeSet<String>,
    raw: &str,
    qualifier: &str,
) -> String {
    let mut id = package_id(raw);
    if used.contains(&id) {
        id = package_id(&format!("{qualifier}-{raw}"));
    }
    let base = id.clone();
    let mut suffix = 2;
    while used.contains(&id) {
        id = format!("{base}-{suffix}");
        suffix += 1;
    }
    used.insert(id.clone());
    id
}

fn write_draft_package(
    output: &std::path::Path,
    id: &str,
    name: &str,
    bus: DeviceBusKind,
    header: &str,
    model: &vds_importer::DeviceModel,
) -> Result<(), String> {
    let yaml = vds_importer::export_model_yaml(model).map_err(|error| error.to_string())?;
    write_device_package(
        &DevicePackageNewArguments {
            path: output.join(id),
            id: id.to_owned(),
            name: name.to_owned(),
            bus,
        },
        &format!("{header}{yaml}"),
    )
}

/// Lower-case package ID allowed by the manifest schema (`^[a-z0-9][a-z0-9-]*$`).
fn package_id(raw: &str) -> String {
    let mut id = String::new();
    for character in raw.chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character.to_ascii_lowercase());
        } else if !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    let id = id.trim_end_matches('-').to_owned();
    if id.is_empty() {
        "device".to_owned()
    } else {
        id
    }
}

/// `12 2 (parent gpio0)` from interrupt cells and the interrupt parent.
fn interrupt_summary(interrupts: &[u32], parent: Option<&str>) -> String {
    let cells = interrupts
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(" ");
    match parent {
        Some(parent) if !cells.is_empty() => {
            format!("{cells} (parent {})", parent.trim_start_matches('&'))
        }
        _ => cells,
    }
}

/// Loads every draft, and the topology draft when there is one, exactly as the
/// server would, so a broken draft fails here.
fn verify_imported_packages(
    output: &std::path::Path,
    imported: &[ImportedStub],
    topology: Option<&std::path::Path>,
) -> Result<(), String> {
    if imported.is_empty() {
        return Ok(());
    }
    let packages = imported
        .iter()
        .map(|stub| {
            output
                .join(&stub.id)
                .canonicalize()
                .map(|path| format!("'{}'", path.display()))
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let topology = topology
        .map(|path| {
            path.canonicalize()
                .map(|path| format!("topology: '{}'\n", path.display()))
                .map_err(|error| error.to_string())
        })
        .transpose()?
        .unwrap_or_default();
    let config = ServerConfig::from_yaml(&format!(
        "schema_version: 1\nserver: {{ control_address: '127.0.0.1:0' }}\ndata_plane: {{ unix_socket: /tmp/vds4e-import-check.sock }}\nobservability: {{ log_level: info }}\ndevice_packages: [{}]\n{topology}",
        packages.join(", ")
    ))
    .map_err(|error| error.to_string())?;
    vds_server::load_registry_with_clock(&config, Arc::new(ManualClock::default()))
        .map(|_| ())
        .map_err(|error| format!("generated drafts do not load: {error}"))
}

struct BoardSummary<'a> {
    board: &'a str,
    source: &'a std::path::Path,
    output: &'a std::path::Path,
    controllers: &'a [String],
    topology: Option<&'a std::path::Path>,
}

fn board_summary(
    summary: &BoardSummary<'_>,
    imported: &[ImportedStub],
    wires: &[ImportedWire],
    skipped: &[String],
) -> String {
    let BoardSummary {
        board,
        source,
        output,
        controllers,
        topology,
    } = summary;
    let mut text = format!(
        "# {board}\n\nDevice package drafts imported from `{}` by `vds-cli import dts`.\nEach model is a placeholder that loads in VDS4E; replace its commands,\nregisters and behavior with the device's datasheet semantics.\n\n| Package | Bus | Controller | Endpoint | Compatible | Interrupts |\n| --- | --- | --- | --- | --- | --- |\n",
        source.display()
    );
    for stub in imported {
        let compatible = if stub.compatible.is_empty() {
            "—"
        } else {
            &stub.compatible
        };
        let interrupts = if stub.interrupts.is_empty() {
            "—"
        } else {
            &stub.interrupts
        };
        writeln!(
            text,
            "| `{}` | {} | {} | {} | {compatible} | {interrupts} |",
            stub.id,
            stub.bus.as_str(),
            stub.bus_name,
            stub.endpoint,
        )
        .expect("writing to String cannot fail");
    }
    if !controllers.is_empty() {
        writeln!(
            text,
            "\nBus controllers found: {}. VDS4E exposes them through host adapters.",
            controllers.join(", ")
        )
        .expect("writing to String cannot fail");
    }
    if !wires.is_empty() {
        text.push_str("\n## Interrupt wiring\n\n`topology.yaml` connects each interrupt to the GPIO line the Device Tree\nnames. The peripheral's `irq` output follows bit 0 of its draft `IRQ_STATE`\nregister; write 1 to it to assert the line, then replace the binding with the\ndevice's real interrupt condition.\n\n");
        for wire in wires {
            writeln!(
                text,
                "- `{}.{}` → `{}.GPIO{}`",
                wire.device,
                vds_importer::IRQ_SIGNAL,
                wire.bank,
                wire.line
            )
            .expect("writing to String cannot fail");
        }
    }
    if !skipped.is_empty() {
        text.push_str("\n## Skipped nodes\n\n");
        for reason in skipped {
            writeln!(text, "- {reason}").expect("writing to String cannot fail");
        }
    }
    text.push_str("\n## Next steps\n\n1. Review each `model/device.yaml` and add scenarios.\n2. Add the drafts to `vds-server.yaml`:\n\n```yaml\ndevice_packages:\n");
    for stub in imported {
        writeln!(text, "  - {}", output.join(&stub.id).display())
            .expect("writing to String cannot fail");
    }
    if let Some(topology) = topology {
        writeln!(text, "topology: {}", topology.display()).expect("writing to String cannot fail");
    }
    text.push_str("```\n\n3. Bind each device to a host adapter at the endpoint above (SPI chip select\n   or I2C address) so the application reaches it through `/dev/spidevX.Y`,\n   `/dev/i2c-N` or `/dev/gpiochipN`.\n");
    text
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
        "vds-cli\n\nUSAGE:\n    vds-cli spi-transfer --socket PATH --device ID --tx HEX [--rx-length N] [--mode 0..3] [--bits N] [--speed-hz HZ] [--command-width 1|2|4] [--address-width 1|2|4] [--data-width 1|2|4] [--rate str|dtr] [--dummy-cycles N] [--lsb-first]\n    vds-cli scenario run SCENARIO [--config PATH] [--json-output PATH] [--junit-output PATH] [--run-id ID] [--revision N]\n    vds-cli device-package validate PATH\n    vds-cli device-package new PATH --id ID --name NAME --bus BUS\n    vds-cli import dts SOURCE.dts --output DIR [--include-disabled]"
    );
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        DeviceBusKind, DevicePackage, DevicePackageNewArguments, ImportDtsArguments,
        ScenarioRunArguments, create_device_package, import_dts, package_id, parse_hex,
        run_scenario,
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
                root.join("device-models/examples/micron-mt25ql256aba8esf-0sit").display()
            ),
        )
        .unwrap();
        let status = run_scenario(&ScenarioRunArguments {
            scenario: root
                .join("device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios/01-read-jedec-id.yaml"),
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
        assert!(xml.contains(
            "name=\"vds4e.coverage.micron-mt25ql256aba8esf-0sit.commands\" value=\"1/21\""
        ));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn dts_import_drafts_loadable_packages_and_a_board_summary() {
        let directory = std::env::temp_dir().join(format!("vds4e-cli-dts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let source = directory.join("board.dts");
        fs::write(
            &source,
            r#"
/dts-v1/;
/ {
    model = "Carrier";
};
&i2c1 {
    status = "okay";
    temp: bme280@76 {
        compatible = "bosch,bme280";
        reg = <0x76>;
        interrupt-parent = <&gpio0>;
        interrupts = <12 2>;
    };
    eeprom@50 {
        compatible = "atmel,24c256";
        reg = <0x50>;
        status = "disabled";
    };
};
&i2c2 {
    status = "okay";
    bme280@76 {
        compatible = "bosch,bme280";
        reg = <0x76>;
    };
};
gpio0: gpio@48000000 {
    compatible = "ti,omap4-gpio";
    gpio-controller;
    #gpio-cells = <2>;
};
&spi0 {
    status = "okay";
    flash@1 {
        compatible = "jedec,spi-nor";
        reg = <1>;
        spi-max-frequency = <50000000>;
    };
};
"#,
        )
        .unwrap();
        let output = directory.join("drafts");
        import_dts(&ImportDtsArguments {
            source: source.clone(),
            output: output.clone(),
            include_disabled: false,
        })
        .unwrap();

        for id in ["bme280-76", "i2c2-bme280-76", "spi-nor-1", "gpio0"] {
            let package = DevicePackage::load(output.join(id)).unwrap();
            assert_eq!(package.manifest().metadata.id, id);
        }
        assert!(
            !output.join("24c256-50").exists(),
            "disabled nodes are skipped"
        );
        let summary = fs::read_to_string(output.join("board.md")).unwrap();
        assert!(summary.starts_with("# Carrier\n"));
        assert!(summary.contains(
            "| `bme280-76` | i2c | i2c1 | address 0x76 | bosch,bme280 | 12 2 (parent gpio0) |"
        ));
        assert!(summary.contains("| `spi-nor-1` | spi | spi0 | chip select 1 |"));
        assert!(summary.contains("24c256-50: status \"disabled\""));

        assert!(summary.contains("- `bme280-76.irq` → `gpio0.GPIO12`"));
        assert!(
            fs::read_to_string(output.join("topology.yaml"))
                .unwrap()
                .contains("  - { from: bme280-76.irq, to: gpio0.GPIO12 }\n")
        );

        assert_draft_interrupt_drives_the_line(&output);

        let again = import_dts(&ImportDtsArguments {
            source,
            output,
            include_disabled: true,
        });
        assert!(again.unwrap_err().contains("is not empty"));
        fs::remove_dir_all(directory).unwrap();
    }

    /// Writing the draft `IRQ_STATE` bit raises the wired GPIO line.
    fn assert_draft_interrupt_drives_the_line(output: &std::path::Path) {
        let config = vds_core::config::ServerConfig::from_yaml(&format!(
            "schema_version: 1\nserver: {{ control_address: '127.0.0.1:0' }}\ndata_plane: {{ unix_socket: /tmp/vds4e-cli-dts.sock }}\nobservability: {{ log_level: info }}\ndevice_packages: ['{}', '{}']\ntopology: '{}'\n",
            output.join("bme280-76").display(),
            output.join("gpio0").display(),
            output.join("topology.yaml").display(),
        ))
        .unwrap();
        let registry = vds_server::load_registry_with_clock(
            &config,
            std::sync::Arc::new(vds_core::clock::ManualClock::default()),
        )
        .unwrap();
        assert_eq!(registry.read_register("gpio0", "GPIO12_STATE").unwrap(), 0);
        let irq = registry
            .registers("bme280-76")
            .unwrap()
            .into_iter()
            .find(|register| register.name == "IRQ_STATE")
            .unwrap();
        registry
            .write_register("bme280-76", irq.address, 1)
            .unwrap();
        assert_eq!(registry.read_register("gpio0", "GPIO12_STATE").unwrap(), 1);
    }

    #[test]
    fn package_ids_follow_the_manifest_pattern() {
        assert_eq!(package_id("BME280_76"), "bme280-76");
        assert_eq!(package_id("--x..y--"), "x-y");
        assert_eq!(package_id("__"), "device");
    }
}
