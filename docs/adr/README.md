# Architecture Decision Records

Create a new ADR by copying `template.md`. ADRs are numbered sequentially and
use a concise kebab-case title, for example:
`0003-use-a-simulator-clock.md`.

Accepted ADRs are immutable. If a decision changes, add a superseding ADR and
update `VDS4E_ARCHITECTURE.md` before implementing the change.

## Records

- [0001: Generic SPI first vertical slice](0001-generic-spi-first-vertical-slice.md)
- [0002: Introduce virtual clock before state machine](0002-introduce-virtual-clock-before-state-machine.md)
- [0003: Define fault evaluation and precedence](0003-define-fault-evaluation-and-precedence.md)
- [0004: Create runtime device instances](0004-create-runtime-device-instances-from-configured-models.md)
- [0005: Linux SPI preload v1](0005-linux-spi-preload-v1.md) — superseded by ADR 0009
- [0006: Manage host adapters](0006-manage-host-adapters-as-top-level-resources.md)
- [0007: Compile behavior flows into typed runtime graphs](0007-compile-device-behavior-flows-into-typed-runtime-graphs.md)
- [0008: Use kernel gpio-sim for libgpiod integration](0008-use-kernel-gpio-sim-for-libgpiod-integration.md)
- [0009: Retire the Linux SPI preload adapter](0009-retire-linux-spi-preload-adapter.md)
