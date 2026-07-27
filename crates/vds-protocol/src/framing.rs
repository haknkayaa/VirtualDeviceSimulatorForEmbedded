use std::io::{Error, ErrorKind, Result};

use prost::Message;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Maximum accepted Protobuf payload size for the local transaction protocol.
pub const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// Reads one 4-byte big-endian length-prefixed Protobuf message.
///
/// # Errors
///
/// Returns an I/O error for a truncated frame, an oversized payload, or an
/// invalid Protobuf message.
pub async fn read_message<M, R>(reader: &mut R) -> Result<M>
where
    M: Message + Default,
    R: AsyncRead + Unpin,
{
    let length = reader.read_u32().await? as usize;
    if length > MAX_FRAME_SIZE {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!("frame length {length} exceeds limit {MAX_FRAME_SIZE}"),
        ));
    }

    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    M::decode(payload.as_slice()).map_err(|error| Error::new(ErrorKind::InvalidData, error))
}

/// Writes one 4-byte big-endian length-prefixed Protobuf message.
///
/// # Errors
///
/// Returns an I/O error when the encoded payload is too large or cannot be
/// written to the stream.
pub async fn write_message<M, W>(writer: &mut W, message: &M) -> Result<()>
where
    M: Message,
    W: AsyncWrite + Unpin,
{
    let length = message.encoded_len();
    if length > MAX_FRAME_SIZE {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("frame length {length} exceeds limit {MAX_FRAME_SIZE}"),
        ));
    }

    let wire_length =
        u32::try_from(length).map_err(|error| Error::new(ErrorKind::InvalidInput, error))?;
    writer.write_u32(wire_length).await?;
    let mut payload = Vec::with_capacity(length);
    message
        .encode(&mut payload)
        .map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
    writer.write_all(&payload).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use tokio::io::duplex;

    use super::{read_message, write_message};
    use crate::v1::{ClientRequest, SpiTransferRequest, client_request};

    #[tokio::test]
    async fn round_trips_a_framed_message() {
        let (mut client, mut server) = duplex(1024);
        let request = ClientRequest {
            request_id: 7,
            payload: Some(client_request::Payload::SpiTransfer(SpiTransferRequest {
                device_id: "spi-flash-0".to_owned(),
                tx: vec![0x9f],
                wire: None,
                rx_length: 0,
            })),
        };

        write_message(&mut client, &request)
            .await
            .expect("frame should be written");
        let decoded: ClientRequest = read_message(&mut server)
            .await
            .expect("frame should be decoded");

        assert_eq!(decoded, request);
    }
}
