# Linux GPIO simulator adapter

`vds4e-gpio-sim` provisions a kernel `gpio-sim` controller through configfs.
The kernel assigns a real character device such as `/dev/gpiochip2`, so
`gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, and applications using
libgpiod work without wrappers or `LD_PRELOAD`.

The source keeps CLI validation (`options.c`), kernel configfs provisioning
(`configfs.c`), and runtime line synchronization (`runtime.c`) in separate
modules. `main.c` coordinates their lifecycle.

## Requirements

- Linux with the `gpio-sim` kernel module
- configfs mounted at `/sys/kernel/config`
- root privileges to create and remove gpio-sim devices
- libgpiod tools for manual verification

## Build and run

```sh
cmake -S adapters/gpio-sim -B build/adapters/gpio-sim
cmake --build build/adapters/gpio-sim

sudo modprobe gpio-sim
sudo build/adapters/gpio-sim/vds4e-gpio-sim \
  --name vds4e-gpio0 \
  --label "VDS4E GPIO 0" \
  --lines 32 \
  --device-id generic-gpio-bank-32 \
  --socket /tmp/vds4e.sock
```

The first stdout line is the kernel-assigned `/dev/gpiochipX` path. The
controller remains live until the adapter receives `SIGINT` or `SIGTERM`.
While live, the helper synchronizes line levels with the attached declarative
GPIO runtime over the normal VDS4E Unix-socket data plane.

```sh
gpiodetect
gpioinfo gpiochipX
gpioget -c gpiochipX 3
gpioset -c gpiochipX 4=1
```

The numeric suffix is allocated by the kernel and cannot be assumed when the
host already has GPIO controllers. Use the path reported by the adapter.
