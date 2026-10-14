#!/usr/bin/env python3
"""Bridge One 3D-printable enclosure (CadQuery), driven by the PCB placement.

Reads ../preview/placement.json (positions and courtyards from
generate_preview.py) and ../preview/bridge-one-preview.step (KiCad export with
--user-origin 0x0mm). Frame: KiCad x -> X, KiCad y -> -Y, PCB bottom at Z=0.

Outputs (this directory):
  bridge-one-enclosure-base.step/.stl, bridge-one-enclosure-lid.step/.stl
  bridge-one-assembly.step           board + base + lid, closed
  bridge-one-assembly-exploded.step  lid lifted for inspection

Run with a Python that has CadQuery, e.g. ~/.venvs/cad/bin/python.
"""

import json
import os

import cadquery as cq
from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_ColorRGBA
from OCP.STEPCAFControl import STEPCAFControl_Reader, STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, "..", "preview")

with open(os.path.join(PREVIEW, "placement.json"), encoding="utf-8") as f:
    PLACEMENT = json.load(f)
PARTS = {p["ref"]: p for p in PLACEMENT["parts"]}
BOARD_W, BOARD_H = PLACEMENT["board_mm"]

PCB_T = 1.6            # nominal board thickness; the KiCad body is slightly thinner
EDGE_GAP = 0.5         # PCB edge to inner wall
WALL = 2.0
FLOOR = 2.0
STANDOFF_H = 4.0       # clears through-hole header tails under the PCB
HEADROOM = 4.0         # PCB top to lid underside; tallest low part is the module (~3.1 mm)
LID_T = 1.8
CORNER_R = 3.0
PILLAR_D = 5.2
SCREW_CLEAR_D = 2.8    # M2.5 through lid and PCB
SCREW_PILOT_D = 2.1    # M2.5 self-tapping into the standoff
SCREW_HEAD_D = 5.0
SCREW_HEAD_DEPTH = 1.2
CUTOUT_MARGIN = 0.4
# Must match cad/footprints/make_oled_panel.py.
OLED_GLASS_H = 19.26
OLED_ACTIVE_W, OLED_ACTIVE_H = 21.74, 10.86
OLED_ACTIVE_TOP = 1.90

Z_FLOOR_BOTTOM = -STANDOFF_H - FLOOR
Z_PCB_TOP = PCB_T
Z_LID_BOTTOM = Z_PCB_TOP + HEADROOM
Z_LID_TOP = Z_LID_BOTTOM + LID_T

IN_X0, IN_X1 = -EDGE_GAP, BOARD_W + EDGE_GAP
IN_Y0, IN_Y1 = -(BOARD_H + EDGE_GAP), EDGE_GAP
OUT_X0, OUT_X1 = IN_X0 - WALL, IN_X1 + WALL
OUT_Y0, OUT_Y1 = IN_Y0 - WALL, IN_Y1 + WALL


def xy(ref):
    p = PARTS[ref]
    return p["x"], -p["y"]


def courtyard_rect(ref, margin=CUTOUT_MARGIN):
    """Return (cx, cy, w, h) in enclosure XY for a part's courtyard."""
    left, top, right, bottom = PARTS[ref]["courtyard"]
    return ((left + right) / 2, -(top + bottom) / 2,
            right - left + 2 * margin, bottom - top + 2 * margin)


def box(x0, x1, y0, y1, z0, z1, fillet=0.0):
    solid = (cq.Workplane("XY").workplane(offset=z0)
             .center((x0 + x1) / 2, (y0 + y1) / 2)
             .rect(x1 - x0, y1 - y0).extrude(z1 - z0))
    if fillet:
        solid = solid.edges("|Z").fillet(fillet)
    return solid


def mount_points():
    return [xy(ref) for ref in ("H1", "H2", "H3", "H4")]


