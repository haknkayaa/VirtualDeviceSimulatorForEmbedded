# Bridge One schematic (generated)

`design.py` is the single source of truth: functional groups, parts, pin-to-net
maps and the notes printed in each group box. Do not edit the `.kicad_sch`
files by hand; regenerate them.

```bash
python3 symbols/make_symbols.py      # project symbols (RSV translators, TPS2553)
python3 render.py                    # root + one hierarchical sheet per group
kicad-cli sch erc bridge-one.kicad_sch
kicad-cli sch export netlist --format kicadsexpr -o /tmp/bridge-one.net bridge-one.kicad_sch
python3 tools/verify_netlist.py /tmp/bridge-one.net   # must report 0 mismatches
kicad-cli sch export pdf -o bridge-one-schematic.pdf bridge-one.kicad_sch
```

Nets used in more than one group become global labels; group-internal nets are
local labels. Every symbol pin must be assigned a net or listed as no-connect,
or `render.py` refuses to write the schematic.

Status (sch0.1, 2026-10-14): ERC shows only intentional warnings (unused translator
inputs tied to GND, TPS22917 QOD tied to VOUT per datasheet); KiCad's netlist matches design.py exactly. Still
open: OLED FPC pin-1 orientation review,
32 MB PSRAM option, VTREF TVS, target pull-up jumpers.
