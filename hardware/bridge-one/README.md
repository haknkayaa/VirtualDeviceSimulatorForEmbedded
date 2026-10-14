# VDS4E Bridge One

Bridge One is a proposed ESP32-S3-WROOM-1-N8R8 hardware extension to VDS4E.
Design state: revision A architecture and feasibility review. No fabrication
release, bench timing qualification or implemented bridge firmware is claimed.

**V1 priority:** real embedded boards communicate with virtual I2C/SPI/UART/GPIO
peripherals. The S3 performs bounded local transactions; VDS4E on the PC remains
the simulation authority. **V2:** reverse supported bus roles to access physical
peripherals, without compromising V1. The existing native x86_64/Linux ABI
workflow remains supported independently.

Fixed baseline: ESP-IDF, native USB-C, 1.8 V/3.3 V target IO, ESD protection and a
compact four-layer PCB. Real flash/EEPROM devices belong to optional validation
fixtures, rather than replacing the V1 virtual-peripheral objective.

## Layout

| Path | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Architecture and cache/authority contract |
| [`docs/pin-allocation.md`](docs/pin-allocation.md) | Provisional module pin allocation |
| [`docs/validation.md`](docs/validation.md) | Bus capability matrix and release measurements |
| [`docs/pi-header-pinout.md`](docs/pi-header-pinout.md) | Raspberry Pi 40-pin compatible target header |
| [`docs/history/`](docs/history/) | Dated handoffs, delegation log, MCP audit, superseded reviews |
| [`research/`](research/) | Technical research; `sourcing/` holds the candidate BOM and supplier evidence |
| [`cad/core/`](cad/core/) | Core schematic (USB-C, power, MCU), its generator and net manifest |
| [`cad/preview/`](cad/preview/) | Placement-only PCB preview and STEP ([3D](docs/images/bridge-one-revF-3d.png), [top](docs/images/bridge-one-revF-top.png)) |
| [`cad/enclosure/`](cad/enclosure/) | Parametric 3D-printable enclosure and board+enclosure STEP assemblies ([exploded](docs/images/bridge-one-enclosure-exploded.png)) |
| [`cad/footprints/`](cad/footprints/) | Project footprints and 3D models (KLS USB-C, OLED panel) |
| [`cad/tools/`](cad/tools/) | Independent CAD checks |
| [`AGENTS.md`](AGENTS.md) | Hardware agent instructions |

## Revision F placement (2026-10-14)

76 x 50 mm, 3 mm corner radius, four symmetric via-stitched M2.5 holes, four
layers, double-sided placement only. Orientation: back edge = all target cables
(Raspberry Pi 40-pin header plus a 2x12 direct header carrying I2C, SPI, GPIO,
VREF and auxiliary 5V_OUT/3V3_OUT/GND; pin names point inward between the
rows); front edge = 0.96in OLED (rotated in firmware), status LEDs and
side-actuated RESET/BOOT; left = universal USB-C input (PTC, SMAJ24A,
AP63203 3.8-32 V buck); right = ESP32-S3 module with its antenna on the edge.
iCE40UP5K + QSPI PSRAM in the middle. Enclosure: 81 x 55 x 13.4 mm.
Power-input part evidence: `research/power-input-universal.md`.
Regenerate with `cad/preview/generate_preview.py` (KiCad 10 Python; also exports
the board STEP), then `cad/enclosure/generate_enclosure.py` (CadQuery). No
schematic, nets, routing or DRC exist for this revision.

## Release blockers

I2C shared-bus multi-address and repeated-START read behavior require explicit
qualification. General same-CS SPI opcode/address-dependent responses are not
established by prequeued transmit buffers. Critical exact-part sourcing and
electrical safety must be reviewed before schematic release. The PC execution
lease/journal contract is proposed, not already present in the runtime.

## Tooling

KiCad 10.0.6 with `kicad-cli` is installed (2026-10-14). The KiCad MCP server
analyzes CAD files but cannot place symbols or wires; file generation and MCP
analysis must be reported separately. The core schematic still embeds KiCad 6
symbol copies and has no target-interface sheets, routed PCB or ERC/DRC release.

## License

Same as the parent VDS4E project.
