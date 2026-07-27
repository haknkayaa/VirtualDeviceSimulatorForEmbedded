# Generic GPIO bank

This package provides a 32-line declarative GPIO runtime for the Linux
`gpio-sim` host adapter. Lines 0–15 are inputs from the device's perspective,
can be driven by `gpioset`, and are exposed through read-only state registers.
Lines 16–31 are device outputs initialized low
and can be observed with `gpioget` or `gpiomon`. Their runtime levels are
backed by writable `GPIO16_STATE` through `GPIO31_STATE` one-bit registers, so
device flows, scenarios, or the control API can inject output transitions.

Create a GPIO adapter with 32 lines, attach `generic-gpio-bank-32`, and load
the adapter. The kernel-assigned `/dev/gpiochipX` path appears in the adapter
snapshot.
