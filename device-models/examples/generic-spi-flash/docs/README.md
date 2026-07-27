# Generic SPI Flash 128 Mbit device package

This directory is VDS4E's complete, vendor-neutral public reference model. It
models a 128 Mbit (16 MiB) SPI mode 0 flash with 8-bit transfers. Names,
identifiers, timings, and protocol behavior are generic and contain no
company-private device information.

## Contents

- `device-package.yaml` — versioned package identity, bus, runtime, and resource
  declarations.
- `model/device.yaml` — declarative device, registers, commands, state machine,
  memory geometry, timing, and six deterministic fault profiles.
- `flows/behavior.yaml` — editable visual behavior graph loaded by the Devices
  screen through the Control API.
- `scenarios/` — ten conformance scenarios executed by the existing
  `vds-scenario` engine.
- `fixtures/`, `assets/`, and `docs/` — package-local test data, UI assets, and
  documentation.

The directory is the deployment unit. Copying or moving the whole directory
preserves the model, editable flow, scenarios, documentation, and package-local
references.

Start the complete workspace with:

```bash
./dev.sh
```

The model is loaded as `generic-spi-flash-128m`.

Configure the directory once; individual files do not need to be listed:

```yaml
device_packages:
  - device-models/examples/generic-spi-flash
```

Package loading follows `device-package.yaml`; resource names are not inferred.
The declared runtime model is required, while the behavior flow, scenarios,
fixtures, documentation, and assets are optional. Every `.yaml` or `.yml` file
in the declared scenario directory is loaded automatically.

If the directory is moved elsewhere, update only the `device_packages` path.
Moving it back to the configured path restores the complete package on the next
server start.

## Interface

The flash uses SPI mode 0 and 8-bit transfers. Memory is 16 MiB, divided into
256-byte pages and 4 KiB sectors, with erased value `0xFF`. Page program
validates the address range and page boundary and commits `old & requested`, so
programming can only change bits from 1 to 0.

| Command | Opcode | Behavior |
| --- | ---: | --- |
| READ_ID | `9F` | Returns public generic ID `00 40 18` |
| READ_STATUS | `05` | Returns STATUS1 |
| WRITE_ENABLE / WRITE_DISABLE | `06` / `04` | Controls WEL and state |
| READ_DATA | `03` | Three-byte address; trailing dummy bytes select read length |
| PAGE_PROGRAM | `02` | Three-byte address and data, 10 ms |
| SECTOR_ERASE | `20` | Three-byte address, 150 ms |
| CHIP_ERASE | `C7` | Whole memory |
| DEEP_POWER_DOWN / RELEASE_POWER_DOWN | `B9` / `AB` | Release completes after 30 µs |
| RESET_ENABLE / RESET | `66` / `99` | Reset cancels pending work and enters resetting |

`READ_DATA` uses the number of bytes after its three-byte address as the
requested response length. For example, `03 00 00 10 00 00` reads two bytes.
This keeps the existing SPI transaction API unchanged.

## Registers

| Register | Bits |
| --- | --- |
| STATUS1 | `BUSY[0]`, `WEL[1]`, `BP0[2]`, `BP1[3]`, `BP2[4]` |
| STATUS2 | `QE[1]`, `SUS[7]` |
| CONFIG | `DUMMY_CYCLES[3:0]`, `HOLD_RESET_MODE[4]` |

BUSY and WEL are hardware-owned and are updated through state entry/exit
actions. Program and erase clear WEL when leaving `write_enabled`. Reset clears
pending scheduler entries before transitioning to `resetting`; an incomplete
memory operation therefore cannot commit later.

## State and timing model

The states are `powered_off`, `resetting`, `ready`, `write_enabled`,
`programming`, `erasing`, `deep_power_down`, and `error`. Resetting completes
after 5 ms. Page program and sector erase completion is scheduled by the
existing virtual scheduler at 10 ms and 150 ms. Release from power-down
dispatches its existing state event after 30 µs.

The visual representation uses the editor's edge-centric contract: states are
nodes; command/event triggers and reset paths are typed edges; register actions
are state data. Memory geometry and command timing remain device-model metadata
and execute only in the authoritative Rust runtime.

## Fault profiles

All profiles are disabled by default:

- `page_program_timeout`
- `sector_erase_timeout`
- `busy_stuck_at_1`
- `wel_forced_low`
- `read_data_corruption`
- `power_loss_during_program`

The power-loss profile is terminal and prevents scheduling/committing program
data. Timeout and corruption profiles use the existing structured fault path.

## Conformance

The scenarios cover read ID, WEL lifecycle, successful and rejected program,
sector erase, BUSY timing, deep-power-down rejection, reset cancellation,
timeout, and deterministic read corruption. The Rust integration test loads
every file from this directory into a fresh registry and runs it through
`ScenarioExecutor<RegistryRuntime>`.

The reference also has direct runtime tests for geometry, page boundaries, and
1-to-0 programming. No alternate scenario engine, device runtime, REST
transaction endpoint, scripting facility, or wall-clock timing path is used.
