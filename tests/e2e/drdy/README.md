# Signal topology end-to-end tests (ADR 0011, ADR 0012)

Exercise the full Linux ABI path with unmodified tools. This is a privileged ABI test
suite and is not part of `cargo test` or the default CI.

| Script | Sensor | Application-side tools |
| --- | --- | --- |
| `spi-gpio.sh` | `spi-sensor-drdy` (1 ms conversion timer) | upstream `spidev_test`, `gpiomon`, `gpioget` |
| `i2c-gpio.sh` | `i2c-sensor-drdy` (generic I2C register device) | `i2cdetect`, `i2cget`, `i2ctransfer`, `gpiomon`, `gpioget` |

```text
sensor model -> signal router (topology.yaml) -> generic GPIO runtime -> vds4e-gpio-sim
  -> kernel gpio-sim -> /dev/gpiochipN -> gpiomon (rising)
  -> read of the sample over /dev/spidevX.Y or /dev/i2c-N -> read-clear -> gpiomon (falling)
```

Both scripts also check that DRDY does not clear before the sample is read, that it
re-arms, and that a read without a new sample does not raise it. The SPI sensor raises
DRDY from its own timer (no further bus traffic, so only the pump can apply it). The
generic I2C device has no timers, so the sample-ready event is the control-plane
register write that the Web UI and scenarios perform.

## Run

- `run-native.sh`: on a host with root, the `gpio-sim` and `cuse` modules, configfs,
  libgpiod tools, i2c-tools and curl. Builds the binaries and the upstream `spidev_test`.
- `run-qemu.sh`: boots a stock distribution kernel in QEMU (software emulation without
  `/dev/kvm`) for hosts whose kernel lacks those modules: cloud sandboxes, hosted CI
  runners, containers. See the script header for host requirements.
- GitHub: start the *Device ABI E2E* workflow by hand and choose `qemu-hosted` or
  `self-hosted` (a runner labelled `vds4e-privileged`).

Ubuntu 24.04 ships libgpiod 1.6, so the scripts use the `gpiomon <chip> <line>` syntax
of that version.
