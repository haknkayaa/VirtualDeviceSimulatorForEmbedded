# Contributing

VDS4E separates device semantics, Linux ABI adapters and control-plane UI.
Read [VDS4E_ARCHITECTURE.md](VDS4E_ARCHITECTURE.md) before making architectural
or cross-cutting changes.

Architectural deviations require a new ADR under
[docs/adr/](docs/adr/) and an accompanying architecture update. Accepted ADRs
are historical records; supersede them rather than rewriting the original
decision.

## Before editing

Use the focused guide for the area you are changing:

- [Documentation index](docs/README.md)
- [Repository layout](docs/development/repository-layout.md)
- [Device Package SDK](docs/development/device-package-sdk.md)
- [Testing guide](docs/guides/testing.md)

Keep application code independent of VDS4E-specific headers/APIs. Linux host
adapters translate host ABIs; device behavior belongs in the authoritative
runtime/device-package layer.

## Required local checks

Run the checks relevant to your change before integrating it into `main`.

Rust:

```shell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cargo run --locked -p vds-server -- \
  --config config/vds-server.yaml \
  --check-config
```

Web:

```shell
npm --prefix apps/vds-web ci
npm --prefix apps/vds-web run lint
npm --prefix apps/vds-web run typecheck
npm --prefix apps/vds-web run test:run
npm --prefix apps/vds-web run build
```

Repository-wide staged build:

```shell
./configure
./build.sh
```

Use focused CMake/CTest commands while developing an individual native adapter.
The regular CI builds `spi-cuse`, `i2c-cuse`, `gpio-sim` and `uart-pty`
with normal and sanitizer configurations.

Changes to signal topology or Linux ABI behavior should also run the privileged
E2E suite when the environment permits it. See
[Testing VDS4E](docs/guides/testing.md).

## CI behavior

The normal Build and Test workflow runs automatically on `main` pushes and
can be started manually. Feature-branch pushes intentionally do not consume a
normal CI run, so do not rely on GitHub Actions as a substitute for local
verification.

The Device ABI E2E workflow is manual because it requires a privileged
environment or a QEMU guest. Release tags use a separate release workflow.

## Documentation expectations

Update documentation in the same change when modifying public commands,
configuration fields, schemas, package contracts, host ABI behavior, supported
interfaces or release procedures.

Document current behavior as current behavior. Put future work in
[docs/ROADMAP.md](docs/ROADMAP.md) instead of presenting an unimplemented
runtime or adapter as available.

Core behavior changes require tests. Configuration/schema changes require
validation coverage and updated examples.
