use std::{sync::Arc, time::Duration};

use vds_core::{clock::ManualClock, device::Device};
use vds_device_model::DeviceModel;

const MODEL: &str = include_str!("../../../device-models/examples/generic-spi-flash/model.yaml");

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
