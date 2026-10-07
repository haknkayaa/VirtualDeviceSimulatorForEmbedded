use vds_device_model::DeviceModel;
use vds_importer::{import_svd, svd::SvdPeripheral};
use vds_registers::AccessType;

const REALISTIC_STM32_SVD: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<device schemaVersion="1.3" xmlns:xs="http://www.w3.org/2001/XMLSchema-instance">
  <name>STM32F429</name>
  <version>1.0</version>
  <description>ARM 32-bit Cortex-M4 MCU</description>
  <addressUnitBits>8</addressUnitBits>
  <width>32</width>
  <size>32</size>
  <resetValue>0x00000000</resetValue>
  <resetMask>0xFFFFFFFF</resetMask>
  <peripherals>
    <peripheral>
      <name>SPI1</name>
      <description>Serial peripheral interface</description>
      <groupName>SPI</groupName>
      <baseAddress>0x40013000</baseAddress>
      <registers>
        <register>
          <name>CR1</name>
          <description>control register 1</description>
          <addressOffset>0x00</addressOffset>
          <size>16</size>
          <access>read-write</access>
          <resetValue>0x0000</resetValue>
          <fields>
            <field>
              <name>CPHA</name>
              <description>Clock phase</description>
              <bitOffset>0</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-write</access>
            </field>
            <field>
              <name>CPOL</name>
              <description>Clock polarity</description>
              <bitOffset>1</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-write</access>
            </field>
            <field>
              <name>MSTR</name>
              <description>Master selection</description>
              <bitOffset>2</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-write</access>
            </field>
            <field>
              <name>BR</name>
              <description>Baud rate control</description>
              <bitRange>[5:3]</bitRange>
              <access>read-write</access>
            </field>
            <field>
              <name>SPE</name>
              <description>SPI enable</description>
              <lsb>6</lsb>
              <msb>6</msb>
              <access>read-write</access>
            </field>
          </fields>
        </register>
        <register>
          <name>SR</name>
          <description>status register</description>
          <addressOffset>0x08</addressOffset>
          <size>16</size>
          <access>read-only</access>
          <resetValue>0x0002</resetValue>
          <fields>
            <field>
              <name>RXNE</name>
              <description>Receive buffer not empty</description>
              <bitOffset>0</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-only</access>
            </field>
            <field>
              <name>TXE</name>
              <description>Transmit buffer empty</description>
              <bitOffset>1</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-only</access>
            </field>
            <field>
              <name>BSY</name>
              <description>Busy flag</description>
              <bitOffset>7</bitOffset>
              <bitWidth>1</bitWidth>
              <access>read-only</access>
            </field>
          </fields>
        </register>
        <register>
          <name>DATA_%s</name>
          <description>Array of 4 buffer registers</description>
          <addressOffset>0x10</addressOffset>
          <size>8</size>
          <access>read-write</access>
          <resetValue>0x00</resetValue>
          <dim>4</dim>
          <dimIncrement>1</dimIncrement>
          <dimIndex>0-3</dimIndex>
        </register>
      </registers>
    </peripheral>
    <peripheral derivedFrom="SPI1">
      <name>SPI2</name>
      <description>SPI2 inheriting from SPI1</description>
      <baseAddress>0x40003800</baseAddress>
    </peripheral>
  </peripherals>
</device>
"#;

#[test]
fn parses_comprehensive_svd_with_arrays_and_bitfield_formats() {
    let device = import_svd(REALISTIC_STM32_SVD).expect("parsing realistic SVD");
    assert_eq!(device.name, "STM32F429");
    assert_eq!(device.default_size, 32);

    let spi1 = device.peripheral("SPI1").expect("SPI1 exists");
    assert_eq!(spi1.base_address, 0x4001_3000);

    // CR1, SR, and DATA_0, DATA_1, DATA_2, DATA_3 = 6 registers total
    assert_eq!(spi1.registers.len(), 6);

    let cr1 = &spi1.registers[0];
    assert_eq!(cr1.name, "CR1");
    assert_eq!(cr1.size, 16);
    assert_eq!(cr1.access, AccessType::Rw);
    assert_eq!(cr1.fields.len(), 5);

    // Check Format 1: bitOffset + bitWidth
    assert_eq!(cr1.fields[0].name, "CPHA");
    assert_eq!(cr1.fields[0].lsb, 0);
    assert_eq!(cr1.fields[0].width, 1);

    // Check Format 2: bitRange [5:3]
    assert_eq!(cr1.fields[3].name, "BR");
    assert_eq!(cr1.fields[3].lsb, 3);
    assert_eq!(cr1.fields[3].width, 3);

    // Check Format 3: <lsb>6</lsb><msb>6</msb>
    assert_eq!(cr1.fields[4].name, "SPE");
    assert_eq!(cr1.fields[4].lsb, 6);
    assert_eq!(cr1.fields[4].width, 1);

    // Check Register Array expansion (dim)
    assert_eq!(spi1.registers[2].name, "DATA_0");
    assert_eq!(spi1.registers[2].address_offset, 0x10);
    assert_eq!(spi1.registers[3].name, "DATA_1");
    assert_eq!(spi1.registers[3].address_offset, 0x11);
    assert_eq!(spi1.registers[4].name, "DATA_2");
    assert_eq!(spi1.registers[4].address_offset, 0x12);
    assert_eq!(spi1.registers[5].name, "DATA_3");
    assert_eq!(spi1.registers[5].address_offset, 0x13);

    // Check derivedFrom inheritance
    let spi2 = device.peripheral("SPI2").expect("SPI2 exists");
    assert_eq!(spi2.base_address, 0x4000_3800);
    assert_eq!(spi2.registers.len(), 6);
    assert_eq!(spi2.registers[0].name, "CR1");
}

#[test]
fn converts_svd_to_schema_valid_device_model() {
    let raw_periph = r#"
      <peripheral>
        <name>AD7991</name>
        <description>Analog Devices 4-channel 12-bit ADC</description>
        <baseAddress>0x28</baseAddress>
        <registers>
          <register>
            <name>RESULT</name>
            <description>Conversion result register</description>
            <addressOffset>0x00</addressOffset>
            <size>8</size>
            <access>read-only</access>
            <resetValue>0x00</resetValue>
          </register>
          <register>
            <name>CONFIG</name>
            <description>Configuration register</description>
            <addressOffset>0x02</addressOffset>
            <size>8</size>
            <access>read-write</access>
            <resetValue>0x00</resetValue>
          </register>
        </registers>
      </peripheral>
    "#;

    let periph = SvdPeripheral::from_xml(raw_periph).expect("SVD snippet");
    let model = periph.to_device_model("i2c").expect("generates model");

    let yaml = serde_yaml::to_string(&model).expect("serializes to YAML");
    let parsed_model = DeviceModel::from_yaml(&yaml).expect("validates against DEVICE_MODEL_SCHEMA");
    assert_eq!(parsed_model.device.id, "ad7991");
    assert_eq!(parsed_model.device.bus, "i2c");
    assert_eq!(parsed_model.device.registers.len(), 2);
}
