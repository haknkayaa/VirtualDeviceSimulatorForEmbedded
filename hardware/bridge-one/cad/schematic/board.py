#!/usr/bin/env python3
"""Build bridge-one.kicad_pcb from design.py: every schematic part, its footprint
and its pad nets, linked to the schematic symbols by footprint path.

Major parts (ICs, connectors, LEDs, buttons) keep explicit positions from the
revision placement (../preview/generate_preview.py PARTS) or NEW_ANCHORS below.
Passives and test points are auto-placed next to the part they connect to,
on the bottom side by default, without courtyard overlaps or entering the
antenna keepout. Also writes ../preview/placement.json and the board STEP for
the enclosure generator.

Usage: python3 board.py   (KiCad 10 Python: system python3 with pcbnew)
"""

import json
import math
import os
import subprocess
import sys

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, "..", "preview")
sys.path.insert(0, PREVIEW)
sys.path.insert(0, HERE)

import design  # noqa: E402
import generate_preview as gp  # noqa: E402
import render  # noqa: E402

PCB_PATH = os.path.join(HERE, "bridge-one.kicad_pcb")
STEP_PATH = os.path.join(PREVIEW, "bridge-one-preview.step")
PLACEMENT_PATH = os.path.join(PREVIEW, "placement.json")
SYS_FP = "/usr/share/kicad/footprints"
LOCAL_FP = os.path.join(HERE, "..", "footprints")

W, H = gp.BOARD_W, gp.BOARD_H
ANTENNA_X = W - 6.2          # copper-free band along the right edge (module antenna)
EDGE_MARGIN = 0.4
CLEARANCE = 0.2
POWER_NETS = {"GND", "+3V3"}

# ICs added to the schematic after the revision F placement: x, y, rotation, side.
NEW_ANCHORS = {
    "U17": (53.5, 15.5, 0, "top"),      # FPGA_3V3 sequencing switch, next to U5
    "U18": (39.5, 38.5, 90, "top"),     # isolation OR gates
    "U19": (43.0, 38.5, 90, "top"),
    "U20": (46.5, 38.5, 90, "top"),     # I2C enable NOR gates
    "U21": (42.5, 43.2, 0, "top"),      # VTREF comparator
    "U15": (24.0, 21.5, 0, "bottom"),   # 5V_OUT OVP switch, near J10 pins 21-24
    "U16": (31.0, 21.5, 0, "bottom"),   # 3V3_OUT limit switch
    "U22": (44.5, 31.0, 90, "bottom"),  # DNP second PSRAM under U4
    "D12": (21.5, 26.8, 0, "bottom"),   # OVP / UVLO pin clamps next to U15
    "D13": (26.5, 26.8, 0, "bottom"),
    "U23": (58.0, 16.0, 0, "top"),      # FPGA rail supervisor next to U17
}
AUTO_PREFIXES = ("C", "R", "TP")
PRO_PATH = os.path.join(HERE, "bridge-one.kicad_pro")

# JLCPCB 4-layer class rules. pcbnew.SaveBoard rewrites the project file with
# defaults, so these are merged back into it after every save.
RULES = {
    "min_clearance": 0.1, "min_track_width": 0.1, "min_through_hole_diameter": 0.2,
    "min_via_diameter": 0.45, "min_via_annular_width": 0.1, "min_hole_clearance": 0.2,
    "min_hole_to_hole": 0.25, "min_copper_edge_clearance": 0.3, "min_silk_clearance": 0.0,
    "min_text_height": 0.6, "min_text_thickness": 0.08,
}
NETCLASSES = [
    {"name": "Default", "clearance": 0.1, "track_width": 0.15, "via_diameter": 0.45, "via_drill": 0.2},
    {"name": "Power", "clearance": 0.15, "track_width": 0.4, "via_diameter": 0.6, "via_drill": 0.3},
]
POWER_PATTERNS = ["VBUS*", "+3V3", "5V_OUT", "3V3_OUT", "BUCK_SW", "FPGA_3V3", "FPGA_1V2"]


def apply_project_rules():
    with open(PRO_PATH, encoding="utf-8") as f:
        pro = json.load(f)
    pro.setdefault("board", {}).setdefault("design_settings", {}).setdefault("rules", {}).update(RULES)
    ns = pro.setdefault("net_settings", {})
    classes = {c.get("name"): c for c in ns.get("classes", [])}
    template = classes.get("Default", {})
    for nc in NETCLASSES:
        classes[nc["name"]] = {**template, **classes.get(nc["name"], {}), **nc}
    ns["classes"] = list(classes.values())
    ns["netclass_patterns"] = [{"netclass": "Power", "pattern": p} for p in POWER_PATTERNS]
    with open(PRO_PATH, "w", encoding="utf-8") as f:
        json.dump(pro, f, indent=2)


def mm(v):
    return pcbnew.FromMM(v)


