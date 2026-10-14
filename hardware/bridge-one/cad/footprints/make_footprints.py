#!/usr/bin/env python3
"""Derive project footprints from KiCad library footprints with manufacturer land patterns.

Pad numbering and orientation are inherited from the KiCad source footprint; only
pad sizes/positions change, per research/footprint-verification.md. Run with the
system python3 (KiCad 10 pcbnew).
"""

import os

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "BridgeOne.pretty")
SYS = "/usr/share/kicad/footprints"


def mm(v):
    return pcbnew.FromMM(v)


def derive(src_lib, src_name, new_name, descr, pad_rule):
    fp = pcbnew.FootprintLoad(os.path.join(SYS, src_lib + ".pretty"), src_name)
    fp.SetFPID(pcbnew.LIB_ID("BridgeOne", new_name))
    fp.SetLibDescription(descr)
    for pad in fp.Pads():
        size, (x, y) = pad_rule(pad.GetNumber(), pcbnew.ToMM(pad.GetPosition().x), pcbnew.ToMM(pad.GetPosition().y))
        # Rules give (board X extent, board Y extent); pad size is in the pad's own frame.
        if round(pad.GetOrientationDegrees()) % 180 == 90:
            size = (size[1], size[0])
        pad.SetSize(pcbnew.VECTOR2I(mm(size[0]), mm(size[1])))
        pad.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    pcbnew.FootprintSave(LIB, fp)
    return fp


def sign(v):
    return 1 if v >= 0 else -1


def ti_dqa(number, x, y):
    # TI DQA0010A land pattern: signal pads 0.565 x 0.20, GND pads (3, 8) 0.565 x 0.40,
    # column centres at x = +/-0.4175 mm.
    width = 0.40 if number in ("3", "8") else 0.20
    return (0.565, width), (sign(x) * 0.4175, y)


def yxc_2016(number, x, y):
    # YXC 2.0 x 1.6 oscillator land pattern: 0.775 x 0.675 pads, outer span 2.05 x 1.65 mm.
    return (0.775, 0.675), (sign(x) * 0.6375, sign(y) * 0.4875)


def main():
    derive("Package_SON", "USON-10_2.5x1.0mm_P0.5mm", "USON-10_2.5x1.0mm_P0.5mm_TI_DQA",
           "TI DQA0010A (TPD4E05U06DQA) land pattern; flow-through: route lines straight across pad pairs",
           ti_dqa)
    derive("Oscillator", "Oscillator_SMD_SiT_PQFN-4Pin_2.0x1.6mm", "Oscillator_SMD_YXC_2016-4Pin_2.0x1.6mm",
           "YXC 2016 crystal oscillator (OT201612 series) recommended land pattern", yxc_2016)
    print("footprints ->", LIB)


if __name__ == "__main__":
    main()
