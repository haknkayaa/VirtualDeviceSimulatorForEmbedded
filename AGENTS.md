# Agent instructions

## Core product intent: hardwareless Yocto application development

VDS4E exists so embedded Linux applications can be developed and tested on an
x86 Linux workstation without the physical target hardware.

The intended workflow is:

1. Keep the embedded application's production source code and Yocto recipe.
2. Build that same source for an x86_64 **target** using the appropriate Yocto
   target SDK/sysroot.
3. Run the resulting native x86_64 application unchanged against normal Linux
   device interfaces.
4. Expose virtual devices through VDS4E host adapters:
   - SPI: `/dev/spidevX.Y`
   - I2C: `/dev/i2c-X`
   - GPIO/libgpiod: `/dev/gpiochipX`
   - Future buses must follow their normal Linux userspace ABI.
5. Route those standard Linux operations through the adapter/data plane into
   declarative VDS4E device runtimes.

Do not require application code to include a VDS4E header, call a VDS4E API, or
contain simulator-specific mocks. Do not replace standard embedded Linux tools
with incomplete VDS4E-specific clones. Applications and tools should use their
normal Linux ABI; compatibility belongs in the host adapters.

Treat real, unmodified Linux userspace tools as adapter conformance tests:

- SPI adapters must work with the upstream `spidev_test` utility when it is
  built for the x86_64 target. Prefer the host distribution's standard SPI
  tools; when `spidev_test` is not packaged, use the upstream Linux source.
  Do not write a VDS4E-specific replacement.
- I2C adapters are not complete until the distribution's real `i2cdetect`,
  `i2cget`, `i2cset`, and `i2ctransfer` commands work against `/dev/i2c-N`.
- GPIO adapters are not complete until normal libgpiod tools such as
  `gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, and `gpiomon` work against
  `/dev/gpiochipN`.

Implement the Linux ioctl semantics required by these tools in the adapter and
the bus-neutral transaction semantics in the runtime/data plane. Never add
device-specific command knowledge to an ABI adapter merely to make a test tool
pass.

Remember the Yocto distinction: `SDKMACHINE=x86_64` only selects the machine on
which the SDK runs. The SDK's target architecture/sysroot must also produce an
x86_64 binary for native workstation execution.

Running an existing ARM binary unchanged is a separate QEMU/full-system
emulation concern and is not the current host-adapter architecture. Do not
silently redefine the product as an ARM binary emulator.

Before proposing changes to application compatibility, adapters, bus APIs, or
test tools, read `VDS4E_ARCHITECTURE.md`, `docs/ROADMAP.md`, and the relevant
ADR files under `docs/adr/`. Preserve the established boundary:

```text
Yocto application using standard Linux device ABI
    -> VDS4E host adapter
    -> Unix-socket transaction data plane
    -> declarative virtual device runtime
```
