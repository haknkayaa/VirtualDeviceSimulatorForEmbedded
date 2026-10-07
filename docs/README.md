# VDS4E documentation

This directory is the documentation entry point for contributors and users who
need more detail than the project README.

## Start here

| Goal | Read |
| --- | --- |
| Install or run VDS4E | [Getting started](guides/getting-started.md) |
| Understand the architecture | [Architecture](../VDS4E_ARCHITECTURE.md) |
| Work with SPI | [SPI guide](guides/spi.md) |
| Work with I²C | [I²C guide](guides/i2c.md) |
| Work with GPIO | [GPIO guide](guides/gpio.md) |
| Work with UART | [UART guide](guides/uart.md) |
| Connect device signals to GPIO | [Topology guide](guides/topology.md) |
| Create device packages | [Device Package SDK](development/device-package-sdk.md) |
| Author behavior flows | [Behavior-flow reference](device-models/device-behavior-flow-reference.md) |
| Run and understand tests | [Testing guide](guides/testing.md) |
| Build a release | [Release guide](guides/releases.md) |
| Diagnose a local setup problem | [Troubleshooting](guides/troubleshooting.md) |
| Contribute code | [Contributing](../CONTRIBUTING.md) |
| Review design decisions | [Architecture Decision Records](adr/README.md) |
| See planned work | [Roadmap](ROADMAP.md) |

## Documentation layers

The project keeps documentation at three levels:

1. **README:** product overview, quick start, supported interfaces and project
   boundaries.
2. **Guides and references:** operational workflows, device-package authoring,
   testing, release procedures and troubleshooting.
3. **Architecture and ADRs:** authoritative design constraints and the history
   behind architectural decisions.

If implementation and documentation disagree, treat
[VDS4E_ARCHITECTURE.md](../VDS4E_ARCHITECTURE.md) and accepted ADRs as the
architectural source of truth, then update stale operational documentation with
the implementation change.

## Keeping documentation current

Documentation changes should accompany changes to public commands, configuration,
schemas, Linux ABI behavior, device-package contracts or release workflows.
Avoid documenting future components as if they already execute. Planned
capabilities belong in the [roadmap](ROADMAP.md).
