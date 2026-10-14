# Bridge One schematic (generated)

`design.py` is the single source of truth: functional groups, parts, pin-to-net
maps and the notes printed in each group box. Do not edit the `.kicad_sch`
files by hand; regenerate them.

```bash
python3 symbols/make_symbols.py      # project symbols (RSV translators, TPS2553)
python3 ../footprints/make_footprints.py   # TI DQA / YXC land patterns
python3 render.py                    # root + one hierarchical sheet per group
python3 board.py                     # bridge-one.kicad_pcb: all parts, pad nets, linked to symbols
kicad-cli sch erc bridge-one.kicad_sch
kicad-cli sch export netlist --format kicadsexpr -o /tmp/bridge-one.net bridge-one.kicad_sch
python3 tools/verify_netlist.py /tmp/bridge-one.net   # must report 0 mismatches
kicad-cli sch export pdf -o bridge-one-schematic.pdf bridge-one.kicad_sch
```

Nets used in more than one group become global labels; group-internal nets are
local labels. Every symbol pin must be assigned a net or listed as no-connect,
or `render.py` refuses to write the schematic.

`board.py` places every design.py part (anchors from ../preview/generate_preview.py
plus NEW_ANCHORS; passives auto-placed next to the part they connect to), assigns
pad nets, links footprints to schematic symbols (deterministic UUIDs), restores
the JLCPCB 4-layer rules in bridge-one.kicad_pro, and writes the STEP and
placement.json used by ../enclosure/generate_enclosure.py.

Status (sch0.3, 2026-10-14): PCA9306 replaced by PCA9617ADP (research/i2c-translator-replacement.md); review fixes applied (research/review-codex-sch0.1.md,
research/review-kicad-happy-sch0.1.md, research/footprint-verification.md).
ERC: only intentional warnings (unused translator inputs tied to GND, TPS22917 QOD
tied to VOUT). Netlist matches design.py exactly. PCB: 204 footprints, unrouted;
DRC errors are only unrouted nets, H2/H4 inside the module's conservative antenna
keepout (symmetric holes by request) and a GCT USB-C library footprint hole note.

Open: FPGA rail supervisor for U17 ON,
VTREF overvoltage protection, power budget vs F1 hold with aux outputs, OLED FPC
pin-1 mapping check on samples, 32 MB PSRAM option, KLS USB-C footprint swap,
routing and bottom silkscreen cleanup.
