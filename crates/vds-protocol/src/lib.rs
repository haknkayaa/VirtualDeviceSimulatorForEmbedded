//! VDS4E local data-plane protocol and framing.

/// Length-prefixed protobuf stream framing.
pub mod framing;

#[allow(clippy::doc_markdown, clippy::must_use_candidate)]
/// Generated VDS4E v1 protobuf messages.
pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/vds.v1.rs"));
}
