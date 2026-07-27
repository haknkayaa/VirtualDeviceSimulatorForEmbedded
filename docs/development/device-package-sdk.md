# Device Package SDK

For the complete visual behavior node, port, transition, and parameter
contract, see the
[Device behavior flow reference](../device-models/device-behavior-flow-reference.md).

A VDS4E device package is a self-contained, versioned directory. It is the unit
that developers copy into or remove from `device-models/`, publish, validate,
and configure in the server. No resource inside a package is referenced by a
repository-global path.

Create and validate packages with the public CLI:

```bash
cargo run -p vds-cli -- device-package new ./my-sensor \
  --id my-sensor --name "My Sensor" --bus i2c
cargo run -p vds-cli -- device-package validate ./my-sensor
```

The versioned JSON contract is
[`schemas/device-package.schema.json`](../../schemas/device-package.schema.json),
and the Rust loader is `vds_core::device_package::DevicePackage`.

## Stable directory contract

```text
my-device/
├── device-package.yaml       # required package manifest
├── README.md                 # package landing page
├── model/
│   └── device.yaml           # required runtime model by convention
├── flows/
│   └── behavior.yaml         # optional editable behavior document
├── scenarios/                # optional conformance scenarios
├── fixtures/                 # optional binary/JSON/YAML test data
├── runtime-data/             # generated File Write outputs; not package source
├── docs/                     # optional detailed documentation
└── assets/                   # optional images, icons, and data files
```

Only `device-package.yaml` has a fixed filename. Other paths are declared in
the manifest, so a future package can add protocol descriptions, generated
artifacts, firmware samples, or additional flows without changing discovery.
Unknown future metadata belongs under `spec.extensions`, namespaced by its
owner.

When `spec.authoring.behavior_flow` is declared, the server compiles it during
package loading and uses it as the authoritative runtime state machine and
typed signal graph. See
[ADR 0007](../adr/0007-compile-device-behavior-flows-into-typed-runtime-graphs.md).

File Read paths are package-relative. File Write paths must be under
`runtime-data/`; absolute paths, parent traversal, and symlink escapes are
rejected.

## Manifest

```yaml
api_version: vds4e.dev/v1alpha1
kind: DevicePackage
metadata:
  id: example-temperature-sensor
  display_name: Example Temperature Sensor
  version: 0.1.0
  license: Apache-2.0
  authors: [Example Labs]
  tags: [i2c, sensor]
spec:
  bus:
    type: i2c
    profile: i2c.register-device
    options:
      default_address: 0x48
      address_bits: 7
  runtime:
    driver: generic-i2c-register
    model: model/device.yaml
  authoring:
    behavior_flow: flows/behavior.yaml
  validation:
    scenarios: scenarios
    fixtures: fixtures
  documentation: docs
  assets: assets
  extensions:
    example.com:
      datasheet_revision: A
```

`metadata.id`, `spec.bus.type`, and `spec.runtime.driver` must match the
corresponding `device.id`, `device.bus`, and `device.model` fields in the
runtime model. All paths are package-relative. Absolute paths and `..`
traversal are rejected.

## Bus profiles

The manifest contract supports these bus families without changing the folder
layout:

| Bus | Typical package content | Suggested runtime driver |
| --- | --- | --- |
| SPI | commands, mode, word size, memory/register maps | `generic-spi-command` |
| I²C | address rules, register map, repeated-start behavior | `generic-i2c-register` |
| GPIO | pins, direction, pull, edge/level events | `generic-gpio-bank` |
| Ethernet | MAC/link settings, frame or socket behavior | `generic-ethernet-endpoint` |
| UART | baud/frame settings, byte streams | `generic-uart-stream` |
| CAN | node IDs, frames, filters, arbitration data | `generic-can-node` |
| USB | descriptors, endpoints, transfer behavior | `generic-usb-function` |
| Custom | vendor or experimental transport contract | `custom-runtime` |

The package layer, schema, validator, and scaffold support every row today.
The authoritative execution engine currently implements
`spi` + `generic-spi-command`, `i2c` + `generic-i2c-register`, and `gpio` +
`generic-gpio-bank`. Adding another bus requires a runtime driver and adapter
implementation, but does not require another package format.

## Author workflow

1. Scaffold with `vds-cli device-package new`.
2. Implement `model/device.yaml` for the selected runtime driver.
3. Add an editable behavior flow and deterministic scenarios as needed.
4. Run `vds-cli device-package validate <directory>`.
5. Add the directory to `device_packages` in `config/vds-server.yaml`.

## Operating-system package store

At load time, packages referenced from `device-models/examples/` are copied to
`~/vds4e/devices/<package-id>/`. Validation, scenarios, behavior flows, assets,
and runtime models are then loaded from that installed copy rather than from
the repository tree.

Installed example copies contain a `.vds4e-managed-example` marker and are
refreshed on subsequent loads. An existing unmarked directory with the same
package ID is never overwritten. Set `VDS4E_DEVICE_STORE` to use a different
store root in CI, containers, or development environments.
6. Start the server and run package scenarios against the authoritative
   runtime.

The scaffold's non-SPI models are structural starting points until their
runtime drivers land; the validator deliberately validates package integrity,
while server startup additionally validates the runtime model contract.

## Portability and lifecycle

The entire directory is installed or removed as a unit. Moving it elsewhere
removes its model, flow, scenarios, fixtures, docs, and assets together.
Restoring it at the configured path restores the complete package after the
next server load. Do not put writable simulator state in a package; runtime
state belongs to the server's state/storage layer.

Package consumers must:

- resolve only manifest-declared relative paths;
- reject resources escaping the package root;
- ignore no unknown top-level fields (schema upgrades must be explicit);
- treat `api_version` as the compatibility boundary;
- keep package contents read-only at runtime;
- use semantic versions for package releases.

## Adding a runtime driver

A new bus implementation should keep transport, device semantics, and host
exposure separate:

1. Define the bus-specific model schema and deserialize it in the device-model
   layer.
2. Implement the authoritative runtime device/transaction behavior.
3. Dispatch `spec.runtime.driver` to that implementation during registry load.
4. Add an adapter that exposes the bus to the host where applicable.
5. Add package conformance scenarios and an end-to-end adapter test.
6. Document stable `spec.bus.options` and the model schema.

This separation permits several host adapters to attach to device instances
without embedding `/dev` paths or host privileges in distributable packages.
