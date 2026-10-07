//! CMSIS-SVD (System View Description) importer.
//!
//! Parses vendor SVD XML files defining peripherals, registers, and bitfields,
//! and maps them into VDS4E declarative register and device definitions.

use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use vds_device_model::{DeviceDefinition, DeviceModel, I2cBusDefinition, SpiBusDefinition};
use vds_registers::{AccessType, BitFieldDefinition, RegisterDefinition};

use crate::{
    error::{ImporterError, Result},
    xml::XmlElement,
};

/// Represents a parsed CMSIS-SVD device specification.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SvdDevice {
    /// Device / MCU name (e.g. "STM32F401", "RP2040").
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Default register size in bits (defaults to 32 if omitted).
    pub default_size: u8,
    /// Default register reset value.
    pub default_reset_value: u64,
    /// Default register access type.
    pub default_access: AccessType,
    /// Parsed peripherals.
    pub peripherals: Vec<SvdPeripheral>,
}

/// Represents a peripheral within an SVD device (e.g. "I2C1", "SPI2", "GPIOA").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SvdPeripheral {
    /// Peripheral name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional group name (e.g. "I2C", "SPI", "GPIO").
    pub group_name: Option<String>,
    /// Base memory address.
    pub base_address: u64,
    /// Name of another peripheral from which this inherits (derivedFrom attribute).
    pub derived_from: Option<String>,
    /// Registers belonging to this peripheral.
    pub registers: Vec<SvdRegister>,
}

/// Represents an individual hardware register.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SvdRegister {
    /// Register name (e.g. "CR1", "SR", "DR").
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Byte offset from the peripheral's base address.
    pub address_offset: u64,
    /// Width in bits (8, 16, 32, 64).
    pub size: u8,
    /// Access mode: read-only, write-only, or read-write.
    pub access: AccessType,
    /// Reset value after hardware reset.
    pub reset_value: u64,
    /// Bitfield / field definitions inside this register.
    pub fields: Vec<SvdField>,
}

/// Represents a bitfield within a register.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SvdField {
    /// Field name (e.g. "PE", "TXE", "RXNE").
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Least significant bit index (0..63).
    pub lsb: u8,
    /// Width in bits (1..64).
    pub width: u8,
    /// Access mode.
    pub access: AccessType,
}

impl SvdDevice {
    /// Parses an SVD device from XML content.
    ///
    /// # Errors
    /// Returns `ImporterError` on malformed XML or invalid SVD structure.
    pub fn from_xml(xml: &str) -> Result<Self> {
        let root = XmlElement::parse(xml)?;
        if root.name != "device" {
            return Err(ImporterError::InvalidSvd(format!(
                "root element must be <device>, found <{}>",
                root.name
            )));
        }

        let name = root
            .child_text("name")
            .ok_or_else(|| ImporterError::InvalidSvd("missing <name> in <device>".to_string()))?
            .to_string();

        let description = root.child_text("description").map(ToString::to_string);
        let default_size = root.parse_child_u8("size")?.unwrap_or(32);
        let default_reset_value = root.parse_child_u64("resetValue")?.unwrap_or(0);
        let default_access = root
            .child_text("access")
            .and_then(parse_access_type)
            .unwrap_or(AccessType::Rw);

        let mut peripherals = Vec::new();
        if let Some(periphs_node) = root.child("peripherals") {
            for periph_node in periphs_node.children_named("peripheral") {
                let periph = parse_peripheral(
                    periph_node,
                    default_size,
                    default_reset_value,
                    default_access,
                )?;
                peripherals.push(periph);
            }
        }

        // Resolve derivedFrom relationships
        resolve_derived_peripherals(&mut peripherals);

        Ok(Self {
            name,
            description,
            default_size,
            default_reset_value,
            default_access,
            peripherals,
        })
    }