def load_fp(fpid):
    lib, name = fpid.split(":", 1)
    path = os.path.join(LOCAL_FP, lib + ".pretty") if lib == "BridgeOne" else os.path.join(SYS_FP, lib + ".pretty")
    fp = pcbnew.FootprintLoad(path, name)
    if fp is None:
        raise RuntimeError(f"footprint {fpid} not found")
    model_override = gp.MODEL_OVERRIDES.get(name)
    if model_override and len(fp.Models()):
        fp.Models()[0].m_Filename = model_override
    return fp


def courtyard_box(fp, side):
    layer = pcbnew.B_CrtYd if side == "bottom" else pcbnew.F_CrtYd
    cy = fp.GetCourtyard(layer)
    if cy.OutlineCount():
        bb = cy.BBox()
    else:
        bb = fp.GetBoundingBox(False)
    return [pcbnew.ToMM(v) for v in (bb.GetLeft(), bb.GetTop(), bb.GetRight(), bb.GetBottom())]


def pad_box(fp, margin=0.25):
    xs, ys = [], []
    for p in fp.Pads():
        b = p.GetBoundingBox()
        xs += [b.GetLeft(), b.GetRight()]
        ys += [b.GetTop(), b.GetBottom()]
    return [pcbnew.ToMM(min(xs)) - margin, pcbnew.ToMM(min(ys)) - margin,
            pcbnew.ToMM(max(xs)) + margin, pcbnew.ToMM(max(ys)) + margin]


def overlaps(a, b, gap=CLEARANCE):
    return a[0] < b[2] + gap and b[0] < a[2] + gap and a[1] < b[3] + gap and b[1] < a[3] + gap


class Board:
    def __init__(self):
        self.board = pcbnew.BOARD()
        self.board.SetCopperLayerCount(4)
        self.board.SetLayerName(pcbnew.In1_Cu, "GND")
        self.board.SetLayerName(pcbnew.In2_Cu, "PWR")
        gp.add_outline(self.board)
        gp.add_silk(self.board)
        self.boxes = {"top": [], "bottom": []}
        self.placed = {}
        self.nets = {}

    def net(self, name):
        if name not in self.nets:
            ni = pcbnew.NETINFO_ITEM(self.board, name)
            self.board.Add(ni)
            self.nets[name] = ni
        return self.nets[name]

    def add(self, ref, fp, x, y, rot, side, value=None):
        fp.SetReference(ref)
        if value is not None:
            fp.SetValue(value)
        fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        fp.SetOrientationDegrees(rot)
        self.board.Add(fp)
        if side == "bottom":
            fp.SetLayerAndFlip(pcbnew.B_Cu)
        tht = any(p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH for p in fp.Pads()) or ref.startswith("H")
        box = courtyard_box(fp, side)
        self.boxes[side].append((ref, box))
        if tht:
            other = "top" if side == "bottom" else "bottom"
            self.boxes[other].append((ref, box if ref.startswith(("H", "J1")) else pad_box(fp)))
        self.placed[ref] = (fp, x, y, rot, side, box)
        return fp

    def fits(self, box, side):
        if box[0] < EDGE_MARGIN or box[1] < EDGE_MARGIN or box[2] > W - EDGE_MARGIN or box[3] > H - EDGE_MARGIN:
            return False
        if box[2] > ANTENNA_X and 6.0 < box[3] and box[1] < H:
            return False
        return not any(overlaps(box, b) for _, b in self.boxes[side])


def part_index():
    parts = {}
    for g in design.GROUPS:
        for p in g.parts:
            if not p.ref.startswith("#") and p.footprint:
                parts[p.ref] = (p, g)
    return parts


def owner_of(part, group, board, parts):
    signal = {n for n in part.nets.values() if n not in POWER_NETS}
    best, score = None, 0
    for ref, (fp, x, y, rot, side, box) in board.placed.items():
        if ref not in parts:
            continue
        other = parts[ref][0]
        shared = len(signal & set(other.nets.values()))
        if shared == 0:
            continue
        s = shared * (3 if ref.startswith(("U", "J")) else 1)
        if s > score:
            best, score = ref, s
    if best is None:
        same = [r for r, (p, g) in parts.items() if g is group and r in board.placed and r.startswith("U")]
        best = same[0] if same else next(iter(board.placed))
    return best


_LOCAL_BOX = {}


def local_box(fpid, rot, side):
    """Courtyard box of a footprint placed at the origin (cached per rotation/side)."""
    key = (fpid, rot, side)
    if key not in _LOCAL_BOX:
        probe = load_fp(fpid)
        probe.SetOrientationDegrees(rot)
        holder = pcbnew.BOARD()
        holder.Add(probe)
        if side == "bottom":
            probe.SetLayerAndFlip(pcbnew.B_Cu)
        _LOCAL_BOX[key] = (courtyard_box(probe, side), holder)
    return _LOCAL_BOX[key][0]


