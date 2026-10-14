# Bridge One — Claude handoff at first design checkpoint

Date: 2026-10-14, approximately 15:20 Europe/Istanbul.
The user explicitly requested stopping at the first suitable checkpoint and
continuing with Claude. Work is paused here; the complete hardware design is
not finished. No commit, purchase, fabrication or deployment was performed.

## User intent and authorization

- V1 primary: a physical embedded target uses virtual I2C/SPI/UART/GPIO
  peripherals. ESP32-S3 handles time-critical work locally; VDS4E PC runtime
  remains the simulation authority.
- V2 secondary: real peripherals can be accessed through reversed supported bus
  roles without compromising V1.
- Fixed: ESP32-S3-WROOM-1-N8R8, ESP-IDF, USB-C, 1.8 V/3.3 V target IO, ESD,
  compact four-layer PCB; prioritize Ozdisan, Robotistan and Direnc.net.
- User authorized routine work without repeated confirmation and explicitly
  requested Antigravity CLI delegation. OS authentication still requires the
  user's identity; do not collect passwords or bypass system authorization.
- User wanted a real PCB 3D view. It is now open on the desktop in KiCad's
  **3D Viewer**, with the placement preview and local models loaded.
- Preserve root AGENTS.md and existing Linux ABI product boundaries. Read the
  hardware-scoped AGENTS.md, architecture, roadmap and relevant ADRs before
  software/runtime changes. No host ABI tests were run or authorized here.

## Start from these files

1. `ARCHITECTURE.md`: proposed hardware and local execution lease/journal design.
2. `PIN_ALLOCATION.md`: architect's canonical provisional pin map.
3. `VALIDATION.md`: documentary capabilities, measurement plan and release gates.
4. `research/sourcing-bom.csv`: 20 reviewed candidate rows, 13 fields each.
5. `research/sourcing-review.md`: architect's corrected sourcing/circuit summary.
6. `research/reviewed-supplier-evidence.json`: independent exact-MPN supplier
   metadata, timestamps, URLs, response hashes and inventory declarations.
7. `cad/bridge-one-core.kicad_sch` and `.kicad_pro`: corrected core schematic.
8. `cad/preview/bridge-one-preview.kicad_pcb` and `.kicad_pro`: mechanical preview.
9. `cad/preview/bridge-one-preview.step`: actual exported assembled STEP (~9.8 MB).
10. `cad/preview/bridge-one-preview.png`: actual KiCad 3D window screenshot.

The original `vds4e-bridge.kicad_sch/.kicad_pcb/.kicad_pro` at this directory's
root were preserved. They are empty scaffolds; the root project file is an
invalid S-expression instead of JSON. Do not open them expecting the new design.

## Completed and independently checked

- Hardware AGENTS.md documents architecture, sourcing and delegated ownership.
- `agy` installed; actual KiCad MCP `list_projects` and other read-only calls
  succeeded. The MCP server has no symbol/wire placement API, so Antigravity
  generated CAD files separately and used MCP for analysis.
- The first schematic was rejected after an independent geometric check found
  shorts, split power nets and wrong MCU USB endpoints. It was regenerated from
  actual symbol-pin geometry. Do not restore the first revision from backups.
- Current core schematic: 18 physical parts, 83 pin-to-label wire stubs. The
  independent checker reports no manifest splits, multiple-named-net shorts or
  misplaced NC marks. Project JSON parses. It actually opens and renders in
  KiCad 6; this was verified on screen.
- `cad/tools/review_connectivity.py` checks actual symbol geometry against
  `cad/core-net-manifest.json`. It is not KiCad ERC and not a complete electrical
  safety review. It can be rerun after material connectivity edits, not after
  every incremental edit.
- Preview board loads through system `pcbnew`: 18 footprints, four copper
  layers, zero routed tracks. All 18 assigned local STEP paths exist.
- `kicad2step` generated the assembled STEP. The actual KiCad 3D Viewer rendered
  the board, module, passives, buttons, USB candidate and recovery header.
- Independent sourcing confirmed exact supplier product metadata for MCU,
  connector, LDO, AVC4T245, AXC4T774, PCA9306 packages and several ESD candidates.
  MCU visible page stock is 0. CC resistor SKU 427375 also reports stock 0.
  Unverified passive/button/header supplier URLs were removed from the CSV.

## Scope of the CAD artifacts

Core schematic implements USB-C, USB ESD, 3.3 V LDO, MCU, reset/boot networks,
module decoupling and UART0 recovery header. Target-side buses/control signals
terminate at labels. There are **no target translator or connector circuits**
on this sheet yet. Firmware/gateway/lease protocol are not implemented.

The 50 × 50 mm PCB is **placement only**. No net routing, plane fill, DRC release
or fabrication-ready stackup is claimed. Antenna keepout is provisioned. The
USB 3D/footprint candidate is GCT USB4085, **not** the sourced KLS connector.
Buttons/models are preview approximations rather than verified PTS526 parts.
The board is not an electrically synchronized, manufacturable implementation
of the schematic. Preserve these labels until exact footprints are accepted.