    /// Loads and parses an SVD device from a file path.
    ///
    /// # Errors
    /// Returns `ImporterError` on I/O or parsing failure.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let content = fs::read_to_string(path)?;
        Self::from_xml(&content)
    }

    /// Finds a peripheral by name (case-insensitive).
    #[must_use]
    pub fn peripheral(&self, name: &str) -> Option<&SvdPeripheral> {
        self.peripherals
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
    }
}

impl SvdPeripheral {
    /// Parses an isolated `<peripheral>` XML element snippet.
    ///
    /// # Errors
    /// Returns `ImporterError` on malformed XML or missing required fields.
    pub fn from_xml(xml: &str) -> Result<Self> {
        let root = XmlElement::parse(xml)?;
        if root.name != "peripheral" {
            return Err(ImporterError::InvalidSvd(format!(
                "root element must be <peripheral>, found <{}>",
                root.name
            )));
        }
        parse_peripheral(&root, 32, 0, AccessType::Rw)
    }

    /// Converts peripheral registers to VDS4E `RegisterDefinition` instances.
    ///
    /// If `use_absolute_address` is false, registers keep their relative offset from the peripheral base.
    /// If true, registers use `base_address + address_offset`.
    #[must_use]
    pub fn to_vds_registers(&self, use_absolute_address: bool) -> Vec<RegisterDefinition> {
        let base = if use_absolute_address {
            Some(self.base_address)
        } else {
            None
        };
        self.registers
            .iter()
            .map(|r| r.to_vds_register(base))
            .collect()
    }

    /// Creates a schema-valid declarative `DeviceModel` stub based on this peripheral.
    ///
    /// Supported `bus` types: `"i2c"`, `"spi"`, `"gpio"`.
    ///
    /// # Errors
    /// Returns `ImporterError::Conversion` if the bus type or model is invalid.
    #[allow(clippy::too_many_lines)]
    pub fn to_device_model(&self, bus: &str) -> Result<DeviceModel> {
        let id = sanitize_identifier(&self.name);
        let name = self
            .description
            .clone()
            .unwrap_or_else(|| format!("{} Peripheral", self.name));

        match bus {
            "i2c" => {
                // Generic I2C register driver requires 8-bit width registers.
                // We convert 16/32-bit registers into byte-wide registers.
                let mut registers = Vec::new();
                for reg in &self.registers {
                    if reg.size == 8 {
                        registers.push(reg.to_vds_register(None));
                    } else {
                        // Split into 8-bit chunks
                        let bytes = usize::from(reg.size / 8);
                        for byte_idx in 0..bytes {
                            let shift = byte_idx * 8;
                            let byte_val = (reg.reset_value >> shift) & 0xFF;
                            let byte_name = if bytes == 1 {
                                reg.name.clone()
                            } else {
                                format!("{}_{byte_idx}", reg.name)
                            };
                            let byte_offset = reg.address_offset + u64::try_from(byte_idx).unwrap_or(0);

                            // Find matching bitfields in this byte range
                            let mut byte_fields = Vec::new();
                            let byte_start = u8::try_from(shift).unwrap_or(0);
                            let byte_end = byte_start + 8;
                            for f in &reg.fields {
                                if f.lsb >= byte_start && (f.lsb + f.width) <= byte_end {
                                    byte_fields.push(BitFieldDefinition {
                                        name: f.name.clone(),
                                        lsb: f.lsb - byte_start,
                                        width: f.width,
                                        access: f.access,
                                        description: f.description.clone().unwrap_or_default(),
                                    });
                                }
                            }

                            registers.push(RegisterDefinition {
                                name: byte_name,
                                address: byte_offset,
                                width_bits: 8,
                                reset_value: byte_val,
                                access: reg.access,
                                description: reg.description.clone().unwrap_or_default(),
                                bitfields: byte_fields,
                            });
                        }
                    }
                }

                // Ensure at least one register exists for generic-i2c-register
                if registers.is_empty() {
                    registers.push(RegisterDefinition {
                        name: "ID".to_string(),
                        address: 0,
                        width_bits: 8,
                        reset_value: 0,
                        access: AccessType::Ro,
                        description: "Default identification register".to_string(),
                        bitfields: vec![],
                    });
                }

                let device = DeviceDefinition {
                    id,
                    name,
                    bus: "i2c".to_string(),
                    model: "generic-i2c-register".to_string(),
                    spi: None,
                    i2c: Some(I2cBusDefinition {
                        register_address_bytes: 1,
                        auto_increment: true,
                        write_cycle_us: None,
                        write_protect: false,
                    }),
                    gpio: None,
                    uart: None,
                    commands: vec![],
                    memory: None,
                    registers,
                    busy: None,
                    state_machine: None,
                    faults: vec![],
                };

                Ok(DeviceModel {
                    schema_version: 1,
                    device,
                    signal_graph: None,
                    package_root: None,
                })
            }
            "spi" => {
                let registers = self.to_vds_registers(false);
                let device = DeviceDefinition {
                    id,
                    name,
                    bus: "spi".to_string(),
                    model: "generic-spi-command".to_string(),
                    spi: Some(SpiBusDefinition {
                        mode: 0,
                        transfer_bits: 8,
                        max_frequency_hz: Some(10_000_000),
                        supports_dtr: false,
                    }),
                    i2c: None,
                    gpio: None,
                    uart: None,
                    commands: vec![],
                    memory: None,
                    registers,
                    busy: None,
                    state_machine: None,
                    faults: vec![],
                };

                Ok(DeviceModel {
                    schema_version: 1,
                    device,
                    signal_graph: None,
                    package_root: None,
                })
            }
            other => Err(ImporterError::Conversion(format!(
                "unsupported bus type '{other}' for SVD stub generation"
            ))),
        }
    }
}