def auto_place(board, ref, part, owner):
    _, _, _, _, _, obox = board.placed[owner]
    cx, cy = (obox[0] + obox[2]) / 2, (obox[1] + obox[3]) / 2
    for side in ("bottom", "top"):
        for radius in [r * 0.5 for r in range(0, 90)]:
            steps = max(1, int(2 * math.pi * radius / 0.8))
            for k in range(steps):
                a = 2 * math.pi * k / steps
                x, y = round(cx + radius * math.cos(a), 2), round(cy + radius * math.sin(a), 2)
                for rot in (0, 90):
                    lb = local_box(part.footprint, rot, side)
                    box = [lb[0] + x, lb[1] + y, lb[2] + x, lb[3] + y]
                    if board.fits(box, side):
                        return x, y, rot, side
    raise RuntimeError(f"no room for {ref} near {owner}")


def main():
    parts = part_index()
    board = Board()
    anchors = {}
    for ref, value, lib, name, x, y, rot, role in gp.PARTS:
        if ref in parts and ref.startswith(AUTO_PREFIXES):
            continue
        if ref not in parts and not ref.startswith(("H", "DS")):
            continue                      # dropped from the schematic (e.g. old U12)
        side = "bottom" if ref in gp.BOTTOM else "top"
        anchors[ref] = (x, y, rot, side, f"{lib}:{name}" if ref not in parts else parts[ref][0].footprint, value)
    for ref, (x, y, rot, side) in NEW_ANCHORS.items():
        anchors[ref] = (x, y, rot, side, parts[ref][0].footprint, parts[ref][0].value)

    for ref, (x, y, rot, side, fpid, value) in anchors.items():
        board.add(ref, load_fp(fpid), x, y, rot, side, value if ref not in parts else parts[ref][0].value)

    pending = [r for r in parts if r not in board.placed]
    missing_anchor = [r for r in pending if not r.startswith(AUTO_PREFIXES)]
    if missing_anchor:
        print("auto-placing parts without an anchor:", ", ".join(sorted(missing_anchor)))
    # Place parts that share a signal net with something already placed first.
    pending.sort(key=lambda r: (parts[r][1].key, r))
    for ref in pending:
        part, group = parts[ref]
        owner = owner_of(part, group, board, parts)
        x, y, rot, side = auto_place(board, ref, part, owner)
        board.add(ref, load_fp(part.footprint), x, y, rot, side, part.value)

    # Nets, schematic links, display.
    problems = []
    for ref, (fp, *_rest) in board.placed.items():
        if ref not in parts:
            continue
        part, group = parts[ref]
        fp.SetPath(pcbnew.KIID_PATH(f"/{render.sheet_uuid(group.key)}/{render.symbol_uuid(ref, 1)}"))
        if part.dnp:
            fp.SetDNP(True)
        if ref.startswith(gp.HIDDEN_REF_PREFIXES) or ref.startswith("D") and part.value in ("PWR", "LINK", "FPGA", "VTREF"):
            fp.Reference().SetVisible(False)
        pad_numbers = {p.GetNumber() for p in fp.Pads() if p.GetNumber()}
        for pin, net in part.nets.items():
            pads = [p for p in fp.Pads() if p.GetNumber() == pin]
            if not pads:
                problems.append(f"{ref}: pin {pin} ({net}) has no pad in {part.footprint}")
            for p in pads:
                p.SetNet(board.net(net))
        stray = sorted(pad_numbers - set(part.nets) - set(part.nc))
        if stray:
            problems.append(f"{ref}: pads {stray} have no net or NC in design.py")

    pcbnew.SaveBoard(PCB_PATH, board.board)
    apply_project_rules()
    entries = []
    for ref, (fp, x, y, rot, side, box) in board.placed.items():
        entries.append({"ref": ref, "value": fp.GetValue(), "footprint": str(fp.GetFPID().GetUniStringLibId()),
                        "x": x, "y": y, "rot": rot, "side": side, "courtyard": [round(v, 3) for v in box]})
    with open(PLACEMENT_PATH, "w", encoding="utf-8") as f:
        json.dump({"board_mm": [W, H], "parts": entries}, f, indent=1)
    subprocess.run(["kicad-cli", "pcb", "export", "step", "--subst-models", "--force", "--user-origin", "0x0mm",
                    "-o", STEP_PATH, PCB_PATH], check=True, stdout=subprocess.DEVNULL)
    top = sum(1 for e in entries if e["side"] == "top")
    print(f"{len(entries)} footprints ({top} top, {len(entries) - top} bottom), {len(board.nets)} nets -> {PCB_PATH}")
    for p in problems:
        print("PAD:", p)
    return 1 if any("has no pad" in p for p in problems) else 0


if __name__ == "__main__":
    sys.exit(main())
