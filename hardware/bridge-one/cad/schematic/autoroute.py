#!/usr/bin/env python3
"""Autorouted PREVIEW of bridge-one.kicad_pcb (Freerouting), for visual review only.

Adds a GND plane on In1.Cu and a +3V3 plane on In2.Cu, exports Specctra DSN,
runs Freerouting headless, imports the session and writes
bridge-one-autorouted.kicad_pcb. The source board is not modified. Autorouted
copper is not a fabrication layout: USB, SPI, antenna and power routing need a
manual pass with KiCad's interactive router.

Usage: python3 autoroute.py [max_passes]
"""

import os
import subprocess
import sys

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "bridge-one.kicad_pcb")
OUT = os.path.join(HERE, "bridge-one-autorouted.kicad_pcb")
WORK = os.path.join(HERE, "autoroute")
JAVA = os.path.expanduser("~/Applications/jre25/bin/java")
FREEROUTING = os.path.expanduser("~/Applications/freerouting-2.5.0.jar")
PLANES = [("GND", pcbnew.In1_Cu), ("+3V3", pcbnew.In2_Cu)]


def mm(v):
    return pcbnew.FromMM(v)


def add_plane(board, net_name, layer):
    net = board.FindNet(net_name)
    zone = pcbnew.ZONE(board)
    zone.SetLayer(layer)
    zone.SetNet(net)
    zone.SetLocalClearance(mm(0.2))
    zone.SetMinThickness(mm(0.2))
    zone.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
    outline = zone.Outline()
    outline.NewOutline()
    bb = board.GetBoardEdgesBoundingBox()
    for x, y in ((bb.GetLeft(), bb.GetTop()), (bb.GetRight(), bb.GetTop()),
                 (bb.GetRight(), bb.GetBottom()), (bb.GetLeft(), bb.GetBottom())):
        outline.Append(x, y)
    board.Add(zone)


def main():
    passes = sys.argv[1] if len(sys.argv) > 1 else "30"
    os.makedirs(WORK, exist_ok=True)
    board = pcbnew.LoadBoard(SRC)
    for name, layer in PLANES:
        add_plane(board, name, layer)
    dsn = os.path.join(WORK, "bridge-one.dsn")
    ses = os.path.join(WORK, "bridge-one.ses")
    if not pcbnew.ExportSpecctraDSN(board, dsn):
        raise RuntimeError("DSN export failed")
    cmd = [JAVA, "-jar", FREEROUTING, "-de", dsn, "-do", ses, "-mp", passes, "--gui.enabled=false"]
    print("running:", " ".join(cmd))
    with open(os.path.join(WORK, "freerouting.log"), "w") as log:
        subprocess.run(cmd, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=3600)
    if not pcbnew.ImportSpecctraSES(board, ses):
        raise RuntimeError("SES import failed")
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    pcbnew.SaveBoard(OUT, board)
    print(f"{len(board.GetTracks())} track/via items -> {OUT}")


if __name__ == "__main__":
    main()
