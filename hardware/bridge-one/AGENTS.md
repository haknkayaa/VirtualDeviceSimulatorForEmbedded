# Bridge One engineering instructions

## Product and architecture

- V1 priority: a real embedded target talks to virtual I2C/SPI/UART/GPIO peripherals through Bridge One. ESP32-S3 executes time-critical bus operations locally; VDS4E on the PC remains the simulation authority.
- V2: the same hardware may connect VDS4E to real peripherals. Reserve electrical direction controls and bus-role switching where feasible; never sacrifice V1 correctness for V2.
- Fixed baseline: ESP32-S3-WROOM-1-N8R8, ESP-IDF, USB-C, selectable 1.8 V/3.3 V target I/O, ESD protection, compact four-layer PCB.
- Preserve the existing native x86_64 Linux ABI workflow. The hardware bridge is an additional HIL path, not a replacement for Linux host adapters.
- Bridge firmware must use generic, versioned execution/cache contracts. Do not hardcode device-specific commands in electrical adapters. Any local execution of model semantics requires an explicit architectural decision.
- Define cache version, ownership, ordered writes/read side effects, event acknowledgments, reset, disconnect, stale-state behavior and reconciliation before claiming authoritative consistency.
- Never assume a PC/USB round trip can satisfy an externally clocked SPI transaction. Cached response bytes alone do not prove command-dependent response within one CS assertion.
- Validate ESP32-S3 I2C simultaneous-address support, repeated START/read response behavior and SPI same-transaction response timing before schematic release. Distinguish documentary evidence from bench measurement; report unsupported requirements explicitly.
- Avoid GPIOs reserved for N8R8 octal PSRAM and protect USB, boot straps, reset and programming access.

## Component sourcing

- Prioritize Ozdisan, Robotistan and Direnc.net. Record exact manufacturer part number, supplier SKU, direct product URL, package/footprint, quantity and observation date.
- Separate verified listing, reported in-stock, unknown stock and unavailable. Never infer stock from a search snippet or generic family page.
- Verify electrical ratings and pinouts against manufacturer documentation. Supplier substitutions require pinout, footprint and electrical review.
- No purchase authorization is implied. A candidate BOM is not procurement-ready while critical parts or exact variants remain unverified.

## Delegation and file ownership

- The main agent is architect and orchestrator. Use Antigravity CLI headlessly (`agy -p ... --output-format json`) for KiCad MCP work, sourcing and independent technical research.
- Check CLI, permissions and actual read-only MCP calls before mutation. An enabled MCP configuration alone is not proof of connectivity.
- Do not disable permission checks. Request normal sandbox escalation when required.
- Give each delegated task an explicit scope and disjoint output paths. Research owns `research/*.md`; sourcing owns `research/sourcing/`; KiCad owns `cad/` only until an architect accepts promotion.
- Workers must not edit repository-root instructions, software adapters, runtime, or another worker's outputs.
- Capture delegated results and independently inspect sources and actual changed files. Exit status and agent prose alone do not prove success.
- Keep the original scaffold untouched until reviewed CAD artifacts are available. Do not present notes, empty sheets or unconnected symbols as a finished schematic.

## Review and release

- Label assumptions, planned capabilities, validated capabilities and release blockers clearly.
- No automatic application tests or host ABI/conformance tests. Run requested design-specific checks as part of the user's hardware validation scope; no PCB fabrication release without reviewed schematic, ERC, layout and DRC.
- Keep datasheet links, architecture, bus capability matrix, pin allocation, BOM and schematic revision consistent.
