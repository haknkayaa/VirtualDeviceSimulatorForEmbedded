#!/usr/bin/env python3
"""Render design.py into a grouped KiCad schematic.

Each design group becomes a titled, dashed box with its notes; every symbol
pin gets a short wire stub and a net label, so connectivity is defined only by
design.py. Unassigned pins are an error unless listed as no-connect.

The file is written in KiCad 9 syntax and then normalised with
`kicad-cli sch upgrade` to the installed KiCad 10 format.

Usage: python3 render.py   (writes bridge-one.kicad_sch next to this file)
"""

import math
import os
import re
import subprocess
import sys
import uuid

import design

HERE = os.path.dirname(os.path.abspath(__file__))
SYMBOL_DIRS = ["/usr/share/kicad/symbols", os.path.join(HERE, "symbols")]
OUT = os.path.join(HERE, "bridge-one.kicad_sch")
PROJECT = "bridge-one"

GRID = 1.27
GLOBAL_NETS = set()
PAPERS = [("A3", 420.0, 297.0), ("A2", 594.0, 420.0), ("A1", 841.0, 594.0)]
STUB = 2.54
LABEL_CHAR_W = 1.0       # approximate width of a 1.27 mm label character
PAGE_W = 840.0           # A0 landscape-ish working width; paper is set below
GROUP_GAP = 12.7
PART_GAP = 7.62
TITLE_H = 10.16
NOTE_LINE_H = 3.0


# --- S-expression helpers -------------------------------------------------

def tokenize(text):
    return re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+', text)


def parse(tokens):
    stack = [[]]
    for tok in tokens:
        if tok == "(":
            stack.append([])
        elif tok == ")":
            node = stack.pop()
            stack[-1].append(node)
        else:
            stack[-1].append(tok)
    return stack[0]


def dump(node):
    if isinstance(node, list):
        return "(" + " ".join(dump(n) for n in node) + ")"
    return node


def q(text):
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


def unq(tok):
    return tok[1:-1].replace('\\"', '"') if tok.startswith('"') else tok


def head(node):
    return node[0] if isinstance(node, list) and node else None


def child(node, name):
    return next((n for n in node if head(n) == name), None)


# Deterministic UUIDs: identical output for identical design.py, and stable symbol
# identities that the PCB generator can reference as footprint paths.
UUID_NS = uuid.UUID("6f1c8a52-3d0e-4b8e-9a51-5b2d0c7e4a10")
_CTX = {"scope": "", "n": 0}


def det_uuid(*parts):
    return str(uuid.uuid5(UUID_NS, "/".join(str(p) for p in parts)))


def begin_scope(name):
    _CTX["scope"], _CTX["n"] = name, 0


def new_uuid():
    _CTX["n"] += 1
    return q(det_uuid(_CTX["scope"], _CTX["n"]))


ROOT_UUID = det_uuid("root")


def sheet_uuid(group_key):
    return det_uuid("sheet", group_key)


def symbol_uuid(ref, unit=1):
    return det_uuid("symbol", ref, unit)


def snap(v):
    return round(round(v / GRID) * GRID, 4)


# --- Library access -------------------------------------------------------

_LIBS = {}


def library(lib):
    if lib not in _LIBS:
        for d in SYMBOL_DIRS:
            path = os.path.join(d, f"{lib}.kicad_sym")
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    root = parse(tokenize(f.read()))[0]
                _LIBS[lib] = {unq(n[1]): n for n in root if head(n) == "symbol"}
                break
        else:
            raise FileNotFoundError(f"symbol library {lib} not found")
    return _LIBS[lib]


def flattened(lib_id):
    """Return the library symbol as a standalone node named lib_id (extends resolved)."""
    lib, name = lib_id.split(":", 1)
    table = library(lib)
    sym = table[name]
    parent_ref = child(sym, "extends")
    if parent_ref:
        parent = flattened(f"{lib}:{unq(parent_ref[1])}")
        pname = unq(parent[1]).split(":", 1)[1]
        props = {unq(p[1]): p for p in sym if head(p) == "property"}
        body = []
        for n in parent[2:]:
            if head(n) == "property" and unq(n[1]) in props:
                body.append(props.pop(unq(n[1])))
            elif head(n) == "symbol":
                body.append([n[0], q(unq(n[1]).replace(pname, name, 1))] + n[2:])
            else:
                body.append(n)
        body.extend(props.values())
        return ["symbol", q(lib_id)] + body
    out = ["symbol", q(lib_id)]
    for n in sym[2:]:
        out.append(n)
    return out


