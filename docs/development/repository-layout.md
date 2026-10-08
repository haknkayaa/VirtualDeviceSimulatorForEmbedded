# Repository layout

The repository keeps the runtime, host ABI adapters, device packages and Web
control plane separate.

## Applications

- `apps/vds-server`: authoritative runtime owner, Unix-socket data plane,
  REST API and WebSocket event transport.
- `apps/vds-cli`: local diagnostics, device-package tooling and headless
  scenario commands.
- `apps/vds-web`: React/Vite control and observability client.

## Rust crates

- `crates/vds-core`: device registry, clocks, scheduling, topology and common
  runtime foundations.
- `crates/vds-device-model`: declarative device-model parsing and generic
  device behavior.
- `crates/vds-registers`: register/bitfield validation and runtime values.
- `crates/vds-scenario`: deterministic scenario parsing and execution.
- `crates/vds-events`: typed domain events, replay and persistence support.
- `crates/vds-protocol`: Protobuf data-plane contract and framing.
- `crates/vds-importer`: draft model import from hardware descriptions such as
  CMSIS-SVD and Device Tree source.

## Linux host adapters

- `adapters/bridge`: shared C transport/codec layer used by native helpers.
- `adapters/spi-cuse`: `/dev/spidevX.Y` CUSE adapter.
- `adapters/i2c-cuse`: `/dev/i2c-N` CUSE adapter.
- `adapters/gpio-sim`: kernel gpio-sim lifecycle/synchronization helper.
- `adapters/uart-pty`: unprivileged UART PTY helper.

Host adapters translate Linux ABIs and transport requests to the runtime. They
must not become a second implementation of device semantics.

## Device packages and schemas

- `device-models/examples/`: independently movable example device packages.
- `schemas/`: versioned public package/model/topology contracts.
- `config/`: repository example configuration and topology.

A device package owns its model, flows, scenarios, fixtures, documentation and
assets beneath one package root.

## Tests and examples

- `examples/`: normal application examples that use Linux interfaces.
- `tests/e2e/drdy/`: privileged SPI/I²C + GPIO real-ABI signal tests.
- Rust and Web unit/integration tests remain beside the code they validate.

## Build and packaging

- `./configure`: prerequisite/configuration stage.
- `./build.sh`: repository-wide staged build.
- `./install`: installation/staging step with `PREFIX` and `DESTDIR`.
- `packaging/debian/`: Debian package assembly.
- `.github/workflows/ci.yml`: regular main-branch verification.
- `.github/workflows/e2e-abi.yml`: manual privileged ABI verification.
- `.github/workflows/release.yml`: tag-driven Debian release.

## Documentation

- `README.md`: product overview and quick start.
- `VDS4E_ARCHITECTURE.md`: authoritative architecture.
- `docs/guides/`: operational user/contributor guides.
- `docs/development/`: implementation and authoring references.
- `docs/adr/`: accepted architecture decisions.
- `docs/ROADMAP.md`: planned work.

Future components stay in the roadmap until implementation begins. Company
private protocols, models, fixtures and test vectors belong outside the public
repository.
