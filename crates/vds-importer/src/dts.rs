//! Device Tree Source (DTS / DTBO) importer.
//!
//! Parses Device Tree source nodes and overlays, extracts peripheral connectivity
//! (buses, addresses, chip selects, interrupts, and compatible strings), and maps
//! them into reviewable virtual board drafts and declarative device stubs.

use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use vds_device_model::{
    DeviceDefinition, DeviceModel, GpioBusDefinition, GpioLineDefinition, GpioLineDirection,
    I2cBusDefinition, SpiBusDefinition, SpiCommandDefinition, SpiCommandShortcutDefinition,
};
use vds_registers::{AccessType, RegisterDefinition};

use crate::error::{ImporterError, Result};

/// Supported hardware bus types in VDS4E.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BusType {
    /// Serial Peripheral Interface (/dev/spidevX.Y).
    Spi,
    /// Inter-Integrated Circuit (/dev/i2c-X).
    I2c,
    /// General Purpose Input/Output (/dev/gpiochipX).
    Gpio,
    /// Universal Asynchronous Receiver-Transmitter.
    Uart,
    /// Unrecognized or system bus.
    Other,
}

impl std::fmt::Display for BusType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spi => write!(f, "spi"),
            Self::I2c => write!(f, "i2c"),
            Self::Gpio => write!(f, "gpio"),
            Self::Uart => write!(f, "uart"),
            Self::Other => write!(f, "other"),
        }
    }
}

/// Virtual board draft extracted from Device Tree sources.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualBoardDraft {
    /// Board or overlay name.
    pub name: String,
    /// Detected hardware buses.
    pub buses: Vec<VirtualBusDraft>,
    /// Peripheral device stubs.
    pub devices: Vec<DeviceStubDraft>,
}

/// A detected hardware bus on the virtual board.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VirtualBusDraft {
    /// Bus identifier (e.g. "i2c1", "spi0", "gpio0").
    pub name: String,
    /// Type of the bus.
    pub bus_type: BusType,
    /// Raw bus properties.
    pub properties: BTreeMap<String, String>,
}

/// Peripheral device stub extracted from a Device Tree peripheral node.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceStubDraft {
    /// Unique identifier for this device (e.g. "bme280-76", "spidev-0").
    pub id: String,
    /// Human-friendly name.
    pub name: String,
    /// Bus type.
    pub bus_type: BusType,
    /// Parent bus identifier (e.g. "i2c1", "spi0").
    pub bus_name: String,
    /// Device bus address (I2C slave address, SPI chip-select number, etc.).
    pub address: Option<u64>,
    /// Device Tree compatible strings (e.g. `["bosch,bme280"]`).
    pub compatible: Vec<String>,
    /// Interrupt numbers / specifiers.
    pub interrupts: Vec<u32>,
    /// Interrupt controller phandle reference.
    pub interrupt_parent: Option<String>,
    /// SPI clock mode (0..3), if applicable.
    pub spi_mode: Option<u8>,
    /// Maximum SPI clock frequency in Hz, if applicable.
    pub spi_max_frequency_hz: Option<u64>,
    /// Device status ("okay", "disabled", etc.).
    pub status: String,
    /// Additional properties extracted from the node.
    pub properties: BTreeMap<String, String>,
}

/// Parsed property value in a Device Tree node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DtsValue {
    /// Boolean flag (empty property).
    Empty,
    /// List of strings.
    StringList(Vec<String>),
    /// Integer cells (<0x76>, <14 2>, etc.).
    Cells(Vec<u64>),
    /// Raw byte sequence ([00 11 22]).
    Bytes(Vec<u8>),
    /// Phandle or node reference (&gpio1, etc.).
    Reference(String),
}

/// An AST node in a Device Tree hierarchy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DtsNode {
    /// Node name with optional unit address (e.g. "bme280@76").
    pub name: String,
    /// Optional label preceding node name (e.g. "sensor: bme280@76").
    pub label: Option<String>,
    /// Extracted unit address string (after '@').
    pub unit_address: Option<String>,
    /// Properties declared inside the node.
    pub properties: BTreeMap<String, DtsValue>,
    /// Child nodes.
    pub children: Vec<DtsNode>,
}

