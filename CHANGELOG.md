# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
