//! Compiled SPI commands and command behavior.

use super::{CommandTimingDefinition, SpiCommandWireDefinition};

pub(super) struct SpiCommand {
    pub(super) name: String,
    pub(super) allowed_states: Vec<String>,
    pub(super) event: Option<String>,
    pub(super) event_delay_us: Option<u64>,
    pub(super) wire: Option<SpiCommandWireDefinition>,
    pub(super) behavior: SpiCommandBehavior,
}

pub(super) enum SpiCommandBehavior {
    FixedResponse(Vec<u8>),
    RegisterRead {
        address_bytes: Option<u8>,
        register: Option<String>,
    },
    RegisterWrite {
        address_bytes: Option<u8>,
        register: Option<String>,
        timing: Option<CommandTimingDefinition>,
    },
    MemoryRead {
        address_bytes: u8,
    },
    PageProgram {
        address_bytes: u8,
        timing: CommandTimingDefinition,
    },
    SectorErase {
        address_bytes: u8,
        timing: CommandTimingDefinition,
    },
    ChipErase {
        timing: CommandTimingDefinition,
    },
}