impl DtsNode {
    /// Returns the primary compatible string if present.
    #[must_use]
    pub fn primary_compatible(&self) -> Option<&str> {
        match self.properties.get("compatible") {
            Some(DtsValue::StringList(list)) => list.first().map(String::as_str),
            _ => None,
        }
    }

    /// Returns all compatible strings.
    #[must_use]
    pub fn compatible_strings(&self) -> Vec<String> {
        match self.properties.get("compatible") {
            Some(DtsValue::StringList(list)) => list.clone(),
            _ => Vec::new(),
        }
    }

    /// Returns the first reg address as `u64`.
    #[must_use]
    pub fn reg_address(&self) -> Option<u64> {
        match self.properties.get("reg") {
            Some(DtsValue::Cells(cells)) => cells.first().copied(),
            _ => None,
        }
    }

    /// Returns interrupt specifiers as `Vec<u32>`.
    #[must_use]
    pub fn interrupts(&self) -> Vec<u32> {
        match self.properties.get("interrupts") {
            Some(DtsValue::Cells(cells)) => cells
                .iter()
                .filter_map(|&c| u32::try_from(c).ok())
                .collect(),
            _ => Vec::new(),
        }
    }
}

impl VirtualBoardDraft {
    /// Parses a Device Tree Source (DTS or DTBO) string and extracts a board draft.
    ///
    /// # Errors
    /// Returns `ImporterError` on syntax or parsing failure.
    pub fn from_dts(dts_source: &str) -> Result<Self> {
        let nodes = parse_dts_source(dts_source)?;
        Self::from_nodes(&nodes)
    }

    /// Loads and parses a Device Tree source from a file.
    ///
    /// # Errors
    /// Returns `ImporterError` on I/O or syntax failure.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let content = fs::read_to_string(path)?;
        Self::from_dts(&content)
    }

    /// Constructs a `VirtualBoardDraft` from parsed `DtsNode` roots.
    ///
    /// # Errors
    /// Returns `ImporterError` if mapping fails.
    pub fn from_nodes(roots: &[DtsNode]) -> Result<Self> {
        let mut buses = Vec::new();
        let mut devices = Vec::new();

        for root in roots {
            extract_topology(root, "", &mut buses, &mut devices);
        }

        let name = roots
            .first()
            .and_then(|r| r.properties.get("model"))
            .and_then(|v| match v {
                DtsValue::StringList(s) => s.first().cloned(),
                _ => None,
            })
            .unwrap_or_else(|| "Virtual Board Draft".to_string());

        Ok(Self {
            name,
            buses,
            devices,
        })
    }

    /// Finds a device stub by ID.
    #[must_use]
    pub fn device(&self, id: &str) -> Option<&DeviceStubDraft> {
        self.devices.iter().find(|d| d.id == id)
    }

    /// Returns all devices connected to a given bus name.
    #[must_use]
    pub fn devices_on_bus(&self, bus_name: &str) -> Vec<&DeviceStubDraft> {
        self.devices
            .iter()
            .filter(|d| d.bus_name == bus_name)
            .collect()
    }
}