def unit_count(sym):
    name = unq(sym[1]).split(":", 1)[1]
    units = [int(m.group(1)) for u in sym if head(u) == "symbol"
             for m in [re.match(re.escape(name) + r"_(\d+)_\d+$", unq(u[1]))] if m]
    return max([1] + units)


def pins_of(sym, unit=None):
    """Yield (number, name, x, y, angle) for body style 1 pins.

    unit=None returns every unit; otherwise the given unit plus common (unit 0) pins.
    """
    name = unq(sym[1]).split(":", 1)[1]
    for sub in sym:
        if head(sub) != "symbol":
            continue
        m = re.match(re.escape(name) + r"_(\d+)_(\d+)$", unq(sub[1]))
        if not m or m.group(2) not in ("0", "1"):
            continue
        u = int(m.group(1))
        if unit is not None and u not in (0, unit):
            continue
        for p in sub:
            if head(p) != "pin":
                continue
            at = child(p, "at")
            number = unq(child(p, "number")[1])
            pname = unq(child(p, "name")[1])
            yield number, pname, float(at[1]), float(at[2]), float(at[3]) if len(at) > 3 else 0.0


# --- Layout ---------------------------------------------------------------

def check_part(part, sym):
    numbers = {n for n, *_ in pins_of(sym)}
    missing = sorted(numbers - set(part.nets) - set(part.nc))
    extra = sorted((set(part.nets) | set(part.nc)) - numbers)
    if missing or extra:
        raise ValueError(f"{part.ref} ({part.lib_id}): unassigned pins {missing}, unknown pins {extra}")


class Placed:
    def __init__(self, part, sym, unit=1):
        self.part = part
        self.sym = sym
        self.unit = unit
        self.pins = list(pins_of(sym, unit))
        xs = [x for _, _, x, _, _ in self.pins] or [0.0]
        ys = [y for _, _, _, y, _ in self.pins] or [0.0]
        self.left_label = max((len(part.nets.get(n, "")) for n, _, x, _, a in self.pins if a == 0), default=0)
        self.right_label = max((len(part.nets.get(n, "")) for n, _, x, _, a in self.pins if a == 180), default=0)
        self.min_x, self.max_x = min(xs), max(xs)
        self.min_y, self.max_y = min(ys), max(ys)
        self.left = -self.min_x + STUB + self.left_label * LABEL_CHAR_W + 2.0
        self.right = self.max_x + STUB + self.right_label * LABEL_CHAR_W + 2.0
        top_label = max((len(part.nets.get(n, "")) for n, _, _, _, a in self.pins if a == 270), default=0)
        bot_label = max((len(part.nets.get(n, "")) for n, _, _, _, a in self.pins if a == 90), default=0)
        self.up = self.max_y + STUB + top_label * LABEL_CHAR_W + 5.0
        self.down = -self.min_y + STUB + bot_label * LABEL_CHAR_W + 5.0
        self.width = self.left + self.right
        self.height = self.up + self.down


def layout_group(group, origin_x, origin_y, max_width):
    placed = []
    for p in group.parts:
        sym = flattened(p.lib_id)
        check_part(p, sym)
        placed += [Placed(p, sym, u) for u in range(1, unit_count(sym) + 1)]
    note_h = TITLE_H + NOTE_LINE_H * len(group.notes) + 4.0
    x = origin_x + 5.0
    y = origin_y + note_h
    row_h = 0.0
    width_used = 0.0
    for pl in placed:
        if x + pl.width > origin_x + max_width and x > origin_x + 5.0:
            x = origin_x + 5.0
            y += row_h + PART_GAP
            row_h = 0.0
        pl.at = (snap(x + pl.left), snap(y + pl.up))
        x += pl.width + PART_GAP
        row_h = max(row_h, pl.height)
        width_used = max(width_used, x - origin_x)
    group_w = max(width_used + 2.0, 120.0)
    group_h = (y + row_h + 5.0) - origin_y
    return placed, group_w, group_h


# --- Emitters -------------------------------------------------------------

def font(size=1.27, bold=False):
    return f"(effects (font (size {size} {size}){' (bold yes)' if bold else ''}))"


