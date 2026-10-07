//! # VDS4E Hardware Importer (`vds-importer`)
//!
//! Provides declarative peripheral and register map generation directly from:
//! 1. **CMSIS-SVD** (XML format detailing peripherals, registers, and bitfields).
//! 2. **Device Tree Source** (DTS / DTBO snippets detailing buses, addresses, and compatible strings).
//!
//! Outputs schema-valid VDS4E device models and virtual board drafts without
//! embedding any proprietary or target-specific emulation code in the host Linux ABI adapters.

pub mod dts;
pub mod error;
pub mod svd;
pub mod xml;

use std::path::Path;

pub use dts::{BusType, DeviceStubDraft, DtsNode, DtsValue, VirtualBoardDraft, VirtualBusDraft};
pub use error::{ImporterError, Result};
pub use svd::{SvdDevice, SvdField, SvdPeripheral, SvdRegister};
use vds_device_model::DeviceModel;
pub use xml::XmlElement;

/// Parses a CMSIS-SVD document from an XML string.
///
/// # Errors
/// Returns [`ImporterError`] on syntax errors or invalid SVD structure.
pub fn import_svd(xml: &str) -> Result<SvdDevice> {
    SvdDevice::from_xml(xml)
}

/// Loads and parses a CMSIS-SVD document from a file.
///
/// # Errors
/// Returns [`ImporterError`] on file I/O or parsing errors.
pub fn import_svd_file(path: impl AsRef<Path>) -> Result<SvdDevice> {
    SvdDevice::from_file(path)
}

/// Parses Device Tree source (DTS / DTBO) and produces a virtual board draft.
///
/// # Errors
/// Returns [`ImporterError`] on syntax or parsing errors.
pub fn import_dts(dts_source: &str) -> Result<VirtualBoardDraft> {
    VirtualBoardDraft::from_dts(dts_source)
}

/// Loads and parses Device Tree source from a file.
///
/// # Errors
/// Returns [`ImporterError`] on file I/O or parsing errors.
pub fn import_dts_file(path: impl AsRef<Path>) -> Result<VirtualBoardDraft> {
    VirtualBoardDraft::from_file(path)
}

/// Merges a Device Tree peripheral stub with register definitions from an SVD peripheral.
///
/// Connectivity (bus type, address) comes from the DTS stub, while register maps
/// and bitfields are imported from SVD.
///
/// # Errors
/// Returns [`ImporterError`] if the resulting device model cannot be formed.
pub fn merge_stub_and_svd(
    stub: &DeviceStubDraft,
    peripheral: &SvdPeripheral,
) -> Result<DeviceModel> {
    let mut model = stub.to_device_model()?;
    let registers = peripheral.to_vds_registers(false);
    if !registers.is_empty() {
        model.device.registers = registers;
    }
    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_and_merges_dts_with_svd() {
        let dts = r#"
            &i2c1 {
                bme280@76 {
                    compatible = "bosch,bme280";
                    reg = <0x76>;
                };
            };
        "#;

        let svd = r#"
            <peripheral>
                <name>BME280</name>
                <baseAddress>0x76</baseAddress>
                <registers>
                    <register>
                        <name>ID</name>
                        <addressOffset>0xD0</addressOffset>
                        <size>8</size>
                        <access>read-only</access>
                        <resetValue>0x60</resetValue>
                    </register>
                </registers>
            </peripheral>
        "#;

        let board = import_dts(dts).expect("DTS import succeeds");
        assert_eq!(board.devices.len(), 1);
        let stub = &board.devices[0];

        let periph = SvdPeripheral::from_xml(svd).expect("SVD import succeeds");
        let model = merge_stub_and_svd(stub, &periph).expect("merge succeeds");

        assert_eq!(model.device.bus, "i2c");
        assert_eq!(model.device.registers.len(), 1);
        assert_eq!(model.device.registers[0].name, "ID");
        assert_eq!(model.device.registers[0].address, 0xD0);
        assert_eq!(model.device.registers[0].reset_value, 0x60);
    }
}
