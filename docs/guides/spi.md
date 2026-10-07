# SPI: `/dev/spidevX.Y`

## Device-node permissions

Which commands need `sudo` depends on how the host exposes the node:

- The SPI and I2C CUSE adapters run as privileged helpers. The node is created
  with permissions chosen by the host device manager (SPI) or by the adapter
  (I2C sets ownership and mode `0660` where it can determine the invoking
  user). If `open(2)` fails with `EACCES`, run the client with `sudo` or add a
  udev rule for persistent non-root access. Do not make device nodes
  world-writable.
- `/dev/gpiochipX` is a normal kernel node. Access follows the host policy for
  GPIO character devices, commonly a dedicated group or root.
- The UART PTY adapter is unprivileged.

Examples in these guides omit `sudo` and note it only where it is usually
required. Add `sudo` if your host policy denies access.

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
./spidev_ping /dev/spidev0.0
```

Expected output:

```text
Device: /dev/spidev0.0
TX: A0 00 00 00
RX: DE AD BE EF
```

Use the host's normal udev/group policy to grant non-root access instead of
making the device node world-writable.

## Run the Micron Embedded Linux example

To exercise flash behavior instead of the generic transport endpoint, attach
`micron-mt25ql256aba8esf-0sit` to the SPI adapter and load it as
`/dev/spidev0.0`. Build and run the bundled application:

```shell
cc -O2 -Wall -Wextra -Werror -std=c11 \
  examples/micron-mt25ql256-embedded/mt25ql256_tool.c \
  -o mt25ql256_tool

./mt25ql256_tool -d /dev/spidev0.0 id
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
[the package documentation](../../device-models/examples/micron-mt25ql256aba8esf-0sit/docs/README.md).

The SPI adapter is documented in
[adapters/spi-cuse/README.md](../../adapters/spi-cuse/README.md). It also works
with the upstream `spidev_test` utility.
