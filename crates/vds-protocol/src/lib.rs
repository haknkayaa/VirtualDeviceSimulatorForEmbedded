//! VDS4E local data-plane protocol and framing.

pub mod framing;

#[allow(clippy::doc_markdown, clippy::must_use_candidate)]
pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/vds.v1.rs"));
}
