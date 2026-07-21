use std::{env, path::PathBuf, process::ExitCode};

use tokio::net::UnixStream;
use vds_protocol::{
    framing::{read_message, write_message},
    v1::{
        ClientRequest, ErrorCode, ServerResponse, SpiTransferRequest, client_request,
        server_response,
    },
};

struct Arguments {
    socket: PathBuf,
    device_id: String,
    tx: Vec<u8>,
}

impl Arguments {
    fn parse() -> Result<Self, String> {
        let mut args = env::args().skip(1);
        match args.next().as_deref() {
            Some("spi-transfer") => {}
            Some("--help" | "-h") | None => return Err(String::new()),
            Some(command) => return Err(format!("unknown command: {command}")),
        }

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

        Ok(Self {
            socket: socket.ok_or_else(|| "--socket is required".to_owned())?,
            device_id: device_id.ok_or_else(|| "--device is required".to_owned())?,
            tx: tx.ok_or_else(|| "--tx is required".to_owned())?,
        })
    }
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

    match transfer(arguments).await {
        Ok(rx) => {
            println!("RX: {}", format_hex(&rx));
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn transfer(arguments: Arguments) -> Result<Vec<u8>, String> {
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
    println!("vds-cli\n\nUSAGE:\n    vds-cli spi-transfer --socket PATH --device ID --tx HEX");
}

#[cfg(test)]
mod tests {
    use super::parse_hex;

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
}
