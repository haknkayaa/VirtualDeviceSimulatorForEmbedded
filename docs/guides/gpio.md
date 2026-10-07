# GPIO: `/dev/gpiochipX`

See [device-node permissions](spi.md#device-node-permissions) for when `sudo` is required.

The [GPIO simulator adapter](../../adapters/gpio-sim/README.md) provisions the
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
        ...
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