def emit_symbol(pl, inst_path):
    p = pl.part
    x, y = pl.at
    props = [
        ("Reference", p.ref, (x, y - pl.max_y - 3.81), False),
        ("Value", p.value, (x, y - pl.min_y + 3.81), False),
        ("Footprint", p.footprint, (x, y), True),
        ("Datasheet", p.datasheet, (x, y), True),
    ] + [(k, v, (x, y), True) for k, v in p.fields.items()]
    out = [f'(symbol (lib_id {q(p.lib_id)}) (at {x} {y} 0) (unit {pl.unit}) (exclude_from_sim no) '
           f'(in_bom {"no" if p.dnp else "yes"}) (on_board yes) (dnp {"yes" if p.dnp else "no"}) '
           f'(uuid {q(symbol_uuid(p.ref, pl.unit))})']
    for key, val, (px, py), hidden in props:
        hide = " (hide yes)" if hidden else ""
        out.append(f'  (property {q(key)} {q(val)} (at {snap(px)} {snap(py)} 0) '
                   f'(effects (font (size 1.27 1.27)){hide}))')
    for number in sorted({n for n, *_ in pl.pins}):
        out.append(f"  (pin {q(number)} (uuid {new_uuid()}))")
    out.append(f'  (instances (project {q(PROJECT)} (path {q(inst_path)} '
               f'(reference {q(p.ref)}) (unit {pl.unit})))))')
    return "\n".join(out)


def emit_pin_nets(pl):
    out = []
    x0, y0 = pl.at
    for number, _name, px, py, ang in pl.pins:
        wx, wy = snap(x0 + px), snap(y0 - py)
        if number in pl.part.nc:
            out.append(f"(no_connect (at {wx} {wy}) (uuid {new_uuid()}))")
            continue
        net = pl.part.nets[number]
        dx, dy = -math.cos(math.radians(ang)), math.sin(math.radians(ang))
        ex, ey = snap(wx + dx * STUB), snap(wy + dy * STUB)
        out.append(f"(wire (pts (xy {wx} {wy}) (xy {ex} {ey})) (stroke (width 0) (type default)) (uuid {new_uuid()}))")
        if abs(dx) > 0.5:
            angle, just = (180, "right") if dx < 0 else (0, "left")
        else:
            angle, just = (90, "left") if dy < 0 else (270, "right")
        if net in GLOBAL_NETS:
            out.append(f"(global_label {q(net)} (shape passive) (at {ex} {ey} {angle}) "
                       f"(effects (font (size 1.27 1.27)) (justify {just})) (uuid {new_uuid()}) "
                       f'(property "Intersheetrefs" "${{INTERSHEET_REFS}}" (at {ex} {ey} 0) '
                       f"(effects (font (size 1.27 1.27)) (hide yes))))")
        else:
            out.append(f"(label {q(net)} (at {ex} {ey} {angle}) "
                       f"(effects (font (size 1.27 1.27)) (justify {just} bottom)) (uuid {new_uuid()}))")
    return out


def emit_group_frame(group, ox, oy, w, h):
    out = [f"(rectangle (start {snap(ox)} {snap(oy)}) (end {snap(ox + w)} {snap(oy + h)}) "
           f"(stroke (width 0.35) (type dash) (color 40 90 160 1)) (fill (type color) (color 230 240 255 0.35)) "
           f"(uuid {new_uuid()}))",
           f"(text {q(group.title.upper())} (exclude_from_sim no) (at {snap(ox + 3)} {snap(oy + 6.35)} 0) "
           f"(effects (font (size 3 3) (bold yes)) (justify left bottom)) (uuid {new_uuid()}))"]
    for i, note in enumerate(group.notes):
        out.append(f"(text {q('• ' + note)} (exclude_from_sim no) "
                   f"(at {snap(ox + 3)} {snap(oy + TITLE_H + 1 + i * NOTE_LINE_H)} 0) "
                   f"(effects (font (size 1.6 1.6) (italic yes)) (justify left bottom)) (uuid {new_uuid()}))")
    return out


def header(file_uuid, paper, page_title):
    title = design.TITLE
    return [f'(kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0") '
            f'(uuid {q(file_uuid)}) (paper {q(paper)})',
            f'(title_block (title {q(title["title"] + " - " + page_title)}) (date {q(title["date"])}) '
            f'(rev {q(title["rev"])}) (company {q(title["company"])}) (comment 1 {q(title["comment"])}))']


