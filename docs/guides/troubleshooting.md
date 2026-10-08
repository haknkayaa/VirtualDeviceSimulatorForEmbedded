# Troubleshooting

This guide covers common local-development and Linux-adapter failures.

## Server configuration does not validate

Run the explicit config check first:

```shell
vds-server --config config/vds-server.yaml --check-config
```

When running from source:

```shell
cargo run --locked -p vds-server -- \
  --config config/vds-server.yaml \
  --check-config
```

Check package paths, topology paths and package/model IDs before debugging the
runtime. Device-package paths are validated and must remain within the package
contract.

## `/dev/spidevX.Y` or `/dev/i2c-N` does not appear

SPI and I²C endpoints use CUSE. Confirm the module and device are available:

```shell
lsmod | grep '^cuse'
ls -l /dev/cuse
```

Load CUSE when your host policy permits it:

```shell
sudo modprobe cuse
```

Then reload the VDS4E adapter and inspect its error/status in the control plane.
The helper requires sufficient privileges to create the endpoint.

## Permission denied opening a device node

Device-node permissions are controlled by the host. Do not solve this by making
the node world-writable.

Check the node:

```shell
ls -l /dev/spidev0.0
ls -l /dev/i2c-0
ls -l /dev/gpiochip0
```

Use the host's normal group/udev policy for persistent non-root access. For a
one-off diagnosis, run the client with the privileges required by that host.

## No `/dev/gpiochipX` appears

The GPIO adapter relies on kernel `gpio-sim` and configfs.

Check:

```shell
lsmod | grep '^gpio_sim'
mount | grep configfs
```

If supported by the host:

```shell
sudo modprobe gpio-sim
```

Do not assume the numeric `gpiochipX` suffix. Linux assigns it dynamically;
use the path reported by the adapter.

## `gpiomon` or `gpioget` syntax differs

libgpiod 1.x and 2.x command-line syntax differs. Check the installed tool:

```shell
gpiomon --version
gpiomon --help
```

The project E2E scripts target the syntax provided by their test environment.
For interactive use, follow the help text of the installed libgpiod version.

## UART path changed

UART adapters expose kernel-assigned PTYs such as `/dev/pts/7`. The number is
not stable between runs. Always use the slave path reported by the adapter.

## Web UI or API port is already in use

The development defaults are:

```text
Web UI:      127.0.0.1:4174
Control API: 127.0.0.1:8080
```

For the development UI, choose another port:

```shell
VDS_WEB_PORT=4200 ./dev.sh
```

If the API port is occupied, stop the other workspace or change the server
configuration rather than starting competing runtimes against the same adapter
state.

## Adapter state looks stale after a restart

Managed adapter configuration is persisted under
`~/.vds4e/adapters.json` by default. Logical bindings and load intent are
persisted; transient process IDs and kernel-assigned device paths are
rediscovered.

Set `VDS4E_ADAPTER_STATE` when you need an isolated state file for testing.

## A device package validates but will not execute

Package integrity validation and runtime support are different checks. The
package schema can describe bus families for which no executable runtime driver
exists yet.

Confirm that `spec.runtime.driver` is implemented by the current runtime and
that it matches the model's `device.model`. See the
[Device Package SDK](../development/device-package-sdk.md).

## Real ABI E2E cannot run on the host

The native E2E requires root, CUSE, gpio-sim, configfs and the corresponding
userspace tools. If the host kernel does not provide them, use the QEMU harness:

```shell
sudo -E env "PATH=$PATH" tests/e2e/drdy/run-qemu.sh
```

The manual GitHub **Device ABI E2E** workflow provides the same hosted-QEMU
path.

## Where to look next

For runtime design questions, see
[VDS4E_ARCHITECTURE.md](../../VDS4E_ARCHITECTURE.md). For adapter-specific
limitations, use the README inside the corresponding `adapters/*` directory.
