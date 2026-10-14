#!/usr/bin/env python3
"""Generate the approximate 0.96in 128x64 OLED panel footprint and 3D model.

Model: Wisevision X096-2864KSWPG17-C30 (SSD1315): glass 24.70 x 16.60 x 1.30 mm,
active 21.74 x 11.175 mm, 1.48 mm below the glass top edge (research/oled-panel.md).
The courtyard is sized for the larger second source (ER-OLED0.96-1.3W, 26.70 x
19.26 mm glass) so either panel fits the same footprint. The panel sits on 0.3 mm foam tape; its FPC tail
leaves the bottom edge toward a 30-pin 0.5 mm ZIF connector.
Run with CadQuery (e.g. ~/.venvs/cad/bin/python).
"""

import os

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "OLED_0.96in_128x64_Panel"
GLASS_W, GLASS_H, GLASS_T = 24.70, 16.60, 1.30
ACTIVE_W, ACTIVE_H = 21.74, 11.175
ACTIVE_TOP = 1.48       # active-area offset from the glass top edge
ALT_GLASS_W, ALT_GLASS_H = 26.70, 19.26   # second source outline (courtyard)
TAPE = 0.30
TAIL_W, TAIL_L = 15.5, 3.0


def model():
    glass = cq.Workplane("XY").workplane(offset=TAPE).rect(GLASS_W, GLASS_H).extrude(GLASS_T)
    # Model +Y is footprint -y (up on the board): active area near the top edge.
    ay = GLASS_H / 2 - ACTIVE_TOP - ACTIVE_H / 2
    active = (cq.Workplane("XY").workplane(offset=TAPE + GLASS_T)
              .center(0, ay).rect(ACTIVE_W, ACTIVE_H).extrude(0.02))
    tail = (cq.Workplane("XY").workplane(offset=TAPE)
            .center(0, -GLASS_H / 2 - TAIL_L / 2).rect(TAIL_W, TAIL_L).extrude(0.12))
    asm = cq.Assembly(name=NAME)
    asm.add(glass, name="glass", color=cq.Color(0.05, 0.05, 0.06, 1.0))
    asm.add(active, name="active", color=cq.Color(0.10, 0.35, 0.75, 1.0))
    asm.add(tail, name="fpc", color=cq.Color(0.85, 0.55, 0.15, 1.0))
    asm.save(os.path.join(HERE, "BridgeOne.3dshapes", NAME + ".step"))


def rect_lines(layer, w, h, width):
    x, y = w / 2, h / 2
    pts = [(-x, -y), (x, -y), (x, y), (-x, y)]
    return "".join(
        f'\t(fp_line (start {a[0]:.3f} {a[1]:.3f}) (end {b[0]:.3f} {b[1]:.3f}) '
        f'(stroke (width {width}) (type solid)) (layer "{layer}"))\n'
        for a, b in zip(pts, pts[1:] + pts[:1]))


def footprint():
    ay = -GLASS_H / 2 + ACTIVE_TOP + ACTIVE_H / 2
    text = f'''(footprint "{NAME}"
\t(version 20241229)
\t(generator "make_oled_panel.py")
\t(layer "F.Cu")
\t(descr "0.96in 128x64 OLED: Wisevision X096-2864KSWPG17-C30 outline; courtyard fits ER-OLED0.96-1.3W; foam tape mount, FPC to ZIF")
\t(attr board_only exclude_from_pos_files exclude_from_bom)
\t(property "Reference" "REF**" (at 0 {-GLASS_H / 2 - 1.2:.2f} 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.12))))
\t(property "Value" "{NAME}" (at 0 {ay:.2f} 0) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))
{rect_lines("F.SilkS", GLASS_W + 0.3, GLASS_H + 0.3, 0.12)}{rect_lines("F.Fab", GLASS_W, GLASS_H, 0.1)}{rect_lines("F.CrtYd", ALT_GLASS_W + 0.5, ALT_GLASS_H + 0.5, 0.05)}\t(model "${{KIPRJMOD}}/../footprints/BridgeOne.3dshapes/{NAME}.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
)
'''
    with open(os.path.join(HERE, "BridgeOne.pretty", NAME + ".kicad_mod"), "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    model()
    footprint()
    print("wrote", NAME)
