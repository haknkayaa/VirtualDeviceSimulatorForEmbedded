# DRDY end-to-end test (ADR 0011)

Exercises the full Linux ABI path with unmodified tools:

```text
spi-sensor-drdy model (1 ms conversion timer)
  -> signal router (topology.yaml: spi-sensor-drdy.drdy -> generic-gpio-bank-32.GPIO16)
  -> generic GPIO runtime -> vds4e-gpio-sim -> kernel gpio-sim -> /dev/gpiochipN
  -> gpiomon (rising edge) -> upstream spidev_test read of /dev/spidev0.0
  -> read-clear -> gpiomon (falling edge)
```

It also checks that DRDY does not clear before the sample is read, that it re-arms
for a second conversion, and that a read without a new sample does not raise it.

This is a privileged ABI test and is not part of `cargo test` or the default CI.

## Run on a suitable host

Root, the `gpio-sim` and `cuse` modules, configfs, libgpiod tools, and an upstream
`spidev_test` (build `tools/spi/spidev_test.c` from the Linux source) are required.

```sh
sudo modprobe gpio-sim cuse
sudo env BIN_SERVER=... BIN_GPIO_SIM=... BIN_SPI_CUSE=... SPIDEV_TEST=... \
  tests/e2e/drdy/e2e.sh
```

## Run in QEMU

`run-qemu.sh` builds the binaries, a minimal Ubuntu root filesystem, and boots a
distribution kernel (software emulation without `/dev/kvm`). Use it where the host
kernel lacks the modules, for example cloud sandboxes. See the script header for
host requirements.

Ubuntu 24.04 ships libgpiod 1.6, so the script uses the `gpiomon <chip> <line>`
syntax of that version.
