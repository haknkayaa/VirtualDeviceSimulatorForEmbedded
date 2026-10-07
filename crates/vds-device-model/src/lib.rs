//! Declarative, schema-validated VDS4E device models.

mod at24c;
mod behavior_flow;
mod command;
mod error;
mod gpio;
mod i2c;
mod loading;
mod memory;
mod model;
mod runtime;
mod signal_graph;
mod signals;
mod uart;
mod validation;
pub use at24c::At24cEepromDevice;
use command::{SpiCommand, SpiCommandBehavior};
pub use error::ModelError;
pub use gpio::GenericGpioDevice;
pub use i2c::GenericI2cDevice;
pub use model::*;
pub use runtime::GenericSpiDevice;
use runtime::{DeviceAction, DeviceGuard, DeviceState, FlashMemory, PendingOperation};
pub use signal_graph::{
    FileFormat, FileWriteMode, ScheduledSignal, SignalEdge, SignalExecution, SignalGraph,
    SignalGraphDefinition, SignalNode, SignalValue, StateSignalRoot,
};
pub(crate) use signals::SignalOutputs;
pub use uart::GenericUartDevice;
use validation::{
    apply_actions, apply_stuck, compile_state_machine, decode_unsigned, encode_unsigned,
    evaluate_guard, initialize_state_machine, map_access, map_register_error, map_scheduler_error,
    map_state_machine_error, ms_to_ns, schedule_state_events, timing_failure,
    uncompiled_state_machine, validate_faults, validate_register_reference,
};

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use vds_core::device::{
    BusType, Device, DeviceError, DeviceTransfer, FaultErrorCode, FaultFailure, RegisterAccessType,
    RegisterErrorCode, RegisterFailure, RegisterOperation, RegisterSnapshot, RegisterTrace,
    SpiLaneWidth, SpiTransferRate, SpiWireConfig, StateErrorCode, StateFailure, TimingErrorCode,
    TimingFailure,
};
use vds_core::{
    clock::{RealTimeClock, SimulatorClock},
    event::{DeviceEvent, EventId, EventScheduler, SchedulerError},
    fault::{FaultAction, FaultContext, FaultDefinition, FaultEngine},
    state_machine::{
        DelayedEventDefinition, StateDefinition, StateMachine, StateMachineDefinition,
        StateMachineError, TransitionDefinition, TransitionOutcome,
    },
};
use vds_registers::{AccessType, RegisterDefinition, RegisterEngine, RegisterError};

#[cfg(test)]
mod tests;