impl SvdRegister {
    /// Converts this register into a VDS4E `RegisterDefinition`.
    #[must_use]
    pub fn to_vds_register(&self, base_address: Option<u64>) -> RegisterDefinition {
        let address = match base_address {
            Some(base) => base + self.address_offset,
            None => self.address_offset,
        };
        RegisterDefinition {
            name: self.name.clone(),
            address,
            width_bits: self.size,
            reset_value: self.reset_value,
            access: self.access,
            description: self.description.clone().unwrap_or_default(),
            bitfields: self.fields.iter().map(SvdField::to_vds_bitfield).collect(),
        }
    }
}

impl SvdField {
    /// Converts this field into a VDS4E `BitFieldDefinition`.
    #[must_use]
    pub fn to_vds_bitfield(&self) -> BitFieldDefinition {
        BitFieldDefinition {
            name: self.name.clone(),
            lsb: self.lsb,
            width: self.width,
            access: self.access,
            description: self.description.clone().unwrap_or_default(),
        }
    }
}

fn parse_peripheral(
    node: &XmlElement,
    device_size: u8,
    device_reset_value: u64,
    device_access: AccessType,
) -> Result<SvdPeripheral> {
    let name = node
        .child_text("name")
        .ok_or_else(|| ImporterError::InvalidSvd("missing <name> in <peripheral>".to_string()))?
        .to_string();

    let description = node.child_text("description").map(ToString::to_string);
    let group_name = node.child_text("groupName").map(ToString::to_string);
    let base_address = node
        .parse_child_u64("baseAddress")?
        .unwrap_or(0);
    let derived_from = node.attr("derivedFrom").map(ToString::to_string);

    let periph_size = node.parse_child_u8("size")?.unwrap_or(device_size);
    let periph_reset_val = node
        .parse_child_u64("resetValue")?
        .unwrap_or(device_reset_value);
    let periph_access = node
        .child_text("access")
        .and_then(parse_access_type)
        .unwrap_or(device_access);

    let mut registers = Vec::new();
    if let Some(regs_node) = node.child("registers") {
        parse_registers_node(
            regs_node,
            0,
            periph_size,
            periph_reset_val,
            periph_access,
            &mut registers,
        )?;
    }

    Ok(SvdPeripheral {
        name,
        description,
        group_name,
        base_address,
        derived_from,
        registers,
    })
}

