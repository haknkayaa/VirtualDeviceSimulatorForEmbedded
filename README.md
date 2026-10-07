# Virtual Device Simulator for Embedded (VDS4E)

[![Build and Test](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml)

VDS4E is a deterministic, observable virtual hardware laboratory for Embedded
Linux development. It lets native applications, standard Linux bus tools,
headless scenarios, and the Web control plane interact with the same
declarative device runtime without requiring a physical board.

The authoritative system design is
[VDS4E_ARCHITECTURE.md](VDS4E_ARCHITECTURE.md). Planned work is kept separately
in [docs/ROADMAP.md](docs/ROADMAP.md).

## What works today

| Area | Implemented support |
| --- | --- |
| Device packages | Versioned package manifest, runtime model, behavior flow, scenarios, fixtures, documentation, and assets |
| Runtime drivers | `generic-spi-command`, `generic-i2c-register`, `generic-gpio-bank`, `generic-uart-responder` |
| Device behavior | Registers, bitfields, memory, state machines, virtual time, scheduled operations, faults, reset |
| Automation | CLI package validation/scaffolding, SPI transfer, scenario execution, JSON and JUnit results |
| Control plane | REST API, WebSocket replay/live events, React Web UI |
| Native data plane | Length-prefixed Protobuf over `/tmp/vds4e.sock`, Rust CLI, Linux host adapters |
| Linux SPI | Managed CUSE `/dev/spidevX.Y` adapter |
| Linux I²C | Privileged CUSE `/dev/i2c-N` adapter with `I2C_RDWR` and common SMBus operations |
| Linux GPIO | Kernel `gpio-sim` integration exposing a real `/dev/gpiochipX` |
| Linux UART | Unprivileged PTY adapter exposing a standard `/dev/pts/N` TTY |
| Observability | Transactions, registers, state, faults, runs, telemetry, bounded replay, optional SQLite persistence |

## Interface support

| Interface | Runtime | Linux host interface | Compatible clients | Status |
| --- | --- | --- | --- | --- |
| SPI / spidev | `generic-spi-command` | `/dev/spidevX.Y` through CUSE | Normal spidev applications and upstream `spidev_test` | Supported |
| I²C / i2c-dev | `generic-i2c-register` | `/dev/i2c-N` through CUSE | `i2cdetect`, `i2cget`, `i2cset`, `i2ctransfer`, libi2c applications | Supported |
| GPIO | `generic-gpio-bank` | Real `/dev/gpiochipX` through kernel `gpio-sim` | `gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, `gpiomon`, libgpiod applications | Supported |
| QSPI multi-lane / DTR | SPI command and wire-setting validation | No dedicated host adapter | VDS4E native transaction clients | Runtime only |
| UART / TTY | `generic-uart-responder` | Kernel-assigned `/dev/pts/N` through PTY | Normal applications using `open`, `read`, `write`, and termios | Supported (functional byte stream) |
| Ethernet | None | No TAP or socket endpoint | — | Not implemented |
| CAN | None | No SocketCAN endpoint | — | Not implemented |
| USB | None | No USB gadget or host endpoint | — | Not implemented |

`generic-spidev` is a transport-test device for spidev compatibility. It does
not model flash memory, JEDEC identity, registers, erase/program operations, or
vendor-specific behavior. Use a concrete package such as the bundled Micron
MT25QL256 model when device-specific flash behavior is required.

VDS4E provides functional simulation. It does not simulate electrical
characteristics, controller DMA/IRQ timing, CPU execution, or a complete target
board, and it does not replace real-target or hardware-in-the-loop testing.

## Comparison with other simulation approaches

These tools solve related but different problems. The matrix is evaluated for
Embedded Linux development and peripheral testing; it is not a general product
ranking.

| Feature | **Renode** | **QEMU** | **Simics** | **Synopsys Virtualizer** | **Arm Fast Models** | **VDS4E** |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Embedded-focused virtual platform | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| Full Linux boot | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Bare-metal / RTOS support | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Custom peripheral modeling | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Declarative hardware description | ✅ | ❌ | ✅ | ✅ | ⚠️ | ✅ |
| Device Tree import | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| Automatic virtual board generation from DTS | ❌ | ❌ | ❌ | ⚠️ | ❌ | ✅ |
| Yocto-oriented workflow | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Browser-based UI | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Visual hardware designer | ⚠️ | ❌ | ⚠️ | ✅ | ⚠️ | ⚠️ |
| Drag-and-drop peripheral composition | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ | Planned |
| Live peripheral / register inspector | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| Bus / protocol tracing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fault injection | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| One-click fault injection workflow | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| Snapshot / checkpoint | ✅ | ✅ | ✅ | ✅ | ✅ | Planned |
| Deterministic execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Record / replay | ✅ | ✅ | ✅ | ✅ | ✅ | Planned |
| Multi-node simulation | ✅ | ✅ | ✅ | ✅ | ✅ | Planned |
| HIL / real hardware bridge | ✅ | ✅ | ✅ | ✅ | ✅ | Planned |
| RTL / SystemC co-simulation | ✅ | ⚠️ | ✅ | ✅ | ✅ | Planned |
| CI / regression automation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI-assisted peripheral generation | ❌ | ❌ | ❌ | ❌ | ❌ | Planned |
| Datasheet-to-model generation | ❌ | ❌ | ❌ | ❌ | ❌ | Planned |
| Driver-to-hardware-model assistance | ❌ | ❌ | ❌ | ❌ | ❌ | Planned |
| Shareable reproducible simulation sessions | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | Planned |
| Open-source friendly | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Developer-first UX | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ |

**Legend:** ✅ Supported · ⚠️ Partial / workflow-dependent · ❌ Not a primary feature · Planned = on the VDS4E roadmap

VDS4E occupies a narrower layer than CPU or full-board emulators. It runs an
x86_64 build of the production application natively on the workstation and
provides standard Linux endpoints such as `/dev/spidevX.Y`, `/dev/i2c-N`, and
`/dev/gpiochipX`. This makes it a lightweight fit when the goal is deterministic
application and device-behavior testing without modeling a CPU, booting a guest
kernel, or changing the application to call simulator-specific APIs.

Choose Renode, QEMU, Simics, Synopsys Virtualizer, or Arm Fast Models when
CPU/SoC behavior, boot flow, kernel drivers, interrupts, DMA, or board-level
integration is part of the test. These approaches can complement VDS4E rather
than replace it; optional full-system integration is tracked in the roadmap.

## Prerequisites

- Rust 1.91.1, selected by `rust-toolchain.toml`
- Node.js and npm
- Protocol Buffers compiler (`protoc`)
- C11 compiler, Make, CMake, and pkg-config
- FUSE3 development files for CUSE adapters
- optional host compatibility tools: `i2c-tools`, `gpiod`, and `spi-tools`

Ubuntu/Debian:

```shell
sudo apt-get update
sudo apt-get install -y \
  build-essential cmake pkg-config libfuse3-dev protobuf-compiler \
  i2c-tools libi2c-dev \
  gpiod libgpiod-dev \
  spi-tools
```

Kernel-backed adapters additionally require the host's `cuse` or `gpio-sim`
module and operating-system authorization.

## Start the development workspace

From the repository root:

```shell
./dev.sh
```

For the usual local workflow, use the one-time-authorization launcher instead:

```shell
./run.sh
```

It requests your administrator password once through `sudo`, then uses that
short-lived authorization to start the SPI, I²C, and GPIO adapter helpers as
needed. Keep that terminal open: the authorization is tied to its development
session. The VDS4E server and Web UI still run as your normal user. Use
`VDS4E_ADAPTER_AUTH=pkexec ./run.sh` to retain separate Polkit prompts, or run
`./dev.sh` directly.

The script starts:

- Web UI: `http://127.0.0.1:4174`
- Control API: `http://127.0.0.1:8080/api/v1/health`
- Transaction data plane: `/tmp/vds4e.sock`

Keep the terminal open and press `Ctrl+C` to stop both processes. If port 4174
is occupied, either stop the existing workspace or select another UI port:

```shell
VDS_WEB_PORT=4200 ./dev.sh
```

`dev.sh` installs missing Web dependencies and prepares the development SPI and
I²C CUSE helpers. It is not the staged production build.

## Staged build and installation

The root pipeline is deliberately ordered:

```shell
./configure
./build.sh
sudo ./install
```

- `./build.sh` refuses to run before a successful `./configure`.
- `./install` refuses to run before a successful `./build.sh`.
- all generated build output is stored under `build/`.
- `PREFIX` selects the installation prefix.
- `DESTDIR` stages a filesystem package.

Examples:

```shell
PREFIX="$HOME/.local" ./install
DESTDIR="$PWD/package-root" PREFIX=/usr ./install
```

Focused module builds remain available during development; the full root
pipeline does not need to run after every isolated change.

## Create `/dev/spidevX.Y`

Start VDS4E:

```shell
./dev.sh
```

Open the Web UI and create the Linux SPI endpoint:

1. Open **Adapters** and select **New Adapter**.
2. Select **SPI**, use bus number `0`, and create the adapter.
3. Attach `generic-spidev` to endpoint/chip-select `0`.
4. Select **Load Adapter** and approve the operating-system authorization.

VDS4E starts the SPI CUSE adapter and creates a real Linux character device:

```shell
$ stat -c '%F %n' /dev/spidev0.0
character special file /dev/spidev0.0
```

The application opens `/dev/spidev0.0`; it does not include a VDS4E header,
call a simulator-specific API, or send REST requests. The CUSE adapter forwards
supported spidev ioctls to the runtime over `/tmp/vds4e.sock`.

The bus and chip-select numbers come from the adapter configuration. For
example, SPI bus `2` and endpoint `1` produce `/dev/spidev2.1`.

The local simulator saves adapter configuration, device bindings, and loaded
state in `~/.vds4e/adapters.json`. On the next start it recreates adapters that
were loaded and rediscovers transient process IDs and device paths. Set
`VDS4E_ADAPTER_STATE` to use a different state-file location.

## Access `/dev/spidevX.Y` from C

The following is a normal Embedded Linux spidev program. It sends the
`generic-spidev` `PING` command (`0xA0`) and reads its deterministic response.

```c
#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "/dev/spidev0.0";
    int fd = open(path, O_RDWR);
    if (fd < 0) {
        fprintf(stderr, "open(%s): %s\n", path, strerror(errno));
        return 1;
    }

    uint8_t mode = SPI_MODE_0;
    uint8_t bits = 8;
    uint32_t speed_hz = 1000000;
    if (ioctl(fd, SPI_IOC_WR_MODE, &mode) < 0 ||
        ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, &bits) < 0 ||
        ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed_hz) < 0) {
        fprintf(stderr, "SPI configuration: %s\n", strerror(errno));
        close(fd);
        return 1;
    }

    uint8_t tx[] = {0xA0, 0x00, 0x00, 0x00};
    uint8_t rx[sizeof(tx)] = {0};
    struct spi_ioc_transfer transfer = {
        .tx_buf = (uintptr_t)tx,
        .rx_buf = (uintptr_t)rx,
        .len = sizeof(tx),
        .speed_hz = speed_hz,
        .bits_per_word = bits,
    };

    int transferred = ioctl(fd, SPI_IOC_MESSAGE(1), &transfer);
    if (transferred != (int)sizeof(tx)) {
        fprintf(stderr, "SPI_IOC_MESSAGE: %s\n", strerror(errno));
        close(fd);
        return 1;
    }

    printf("Device: %s\n", path);
    printf("TX: %02X %02X %02X %02X\n",
           tx[0], tx[1], tx[2], tx[3]);
    printf("RX: %02X %02X %02X %02X\n",
           rx[0], rx[1], rx[2], rx[3]);
    close(fd);
    return 0;
}
```

Save it as `spidev_ping.c`, then compile and run it like an ordinary target
application:

```shell
cc -O2 -Wall -Wextra -Werror spidev_ping.c -o spidev_ping
sudo ./spidev_ping /dev/spidev0.0
```

Expected output:

```text
Device: /dev/spidev0.0
TX: A0 00 00 00
RX: DE AD BE EF
```

Use the host's normal udev/group policy to grant non-root access instead of
making the device node world-writable.

### Run the Micron Embedded Linux example

To exercise flash behavior instead of the generic transport endpoint, attach
`micron-mt25ql256aba8esf-0sit` to the SPI adapter and load it as
`/dev/spidev0.0`. Build and run the bundled application:

```shell
cc -O2 -Wall -Wextra -Werror -std=c11 \
  examples/micron-mt25ql256-embedded/mt25ql256_tool.c \
  -o mt25ql256_tool

sudo ./mt25ql256_tool -d /dev/spidev0.0 id
```

The identification portion of the output is:

```text
SPI device : /dev/spidev0.0
SPI config : mode=0 bits=8 speed=20000000 Hz
JEDEC ID   : 20 BA 19
Device     : Micron MT25QL256ABA
Geometry   : 32 MiB, page=256 B, erase=4 KiB/64 KiB
```

The Micron package models status registers, write enable, timed program/erase,
four-byte reads, deep power-down, reset, and package-local scenarios. See
[the package documentation](device-models/examples/micron-mt25ql256aba8esf-0sit/docs/README.md).

### Run the AT24C Embedded Linux example

This example uses only the standard Linux `i2c-dev` ABI, so the same source
runs against VDS4E and physical AT24C128/AT24C256 devices:

```shell
cc -O2 -Wall -Wextra -Wpedantic -Werror -std=c11 \
  examples/atmel-at24c256-embedded/at24c256_tool.c \
  -o at24c256_tool

./at24c256_tool -d /dev/i2c-0 -a 0x50 -m 256 info
./at24c256_tool -d /dev/i2c-0 -a 0x50 -m 256 write 0x0010 0x5a 0xa5
./at24c256_tool -d /dev/i2c-0 -a 0x50 -m 256 read 0x0010 2
./at24c256_tool -d /dev/i2c-0 -a 0x50 -m 256 test 0x0020
```

The tool splits writes at 64-byte page boundaries and performs write-cycle
ACK polling through `I2C_SMBUS`.

## Device packages

Every device lives in a self-contained package:

```text
device-package.yaml
model/device.yaml
flows/behavior.yaml
scenarios/*.yaml
fixtures/
docs/
assets/
```

Only resources declared in the manifest are required. Package paths must stay
inside the package root, and the package ID must match its runtime model.

Create and validate a package:

```shell
cargo run -p vds-cli -- device-package new ./my-sensor \
  --id my-sensor \
  --name "My Sensor" \
  --bus i2c

cargo run -p vds-cli -- device-package validate ./my-sensor
```

The scaffold creates the portable structure; the author must complete the
bus-specific model before it can execute. The package schema accepts SPI, I²C,
GPIO, Ethernet, UART, CAN, USB, and custom buses. The currently executable
generic drivers are SPI, I²C register, and GPIO bank.

See:

- [Device Package SDK](docs/development/device-package-sdk.md)
- [Device behavior flow reference](docs/device-models/device-behavior-flow-reference.md)
- [Package schema](schemas/device-package.schema.json)
- [Model schema](schemas/device-model.schema.json)

## Run package-local scenarios

Scenarios execute headlessly against the same runtime registry used by native
clients:

```shell
cargo run -p vds-cli -- scenario run \
  device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios/01-read-jedec-id.yaml \
  --config config/vds-server.yaml \
  --json-output /tmp/mt25ql256-result.json \
  --junit-output /tmp/mt25ql256-result.xml
```

Scenario steps can reset a device, advance virtual time, send SPI requests,
toggle faults, assert state/register/response/error values, and wait for typed
events. Scenario authoring in the Web UI remains inside the selected device.

## Linux host adapters

Host adapters expose standard Linux userspace ABIs and forward operations to
the Unix-socket runtime. They contain no device opcodes or register behavior.

### SPI example

- [SPI CUSE adapter](adapters/spi-cuse/README.md): real `/dev/spidevX.Y` integration
  for compatible dynamically linked applications.
- [SPI CUSE adapter](adapters/spi-cuse/README.md): real `/dev/spidevX.Y` nodes
  for supported spidev ioctls, including static applications.

After loading SPI bus `0`, endpoint `0`:

```shell
$ stat -c '%F %n' /dev/spidev0.0
character special file /dev/spidev0.0

$ sudo ./spidev_ping /dev/spidev0.0
Device: /dev/spidev0.0
TX: A0 00 00 00
RX: DE AD BE EF
```

The complete C source for `spidev_ping` is shown in
[Access `/dev/spidevX.Y` from C](#access-devspidevxy-from-c).

### I²C example

The [I²C CUSE adapter](adapters/i2c-cuse/README.md) creates a real
`/dev/i2c-N` bus and maps unique slave addresses to runtime device IDs.

In **Adapters**, create I²C bus `0`, attach `generic-i2c-register` at slave
address `80` (`0x50`), and load the adapter:

```shell
$ stat -c '%F %n' /dev/i2c-0
character special file /dev/i2c-0

$ sudo i2cdetect -y 0
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
40: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
50: 50 -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --
```

Register `0x00` is the read-only device ID:

```shell
$ sudo i2cget -y 0 0x50 0x00 b
0x42
```

Register `0x01` is writable. Write it and read the four-register block:

```shell
$ sudo i2cset -y 0 0x50 0x01 0x7f b
$ sudo i2cget -y 0 0x50 0x01 b
0x7f

$ sudo i2ctransfer -y 0 w1@0x50 0x00 r4
0x42 0x7f 0x01 0xa5
```

The bus number is configured by the adapter. If the adapter is I²C bus `4`,
the endpoint and commands use `/dev/i2c-4` and `-y 4`.

For EEPROM behavior, use the bundled `atmel-at24c128` or
`atmel-at24c256` package instead of the generic register fixture. These
datasheet-derived models provide 16/32 KiB memory, two-byte word addresses,
64-byte page-write rollover, current/random/sequential reads, capacity
rollover, hardware write protection, and the self-timed write-cycle NACK used
by ACK polling:

```shell
# AT24C256 at 0x50: write 0x5a to word address 0x0010
i2ctransfer -y 0 w3@0x50 0x00 0x10 0x5a
sleep 0.01
i2ctransfer -y 0 w2@0x50 0x00 0x10 r1
```

### GPIO example

The [GPIO simulator adapter](adapters/gpio-sim/README.md) provisions the
kernel's `gpio-sim` controller. Build the helper for focused development if the
root pipeline has not already built it:

```shell
cmake -S adapters/gpio-sim -B build/adapters/gpio-sim
cmake --build build/adapters/gpio-sim
```

Create a 32-line GPIO adapter in the Web UI, attach
`generic-gpio-bank-32`, and load it. The kernel-assigned `/dev/gpiochipX` path
appears in the adapter view. This example assumes the kernel assigned
`gpiochip2`:

```shell
$ stat -c '%F %n' /dev/gpiochip2
character special file /dev/gpiochip2

$ gpiodetect
gpiochip2 [GPIO 0] (32 lines)
```

`gpioinfo` shows every kernel line and the package-defined line name:

```text
$ gpioinfo gpiochip2
gpiochip2 - 32 lines:
        line   0:      "GPIO0"       unused   input  active-high
        line   1:      "GPIO1"       unused   input  active-high
        line   2:      "GPIO2"       unused   input  active-high
        line   3:      "GPIO3"       unused   input  active-high
        line   4:      "GPIO4"       unused   input  active-high
        line   5:      "GPIO5"       unused   input  active-high
        line   6:      "GPIO6"       unused   input  active-high
        line   7:      "GPIO7"       unused   input  active-high
        line   8:      "GPIO8"       unused   input  active-high
        line   9:      "GPIO9"       unused   input  active-high
        line  10:     "GPIO10"       unused   input  active-high
        line  11:     "GPIO11"       unused   input  active-high
        line  12:     "GPIO12"       unused   input  active-high
        line  13:     "GPIO13"       unused   input  active-high
        line  14:     "GPIO14"       unused   input  active-high
        line  15:     "GPIO15"       unused   input  active-high
        line  16:     "GPIO16"       unused   input  active-high
        line  17:     "GPIO17"       unused   input  active-high
        line  18:     "GPIO18"       unused   input  active-high
        line  19:     "GPIO19"       unused   input  active-high
        line  20:     "GPIO20"       unused   input  active-high
        line  21:     "GPIO21"       unused   input  active-high
        line  22:     "GPIO22"       unused   input  active-high
        line  23:     "GPIO23"       unused   input  active-high
        line  24:     "GPIO24"       unused   input  active-high
        line  25:     "GPIO25"       unused   input  active-high
        line  26:     "GPIO26"       unused   input  active-high
        line  27:     "GPIO27"       unused   input  active-high
        line  28:     "GPIO28"       unused   input  active-high
        line  29:     "GPIO29"       unused   input  active-high
        line  30:     "GPIO30"       unused   input  active-high
        line  31:     "GPIO31"       unused   input  active-high
```

`gpioinfo` reports the current kernel request direction. An unused gpio-sim
line normally appears as `input`. The VDS4E model direction is defined from the
virtual device's perspective:

| Lines | Device perspective | Host operation |
| --- | --- | --- |
| `GPIO0`–`GPIO15` | Device input | Drive with `gpioset` |
| `GPIO16`–`GPIO31` | Device output | Read with `gpioget` or monitor with `gpiomon` |

With libgpiod 1.x, read the initial device output on line 16:

```shell
$ gpioget gpiochip2 16
0
```

Drive device input line 0 high and keep the request active:

```shell
$ gpioset --mode=wait gpiochip2 0=1
```

While that command holds the line, the device's `GPIO0_STATE` register reads
`1` in the Web UI and control API.

To observe a device output transition, start:

```shell
$ gpiomon gpiochip2 16
```

The command waits. After writing `1` to the device's writable
`GPIO16_STATE` register, it prints:

```text
event:  RISING EDGE offset: 16 timestamp: [<kernel timestamp>]
```

The runtime updates gpio-sim and the normal kernel edge event wakes `gpiomon`.

libgpiod 2.x uses `-c gpiochip2` to select the chip. Use the syntax shown by the
installed command's `--help`. Never assume the `gpiochipX` number before the
kernel creates it.

### UART example

The [UART PTY adapter](adapters/uart-pty/README.md) creates an unprivileged
standard TTY endpoint. Create a UART adapter in the Web UI, attach
`generic-uart-responder`, and load it. Use the reported PTY slave path rather
than assuming its numeric suffix:

```shell
stty -F /dev/pts/7 115200 raw -echo
build/examples/uart_ping /dev/pts/7
# PONG
```

The PTY is an unprivileged standard TTY endpoint. Its baud/framing settings are
accepted through termios for application compatibility, but the first UART
runtime models a deterministic byte stream rather than physical bit timing.

## Web control plane

The Web UI provides:

- Dashboard
- Devices
- Adapters
- Transactions
- Device Library
- Logs

Behavior flows and scenarios are device features:

```text
/devices/:deviceId/flows
/devices/:deviceId/scenarios
```

There are no global flow or scenario authoring routes. Device configuration,
registers, commands, faults, flows, and scenarios remain scoped to the selected
device.

Vite proxies `/api` and the WebSocket upgrade to the control server. For
focused frontend development:

```shell
npm --prefix apps/vds-web install
npm --prefix apps/vds-web run dev
```

Use `VDS_API_PROXY_TARGET` to change the development proxy target, or
`VITE_API_ROOT` and `VITE_WS_ROOT` for a separately hosted frontend.

## Control and observability APIs

The server exposes REST resources under `/api/v1` for health, devices,
registers, commands, reset, packages, adapters, scenarios, runs, faults, and
telemetry.

`GET /api/v1/events` is the WebSocket event stream. Event IDs are monotonic,
and reconnecting clients can replay retained events by passing
`after_event_id`.

REST and WebSocket are control/observability paths. Native bus traffic remains
on the Unix-socket Protobuf data plane.

When enabled, the SQLite event store persists the replay high-water mark and
applies configured sampling, retention, event-count, and size limits without
blocking device transactions on database writes.

## Verification

Run focused checks while developing. Before release or integration, run the
complete repository checks:

```shell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

npm --prefix apps/vds-web run lint
npm --prefix apps/vds-web run typecheck
npm --prefix apps/vds-web run test:run
npm --prefix apps/vds-web run build
```

Native adapters and examples have their own CMake or Make definitions. The root
`./configure` and `./build.sh` pipeline builds them together from staged output
directories.

## Architecture boundaries

- The server is the only authoritative owner of runtime device state.
- The Web UI never implements device semantics.
- Linux adapters implement host ABI translation, not device behavior.
- High-frequency hardware transactions do not use REST.
- Models, behavior flows, and scenarios come only from device packages.
- Packages are declarative and cannot load arbitrary executable extensions.
- Privileged kernel integration is isolated from the default runtime.
- Generated build outputs are not source artifacts.

## Maintainers

- Hakan Kaya — [@haknkayaa](https://github.com/haknkayaa)

## Contributors

- Hakan Kaya — [@haknkayaa](https://github.com/haknkayaa)
