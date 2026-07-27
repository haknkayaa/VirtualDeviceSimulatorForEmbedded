# ADR 0008: Use kernel gpio-sim for libgpiod integration

## Status

Accepted

## Context

Embedded Linux GPIO applications use the GPIO character-device ABI through
libgpiod and standard tools. A simulator-specific API or custom device name
would require application changes and would not exercise the production ABI.
GPIO line requests also return anonymous file descriptors, which makes a
complete userspace CUSE emulation unnecessarily complex.

## Decision

VDS4E provisions the Linux kernel's `gpio-sim` controller through configfs.
Loading one GPIO adapter creates one real, kernel-assigned
`/dev/gpiochipX` character device. The numeric suffix is discovered after
activation and returned in the adapter snapshot; it is never assumed.

One declarative `generic-gpio-bank` runtime device binds to each GPIO adapter.
The helper polls the gpio-sim line state, exchanges the complete line vector
over the Protobuf-framed Unix-socket data plane, and applies runtime-driven
levels through gpio-sim pull controls. Device packages define contiguous line
offsets, names, directions, active-low behavior, and initial values.

The helper requires operating-system authorization to load `gpio-sim` and
modify configfs. VDS4E does not collect a sudo password. Adapter unload sends
`SIGTERM`, deactivates the controller, and removes its configfs hierarchy.

Standard `gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, `gpiomon`, and
unmodified libgpiod applications are the conformance boundary.

## Consequences

- Applications use the same `/dev/gpiochipX` ABI as the Embedded Linux target.
- The kernel owns GPIO request, exclusivity, active-low, edge-event, and
  anonymous request-FD semantics.
- GPIO models remain declarative and device-specific behavior stays out of the
  ABI helper.
- Hosts must provide the `gpio-sim` module, configfs, and libgpiod tooling for
  end-to-end conformance tests.
