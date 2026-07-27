# VDS4E roadmap

This document tracks planned capabilities that are not part of the current
runtime contract. Items move into `VDS4E_ARCHITECTURE.md` only after their
implementation and ADR are accepted.

## Additional host adapters and buses

- UART PTY endpoints.
- Ethernet TAP or socket endpoints and PCAP export.
- QSPI multi-lane/DTR host integration beyond the current SPI subset.
- Optional QEMU and full-system integration after functional adapters mature.

Every new bus keeps its host adapter, transport contract, and declarative
device semantics separate. Placeholder source directories are not created
before implementation begins.

## Device library and registry

- Git-backed and HTTP registry indexes.
- Search by vendor, bus, command, register, tag, license, and compatibility.
- Package import/export with checksums, signatures, archive hardening, and
  duplicate/version conflict handling.
- Semantic dependency resolution, composition, project lock files, and
  deterministic package restoration.
- Community publishing, review, validation badges, and registry REST/CLI
  surfaces.

The local package directory and current Device Library UI remain the supported
baseline until these capabilities ship.

## Runtime and observability

- Metrics export and distributed traces.
- Additional runtime drivers for UART, Ethernet, CAN, and USB package profiles.
- Storage images, snapshot/restore, wear simulation, and power-loss recovery.
- Expanded conformance suites and cross-version compatibility testing.

## Delivery order

1. Stabilize the package-only SPI, I²C, and GPIO runtimes, their Linux host
   adapters, device-scoped authoring, scenarios, persistence, and CI.
2. Add one runtime driver and host adapter at a time with an ADR, schema,
   package example, and end-to-end test.
3. Add registry and publishing features only after package compatibility and
   trust rules are stable.
4. Consider full-system/QEMU work only after Level 1 and Level 2 simulation are
   reliable.
