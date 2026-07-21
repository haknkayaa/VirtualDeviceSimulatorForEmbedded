use std::{env, path::PathBuf, process::ExitCode};

use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use vds_core::config::ServerConfig;

#[derive(Debug)]
struct Arguments {
    config: PathBuf,
    check_config: bool,
}

impl Arguments {
    fn parse() -> Result<Self, String> {
        let mut config = PathBuf::from("config/vds-server.yaml");
        let mut check_config = false;
        let mut args = env::args().skip(1);

        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--config" => {
                    config = args
                        .next()
                        .map(PathBuf::from)
                        .ok_or_else(|| "--config requires a path".to_owned())?;
                }
                "--check-config" => check_config = true,
                "--help" | "-h" => {
                    println!(
                        "vds-server\n\nUSAGE:\n    vds-server [--config PATH] [--check-config]"
                    );
                    return Err(String::new());
                }
                unknown => return Err(format!("unknown argument: {unknown}")),
            }
        }

        Ok(Self {
            config,
            check_config,
        })
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let arguments = match Arguments::parse() {
        Ok(arguments) => arguments,
        Err(message) if message.is_empty() => return ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            return ExitCode::from(2);
        }
    };

    let config = match ServerConfig::load(&arguments.config) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::FAILURE;
        }
    };

    if let Err(error) = initialize_logging(&config.observability.log_level) {
        eprintln!("error: failed to initialize logging: {error}");
        return ExitCode::FAILURE;
    }

    info!(
        component = "vds-server",
        schema_version = config.schema_version,
        control_address = %config.server.control_address,
        unix_socket = %config.data_plane.unix_socket.display(),
        "configuration loaded"
    );

    if arguments.check_config {
        if let Err(error) = vds_server::load_registry(&config) {
            error!(component = "vds-server", %error, "device-model validation failed");
            return ExitCode::FAILURE;
        }
        info!(
            component = "vds-server",
            "configuration and device models are valid"
        );
        return ExitCode::SUCCESS;
    }

    if let Err(error) = vds_server::run(config).await {
        error!(component = "vds-server", %error, "server stopped with error");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

fn initialize_logging(level: &str) -> Result<(), tracing_subscriber::filter::ParseError> {
    let filter = EnvFilter::builder().parse(format!(
        "vds_server={level},vds_core={level},vds_device_model={level}"
    ))?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(true)
        .with_span_list(true)
        .init();
    Ok(())
}
