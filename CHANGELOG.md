# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public device signal ports, `signal_bindings`, and a `topology.yaml` that
  connects them to GPIO lines with deterministic zero-delay or `delay_ns`
  propagation (ADR 0011).
- Register bitfield `read_clear` attribute.
- `spi-sensor-drdy` example package and `config/topology.example.yaml`.
- Optional `topology` key in the server configuration.
- Separate CI jobs for Rust, web UI, native adapters (with ASan/UBSan) and examples.
- CodeQL analysis, Dependabot configuration and a security policy.

### Changed
- `uart-pty` adapter builds the shared bridge via `add_subdirectory`.
- Workspace `rust-version` aligned with the pinned 1.91.1 toolchain; repository metadata corrected.
