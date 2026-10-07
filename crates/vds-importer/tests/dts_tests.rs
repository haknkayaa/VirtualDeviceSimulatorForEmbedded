use vds_device_model::DeviceModel;
use vds_importer::{dts::BusType, import_dts, merge_stub_and_svd, svd::SvdPeripheral};

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
    let ad7991 = board
        .devices
        .iter()
        .find(|d| d.id.starts_with("ad7991"))
        .expect("ad7991 stub");
    assert_eq!(ad7991.bus_type, BusType::I2c);
    assert_eq!(ad7991.address, Some(0x28));
    assert_eq!(ad7991.compatible, vec!["adi,ad7991"]);

    // Verify BME280
    let bme280 = board
        .devices
        .iter()
        .find(|d| d.id.starts_with("bme280"))
        .expect("bme280 stub");
    assert_eq!(bme280.bus_type, BusType::I2c);
    assert_eq!(bme280.address, Some(0x76));
    assert_eq!(bme280.interrupts, vec![12, 2]);

    // Verify spidev
    let spidev = board
        .devices
        .iter()
        .find(|d| d.id.starts_with("spidev"))
        .expect("spidev stub");
    assert_eq!(spidev.bus_type, BusType::Spi);
    assert_eq!(spidev.address, Some(0));
    assert_eq!(spidev.spi_max_frequency_hz, Some(25_000_000));
}

#[test]
fn generates_schema_valid_device_models_from_stubs() {
    let board = import_dts(SAMPLE_BOARD_DTS).expect("importing DTS");

    for stub in &board.devices {
        let yaml = stub.export_yaml().expect("exports YAML stub");
        let validated =
            DeviceModel::from_yaml(&yaml).expect("validates against DEVICE_MODEL_SCHEMA");
        assert_eq!(validated.schema_version, 1);
        assert!(!validated.device.id.is_empty());
    }
}

#[test]
fn merges_dts_stub_with_svd_registers_and_validates() {
    let board = import_dts(SAMPLE_BOARD_DTS).expect("importing DTS");
    let ad7991_stub = board
        .devices
        .iter()
        .find(|d| d.id.starts_with("ad7991"))
        .unwrap();

    let svd_content = r"
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
    ";

    let svd = SvdPeripheral::from_xml(svd_content).expect("SVD XML");
    let merged = merge_stub_and_svd(ad7991_stub, &svd).expect("merges stub and svd");

    let yaml = serde_yaml::to_string(&merged).expect("serializes YAML");
    let validated = DeviceModel::from_yaml(&yaml).expect("validates schema");
    assert_eq!(validated.device.id, "ad7991-28");
    assert_eq!(validated.device.registers.len(), 1);
    assert_eq!(validated.device.registers[0].name, "CONV_RES");
}

#[test]
fn keeps_the_same_part_on_two_buses_as_two_devices() {
    let board = import_dts(
        r#"
/dts-v1/;
&i2c1 {
    status = "okay";
    bme280@76 { compatible = "bosch,bme280"; reg = <0x76>; };
};
&i2c1 {
    bme280@76 { compatible = "bosch,bme280"; reg = <0x76>; };
};
&i2c2 {
    status = "okay";
    bme280@76 { compatible = "bosch,bme280"; reg = <0x76>; };
};
"#,
    )
    .expect("importing DTS succeeds");
    let devices = board
        .devices
        .iter()
        .map(|device| (device.id.as_str(), device.bus_name.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(
        devices,
        [("bme280-76", "i2c1"), ("i2c2-bme280-76", "i2c2")],
        "a repeated node on one bus is one device; another bus is another device"
    );
}

#[test]
fn routes_gpio_interrupts_and_drafts_the_controller_bank() {
    use std::collections::{BTreeMap, BTreeSet};

    use vds_importer::{
        GpioInterruptDraft, IRQ_REGISTER, IRQ_SIGNAL, add_interrupt_output, interrupt_topology_yaml,
    };

    let board = import_dts(
        r#"
/dts-v1/;
gpio0: gpio@48000000 {
    compatible = "ti,omap4-gpio";
    gpio-controller;
    ngpios = <8>;
};
&i2c1 {
    status = "okay";
    imu@68 { compatible = "tdk,icm20948"; reg = <0x68>; interrupt-parent = <&gpio0>; interrupts = <10 1>; };
    rtc@51 { compatible = "nxp,pcf85063"; reg = <0x51>; interrupt-parent = <&intc>; interrupts = <3>; };
    eeprom@50 { compatible = "atmel,24c256"; reg = <0x50>; };
};
"#,
    )
    .expect("importing DTS succeeds");

    let interrupts = board.gpio_interrupts();
    assert_eq!(
        interrupts,
        [GpioInterruptDraft {
            device_id: "icm20948-68".to_owned(),
            controller: "gpio0".to_owned(),
            line: 10,
        }],
        "only interrupts whose parent is a GPIO controller are lines"
    );

    // ngpios = 8, extended to cover line 10; only the interrupt line is device-driven.
    let bank = board.gpio_bank_model("gpio0", "gpio0", &BTreeSet::from([10]));
    let lines = &bank.device.gpio.as_ref().expect("gpio lines").lines;
    assert_eq!(lines.len(), 11);
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.direction == vds_device_model::GpioLineDirection::Output)
            .map(|line| line.name.as_str())
            .collect::<Vec<_>>(),
        ["GPIO10"]
    );
    DeviceModel::from_yaml(&vds_importer::export_model_yaml(&bank).unwrap())
        .expect("bank draft is a valid model");

    let stub = board.device("icm20948-68").expect("imu stub");
    let mut model = stub.to_device_model().expect("model");
    let highest = model.device.registers.iter().map(|r| r.address).max();
    add_interrupt_output(&mut model);
    let irq = model
        .device
        .registers
        .iter()
        .find(|register| register.name == IRQ_REGISTER)
        .expect("IRQ register");
    assert_eq!(Some(irq.address), highest.map(|address| address + 1));
    assert_eq!(
        model.device.signals.as_ref().unwrap().outputs[0].name,
        IRQ_SIGNAL
    );
    DeviceModel::from_yaml(&vds_importer::export_model_yaml(&model).unwrap())
        .expect("model with irq output is valid");

    let ids = BTreeMap::from([
        ("icm20948-68".to_owned(), "imu".to_owned()),
        ("gpio0".to_owned(), "bank".to_owned()),
    ]);
    assert!(
        interrupt_topology_yaml(&interrupts, &ids)
            .ends_with("connections:\n  - { from: imu.irq, to: bank.GPIO10 }\n")
    );
}
