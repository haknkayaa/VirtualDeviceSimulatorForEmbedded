//! Board interrupt wiring drafted from Device Tree connectivity.
//!
//! A peripheral whose `interrupt-parent` is a GPIO controller of the board gets
//! an `irq` output signal port, and the controller becomes a GPIO bank draft
//! whose interrupt lines the device drives. A topology connection joins the two
//! (ADR 0011). The interrupt level itself is a placeholder register bit the
//! model author replaces with the device's real interrupt condition.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
};

use serde::{Deserialize, Serialize};
use vds_device_model::{
    DeviceDefinition, DeviceModel, GpioBusDefinition, GpioLineDefinition, GpioLineDirection,
    RegisterBitSourceDefinition, SignalBindingDefinition, SignalOutputDefinition, SignalPortType,
    SignalSourceDefinition, SignalsDefinition,
};
use vds_registers::{AccessType, RegisterDefinition};

use crate::dts::{BusType, VirtualBoardDraft, VirtualBusDraft};

/// Output port added to a peripheral whose interrupt reaches a GPIO line.
pub const IRQ_SIGNAL: &str = "irq";
/// Placeholder register whose bit 0 drives [`IRQ_SIGNAL`].
pub const IRQ_REGISTER: &str = "IRQ_STATE";
/// Lines a GPIO controller draft has when the Device Tree gives no `ngpios`.
pub const DEFAULT_GPIO_LINES: u32 = 32;

/// A peripheral interrupt routed to a line of one of the board's GPIO controllers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GpioInterruptDraft {
    pub device_id: String,
    /// GPIO controller bus name, e.g. `gpio0`.
    pub controller: String,
    /// Line offset: the first `interrupts` cell.
    pub line: u32,
}

impl VirtualBoardDraft {
    /// Peripheral interrupts whose `interrupt-parent` is a GPIO controller of
    /// this board. Interrupts routed to other controllers are not GPIO lines and
    /// are left out.
    #[must_use]
    pub fn gpio_interrupts(&self) -> Vec<GpioInterruptDraft> {
        self.devices
            .iter()
            .filter_map(|device| {
                let parent = device.interrupt_parent.as_deref()?.trim_start_matches('&');
                let line = *device.interrupts.first()?;
                self.gpio_controller(parent)?;
                Some(GpioInterruptDraft {
                    device_id: device.id.clone(),
                    controller: parent.to_owned(),
                    line,
                })
            })
            .collect()
    }

    fn gpio_controller(&self, name: &str) -> Option<&VirtualBusDraft> {
        self.buses
            .iter()
            .find(|bus| bus.bus_type == BusType::Gpio && bus.name == name)
    }

    /// Draft `generic-gpio-bank` model for a GPIO controller with `GPIO<n>` lines.
    /// `device_driven` offsets are outputs a topology connection can drive; the
    /// others are host-driven inputs. The bank has `ngpios` lines (default
    /// [`DEFAULT_GPIO_LINES`]), extended to cover every driven offset.
    #[must_use]
    pub fn gpio_bank_model(
        &self,
        controller: &str,
        id: &str,
        device_driven: &BTreeSet<u32>,
    ) -> DeviceModel {
        let declared = self
            .gpio_controller(controller)
            .and_then(|bus| bus.properties.get("ngpios"))
            .and_then(|value| parse_cell(value))
            .unwrap_or(DEFAULT_GPIO_LINES);
        let count = device_driven
            .last()
            .map_or(declared, |last| declared.max(last + 1));
        let mut lines = Vec::new();
        let mut registers = Vec::new();
        for offset in 0..count {
            let driven = device_driven.contains(&offset);
            let register = format!("GPIO{offset}_STATE");
            lines.push(GpioLineDefinition {
                offset: u16::try_from(offset).unwrap_or(u16::MAX),
                name: format!("GPIO{offset}"),
                direction: if driven {
                    GpioLineDirection::Output
                } else {
                    GpioLineDirection::Input
                },
                initial_value: false,
                active_low: false,
                register: Some(register.clone()),
            });
            registers.push(RegisterDefinition {
                name: register,
                address: u64::from(offset),
                width_bits: 1,
                reset_value: 0,
                access: if driven {
                    AccessType::Rw
                } else {
                    AccessType::Ro
                },
                description: if driven {
                    format!("Line {offset}, driven by a peripheral interrupt")
                } else {
                    format!("Line {offset}, driven by the host")
                },
                bitfields: vec![],
            });
        }
        DeviceModel {
            schema_version: 1,
            device: DeviceDefinition {
                id: id.to_owned(),
                name: format!("{controller} GPIO controller"),
                bus: "gpio".to_owned(),
                model: "generic-gpio-bank".to_owned(),
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
                signals: None,
                signal_bindings: vec![],
            },
            signal_graph: None,
            package_root: None,
        }
    }
}

/// Adds an [`IRQ_SIGNAL`] output port driven by bit 0 of a new read/write
/// [`IRQ_REGISTER`], placed after the model's highest register address.
pub fn add_interrupt_output(model: &mut DeviceModel) {
    let device = &mut model.device;
    let address = device
        .registers
        .iter()
        .map(|register| register.address + 1)
        .max()
        .unwrap_or(0);
    device.registers.push(RegisterDefinition {
        name: IRQ_REGISTER.to_owned(),
        address,
        width_bits: 8,
        reset_value: 0,
        access: AccessType::Rw,
        description: "Draft interrupt level: bit 0 drives the irq output. Replace with the device's interrupt condition.".to_owned(),
        bitfields: vec![],
    });
    device
        .signals
        .get_or_insert_with(SignalsDefinition::default)
        .outputs
        .push(SignalOutputDefinition {
            name: IRQ_SIGNAL.to_owned(),
            kind: SignalPortType::Bool,
            description: "Interrupt request routed to a GPIO line by the board topology."
                .to_owned(),
        });
    device.signal_bindings.push(SignalBindingDefinition {
        signal: IRQ_SIGNAL.to_owned(),
        source: SignalSourceDefinition::Register(RegisterBitSourceDefinition {
            register: IRQ_REGISTER.to_owned(),
            bit: 0,
        }),
    });
}

/// `topology.yaml` connecting each `<device>.irq` to `<bank>.GPIO<line>`.
/// Device and controller IDs are mapped through `ids` (draft ID → package ID).
#[must_use]
pub fn interrupt_topology_yaml(
    interrupts: &[GpioInterruptDraft],
    ids: &BTreeMap<String, String>,
) -> String {
    let mut yaml = String::from(
        "# Draft generated from Device Tree interrupt wiring. Each peripheral's irq\n# output drives the GPIO line its interrupt-parent and interrupts name.\nschema_version: 1\nconnections:\n",
    );
    for interrupt in interrupts {
        let (Some(device), Some(bank)) = (
            ids.get(&interrupt.device_id),
            ids.get(&interrupt.controller),
        ) else {
            continue;
        };
        writeln!(
            yaml,
            "  - {{ from: {device}.{IRQ_SIGNAL}, to: {bank}.GPIO{} }}",
            interrupt.line
        )
        .expect("writing to String cannot fail");
    }
    yaml
}

/// Parses a formatted Device Tree cell (`0x20` or `32`).
fn parse_cell(value: &str) -> Option<u32> {
    let value = value.split_whitespace().next()?;
    value.strip_prefix("0x").map_or_else(
        || value.parse().ok(),
        |hex| u32::from_str_radix(hex, 16).ok(),
    )
}
