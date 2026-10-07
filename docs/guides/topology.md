# Connecting devices with a board topology

Real drivers rely on digital lines between chips: a sensor raises DRDY when a
sample is ready, the application waits for the edge on a GPIO line and then
reads the sample over SPI or I²C. VDS4E models this with **public signal
ports** and a separate **topology** file (ADR 0011). No application change and
no adapter change is needed: the application keeps using `gpiomon` or libgpiod
on `/dev/gpiochipN` and `/dev/spidevX.Y`.

## 1. Expose a port in the device model

```yaml
signals:
  outputs:
    - { name: drdy, type: bool }
signal_bindings:
  - signal: drdy
    source: { register: SAMPLE, bit: 31 }
```

A binding is private to the model. The source can be a register bit, a state
(`{ state: { equals: data_ready } }`), or a combination using `and`, `or`,
`not`, `nand`, `nor`, `xor`, and `xnor`:

```yaml
- signal: drdy
  source:
    and:
      - { register: STATUS, bit: 3 }
      - { state: { equals: ready } }
```

Ports are supported on `generic-spi-command` and `generic-i2c-register`
models. Only `bool` output ports exist in this version.

## 2. Clear the flag when the sample is read

Mark the bitfield `read_clear` so a bus read returns the value and then clears
the bit:

```yaml
bitfields:
  - { name: NEW, lsb: 31, width: 1, access: ro, read_clear: true }
```

Inspection through the control API and scenarios never clears the bit.

## 3. Wire the port to a GPIO line

Create `topology.yaml` and reference it from the server configuration with
`topology: path/to/topology.yaml`:

```yaml
schema_version: 1
connections:
  - from: spi-sensor-drdy.drdy       # <device.id>.<signal>
    to: generic-gpio-bank-32.GPIO16  # <device.id>.<line name>
    # delay_ns: 500                  # optional virtual-time delay
```

The target must be a GPIO line the simulated device drives, that is
`direction: output` in the GPIO model. Lines are addressed by name, never by
offset. A line can have one driver. See `config/topology.example.yaml` and the
`device-models/examples/spi-sensor-drdy` package.

## Behavior

- Without `delay_ns`, the line follows the sensor at the same virtual
  timestamp. With it, the change is queued on virtual time.
- Only value changes propagate. Loops are rejected when the topology loads, and
  propagation has a runtime pass limit.
- The signal is the line's logical value; an `active_low` line reaches the host
  inverted.
- `gpiomon` sees the edge with the GPIO adapter's polling latency, which is
  outside the virtual-time guarantee.

## Observing signals

Every propagation step is published as a `signal_changed` event on the event
stream and shown in the Web UI event views. `phase: emitted` marks a source port
change; `phase: delivered` marks the target GPIO line being driven (later than
`emitted` when the connection has `delay_ns`).

## Verified against the real ABI

`tests/e2e/drdy` runs the chain with unmodified tools: `spidev_test` (SPI sensor) or
`i2cget`/`i2ctransfer` (generic I2C sensor), `gpiomon` and `gpioget` on a real
`gpio-sim` controller. Start it on demand with the *Device ABI E2E* workflow or
`tests/e2e/drdy/run-qemu.sh`.
