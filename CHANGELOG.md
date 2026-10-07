# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `GET /api/v1/topology` lists the attached board topology's signal connections
  with their delay, last sampled source level and in-flight delayed deliveries.
- The Web UI shows *Signal connections* on the Overview and, scoped to the
  device, on the Devices Configuration tab.
- Scenario coverage (ADR 0013): run results report, per device the scenario
  touches, which declared commands, registers, states, state transitions and
  faults were exercised. Shown in the JSON result, as `vds4e.coverage.*` JUnit
  properties, as a CLI summary on standard error, in the Visual Scenario
  Editor's result panel and on the Overview's *Scenario run* panel.
- `vds-cli import dts SOURCE --output DIR` drafts a loadable device package per
  enabled SPI, I2C and GPIO Device Tree peripheral and writes a `board.md` summary
  with endpoints, interrupts, skipped nodes and the `device_packages` entries.

### Changed
- The Web UI Overview shows the live device path from the application under
  test through each adapter (Linux device node) to its virtual device, with
  per-link traffic, the running scenario's step progress, an Attention list
  that includes missing kernel modules with a copyable fix, recent
  transactions with decoded operation names, and a per-bus activity timeline.
- A global top bar shows server state, loaded adapters, virtual time,
  transaction rate, session failures and p95 latency on every page.
- Transactions accepts `?bus=` and `?result=failed` deep links and has a
  "Failures only" filter.
- Web UI visual system: navy surfaces, a larger type scale and sentence-case
  headings instead of uppercase labels.

### Fixed
- The Device Tree importer no longer drops the second of two identical parts
  on different buses; the second gets a bus-prefixed ID.

## [0.1.2] - 2026-10-07

### Changed
- Web UI redesigned as an engineering workstation: one navigation rail and a
  bottom status bar replace the double navigation, placeholder account chrome and
  footer; a token-based design system (dark and light) replaces the glass styling.
- The Web UI home page is now an Overview of Linux device nodes → adapters →
  devices with live bus counters, a derived problems list, recent bus traffic,
  the last scenario run, signal activity, host telemetry and an event tail.
- Transactions and the Logic Analyzer share one capture toolbar; Transactions
  supports `?transaction=` deep links and shows scenario-injected traffic.
- Devices is a three-pane register/command/fault workbench; Adapters shows
  daemon PIDs, kernel-module hints and conflict checks; the Event Log follows the
  tail only while scrolled to the bottom.
- The unused `react-circular-progressbar` Web UI dependency was removed.

## [0.1.1] - 2026-10-07

### Added
- The packaged server serves the bundled React Web UI from the same control-plane
  address, including SPA route fallback.
- The Debian package installs a `vds4e` launcher and a `vds4e.service` systemd
  unit. The service is installed but is not enabled automatically.

### Fixed
- Debian installs no longer leave Web UI assets unused under
  `/usr/share/vds4e/web`; opening `http://127.0.0.1:8080/` now loads the UI.
- Release smoke testing starts the installed server and verifies both the REST
  health endpoint and Web UI routes.


### Added
- Debian `amd64` package builder and tag-driven GitHub Release workflow that
  publishes the `.deb` and SHA-256 checksum.
- `signal_changed` domain event for every signal propagation step, shown in the Web
  UI event stream and filters (ADR 0012).
- `i2c-sensor-drdy` example and an I2C + GPIO real-ABI E2E test (i2c-tools, gpiomon).
- On-demand `Device ABI E2E` workflow (QEMU on hosted runners, or a self-hosted
  privileged runner).
- `tests/e2e/drdy`: real-ABI end-to-end test (spidev_test, gpio-sim, gpiomon) for
  the signal topology flow, with a QEMU runner.
- Public device signal ports, `signal_bindings`, and a `topology.yaml` that
  connects them to GPIO lines with deterministic zero-delay or `delay_ns`
  propagation (ADR 0011).
- Register bitfield `read_clear` attribute.
- `spi-sensor-drdy` example package and `config/topology.example.yaml`.
- Optional `topology` key in the server configuration.
- Separate CI jobs for Rust, web UI, native adapters (with ASan/UBSan) and examples.
- CodeQL analysis, Dependabot configuration and a security policy.

### Fixed
- `vds4e-spi-cuse` implements `SPI_IOC_RD_MODE32` and `SPI_IOC_WR_MODE32`, so the
  upstream `spidev_test` works.
- Web UI lint errors in the waveform feature fixed at their source.
- The live-server signal pump now logs the device events it applies and reports a
  persistent failure once.

### Changed
- The live-server timer pump sleeps until the next scheduled deadline and is woken
  by transactions instead of ticking every 2 ms.
- `uart-pty` adapter builds the shared bridge via `add_subdirectory`.
- Workspace `rust-version` aligned with the pinned 1.91.1 toolchain; repository metadata corrected.
