# ADR 0009: Retire the Linux SPI preload adapter

## Status

Accepted

Supersedes ADR 0005.

## Context

ADR 0005 introduced a rootless `LD_PRELOAD` adapter as the first Linux SPI
compatibility path. It intercepts calls only inside compatible dynamically
linked processes and does not create a real `/dev/spidevX.Y` endpoint.

VDS4E now has a managed SPI CUSE adapter that exposes the normal Linux
character-device ABI. Keeping both paths duplicates ABI translation,
configuration, tests, installation behavior, and error handling while the
preload path cannot cover static binaries or direct system calls.

VDS4E does not provide an application SDK. Embedded applications and standard
Linux tools use their normal Linux ABI, with compatibility implemented by the
host adapter.

## Decision

Remove the SPI preload adapter, its build and installation paths, its tests,
and its VDS4E-specific example utility.

SPI host integration uses the managed CUSE adapter and real
`/dev/spidevX.Y` endpoints. Adapter conformance is tested with normal Linux
clients, preferring the distribution's SPI tools and the upstream Linux
`spidev_test` source when it is not packaged.

The shared C transport under `adapters/common/client-c` remains internal
adapter implementation code. It is not a public application SDK.

## Consequences

- There is one authoritative Linux SPI ABI adapter implementation.
- Dynamically and statically linked applications use the same device-node path.
- SPI integration requires CUSE availability and explicit host authorization.
- Rootless `LD_PRELOAD` execution is no longer supported.
- ADR 0005 remains as historical context but no longer describes supported
  behavior.