def make_base():
    base = box(OUT_X0, OUT_X1, OUT_Y0, OUT_Y1, Z_FLOOR_BOTTOM, Z_LID_BOTTOM, CORNER_R)
    cavity = box(IN_X0, IN_X1, IN_Y0, IN_Y1, Z_FLOOR_BOTTOM + FLOOR, Z_LID_BOTTOM + 1,
                 CORNER_R - WALL)
    base = base.cut(cavity)

    standoffs = (cq.Workplane("XY").workplane(offset=-STANDOFF_H)
                 .pushPoints(mount_points()).circle(PILLAR_D / 2).extrude(STANDOFF_H))
    base = base.union(standoffs)
    pilots = (cq.Workplane("XY").workplane(offset=-STANDOFF_H - 1.0)
              .pushPoints(mount_points()).circle(SCREW_PILOT_D / 2).extrude(STANDOFF_H + 1.0))
    base = base.cut(pilots)

    # Left wall: USB-C opening centred on the receptacle (YZ plane, cut toward -X).
    def left_wall_cut(y, z, sketch):
        wp = cq.Workplane("YZ").workplane(offset=IN_X0 + 0.1).center(y, z)
        return sketch(wp).extrude(-(WALL + 1.0))

    _, usb_y = xy("J1")
    base = base.cut(left_wall_cut(usb_y, Z_PCB_TOP + 1.65, lambda wp: wp.slot2D(10.0, 4.2)))

    # Front wall: pin-press holes in line with the side-actuated buttons.
    for ref in ("SW1", "SW2"):
        x, _ = xy(ref)
        hole = (cq.Workplane("XZ").workplane(offset=-IN_Y0 - 0.1)
                .center(x, Z_PCB_TOP + 1.75).circle(1.3).extrude(WALL + 1.0))
        base = base.cut(hole)

    # Rubber-foot recesses under the standoffs.
    feet = (cq.Workplane("XY").workplane(offset=Z_FLOOR_BOTTOM)
            .pushPoints(mount_points()).circle(4.0).extrude(0.6))
    return base.cut(feet)


def label(wp_text, x, y, size):
    return (cq.Workplane("XY").workplane(offset=Z_LID_TOP - 0.5)
            .center(x, y).text(wp_text, size, 0.6, kind="bold", combine=False))