## Important technical conclusions and corrections

- GPIO19 = USB D−, GPIO20 = USB D+. Module pads 28/29/30 (GPIO35/36/37) are
  unavailable on N8R8; no external stubs. N8R8 is Quad flash plus Octal PSRAM.
- ESP-IDF 5.5.3 slave-v2 API configures one I2C slave address/controller. S3 has
  two controllers. A shared-bus two-address assembly using two open-drain pin
  pairs is plausible but unmeasured. Repeated-START first-byte/FIFO/stretching
  behavior must be qualified; arbitrary multi-address support is not established.
- Architect independently checked the v5.5.3 S3 register header's
  `I2C_SLAVE_ADDR_REG` at offset 0x10 and single address field [14:0]. See
  https://raw.githubusercontent.com/espressif/esp-idf/v5.5.3/components/soc/esp32s3/register/soc/i2c_reg.h
- Generic same-CS SPI opcode/address-dependent reads are not established by
  standard prequeued S3 slave buffers. A register cache does not solve command
  decoding during the same externally clocked transaction. **This is the main
  V1 feasibility gate.** Do not require handshake/multi-CS target-driver changes
  or silently substitute V2. Custom local bus execution or an added deterministic
  engine requires explicit engineering evidence and architecture review.
- Proposed runtime leases/journaling are new contracts. Local side effects,
  read-clear, ordered writes, timer events, reset, reconciliation and offline
  behavior cannot be implemented by silently replaying existing RPCs twice.
- Push-pull translators: MCU rail goes to VCCA, VTREF to VCCB. DIR/OE reference
  VCCA. SN74LVC2T45's common DIR does not handle UART TX/RX opposite directions.
  Standalone 1T45 lacks required OE isolation.
- Planned candidate budget: 2 AVC4T245 for SPI plus 1 dedicated AVC4T245 for UART,
  1 AXC4T774 for four independently directed GPIOs, 2 PCA9306 for I2C ports.
  AXC4T774 has four DIR pins and **one common OE**, not per-channel OE.
  MISO must not share CS-gated OE with UART TX.
- PCA9306 DCTR/DCUR differ in footprint. Validate bias/enable/equal-rail operation
  and startup isolation at both 1.8/3.3 V. VTREF is an input, not target power.
- LD1117AS33TR is rated 1 A, tab is pin 2. Minimum 10 uF effective capacitance,
  actual USB power budget, dropout and thermal performance remain open. A
  generic claimed 0.1–1 ohm ESR requirement was removed as unsupported.
- ESD standoff voltage alone does not qualify a clamp for 1.8 V protected pins.

## KiCad upgrade: not completed

System still reports KiCad **6.0.2**, symbols/footprints 6.0.2. The already-added
stable KiCad 10 PPA offers newer packages but Ubuntu version priority is higher.
`kicad-cli` remains absent. Do not claim KiCad 10 or successful ERC.

A desktop terminal **Bridge One - KiCad 10 upgrade retry** is waiting for sudo
authentication. The installer is `cad/tools/upgrade-kicad.sh`. An early SIGPIPE
in the package-selection awk pipeline was fixed. The first attempt updated APT
but did not install packages. Normal noninteractive sudo still requires a password.
The script writes `cad/tools/kicad-installed-version.txt` only after installation
and `kicad-cli --version` succeed. A missing file is not evidence of success.
Backup: `/tmp/vds4e-bridge-before-kicad-upgrade-20261014.tar.gz`.

## Suggested next sequence

1. Complete/verify the authorized KiCad upgrade when OS authentication is
   available; recheck CLI and MCP behavior without changing global permissions.
2. Resolve the V1 SPI execution approach and perform the required I2C/SPI proof
   on actual S3/target hardware before freezing the schematic.
3. Select exact sourced footprints and complete supply/VTREF/isolation/ESD
   circuits and remaining BOM rows. The BOM is not procurement-ready.
4. Add real target-interface sheets, synchronize schematic/PCB nets, then route
   and review four-layer PCB, RF keepout, USB return path and thermal design.
5. Run appropriate requested hardware/CAD checks at review milestones. No
   fabrication files, purchases, root host-adapter tests or commits are implied.

## Delegation restart information

Use `agy -p ... --output-format json` with tightly bounded isolated file ownership.
Several runs timed out while JSON misleadingly returned `SUCCESS`; inspect
files and results every time. Broad research jobs were inefficient; insist on
writing an artifact before further exploration. Existing conversations:

- Technical: `c7b738f5-6160-4a25-9c43-7247b858cc88`
- Sourcing: `6fe6ab8e-a9e7-46ab-a81f-454cb888aff8`
- Core CAD/MCP: `89dca87a-ed72-43d4-83c2-1fe063a74589`
- 3D placement: `36247897-4246-432b-87cb-83058720df1f`

All headless delegated CLI runs have returned at this checkpoint. GUI processes
remain open for the user. Research corrections by the architect are authoritative
over older agent responses. No shared-file editing task is intentionally left
running. Existing untracked example binaries/apps predated this work and were
not modified. The whole `hardware/` directory remains untracked in git.