fn parse_registers_node(
    regs_node: &XmlElement,
    cluster_offset: u64,
    default_size: u8,
    default_reset_value: u64,
    default_access: AccessType,
    out: &mut Vec<SvdRegister>,
) -> Result<()> {
    // Registers
    for reg_node in regs_node.children_named("register") {
        let reg_name = reg_node
            .child_text("name")
            .ok_or_else(|| ImporterError::InvalidSvd("missing <name> in <register>".to_string()))?;
        let reg_desc = reg_node.child_text("description").map(ToString::to_string);
        let base_offset = reg_node
            .parse_child_u64("addressOffset")?
            .ok_or_else(|| {
                ImporterError::InvalidSvd(format!(
                    "missing <addressOffset> in register '{reg_name}'"
                ))
            })?
            + cluster_offset;

        let reg_size = reg_node.parse_child_u8("size")?.unwrap_or(default_size);
        let reg_reset_val = reg_node
            .parse_child_u64("resetValue")?
            .unwrap_or(default_reset_value);
        let reg_access = reg_node
            .child_text("access")
            .and_then(parse_access_type)
            .unwrap_or(default_access);

        // Fields
        let mut fields = Vec::new();
        if let Some(fields_node) = reg_node.child("fields") {
            for field_node in fields_node.children_named("field") {
                let f_name = field_node
                    .child_text("name")
                    .ok_or_else(|| {
                        ImporterError::InvalidSvd("missing <name> in <field>".to_string())
                    })?
                    .to_string();
                let f_desc = field_node.child_text("description").map(ToString::to_string);
                let (lsb, width) = parse_bit_range(field_node)?;
                let f_access = field_node
                    .child_text("access")
                    .and_then(parse_access_type)
                    .unwrap_or(reg_access);

                fields.push(SvdField {
                    name: f_name,
                    description: f_desc,
                    lsb,
                    width,
                    access: f_access,
                });
            }
        }

        // Check for register array (dim)
        if let Some(dim) = reg_node.parse_child_u64("dim")? {
            let dim_increment = reg_node.parse_child_u64("dimIncrement")?.unwrap_or(4);
            let dim_indices = parse_dim_indices(reg_node.child_text("dimIndex"), dim);

            for (idx, suffix) in dim_indices.into_iter().enumerate() {
                let expanded_name = if reg_name.contains("%s") {
                    reg_name.replace("%s", &suffix)
                } else if reg_name.ends_with("[%s]") {
                    reg_name.replace("[%s]", &format!("[{suffix}]"))
                } else {
                    format!("{reg_name}_{suffix}")
                };
                let offset = base_offset + (u64::try_from(idx).unwrap_or(0) * dim_increment);

                out.push(SvdRegister {
                    name: expanded_name,
                    description: reg_desc.clone(),
                    address_offset: offset,
                    size: reg_size,
                    access: reg_access,
                    reset_value: reg_reset_val,
                    fields: fields.clone(),
                });
            }
        } else {
            out.push(SvdRegister {
                name: reg_name.to_string(),
                description: reg_desc,
                address_offset: base_offset,
                size: reg_size,
                access: reg_access,
                reset_value: reg_reset_val,
                fields,
            });
        }
    }

    // Clusters
    for cluster_node in regs_node.children_named("cluster") {
        let cluster_rel = cluster_node
            .parse_child_u64("addressOffset")?
            .unwrap_or(0);
        let cluster_abs = cluster_offset + cluster_rel;
        parse_registers_node(
            cluster_node,
            cluster_abs,
            default_size,
            default_reset_value,
            default_access,
            out,
        )?;
    }

    Ok(())
}

