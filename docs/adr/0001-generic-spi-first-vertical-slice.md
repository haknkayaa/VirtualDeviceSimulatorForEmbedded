# 0001: Use a generic SPI device for the first vertical slice

- Status: Accepted
- Date: 2026-07-21

## Context

The original architecture selected a product-specific storage device as the
first vertical-slice target. That target combines transport, routing, command
decoding, memory behavior, timing, and product-specific rules. Implementing all
of those concerns at once would make it harder to validate the foundational
Level 1 boundaries and would expose company-private scope in a public roadmap.

The first slice needs to prove only the path from a host application through
the C client and Unix domain socket to a declarative virtual device and back.

## Decision

The first vertical slice will use a declarative generic SPI command device.
It will implement a single `READ_ID` command with opcode `0x9F`, returning
`EF 40 18`, and will return a structured error for unknown opcodes.

This slice includes:

- Length-prefixed Protobuf messages over a Unix domain socket
- A statically linked generic SPI device-model implementation
- YAML model loading and schema validation
- A Rust diagnostic CLI and a C client
- Structured transaction logs
- Unit and integration tests

Company-private devices are outside the public roadmap and consume only stable
public extension interfaces from separate private repositories.

## Alternatives

- Keep a product-specific device as the first slice: rejected because it
  introduces private behavior before the generic interfaces are stable.
- Implement a hardcoded server response: rejected because it would not prove
  declarative model loading or generic command dispatch.
- Start with a Web UI: rejected because headless operation is mandatory and the
  UI must consume working public APIs rather than contain simulation behavior.

## Consequences

- The first executable milestone is smaller and easier to test end to end.
- One generic SPI capability from Phase 2 is pulled forward solely to exercise
  the Phase 1 boundaries.
- No dynamic plugin ABI is introduced; the implementation is statically linked
  behind core device interfaces.
- Private device work remains outside this repository.

## Migration impact

There is no compatibility impact because no released protocol or device-model
schema exists yet. The first public protocol and schema versions begin at 1.
