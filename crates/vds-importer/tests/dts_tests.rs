use vds_device_model::DeviceModel;
use vds_importer::{
    dts::BusType,
    import_dts,
    merge_stub_and_svd,
    svd::SvdPeripheral,
};

const SAMPLE_BOARD_DTS: &str = r#"
/dts-v1/;
/plugin/;

/ {
    model = "VDS4E Virtual Carrier Board";

    fragment@0 {
        target = <&i2c1>;
        __overlay__ {
            status = "okay";
            clock-frequency = <400000>;
            #address-cells = <1>;
            #size-cells = <0>;

            adc@28 {
                compatible = "adi,ad7991";
                reg = <0x28>;
                status = "okay";
            };

            temp_sensor: bme280@76 {
                compatible = "bosch,bme280";
                reg = <0x76>;
                interrupt-parent = <&gpio0>;
                interrupts = <12 2>;
            };
        };
    };
};

&spi0 {
    status = "okay";
    #address-cells = <1>;
    #size-cells = <0>;

    spidev@0 {
        compatible = "spidev";
        reg = <0>;
        spi-max-frequency = <25000000>;
    };
};

gpio0: gpio@48000000 {
    compatible = "ti,omap4-gpio";
    gpio-controller;
    #gpio-cells = <2>;
    ngpios = <32>;
};
"#;

#[test]
fn parses_dts_and_extracts_peripherals() {
    let board = import_dts(SAMPLE_BOARD_DTS).expect("importing DTS succeeds");
    assert_eq!(board.name, "VDS4E Virtual Carrier Board");

    // Buses: i2c1, spi0, gpio0
    assert_eq!(board.buses.len(), 3);
    assert!(board.buses.iter().any(|b| b.bus_type == BusType::I2c));
    assert!(board.buses.iter().any(|b| b.bus_type == BusType::Spi));
    assert!(board.buses.iter().any(|b| b.bus_type == BusType::Gpio));

    // Devices: ad7991, bme280, spidev
    assert_eq!(board.devices.len(), 3);

    // Verify AD7991
    let ad7991 = board.devices.iter().find(|d| d.id.starts_with("ad7991")).expect("ad7991 stub");
    assert_eq!(ad7991.bus_type, BusType::I2c);
    assert_eq!(ad7991.address, Some(0x28));
    assert_eq!(ad7991.compatible, vec!["adi,ad7991"]);

    // Verify BME280
    let bme280 = board.devices.iter().find(|d| d.id.starts_with("bme280")).expect("bme280 stub");
    assert_eq!(bme280.bus_type, BusType::I2c);
    assert_eq!(bme280.address, Some(0x76));
    assert_eq!(bme280.interrupts, vec![12, 2]);

    // Verify spidev
    let spidev = board.devices.iter().find(|d| d.id.starts_with("spidev")).expect("spidev stub");
    assert_eq!(spidev.bus_type, BusType::Spi);
    assert_eq!(spidev.address, Some(0));
    assert_eq!(spidev.spi_max_frequency_hz, Some(25_000_000));
}

#[test]
fn generates_schema_valid_device_models_from_stubs() {
    let board = import_dts(SAMPLE_BOARD_DTS).expect("importing DTS");

    for stub in &board.devices {
        let yaml = stub.export_yaml().expect("exports YAML stub");
        let validated = DeviceModel::from_yaml(&yaml).expect("validates against DEVICE_MODEL_SCHEMA");
        assert_eq!(validated.schema_version, 1);
        assert!(!validated.device.id.is_empty());
    }
}

#[test]
fn merges_dts_stub_with_svd_registers_and_validates() {
    let board = import_dts(SAMPLE_BOARD_DTS).expect("importing DTS");
    let ad7991_stub = board.devices.iter().find(|d| d.id.starts_with("ad7991")).unwrap();

    let svd_content = r#"
      <peripheral>
        <name>AD7991</name>
        <baseAddress>0x28</baseAddress>
        <registers>
          <register>
            <name>CONV_RES</name>
            <addressOffset>0x00</addressOffset>
            <size>8</size>
            <access>read-only</access>
            <resetValue>0x00</resetValue>
          </register>
        </registers>
      </peripheral>
    "#;

    let svd = SvdPeripheral::from_xml(svd_content).expect("SVD XML");
    let merged = merge_stub_and_svd(ad7991_stub, &svd).expect("merges stub and svd");

    let yaml = serde_yaml::to_string(&merged).expect("serializes YAML");
    let validated = DeviceModel::from_yaml(&yaml).expect("validates schema");
    assert_eq!(validated.device.id, "ad7991-28");
    assert_eq!(validated.device.registers.len(), 1);
    assert_eq!(validated.device.registers[0].name, "CONV_RES");
}