fn parse_bit_range(node: &XmlElement) -> Result<(u8, u8)> {
    // Format 1: <bitOffset> and <bitWidth>
    if let (Some(offset), Some(width)) = (
        node.parse_child_u8("bitOffset")?,
        node.parse_child_u8("bitWidth")?,
    ) {
        return Ok((offset, width));
    }

    // Format 2: <bitRange>[msb:lsb]</bitRange>
    if let Some(range_str) = node.child_text("bitRange") {
        if let Some(clean) = range_str.trim().strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            if let Some((msb_str, lsb_str)) = clean.split_once(':') {
                if let (Ok(msb), Ok(lsb)) = (msb_str.trim().parse::<u8>(), lsb_str.trim().parse::<u8>()) {
                    if msb >= lsb {
                        return Ok((lsb, msb - lsb + 1));
                    }
                }
            }
        }
    }

    // Format 3: <lsb> and <msb>
    if let (Some(lsb), Some(msb)) = (
        node.parse_child_u8("lsb")?,
        node.parse_child_u8("msb")?,
    ) {
        if msb >= lsb {
            return Ok((lsb, msb - lsb + 1));
        }
    }

    Err(ImporterError::InvalidSvd(format!(
        "could not determine bit range for field '{}'",
        node.child_text("name").unwrap_or("unknown")
    )))
}

fn parse_access_type(raw: &str) -> Option<AccessType> {
    let lower = raw.trim().to_ascii_lowercase();
    match lower.as_str() {
        "read-only" | "readonly" | "ro" => Some(AccessType::Ro),
        "write-only" | "writeonly" | "wo" | "writeonce" | "write-only-once" => {
            Some(AccessType::Wo)
        }
        "read-write" | "readwrite" | "rw" | "read-writeonce" => Some(AccessType::Rw),
        _ => None,
    }
}

fn parse_dim_indices(raw: Option<&str>, dim: u64) -> Vec<String> {
    if let Some(s) = raw {
        if s.contains(',') {
            return s.split(',').map(|p| p.trim().to_string()).collect();
        }
        if let Some((start_s, end_s)) = s.split_once('-') {
            if let (Ok(start), Ok(end)) = (start_s.trim().parse::<u64>(), end_s.trim().parse::<u64>()) {
                if end >= start {
                    return (start..=end).map(|i| i.to_string()).collect();
                }
            }
        }
    }
    (0..dim).map(|i| i.to_string()).collect()
}

fn resolve_derived_peripherals(peripherals: &mut [SvdPeripheral]) {
    let count = peripherals.len();
    for i in 0..count {
        if let Some(base_name) = peripherals[i].derived_from.as_deref() {
            if peripherals[i].registers.is_empty() {
                let base_regs = peripherals
                    .iter()
                    .find(|p| p.name == base_name)
                    .map(|p| p.registers.clone());
                if let Some(regs) = base_regs {
                    peripherals[i].registers = regs;
                }
            }
        }
    }
}

