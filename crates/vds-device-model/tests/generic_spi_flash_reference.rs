use std::{sync::Arc, time::Duration};

use vds_core::{clock::ManualClock, device::Device};
use vds_device_model::DeviceModel;

const MODEL: &str =
    include_str!("../../../device-models/examples/generic-spi-flash/model/device.yaml");
const MICRON_MODEL: &str =
    include_str!("../../../device-models/examples/micron-mt25ql256aba8esf-0sit/model/device.yaml");
const MICRON_FLOW: &str = include_str!(
    "../../../device-models/examples/micron-mt25ql256aba8esf-0sit/flows/behavior.yaml"
);

fn fixture() -> (Arc<ManualClock>, vds_device_model::GenericSpiDevice) {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(MODEL)
        .unwrap()
        .into_spi_device_with_clock(clock.clone())
        .unwrap();
    clock.advance(Duration::from_millis(5)).unwrap();
    device.run_due_events().unwrap();
    (clock, device)
}

#[test]
fn reference_model_has_public_geometry_commands_registers_and_faults() {
    let model = DeviceModel::from_yaml(MODEL).unwrap();
    let memory = model.device.memory.unwrap();
    assert_eq!(model.device.spi.unwrap().mode, 0);
    assert_eq!(model.device.spi.unwrap().transfer_bits, 8);
    assert_eq!(memory.size_bytes, 16 * 1024 * 1024);
    assert_eq!(memory.page_size_bytes, 256);
    assert_eq!(memory.sector_size_bytes, 4096);
    assert_eq!(memory.erased_value, 0xFF);
    assert_eq!(model.device.commands.len(), 12);
    assert_eq!(model.device.registers.len(), 3);
    assert_eq!(model.device.faults.len(), 6);
    assert_eq!(model.device.state_machine.unwrap().states.len(), 8);
}

#[test]
fn page_program_is_bounded_and_only_clears_bits() {
    let (clock, device) = fixture();
    device.transfer(&[0x06]).unwrap();
    device.transfer(&[0x02, 0x00, 0x00, 0x10, 0x0F]).unwrap();
    clock.advance(Duration::from_millis(10)).unwrap();
    device.run_due_events().unwrap();

    device.transfer(&[0x06]).unwrap();
    device.transfer(&[0x02, 0x00, 0x00, 0x10, 0xF0]).unwrap();
    clock.advance(Duration::from_millis(10)).unwrap();
    device.run_due_events().unwrap();
    assert_eq!(
        device
            .transfer(&[0x03, 0x00, 0x00, 0x10, 0x00])
            .unwrap()
            .response,
        [0x00]
    );

    device.transfer(&[0x06]).unwrap();
    let error = device
        .transfer(&[0x02, 0x00, 0x00, 0xFF, 0xAA, 0x55])
        .unwrap_err();
    assert!(error.to_string().contains("page boundary"));
}

#[test]
fn named_register_reads_accept_spi_dummy_clock_bytes() {
    let (_, device) = fixture();

    assert_eq!(device.transfer(&[0x05, 0x00]).unwrap().response, [0x00]);
}

#[test]
fn micron_behavior_flow_resets_erases_programs_and_reads() {
    let clock = Arc::new(ManualClock::default());
    let mut model = DeviceModel::from_yaml(MICRON_MODEL).unwrap();
    model.apply_behavior_flow(MICRON_FLOW, ".").unwrap();
    let device = model.into_spi_device_with_clock(clock.clone()).unwrap();

    clock.advance(Duration::from_micros(1)).unwrap();
    device.run_due_events().unwrap();
    device.transfer(&[0x66]).unwrap();
    device.transfer(&[0x99]).unwrap();
    clock.advance(Duration::from_micros(1)).unwrap();
    device.run_due_events().unwrap();

    device.transfer(&[0x06]).unwrap();
    device.transfer(&[0x21, 0x00, 0x10, 0x00, 0x00]).unwrap();
    clock.advance(Duration::from_millis(50)).unwrap();
    device.run_due_events().unwrap();

    device.transfer(&[0x06]).unwrap();
    device
        .transfer(&[0x12, 0x00, 0x10, 0x00, 0x00, 0xA5, 0x5A])
        .unwrap();
    clock.advance(Duration::from_micros(120)).unwrap();
    device.run_due_events().unwrap();

    assert_eq!(
        device
            .transfer(&[0x13, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00])
            .unwrap()
            .response,
        [0xA5, 0x5A]
    );
}