def write(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    subprocess.run(["kicad-cli", "sch", "upgrade", "--force", path], check=True, stdout=subprocess.DEVNULL)


def group_sheet(group, root_uuid, sheet_uuid):
    begin_scope(group.key)
    for name, pw, ph in PAPERS:
        placed, gw, gh = layout_group(group, 15.0, 20.0, pw - 40.0)
        if gh <= ph - 55.0 or name == PAPERS[-1][0]:
            break
    body = emit_group_frame(group, 15.0, 20.0, gw, gh)
    syms = {}
    for pl in placed:
        syms.setdefault(pl.part.lib_id, pl.sym)
        body.append(emit_symbol(pl, f"/{root_uuid}/{sheet_uuid}"))
        body += emit_pin_nets(pl)
    file_uuid = det_uuid("file", group.key)
    lines = header(file_uuid, name, group.title) + ["(lib_symbols"] + [dump(s) for s in syms.values()] + [")"]
    lines += body + [")"]
    write(os.path.join(HERE, f"{group.key}.kicad_sch"), lines)
    return name


def main():
    nets_by_group = {}
    for g in design.GROUPS:
        for p in g.parts:
            for net in p.nets.values():
                nets_by_group.setdefault(net, set()).add(g.key)
    GLOBAL_NETS.update(n for n, gs in nets_by_group.items() if len(gs) > 1)

    root_uuid = ROOT_UUID
    begin_scope("root")
    root = header(root_uuid, "A3", "Overview") + ["(lib_symbols)"]
    root.append(f"(text {q('VDS4E BRIDGE ONE - SCHEMATIC OVERVIEW')} (exclude_from_sim no) (at 20 22 0) "
                f"(effects (font (size 4 4) (bold yes)) (justify left bottom)) (uuid {new_uuid()}))")
    for i, line in enumerate(design.OVERVIEW):
        root.append(f"(text {q(line)} (exclude_from_sim no) (at 20 {30 + i * 4.5} 0) "
                    f"(effects (font (size 2 2)) (justify left bottom)) (uuid {new_uuid()}))")
    sw, sh, cols = 85.0, 30.0, 4
    y0 = 40 + len(design.OVERVIEW) * 4.5
    for i, g in enumerate(design.GROUPS):
        s_uuid = sheet_uuid(g.key)
        paper = group_sheet(g, root_uuid, s_uuid)
        begin_scope(f"root-{g.key}")
        x = 20 + (i % cols) * (sw + 10)
        y = y0 + (i // cols) * (sh + 18)
        root.append(
            f'(sheet (at {snap(x)} {snap(y)}) (size {sw} {sh}) (fields_autoplaced yes) '
            f'(stroke (width 0.2) (type solid)) (fill (color 230 240 255 1.0)) (uuid {q(s_uuid)}) '
            f'(property "Sheetname" {q(g.title)} (at {snap(x)} {snap(y) - 0.7} 0) '
            f'(effects (font (size 1.6 1.6) (bold yes)) (justify left bottom))) '
            f'(property "Sheetfile" {q(g.key + ".kicad_sch")} (at {snap(x)} {snap(y + sh) + 0.6} 0) '
            f'(effects (font (size 1.27 1.27)) (justify left top))) '
            f'(instances (project {q(PROJECT)} (path {q("/" + root_uuid)} (page {q(str(i + 2))})))))')
        root.append(f"(text {q(paper + ' - ' + str(len(g.parts)) + ' parts')} (exclude_from_sim no) "
                    f"(at {snap(x + 2)} {snap(y + 6)} 0) (effects (font (size 1.5 1.5)) (justify left bottom)) "
                    f"(uuid {new_uuid()}))")
    root += ['(sheet_instances (path "/" (page "1")))', ")"]
    write(OUT, root)

    single = sorted(n for n, gs in nets_by_group.items()
                    if sum(1 for g in design.GROUPS for p in g.parts for v in p.nets.values() if v == n) < 2
                    and n not in design.SINGLE_PIN_OK)
    print(f"{sum(len(g.parts) for g in design.GROUPS)} parts, {len(nets_by_group)} nets "
          f"({len(GLOBAL_NETS)} cross-sheet), {len(design.GROUPS)} sheets -> {OUT}")
    if single:
        print("WARNING single-pin nets:", ", ".join(single))
    return 0


if __name__ == "__main__":
    sys.exit(main())