fn sanitize_identifier(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch == '_' || ch == '-' || ch == ' ') && !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let res = out.trim_matches('-').to_string();
    if res.is_empty() { "device".to_string() } else { res }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SVD: &str = r#"
        <device schemaVersion="1.3">
            <name>STM32F401</name>
            <description>ARM Cortex-M4 device</description>
            <size>32</size>
            <resetValue>0x00000000</resetValue>
            <access>read-write</access>
            <peripherals>
                <peripheral>
                    <name>I2C1</name>
                    <description>I2C interface</description>
                    <groupName>I2C</groupName>
                    <baseAddress>0x40005400</baseAddress>
                    <registers>
                        <register>
                            <name>CR1</name>
                            <description>Control register 1</description>
                            <addressOffset>0x00</addressOffset>
                            <size>32</size>
                            <access>read-write</access>
                            <resetValue>0x0000</resetValue>
                            <fields>
                                <field>
                                    <name>PE</name>
                                    <description>Peripheral enable</description>
                                    <bitOffset>0</bitOffset>
                                    <bitWidth>1</bitWidth>
                                    <access>read-write</access>
                                </field>
                                <field>
                                    <name>SMBUS</name>
                                    <description>SMBus mode</description>
                                    <bitRange>[1:1]</bitRange>
                                    <access>read-write</access>
                                </field>
                            </fields>
                        </register>
                        <register>
                            <name>DR</name>
                            <description>Data register</description>
                            <addressOffset>0x10</addressOffset>
                            <size>16</size>
                            <access>read-write</access>
                            <resetValue>0x0000</resetValue>
                            <fields>
                                <field>
                                    <name>DR</name>
                                    <description>8-bit data register</description>
                                    <lsb>0</lsb>
                                    <msb>7</msb>
                                    <access>read-write</access>
                                </field>
                            </fields>
                        </register>
                    </registers>
                </peripheral>
                <peripheral derivedFrom="I2C1">
                    <name>I2C2</name>
                    <baseAddress>0x40005800</baseAddress>
                </peripheral>
            </peripherals>
        </device>
    "#;

    #[test]
    fn parses_svd_device_and_registers() {
        let dev = SvdDevice::from_xml(SAMPLE_SVD).expect("valid SVD");
        assert_eq!(dev.name, "STM32F401");
        assert_eq!(dev.peripherals.len(), 2);

        let i2c1 = dev.peripheral("I2C1").expect("I2C1 exists");
        assert_eq!(i2c1.base_address, 0x4000_5400);
        assert_eq!(i2c1.registers.len(), 2);

        let cr1 = &i2c1.registers[0];
        assert_eq!(cr1.name, "CR1");
        assert_eq!(cr1.address_offset, 0);
        assert_eq!(cr1.fields.len(), 2);
        assert_eq!(cr1.fields[0].name, "PE");
        assert_eq!(cr1.fields[0].lsb, 0);
        assert_eq!(cr1.fields[0].width, 1);
        assert_eq!(cr1.fields[1].name, "SMBUS");
        assert_eq!(cr1.fields[1].lsb, 1);
        assert_eq!(cr1.fields[1].width, 1);

        let dr = &i2c1.registers[1];
        assert_eq!(dr.name, "DR");
        assert_eq!(dr.address_offset, 0x10);
        assert_eq!(dr.size, 16);
        assert_eq!(dr.fields[0].width, 8);

        // Test derivedFrom
        let i2c2 = dev.peripheral("I2C2").expect("I2C2 exists");
        assert_eq!(i2c2.base_address, 0x4000_5800);
        assert_eq!(i2c2.registers.len(), 2);
        assert_eq!(i2c2.registers[0].name, "CR1");
    }

    #[test]
    fn converts_to_vds_registers() {
        let dev = SvdDevice::from_xml(SAMPLE_SVD).expect("valid SVD");
        let i2c1 = dev.peripheral("I2C1").unwrap();
        let regs = i2c1.to_vds_registers(false);
        assert_eq!(regs.len(), 2);
        assert_eq!(regs[0].name, "CR1");
        assert_eq!(regs[0].address, 0x00);
        assert_eq!(regs[0].bitfields.len(), 2);

        let abs_regs = i2c1.to_vds_registers(true);
        assert_eq!(abs_regs[0].address, 0x4000_5400);
    }

    #[test]
    fn generates_schema_valid_device_model() {
        let dev = SvdDevice::from_xml(SAMPLE_SVD).expect("valid SVD");
        let i2c1 = dev.peripheral("I2C1").unwrap();
        let model = i2c1.to_device_model("i2c").expect("generates model");
        assert_eq!(model.device.bus, "i2c");
        assert_eq!(model.device.model, "generic-i2c-register");
        // All registers in generic-i2c-register must be 8-bit
        for r in &model.device.registers {
            assert_eq!(r.width_bits, 8);
        }
    }
}
