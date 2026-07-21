# Contributing

Read `VDS4E_ARCHITECTURE.md` before making architectural or implementation
changes.

Changes must preserve the documented phase order and dependency direction.
Architectural deviations require an ADR under `docs/adr/` and an accompanying
update to the architecture document before implementation.

Before submitting a change, run:

```shell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
make -C client/c
```

Core behavior changes require tests. Configuration changes require schema and
example configuration updates.

Before starting a new development phase, all checks in
`docs/development/phase-gates.md` must pass in one workspace test run.
