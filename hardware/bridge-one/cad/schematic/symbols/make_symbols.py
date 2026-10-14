#!/usr/bin/env python3
"""Generate bridge_one.kicad_sym: project symbols missing from the KiCad 10 library.

Every pin table cites the datasheet table it was copied from. Rectangle-body
symbols: `left` and `right` pin lists run top to bottom.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "bridge_one.kicad_sym")
PITCH = 2.54
PIN_LEN = 2.54

# name: (reference, footprint, datasheet, description, left pins, right pins)
# pin = (number, name, electrical type)
SYMBOLS = {
    # TI SLVS841F pin functions, DBV package.
    "TPS2553DBV": ("U", "Package_TO_SOT_SMD:SOT-23-6",
                   "https://www.ti.com/lit/ds/symlink/tps2553.pdf",
                   "Current-limited power switch, adjustable ILIM, active-high EN",
                   [("1", "IN", "power_in"), ("3", "EN", "input"), ("5", "ILIM", "passive"),
                    ("2", "GND", "power_in")],
                   [("6", "OUT", "power_out"), ("4", "~{FAULT}", "open_collector")]),
    # TI SCES576I Table 4-1 "Pin Functions", RSV column (research/pinouts-and-gates.md).
    "SN74AVC4T245RSV": ("U", "Package_DFN_QFN:UQFN-16_1.8x2.6mm_P0.4mm",
                        "https://www.ti.com/lit/ds/symlink/sn74avc4t245.pdf",
                        "Dual 2-bit dual-supply bus transceiver, per-bank DIR and OE",
                        [("3", "VCCA", "power_in"), ("6", "1A1", "bidirectional"), ("7", "1A2", "bidirectional"),
                         ("8", "2A1", "bidirectional"), ("9", "2A2", "bidirectional"),
                         ("4", "1DIR", "input"), ("5", "2DIR", "input"), ("1", "~{1OE}", "input"),
                         ("16", "~{2OE}", "input"), ("10", "GND", "power_in"), ("11", "GND", "passive")],
                        [("2", "VCCB", "power_in"), ("15", "1B1", "bidirectional"), ("14", "1B2", "bidirectional"),
                         ("13", "2B1", "bidirectional"), ("12", "2B2", "bidirectional")]),
    # TI SN74AXC4T774 Table 4-1, RSV column (confirmed in research/pinouts-and-gates.md).
    "SN74AXC4T774RSV": ("U", "Package_DFN_QFN:UQFN-16_1.8x2.6mm_P0.4mm",
                        "https://www.ti.com/lit/ds/symlink/sn74axc4t774.pdf",
                        "4-bit dual-supply transceiver, per-bit DIR, common OE",
                        [("14", "VCCA", "power_in"), ("1", "A1", "bidirectional"), ("2", "A2", "bidirectional"),
                         ("3", "A3", "bidirectional"), ("4", "A4", "bidirectional"),
                         ("15", "DIR1", "input"), ("16", "DIR2", "input"), ("5", "DIR3", "input"),
                         ("6", "DIR4", "input"), ("7", "~{OE}", "input"), ("8", "GND", "power_in")],
                        [("13", "VCCB", "power_in"), ("12", "B1", "bidirectional"), ("11", "B2", "bidirectional"),
                         ("10", "B3", "bidirectional"), ("9", "B4", "bidirectional")]),
}


def pin_line(num, name, etype, x, y, angle):
    return (f'\t\t\t(pin {etype} line (at {x:.2f} {y:.2f} {angle}) (length {PIN_LEN})\n'
            f'\t\t\t\t(name "{name}" (effects (font (size 1.27 1.27))))\n'
            f'\t\t\t\t(number "{num}" (effects (font (size 1.27 1.27)))))\n')


def symbol(name, ref, fp, ds, desc, left, right):
    rows = max(len(left), len(right))
    longest = max([len(n) for _, n, _ in left + right] + [4])
    half_w = round((longest * 1.0 + 4) / PITCH) * PITCH
    top = (rows - 1) / 2 * PITCH
    top = round(top / PITCH) * PITCH
    body_top, body_bot = top + PITCH, top - rows * PITCH
    s = [f'\t(symbol "{name}" (exclude_from_sim no) (in_bom yes) (on_board yes)\n',
         f'\t\t(property "Reference" "{ref}" (at 0 {body_top + 1.27:.2f} 0) (effects (font (size 1.27 1.27))))\n',
         f'\t\t(property "Value" "{name}" (at 0 {body_bot - 1.27:.2f} 0) (effects (font (size 1.27 1.27))))\n',
         f'\t\t(property "Footprint" "{fp}" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n',
         f'\t\t(property "Datasheet" "{ds}" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n',
         f'\t\t(property "Description" "{desc}" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n',
         f'\t\t(symbol "{name}_0_1"\n',
         f'\t\t\t(rectangle (start {-half_w:.2f} {body_top:.2f}) (end {half_w:.2f} {body_bot:.2f}) '
         f'(stroke (width 0.254) (type default)) (fill (type background)))\n',
         '\t\t)\n',
         f'\t\t(symbol "{name}_1_1"\n']
    for i, (num, pname, et) in enumerate(left):
        s.append(pin_line(num, pname, et, -half_w - PIN_LEN, top - i * PITCH, 0))
    for i, (num, pname, et) in enumerate(right):
        s.append(pin_line(num, pname, et, half_w + PIN_LEN, top - i * PITCH, 180))
    s.append('\t\t)\n\t)\n')
    return "".join(s)


def main():
    body = "".join(symbol(n, *v) for n, v in SYMBOLS.items())
    with open(OUT, "w", encoding="utf-8") as f:
        f.write('(kicad_symbol_lib (version 20241209) (generator "make_symbols.py") (generator_version "1.0")\n')
        f.write(body)
        f.write(")\n")
    print(f"{len(SYMBOLS)} symbols -> {OUT}")


if __name__ == "__main__":
    main()