impl DeviceStubDraft {
    /// Generates a schema-valid declarative `DeviceModel` stub.
    ///
    /// # Errors
    /// Returns `ImporterError::Conversion` if required fields for the bus type cannot be generated.
    #[allow(clippy::too_many_lines)]
    pub fn to_device_model(&self) -> Result<DeviceModel> {
        match self.bus_type {
            BusType::I2c => {
                let registers = vec![
                    RegisterDefinition {
                        name: "DEVICE_ID".to_string(),
                        address: 0x00,
                        width_bits: 8,
                        reset_value: 0x00,
                        access: AccessType::Ro,
                        description: format!(
                            "Deterministic device identification for {}",
                            self.name
                        ),
                        bitfields: vec![],
                    },
                    RegisterDefinition {
                        name: "CONTROL".to_string(),
                        address: 0x01,
                        width_bits: 8,
                        reset_value: 0x00,
                        access: AccessType::Rw,
                        description: "Control register".to_string(),
                        bitfields: vec![],
                    },
                    RegisterDefinition {
                        name: "STATUS".to_string(),
                        address: 0x02,
                        width_bits: 8,
                        reset_value: 0x01,
                        access: AccessType::Ro,
                        description: "Status register".to_string(),
                        bitfields: vec![],
                    },
                ];

                let device = DeviceDefinition {
                    id: self.id.clone(),
                    name: self.name.clone(),
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
            BusType::Spi => {
                let commands = vec![
                    SpiCommandDefinition {
                        name: "IDENTIFY".to_string(),
                        opcode: 0x9F,
                        response: Some(vec![0xAA, 0x55, 0x01]),
                        shortcut: Some(SpiCommandShortcutDefinition {
                            tx: vec![0x9F],
                            rx_length: 3,
                            description: Some("Identify SPI peripheral".to_string()),
                        }),
                        operation: None,
                        address_bytes: None,
                        register: None,
                        event: None,
                        event_delay_us: None,
                        timing: None,
                        allowed_states: vec![],
                        wire: None,
                    },
                    SpiCommandDefinition {
                        name: "PING".to_string(),
                        opcode: 0xA0,
                        response: Some(vec![0xDE, 0xAD, 0xBE, 0xEF]),
                        shortcut: Some(SpiCommandShortcutDefinition {
                            tx: vec![0xA0],
                            rx_length: 4,
                            description: Some("Ping peripheral response".to_string()),
                        }),
                        operation: None,
                        address_bytes: None,
                        register: None,
                        event: None,
                        event_delay_us: None,
                        timing: None,
                        allowed_states: vec![],
                        wire: None,
                    },
                ];

                let device = DeviceDefinition {
                    id: self.id.clone(),
                    name: self.name.clone(),
                    bus: "spi".to_string(),
                    model: "generic-spi-command".to_string(),
                    spi: Some(SpiBusDefinition {
                        mode: self.spi_mode.unwrap_or(0),
                        transfer_bits: 8,
                        max_frequency_hz: self.spi_max_frequency_hz.or(Some(10_000_000)),
                        supports_dtr: false,
                    }),
                    i2c: None,
                    gpio: None,
                    uart: None,
                    commands,
                    memory: None,
                    registers: vec![],
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
            BusType::Gpio => {
                let lines_count: u16 = self
                    .properties
                    .get("ngpios")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(16);

                let mut lines = Vec::new();
                let mut registers = Vec::new();
                for i in 0..lines_count {
                    let reg_name = format!("GPIO{i}_STATE");
                    lines.push(GpioLineDefinition {
                        offset: i,
                        name: format!("GPIO{i}"),
                        direction: GpioLineDirection::Input,
                        initial_value: false,
                        active_low: false,
                        register: Some(reg_name.clone()),
                    });
                    registers.push(RegisterDefinition {
                        name: reg_name,
                        address: u64::from(i),
                        width_bits: 1,
                        reset_value: 0,
                        access: AccessType::Rw,
                        description: format!("State register for line {i}"),
                        bitfields: vec![],
                    });
                }

                let device = DeviceDefinition {
                    id: self.id.clone(),
                    name: self.name.clone(),
                    bus: "gpio".to_string(),
                    model: "generic-gpio-bank".to_string(),
                    spi: None,
                    i2c: None,
                    gpio: Some(GpioBusDefinition { lines }),
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
            BusType::Uart | BusType::Other => Err(ImporterError::Conversion(format!(
                "bus type '{}' does not currently have automatic stub generation",
                self.bus_type
            ))),
        }
    }

    /// Attaches custom registers (for instance, imported from SVD) and returns a `DeviceModel`.
    ///
    /// # Errors
    /// Returns `ImporterError::Conversion` if generating the base model fails.
    pub fn with_registers(&self, registers: Vec<RegisterDefinition>) -> Result<DeviceModel> {
        let mut model = self.to_device_model()?;
        model.device.registers = registers;
        Ok(model)
    }

    /// Serializes this device stub into a YAML string.
    ///
    /// # Errors
    /// Returns `ImporterError` on serialization failure.
    pub fn export_yaml(&self) -> Result<String> {
        let model = self.to_device_model()?;
        serde_yaml::to_string(&model).map_err(ImporterError::from)
    }
}

/// Recursively traverses the parsed DTS AST to detect buses and peripheral devices.
fn extract_topology(
    node: &DtsNode,
    current_bus: &str,
    buses: &mut Vec<VirtualBusDraft>,
    devices: &mut Vec<DeviceStubDraft>,
) {
    let mut next_bus = current_bus.to_string();
    let mut is_new_bus = false;

    // Check if this node is an overlay fragment targeting a bus
    if let Some(target) = node.properties.get("target") {
        let target_name = format_dts_value(target).trim_start_matches('&').to_string();
        if let Some(bt) = detect_bus_type_from_name(&target_name) {
            if !buses.iter().any(|b| b.name == target_name) {
                buses.push(VirtualBusDraft {
                    name: target_name.clone(),
                    bus_type: bt,
                    properties: BTreeMap::new(),
                });
            }
            next_bus = target_name;
            is_new_bus = true;
        }
    } else if (current_bus.is_empty() || node.properties.contains_key("gpio-controller"))
        && let Some(bt) = detect_bus_type(node)
    {
        let bus_id = bus_name_for_node(node, bt);
        if !buses.iter().any(|b| b.name == bus_id) {
            let mut props = BTreeMap::new();
            for (k, v) in &node.properties {
                props.insert(k.clone(), format_dts_value(v));
            }
            buses.push(VirtualBusDraft {
                name: bus_id.clone(),
                bus_type: bt,
                properties: props,
            });
        }
        next_bus = bus_id;
        is_new_bus = true;
    }

    // If current node is inside a detected bus and has 'compatible' or 'reg', treat as peripheral
    if !is_new_bus
        && !next_bus.is_empty()
        && (node.properties.contains_key("compatible") || node.properties.contains_key("reg"))
    {
        // Only treat as peripheral if it's not the bus node itself or an overlay container
        let is_bus_controller = node.properties.contains_key("gpio-controller")
            || node.name.starts_with("spi@")
            || node.name.starts_with("i2c@")
            || node.name.starts_with('&')
            || node.name.starts_with("fragment@");

        if !is_bus_controller && let Some(parent_bus) = buses.iter().find(|b| b.name == next_bus) {
            let peripheral_bus_type = parent_bus.bus_type;
            let stub = build_device_stub(node, peripheral_bus_type, &next_bus);
            if !devices.iter().any(|d| d.id == stub.id) {
                devices.push(stub);
            }
        }
    }

    // Recurse into children
    for child in &node.children {
        extract_topology(child, &next_bus, buses, devices);
    }
}

fn detect_bus_type_from_name(name: &str) -> Option<BusType> {
    let lower = name.to_ascii_lowercase();
    if lower.contains("gpio") {
        Some(BusType::Gpio)
    } else if lower.contains("spi") {
        Some(BusType::Spi)
    } else if lower.contains("i2c") {
        Some(BusType::I2c)
    } else if lower.contains("uart") || lower.contains("serial") {
        Some(BusType::Uart)
    } else {
        None
    }
}

fn detect_bus_type(node: &DtsNode) -> Option<BusType> {
    let lower = node.name.to_ascii_lowercase();

    if node.properties.contains_key("gpio-controller") || lower.contains("gpio") {
        return Some(BusType::Gpio);
    }

    if lower.contains("spi") {
        return Some(BusType::Spi);
    }

    if lower.contains("i2c") {
        return Some(BusType::I2c);
    }

    if lower.contains("uart") || lower.contains("serial") {
        return Some(BusType::Uart);
    }

    None
}

fn bus_name_for_node(node: &DtsNode, bt: BusType) -> String {
    if let Some(lbl) = &node.label {
        return lbl.clone();
    }
    let clean = clean_node_name(&node.name);
    if clean.starts_with("spi@") || clean == "spi" {
        "spi0".to_string()
    } else if clean.starts_with("i2c@") || clean == "i2c" {
        "i2c0".to_string()
    } else if clean.starts_with("gpio@") || clean == "gpio" {
        "gpio0".to_string()
    } else if clean.is_empty() {
        format!("{bt}0")
    } else {
        clean
    }
}

fn build_device_stub(node: &DtsNode, bus_type: BusType, bus_name: &str) -> DeviceStubDraft {
    let compat = node.compatible_strings();
    let reg = node.reg_address();
    let interrupts = node.interrupts();
    let interrupt_parent = node
        .properties
        .get("interrupt-parent")
        .map(format_dts_value);

    let clean_name = clean_node_name(&node.name);
    let id = generate_device_id(&clean_name, compat.first().map(String::as_str), reg);
    let friendly_name = format!(
        "{} ({})",
        compat.first().map_or(&clean_name, |c| c),
        reg.map_or_else(|| "unaddressed".to_string(), |r| format!("{r:#x}"))
    );

    // SPI mode determination (CPOL and CPHA)
    let cpol = node.properties.contains_key("spi-cpol");
    let cpha = node.properties.contains_key("spi-cpha");
    let spi_mode = if bus_type == BusType::Spi {
        Some((u8::from(cpol) << 1) | u8::from(cpha))
    } else {
        None
    };

    let spi_max_frequency_hz = node
        .properties
        .get("spi-max-frequency")
        .and_then(|v| match v {
            DtsValue::Cells(cells) => cells.first().copied(),
            _ => None,
        });

    let status = match node.properties.get("status") {
        Some(DtsValue::StringList(list)) => {
            list.first().cloned().unwrap_or_else(|| "okay".to_string())
        }
        _ => "okay".to_string(),
    };

    let mut properties = BTreeMap::new();
    for (k, v) in &node.properties {
        properties.insert(k.clone(), format_dts_value(v));
    }

    DeviceStubDraft {
        id,
        name: friendly_name,
        bus_type,
        bus_name: bus_name.to_string(),
        address: reg,
        compatible: compat,
        interrupts,
        interrupt_parent,
        spi_mode,
        spi_max_frequency_hz,
        status,
        properties,
    }
}

fn generate_device_id(node_name: &str, compat: Option<&str>, reg: Option<u64>) -> String {
    let base = if let Some(c) = compat {
        c.split(',').nth(1).unwrap_or(c)
    } else {
        node_name.split('@').next().unwrap_or(node_name)
    };

    let mut id_raw = String::new();
    for ch in base.chars() {
        if ch.is_ascii_alphanumeric() {
            id_raw.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            id_raw.push('-');
        }
    }

    if let Some(r) = reg {
        format!("{id_raw}-{r:x}")
    } else {
        id_raw
    }
}

fn clean_node_name(name: &str) -> String {
    name.trim_start_matches('&')
        .trim_start_matches('/')
        .to_string()
}

fn format_dts_value(val: &DtsValue) -> String {
    match val {
        DtsValue::Empty => "true".to_string(),
        DtsValue::StringList(list) => list.join(", "),
        DtsValue::Cells(cells) => cells
            .iter()
            .map(|c| format!("{c:#x}"))
            .collect::<Vec<_>>()
            .join(" "),
        DtsValue::Bytes(bytes) => bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" "),
        DtsValue::Reference(r) => r.clone(),
    }
}

// ---------------------------------------------------------------------------
// DTS Tokenizer & Parser
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
enum DtsToken {
    Word(String),
    StringLit(String),
    Cells(Vec<u64>),
    Bytes(Vec<u8>),
    Reference(String),
    BraceOpen,
    BraceClose,
    Semicolon,
    Equals,
    Colon,
    Comma,
}

fn parse_dts_source(input: &str) -> Result<Vec<DtsNode>> {
    let tokens = tokenize_dts(input);
    let mut parser = DtsParser::new(tokens);
    parser.parse_top_level()
}

fn tokenize_dts(input: &str) -> Vec<DtsToken> {
    let mut tokens = Vec::new();
    let mut chars = input.char_indices().peekable();

    while let Some((_, ch)) = chars.next() {
        if ch.is_whitespace() {
            continue;
        }

        // Comments: // or /* ... */
        if ch == '/' {
            if let Some(&(_, '/')) = chars.peek() {
                chars.next();
                for (_, c) in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
                continue;
            } else if let Some(&(_, '*')) = chars.peek() {
                chars.next();
                let mut prev = ' ';
                for (_, c) in chars.by_ref() {
                    if prev == '*' && c == '/' {
                        break;
                    }
                    prev = c;
                }
                continue;
            }
        }

        match ch {
            '{' => tokens.push(DtsToken::BraceOpen),
            '}' => tokens.push(DtsToken::BraceClose),
            ';' => tokens.push(DtsToken::Semicolon),
            '=' => tokens.push(DtsToken::Equals),
            ':' => tokens.push(DtsToken::Colon),
            ',' => tokens.push(DtsToken::Comma),
            '"' => {
                // String literal
                let mut s = String::new();
                for (_, c) in chars.by_ref() {
                    if c == '"' {
                        break;
                    }
                    s.push(c);
                }
                tokens.push(DtsToken::StringLit(s));
            }
            '<' => {
                // Cell array <0x12 0x34 &label>
                let mut cell_content = String::new();
                for (_, c) in chars.by_ref() {
                    if c == '>' {
                        break;
                    }
                    cell_content.push(c);
                }
                let trimmed = cell_content.trim();
                if trimmed.starts_with('&') && !trimmed.contains(' ') {
                    tokens.push(DtsToken::Reference(trimmed.to_string()));
                } else {
                    let cells = parse_cells_inner(&cell_content);
                    tokens.push(DtsToken::Cells(cells));
                }
            }
            '[' => {
                // Byte array [00 11 22]
                let mut byte_content = String::new();
                for (_, c) in chars.by_ref() {
                    if c == ']' {
                        break;
                    }
                    byte_content.push(c);
                }
                let bytes = parse_bytes_inner(&byte_content);
                tokens.push(DtsToken::Bytes(bytes));
            }
            _ => {
                // Word / Identifier / Directive
                let mut word = String::new();
                word.push(ch);
                while let Some(&(_, next_c)) = chars.peek() {
                    if next_c.is_whitespace()
                        || next_c == ';'
                        || next_c == '='
                        || next_c == '{'
                        || next_c == '}'
                        || next_c == ':'
                        || next_c == ','
                        || next_c == '<'
                        || next_c == '>'
                    {
                        break;
                    }
                    word.push(chars.next().unwrap().1);
                }

                // Skip standalone compiler directives like /dts-v1/ or /plugin/
                if word == "/dts-v1/" || word == "/plugin/" {
                    // Expect trailing semicolon if any
                    if let Some(&(_, ';')) = chars.peek() {
                        chars.next();
                    }
                    continue;
                }

                tokens.push(DtsToken::Word(word));
            }
        }
    }

    tokens
}

fn parse_cells_inner(s: &str) -> Vec<u64> {
    let mut out = Vec::new();
    for token in s.split_whitespace() {
        if token.starts_with('&') {
            // Reference inside cell array: store dummy or hash
            out.push(1);
        } else if let Ok(val) = crate::xml::parse_int_u64(token) {
            out.push(val);
        }
    }
    out
}

fn parse_bytes_inner(s: &str) -> Vec<u8> {
    s.split_whitespace()
        .filter_map(|part| u8::from_str_radix(part, 16).ok())
        .collect()
}

struct DtsParser {
    tokens: Vec<DtsToken>,
    pos: usize,
}

impl DtsParser {
    fn new(tokens: Vec<DtsToken>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&DtsToken> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<DtsToken> {
        let t = self.tokens.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn parse_top_level(&mut self) -> Result<Vec<DtsNode>> {
        let mut nodes = Vec::new();

        while self.pos < self.tokens.len() {
            match self.peek() {
                Some(DtsToken::Word(_)) => {
                    let node = self.parse_node()?;
                    nodes.push(node);
                }
                _ => {
                    self.pos += 1;
                }
            }
        }

        Ok(nodes)
    }

    fn parse_node(&mut self) -> Result<DtsNode> {
        let mut label = None;
        let mut name = String::new();

        if let Some(DtsToken::Word(w)) = self.next() {
            name = w;
        }

        // Check if there is a colon (label: node_name {)
        if let Some(DtsToken::Colon) = self.peek() {
            self.next(); // consume ':'
            label = Some(name);
            name = if let Some(DtsToken::Word(w)) = self.next() {
                w
            } else {
                String::new()
            };
        }

        let unit_address = name.split('@').nth(1).map(ToString::to_string);

        // Expect opening brace '{'
        if let Some(DtsToken::BraceOpen) = self.peek() {
            self.next(); // consume '{'
        } else {
            return Err(ImporterError::DtsParse(format!(
                "expected '{{' after node name '{name}', found {:?}",
                self.peek()
            )));
        }

        let mut properties = BTreeMap::new();
        let mut children = Vec::new();

        // Parse properties and children until '}'
        while self.pos < self.tokens.len() {
            match self.peek() {
                Some(DtsToken::BraceClose) => {
                    self.next(); // consume '}'
                    if let Some(DtsToken::Semicolon) = self.peek() {
                        self.next(); // consume optional ';'
                    }
                    break;
                }
                Some(DtsToken::Word(w)) => {
                    let word = w.clone();
                    // Peek ahead to see if it's a child node or property
                    if self.tokens.get(self.pos + 1) == Some(&DtsToken::BraceOpen)
                        || self.tokens.get(self.pos + 1) == Some(&DtsToken::Colon)
                    {
                        // Child node
                        let child = self.parse_node()?;
                        children.push(child);
                    } else {
                        // Property definition
                        self.next(); // consume property name
                        let prop_name = word;
                        let prop_value = self.parse_property_value();
                        properties.insert(prop_name, prop_value);
                    }
                }
                _ => {
                    self.pos += 1;
                }
            }
        }

        Ok(DtsNode {
            name,
            label,
            unit_address,
            properties,
            children,
        })
    }

    fn parse_property_value(&mut self) -> DtsValue {
        if let Some(DtsToken::Semicolon) = self.peek() {
            self.next(); // empty boolean property e.g. "spi-cpol;"
            return DtsValue::Empty;
        }

        if let Some(DtsToken::Equals) = self.peek() {
            self.next(); // consume '='
        }

        let mut strings = Vec::new();

        loop {
            match self.peek() {
                Some(DtsToken::Semicolon) => {
                    self.next(); // consume ';'
                    break;
                }
                Some(DtsToken::StringLit(s)) => {
                    let s_val = s.clone();
                    self.next();
                    strings.push(s_val);
                    if let Some(DtsToken::Comma) = self.peek() {
                        self.next(); // consume ','
                    }
                }
                Some(DtsToken::Cells(cells)) => {
                    let c_val = cells.clone();
                    self.next();
                    if let Some(DtsToken::Semicolon) = self.peek() {
                        self.next();
                    }
                    return DtsValue::Cells(c_val);
                }
                Some(DtsToken::Bytes(bytes)) => {
                    let b_val = bytes.clone();
                    self.next();
                    if let Some(DtsToken::Semicolon) = self.peek() {
                        self.next();
                    }
                    return DtsValue::Bytes(b_val);
                }
                Some(DtsToken::Reference(ref_val)) => {
                    let r_val = ref_val.clone();
                    self.next();
                    if let Some(DtsToken::Semicolon) = self.peek() {
                        self.next();
                    }
                    return DtsValue::Reference(r_val);
                }
                Some(DtsToken::Word(w)) if w.starts_with('&') => {
                    let ref_val = w.clone();
                    self.next();
                    if let Some(DtsToken::Semicolon) = self.peek() {
                        self.next();
                    }
                    return DtsValue::Reference(ref_val);
                }
                Some(_) => {
                    self.next();
                }
                None => break,
            }
        }

        if strings.is_empty() {
            DtsValue::Empty
        } else {
            DtsValue::StringList(strings)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DTS: &str = r#"
        /dts-v1/;
        /plugin/;

        / {
            model = "Raspberry Pi 4 Model B";

            fragment@0 {
                target = <&i2c1>;
                __overlay__ {
                    status = "okay";
                    #address-cells = <1>;
                    #size-cells = <0>;

                    bme280@76 {
                        compatible = "bosch,bme280";
                        reg = <0x76>;
                        status = "okay";
                    };

                    eeprom@50 {
                        compatible = "atmel,24c256";
                        reg = <0x50>;
                    };
                };
            };
        };

        &spi0 {
            status = "okay";

            spidev0: spidev@0 {
                compatible = "rohm,dh2228fv", "spidev";
                reg = <0>;
                spi-max-frequency = <10000000>;
                spi-cpol;
            };
        };

        gpio1: gpio@4804c000 {
            compatible = "ti,omap4-gpio";
            gpio-controller;
            #gpio-cells = <2>;
            ngpios = <32>;
        };
    "#;

    #[test]
    fn parses_dts_and_extracts_buses_and_devices() {
        let board = VirtualBoardDraft::from_dts(SAMPLE_DTS).expect("valid DTS parsing");
        assert_eq!(board.name, "Raspberry Pi 4 Model B");

        // Verify buses
        assert!(board.buses.iter().any(|b| b.bus_type == BusType::I2c));
        assert!(board.buses.iter().any(|b| b.bus_type == BusType::Spi));
        assert!(board.buses.iter().any(|b| b.bus_type == BusType::Gpio));

        // Verify devices
        assert_eq!(board.devices.len(), 3);

        let bme280 = board
            .devices
            .iter()
            .find(|d| d.id.starts_with("bme280"))
            .unwrap();
        assert_eq!(bme280.bus_type, BusType::I2c);
        assert_eq!(bme280.address, Some(0x76));
        assert_eq!(bme280.compatible, vec!["bosch,bme280"]);

        let eeprom = board
            .devices
            .iter()
            .find(|d| d.id.starts_with("24c256"))
            .unwrap();
        assert_eq!(eeprom.bus_type, BusType::I2c);
        assert_eq!(eeprom.address, Some(0x50));

        let spidev = board
            .devices
            .iter()
            .find(|d| d.id.starts_with("dh2228fv") || d.id.starts_with("spidev"))
            .unwrap();
        assert_eq!(spidev.bus_type, BusType::Spi);
        assert_eq!(spidev.address, Some(0));
        assert_eq!(spidev.spi_mode, Some(2)); // CPOL=1, CPHA=0 -> mode 2
        assert_eq!(spidev.spi_max_frequency_hz, Some(10_000_000));
    }

    #[test]
    fn converts_stubs_to_device_models() {
        let board = VirtualBoardDraft::from_dts(SAMPLE_DTS).expect("valid DTS parsing");

        let bme280 = board
            .devices
            .iter()
            .find(|d| d.id.starts_with("bme280"))
            .unwrap();
        let i2c_model = bme280.to_device_model().expect("generates I2C model");
        assert_eq!(i2c_model.device.bus, "i2c");
        assert_eq!(i2c_model.device.model, "generic-i2c-register");
        assert!(!i2c_model.device.registers.is_empty());

        let spidev = board
            .devices
            .iter()
            .find(|d| d.id.starts_with("dh2228fv") || d.id.starts_with("spidev"))
            .unwrap();
        let spi_model = spidev.to_device_model().expect("generates SPI model");
        assert_eq!(spi_model.device.bus, "spi");
        assert_eq!(spi_model.device.model, "generic-spi-command");
        assert!(!spi_model.device.commands.is_empty());
    }
}
