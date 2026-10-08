# Tutorial: build your first virtual I²C device

This tutorial creates a small register-based temperature sensor, loads it into
VDS4E, exposes it as a real Linux `/dev/i2c-90` bus and talks to it using
unmodified `i2c-tools`.

The finished path is:

```text
i2cget / i2cset / i2ctransfer
          ↓
      /dev/i2c-90
          ↓
     VDS4E I2C CUSE adapter
          ↓
       Unix socket
          ↓
 tutorial-temp-sensor runtime
          ↓
 declarative register model
```

No VDS4E-specific API is added to the test application.

## Prerequisites

Complete [Getting started](../guides/getting-started.md) first. For the final
Linux ABI step you also need CUSE support and `i2c-tools`.

This tutorial assumes commands are run from the repository root.

## 1. Scaffold the package

Create a local package directory:

```shell
cargo run --locked -p vds-cli -- device-package new \
  device-models/local/tutorial-temp-sensor \
  --id tutorial-temp-sensor \
  --name "Tutorial Temperature Sensor" \
  --bus i2c
```

The command creates the portable package structure and selects the
`generic-i2c-register` runtime driver. The generated model is intentionally a
skeleton; the next step defines its executable register behavior.

## 2. Define package metadata

Replace
`device-models/local/tutorial-temp-sensor/device-package.yaml` with:

```yaml
api_version: vds4e.dev/v1alpha1
kind: DevicePackage

metadata:
  id: tutorial-temp-sensor
  display_name: Tutorial Temperature Sensor
  version: 0.1.0
  description: Minimal byte-register I2C sensor used by the first-device tutorial.
  license: Apache-2.0
  authors: []
  tags: [i2c, sensor, tutorial]

spec:
  bus:
    type: i2c
    profile: i2c.standard
    options:
      default_address: 0x48
  runtime:
    driver: generic-i2c-register
    model: model/device.yaml
  documentation: docs
```

The package ID, bus and runtime driver must agree with the runtime model.

## 3. Define the register device

Replace `model/device.yaml` with:

```yaml
schema_version: 1

device:
  id: tutorial-temp-sensor
  name: Tutorial Temperature Sensor
  bus: i2c
  model: generic-i2c-register

  i2c:
    register_address_bytes: 1
    auto_increment: true

  commands: []

  registers:
    - name: DEVICE_ID
      address: 0x00
      width_bits: 8
      reset_value: 0xA1
      access: ro
      description: Device identification byte.
      bitfields: []

    - name: CONFIG
      address: 0x01
      width_bits: 8
      reset_value: 0x00
      access: rw
      description: Writable configuration register.
      bitfields: []

    - name: TEMPERATURE
      address: 0x02
      width_bits: 8
      reset_value: 0x19
      access: ro
      description: Tutorial temperature sample; 0x19 is decimal 25.
      bitfields: []

    - name: SCRATCH
      address: 0x03
      width_bits: 8
      reset_value: 0x5A
      access: rw
      description: General-purpose writable byte.
      bitfields: []

  faults: []
```

This model uses one-byte register addresses and auto-increments the pointer
during sequential transfers.

## 4. Validate the package

```shell
cargo run --locked -p vds-cli -- device-package validate \
  device-models/local/tutorial-temp-sensor
```

Validation checks the package contract and safe package-local paths.

For an executable package, server startup is also important: structural package
validation alone does not prove that a runtime driver exists. In this tutorial
the selected `generic-i2c-register` driver is implemented.

## 5. Add the package to the server config

Add the package path under `device_packages` in
`config/vds-server.yaml`:

```yaml
device_packages:
  - device-models/local/tutorial-temp-sensor
  # existing example packages...
```

Start or restart the workspace:

```shell
./run.sh
```

The package is now loaded as a template and its configured runtime instance is
available to the server.

Confirm it through the control API:

```shell
curl -sS http://127.0.0.1:8080/api/v1/devices | \
  jq '.[] | select(.id == "tutorial-temp-sensor")'
```

Inspect its registers:

```shell
curl -sS \
  http://127.0.0.1:8080/api/v1/devices/tutorial-temp-sensor/registers | jq
```

## 6. Create a Linux I²C bus

You can do this from the Web UI's adapter workflow, or directly through the
control API.

Create bus 90:

```shell
curl -sS -X POST http://127.0.0.1:8080/api/v1/adapters \
  -H 'content-type: application/json' \
  -d '{
    "id": "tutorial-i2c90",
    "name": "Tutorial I2C Bus",
    "bus_type": "i2c",
    "bus_number": 90
  }' | jq
```

Attach the sensor at `0x48`. Adapter endpoints are JSON integers, therefore
`0x48` is sent as decimal `72`:

```shell
curl -sS -X POST \
  http://127.0.0.1:8080/api/v1/adapters/tutorial-i2c90/bindings \
  -H 'content-type: application/json' \
  -d '{"device_id":"tutorial-temp-sensor","endpoint":72}' | jq
```

Load the adapter:

```shell
curl -sS -X POST \
  http://127.0.0.1:8080/api/v1/adapters/tutorial-i2c90/load | jq
```

The load step may require host authorization because the I²C adapter uses CUSE.

Verify the character device:

```shell
stat -c '%F %n' /dev/i2c-90
```

Expected type:

```text
character special file /dev/i2c-90
```

## 7. Talk to the model with standard Linux tools

Discover address `0x48`:

```shell
i2cdetect -y 90
```

Read the ID register:

```shell
i2cget -y 90 0x48 0x00
# 0xa1
```

Read the temperature register:

```shell
i2cget -y 90 0x48 0x02
# 0x19
```

Write and read back `CONFIG`:

```shell
i2cset -y 90 0x48 0x01 0x7f
i2cget -y 90 0x48 0x01
# 0x7f
```

Read all four registers with a combined write-then-read transaction:

```shell
i2ctransfer -y 90 w1@0x48 0x00 r4
# 0xa1 0x7f 0x19 0x5a
```

At this point an ordinary Linux application using `/dev/i2c-90` can exercise
the same model without linking to VDS4E.

## 8. Observe the same state through the API

The Linux transaction and control plane share one authoritative runtime state.

After writing `CONFIG = 0x7f` with `i2cset`:

```shell
curl -sS \
  http://127.0.0.1:8080/api/v1/devices/tutorial-temp-sensor/registers | \
  jq '.[] | select(.name == "CONFIG")'
```

The returned value should also be `127`.

This is an important architecture property: the Web UI, REST API, scenarios and
Linux adapters do not own separate copies of device state.

## 9. Reset the device

Reset through the control plane:

```shell
curl -sS -X POST \
  http://127.0.0.1:8080/api/v1/devices/tutorial-temp-sensor/reset | jq
```

Then read `CONFIG` again:

```shell
i2cget -y 90 0x48 0x01
# 0x00
```

The reset value came from the declarative register model.

## Next steps

You now have the smallest useful VDS4E device: package metadata, an executable
register model, a real Linux device node and shared observable state.

From here:

- add bitfields and access rules to the register model;
- add deterministic faults;
- add behavior flows/state machines;
- write package-local scenarios and JUnit-producing tests;
- expose a public signal such as DRDY and connect it to GPIO with a topology;
- use the [Control-plane API](../guides/api.md) for automation;
- see the [Device Package SDK](../development/device-package-sdk.md) for the
  complete package contract.