def make_lid():
    lid = box(OUT_X0, OUT_X1, OUT_Y0, OUT_Y1, Z_LID_BOTTOM, Z_LID_TOP, CORNER_R)

    # Pillars clamp the PCB against the standoffs; one screw holds lid, PCB and base.
    pillars = (cq.Workplane("XY").workplane(offset=Z_PCB_TOP)
               .pushPoints(mount_points()).circle(PILLAR_D / 2).extrude(HEADROOM))
    lid = lid.union(pillars)
    clear = (cq.Workplane("XY").workplane(offset=Z_PCB_TOP - 0.1)
             .pushPoints(mount_points()).circle(SCREW_CLEAR_D / 2).extrude(HEADROOM + LID_T + 0.2))
    heads = (cq.Workplane("XY").workplane(offset=Z_LID_TOP - SCREW_HEAD_DEPTH)
             .pushPoints(mount_points()).circle(SCREW_HEAD_D / 2).extrude(SCREW_HEAD_DEPTH + 0.1))
    lid = lid.cut(clear).cut(heads)

    # One TARGET I/O window over both back-edge headers and the pin names between them.
    boxes = [courtyard_rect(r, 0.0) for r in ("J3", "J10")]
    x0 = min(cx - w / 2 for cx, cy, w, h in boxes) - CUTOUT_MARGIN
    x1 = max(cx + w / 2 for cx, cy, w, h in boxes) + CUTOUT_MARGIN
    y1 = max(cy + h / 2 for cx, cy, w, h in boxes) + CUTOUT_MARGIN
    y0 = min(cy - h / 2 for cx, cy, w, h in boxes) - 3.4      # front-row pin names
    lid = lid.cut(box(x0, x1, y0, y1, Z_LID_BOTTOM - 0.1, Z_LID_TOP + 0.1, 0.8))

    # OLED viewing window over the panel's active area (approximate panel data).
    ox, oy = xy("DS1")
    toward_top = OLED_GLASS_H / 2 - OLED_ACTIVE_TOP - OLED_ACTIVE_H / 2
    flip = 1 if PARTS["DS1"]["rot"] % 360 == 0 else -1
    active_cy = oy + flip * toward_top
    lid = lid.cut(box(ox - OLED_ACTIVE_W / 2 - 0.8, ox + OLED_ACTIVE_W / 2 + 0.8,
                      active_cy - OLED_ACTIVE_H / 2 - 0.8, active_cy + OLED_ACTIVE_H / 2 + 0.8,
                      Z_LID_BOTTOM - 0.1, Z_LID_TOP + 0.1, 0.8))

    # Light holes for the status LEDs.
    leds = [xy(r) for r in ("D2", "D3", "D4", "D5")]
    lid = lid.cut(cq.Workplane("XY").workplane(offset=Z_LID_BOTTOM - 0.1)
                  .pushPoints(leds).circle(0.9).extrude(LID_T + 0.2))

    # Engraved labels.
    texts = [
        ("VDS4E BRIDGE ONE", 61.0, -22.0, 2.2),
        ("TARGET I/O", (x0 + x1) / 2, y0 - 2.0, 1.8),
    ]
    for text, x, y, size in texts:
        lid = lid.cut(label(text, x, y, size))
    for ref, text in (("SW1", "RST"), ("SW2", "BOOT")):
        x, _ = xy(ref)
        lid = lid.cut(label(text, x, IN_Y0 + 2.2, 1.6))
    for ref, text in (("D2", "PWR"), ("D3", "LINK"), ("D4", "FPGA"), ("D5", "VREF")):
        x, y = xy(ref)
        lid = lid.cut(label(text, x, y + 2.2, 1.0))
    return lid


def write_assembly(board_step, base, lid, out_path):
    """Write one STEP holding the coloured KiCad board plus both enclosure parts."""
    doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    if reader.ReadFile(board_step) != IFSelect_RetDone or not reader.Transfer(doc):
        raise RuntimeError(f"cannot read {board_step}")
    shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    for name, part, rgba in (("enclosure-base", base, (0.16, 0.17, 0.19, 1.0)),
                             ("enclosure-lid", lid, (0.85, 0.87, 0.90, 0.45))):
        label = shapes.AddShape(part.val().wrapped, False)
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(name))
        colors.SetColor(label, Quantity_ColorRGBA(*rgba), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    writer = STEPCAFControl_Writer()
    writer.SetColorMode(True)
    writer.SetNameMode(True)
    writer.Transfer(doc, STEPControl_AsIs)
    if writer.Write(out_path) != IFSelect_RetDone:
        raise RuntimeError(f"cannot write {out_path}")


def main():
    base = make_base()
    lid = make_lid()
    for name, part in (("base", base), ("lid", lid)):
        cq.exporters.export(part, os.path.join(HERE, f"bridge-one-enclosure-{name}.step"))
        cq.exporters.export(part, os.path.join(HERE, f"bridge-one-enclosure-{name}.stl"),
                            tolerance=0.02, angularTolerance=0.1)

    board_path = os.path.join(PREVIEW, "bridge-one-preview.step")
    for suffix, lift in (("", 0.0), ("-exploded", 25.0)):
        write_assembly(board_path, base, lid.translate((0, 0, lift)),
                       os.path.join(HERE, f"bridge-one-assembly{suffix}.step"))

    outer = (OUT_X1 - OUT_X0, OUT_Y1 - OUT_Y0, Z_LID_TOP - Z_FLOOR_BOTTOM)
    print("enclosure outer %.1f x %.1f x %.1f mm" % outer)


if __name__ == "__main__":
    main()
