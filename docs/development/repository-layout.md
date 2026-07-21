# Repository layout

The directory layout follows section 9 of `VDS4E_ARCHITECTURE.md`.

The Phase 0 and first vertical-slice Cargo workspace members are:

- `apps/vds-server`: headless daemon entry point
- `apps/vds-cli`: local data-plane diagnostic client
- `crates/vds-core`: backend-independent clock, deterministic one-shot
  scheduler, generic finite-state machine, device, registry, transaction,
  configuration, and error foundations
- `crates/vds-protocol`: Protobuf contract and length-prefixed framing
- `crates/vds-device-model`: declarative generic device-model loading and
  command handling, including device-specific state definitions, register
  actions, guards, pending operations, and busy state
- `crates/vds-registers`: declarative RO/WO/RW register validation and runtime
  value ownership

Other architecture-defined directories are reserved for their documented
phases. They must not gain placeholder implementations or cross-layer
dependencies merely to fill the tree.

Company-private protocol implementations, examples, fixtures, and test vectors
must live in separate private repositories. The public repository exposes only
generic extension points and must remain fully usable without those extensions.
