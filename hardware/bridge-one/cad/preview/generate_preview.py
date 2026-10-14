#!/usr/bin/env python3
"""Bridge One rev F placement preview (KiCad 10 pcbnew API).

Placement and mechanical intent only: no nets, no routing, no fabrication
release. Parts marked "candidate" are placeholders until their sourced
footprints are reviewed (see docs/ and research/).

Usage: python3 generate_preview.py [--staged]
  --staged  park every part beside the board so placement can be animated
            live over the KiCad IPC API (see live_place.py).
"""

import json
import os
import subprocess
import sys

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
PCB_PATH = os.path.join(HERE, "bridge-one-preview.kicad_pcb")
PLACEMENT_PATH = os.path.join(HERE, "placement.json")
STEP_PATH = os.path.join(HERE, "bridge-one-preview.step")
LIB = "/usr/share/kicad/footprints/"
LOCAL_LIB = os.path.join(HERE, "..", "footprints")

BOARD_W, BOARD_H = 76.0, 50.0
CORNER_R = 3.0
MOUNT_INSET = 3.5

# Orientation: the top edge is the BACK (all target cables), the bottom edge is the
# FRONT (display and side-actuated buttons face the user), USB-C enters on the left,
# and the ESP32-S3 antenna sits on the right edge.

# Raspberry Pi 40-pin header along the back edge between the mounting holes.
# Rotation 90: odd pins on the front row (pad 1 position), even pins 2.54 mm behind.
PI_PIN1 = (8.81, 4.77)
PI_PITCH = 2.54

# Direct-plug header in front of the Pi header: same translated nets plus auxiliary
# power outputs. Odd pins = front row, even pins = back row.
DIRECT_PIN1 = (8.81, 15.0)
DIRECT_PINS = ["VREF", "GND", "SDA0", "SCL0", "SDA1", "SCL1", "CS0", "CS1", "SCK", "MOSI",
               "MISO", "GND", "GPIO0", "GPIO1", "GPIO2", "GPIO3", "GPIO4", "GPIO5", "GPIO6", "GPIO7",
               "5V", "GND", "3V3", "GND"]

QFN16 = ("Package_DFN_QFN", "UQFN-16_1.8x2.6mm_P0.4mm")
ESD = ("Package_SON", "USON-10_2.5x1.0mm_P0.5mm")
HDR = "Connector_PinHeader_2.54mm"
SOT = "Package_TO_SOT_SMD"
CAP, RES = "Capacitor_SMD", "Resistor_SMD"

# Library footprints whose 3D model is missing from the KiCad 10 package set.
MODEL_OVERRIDES = {
    "UQFN-16_1.8x2.6mm_P0.4mm": "${KIPRJMOD}/../footprints/BridgeOne.3dshapes/UQFN-16_1.8x2.6mm_P0.4mm.step",
    "L_Taiyo-Yuden_NR-30xx": "${KIPRJMOD}/../footprints/BridgeOne.3dshapes/L_Taiyo-Yuden_NR-30xx.step",
}
# Reference designators shown on silkscreen; small parts stay unlabelled at this density.
HIDDEN_REF_PREFIXES = ("C", "R", "F", "DS", "D")

# Parts mounted on the bottom side.
BOTTOM = {"C1", "C2", "C3", "C4", "C5", "C10", "C11", "C12", "C13", "C14", "C20", "C21",
          "C22", "R1", "R2", "R20", "F1", "D1", "D6", "D7", "D8", "D9", "D10", "D11", "U15", "U16"}

TX_Y = 10.5     # translator row
X0 = 40.8       # first translator
DX = 3.2

# ref, value, library, footprint, x, y, rotation (deg), role
# Coordinates are footprint origins in mm seen from the top, board origin at back-left.
PARTS = [
    # MCU on the right; rotation 270 puts the antenna end flush with the right edge.
    ("U1", "ESP32-S3-WROOM-1-N8R8", "RF_Module", "ESP32-S3-WROOM-1", BOARD_W - 12.75, 30.0, 270, "MCU, USB device, control plane"),
    # Universal USB-C input on the left: fuse, TVS, 3.8-32 V buck to 3V3.
    ("J1", "USB-C 16P (candidate, KLS pending)", "Connector_USB", "USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal", 3.1, 24.0, 270, "USB2 device + power"),
    ("U14", "AP63203WU-7", SOT, "TSOT-23-6", 4.3, 32.6, 0, "3.8-32 V buck, fixed 3V3"),
    ("L1", "4u7 NR3015", "Inductor_SMD", "L_Taiyo-Yuden_NR-30xx", 4.3, 37.0, 0, "Buck inductor"),
    ("F1", "PTC 30 V 0.5 A", "Fuse", "Fuse_1812_4532Metric", 10.5, 25.0, 90, "VBUS overcurrent"),
    ("D11", "SMAJ24A", "Diode_SMD", "D_SMA", 15.5, 25.0, 90, "VBUS surge clamp"),
    ("C1", "10u 35V", CAP, "C_1206_3216Metric", 4.3, 31.5, 0, "Buck input"),
    ("C5", "100n 50V", CAP, "C_0603_1608Metric", 7.6, 31.2, 90, "Buck input HF"),
    ("C2", "22u", CAP, "C_0805_2012Metric", 4.3, 36.0, 0, "Buck output"),
    ("C3", "22u", CAP, "C_0805_2012Metric", 4.3, 38.6, 0, "Buck output"),
    ("C4", "100n", CAP, "C_0603_1608Metric", 7.6, 34.4, 90, "Buck bootstrap"),
    ("D1", "TPD2E2U06", SOT, "SOT-553", 10.0, 20.5, 0, "USB D+/D- ESD"),
    ("R1", "5k1", RES, "R_0402_1005Metric", 10.0, 17.6, 0, "CC1 Rd"),
    ("R2", "5k1", RES, "R_0402_1005Metric", 10.0, 29.0, 0, "CC2 Rd"),
    # Auxiliary power outputs on the direct header (bottom side, near pins 21-24).
    ("U15", "5V_OUT OVP switch (candidate)", SOT, "SOT-23-6", 36.5, 21.5, 0, "5V_OUT, opens above ~6 V VBUS"),
    ("U16", "3V3_OUT limit switch (candidate)", SOT, "SOT-23-5", 36.5, 26.0, 0, "3V3_OUT, ~300 mA limit"),
    # SPI execution engine: iCE40UP5K configured by the S3 (no config flash).
    ("U3", "iCE40UP5K-SG48", "Package_DFN_QFN", "QFN-48-1EP_7x7mm_P0.5mm_EP5.6x5.6mm", 44.5, 21.5, 0, "SPI/GPIO bus engine"),
    ("U4", "QSPI PSRAM (candidate)", "Package_SO", "SOIC-8_3.9x4.9mm_P1.27mm", 44.5, 31.0, 90, "Flash-image backing store"),
    ("U5", "TLV75712P", SOT, "SOT-23-5", 41.8, 15.0, 0, "FPGA 1V2 core rail"),
    ("Y1", "12 MHz", "Oscillator", "Oscillator_SMD_SiT_PQFN-4Pin_2.0x1.6mm", 47.5, 15.0, 0, "FPGA/timestamp clock"),
    ("C10", "100n", CAP, "C_0402_1005Metric", 39.2, 19.0, 90, "FPGA decoupling"),
    ("C11", "100n", CAP, "C_0402_1005Metric", 39.2, 22.0, 90, "FPGA decoupling"),
    ("C12", "100n", CAP, "C_0402_1005Metric", 39.2, 25.0, 90, "FPGA decoupling"),
    ("C13", "100n", CAP, "C_0402_1005Metric", 49.8, 19.0, 90, "FPGA decoupling"),
    ("C14", "100n", CAP, "C_0402_1005Metric", 49.8, 25.0, 90, "FPGA decoupling"),
    ("U12", "74LVC1G08", SOT, "SOT-23-5", 65.5, 10.5, 0, "Global isolate gate"),
    # Front: display, status LEDs and side-actuated buttons.
    ("DS1", "OLED 128x64 0.96in (candidate)", "BridgeOne", "OLED_0.96in_128x64_Panel", 22.35, 39.77, 180, "Status display, rotated in firmware"),
    ("J6", "FH12-30S-0.5SH", "Connector_FFC-FPC", "Hirose_FH12-30S-0.5SH_1x30-1MP_P0.50mm_Horizontal", 22.35, 24.8, 0, "OLED FPC (pitch/pinout per panel TBD)"),
    ("C20", "1u", CAP, "C_0402_1005Metric", 26.0, 24.0, 90, "OLED charge pump"),
    ("C21", "1u", CAP, "C_0402_1005Metric", 28.0, 24.0, 90, "OLED charge pump"),
    ("C22", "2u2", CAP, "C_0402_1005Metric", 30.0, 24.0, 90, "OLED VCOMH"),
    ("R20", "910k", RES, "R_0402_1005Metric", 32.0, 24.0, 90, "OLED IREF"),
    ("D2", "PWR", "LED_SMD", "LED_0603_1608Metric", 52.0, 42.0, 0, "Power LED"),
    ("D3", "LINK", "LED_SMD", "LED_0603_1608Metric", 55.5, 42.0, 0, "USB/host link"),
    ("D4", "FPGA", "LED_SMD", "LED_0603_1608Metric", 59.0, 42.0, 0, "FPGA CDONE"),
    ("D5", "VTREF", "LED_SMD", "LED_0603_1608Metric", 62.5, 42.0, 0, "Target reference present"),
    ("SW1", "RESET", "Button_Switch_SMD", "SW_SPST_EVQP7A", 44.0, BOARD_H - 1.8, 0, "EN reset, side-actuated"),
    ("SW2", "BOOT", "Button_Switch_SMD", "SW_SPST_EVQP7A", 64.0, BOARD_H - 1.8, 0, "GPIO0 strap, side-actuated"),
    # Target translators (UQFN/VSSOP) in one row behind the FPGA, next to the headers.
    ("U8", "PCA9306DCU", "Package_SO", "VSSOP-8_2.3x2mm_P0.5mm", X0, TX_Y, 90, "I2C0"),
    ("U9", "PCA9306DCU", "Package_SO", "VSSOP-8_2.3x2mm_P0.5mm", X0 + DX, TX_Y, 90, "I2C1"),
    ("U10", "SN74AVC4T245RSV", *QFN16, X0 + 2 * DX, TX_Y, 0, "UART"),
    ("U6", "SN74AVC4T245RSV", *QFN16, X0 + 3 * DX, TX_Y, 0, "SPI in (SCK/MOSI/CS0/CS1)"),
    ("U7", "SN74AVC4T245RSV", *QFN16, X0 + 4 * DX, TX_Y, 0, "SPI out (MISO)"),
    ("U11", "SN74AXC4T774RSV", *QFN16, X0 + 5 * DX, TX_Y, 0, "GPIO0-3"),
    ("U13", "SN74AXC4T774RSV", *QFN16, X0 + 6 * DX, TX_Y, 0, "GPIO4-7"),
    ("D6", "TPD4E05U06", *ESD, 41.0, 8.0, 0, "Target ESD"),
    ("D7", "TPD4E05U06", *ESD, 47.0, 8.0, 0, "Target ESD"),
    ("D8", "TPD4E05U06", *ESD, 53.0, 8.0, 0, "Target ESD"),
    ("D9", "TPD4E05U06", *ESD, 59.0, 8.0, 0, "Target ESD"),
    ("D10", "TPD4E05U06", *ESD, 65.0, 8.0, 0, "Target ESD"),
    # Target I/O block at the back edge.
    ("J3", "TARGET RPi 40-pin", HDR, "PinHeader_2x20_P2.54mm_Vertical", PI_PIN1[0], PI_PIN1[1], 90, "Raspberry Pi GPIO-compatible target header"),
    ("J10", "TARGET DIRECT", HDR, "PinHeader_2x12_P2.54mm_Vertical", DIRECT_PIN1[0], DIRECT_PIN1[1], 90, "Direct I2C/SPI/GPIO + power header"),
    # Four symmetric plated mounting holes with via stitching.
    ("H1", "M2.5", "MountingHole", "MountingHole_2.7mm_M2.5_Pad_Via", MOUNT_INSET, MOUNT_INSET, 0, "Mounting"),
    ("H2", "M2.5", "MountingHole", "MountingHole_2.7mm_M2.5_Pad_Via", BOARD_W - MOUNT_INSET, MOUNT_INSET, 0, "Mounting"),
    ("H3", "M2.5", "MountingHole", "MountingHole_2.7mm_M2.5_Pad_Via", MOUNT_INSET, BOARD_H - MOUNT_INSET, 0, "Mounting"),
    ("H4", "M2.5", "MountingHole", "MountingHole_2.7mm_M2.5_Pad_Via", BOARD_W - MOUNT_INSET, BOARD_H - MOUNT_INSET, 0, "Mounting"),
]


def direct_pin_xy(pin):
    col = (pin - 1) // 2
    row_y = DIRECT_PIN1[1] if pin % 2 else DIRECT_PIN1[1] - PI_PITCH
    return DIRECT_PIN1[0] + PI_PITCH * col, row_y


# Bridge function per Raspberry Pi header pin (see docs/pi-header-pinout.md).
PI_HEADER = {
    1: "VTREF", 2: "NC", 3: "I2C0_SDA", 4: "NC", 5: "I2C0_SCL", 6: "GND",
    7: "GPIO0", 8: "UART_RX", 9: "GND", 10: "UART_TX", 11: "GPIO1", 12: "GPIO2",
    13: "GPIO3", 14: "GND", 15: "GPIO4", 16: "GPIO5", 17: "VTREF", 18: "GPIO6",
    19: "SPI_MOSI", 20: "GND", 21: "SPI_MISO", 22: "GPIO7", 23: "SPI_SCLK", 24: "SPI_CS0",
    25: "GND", 26: "SPI_CS1", 27: "I2C1_SDA", 28: "I2C1_SCL", 29: "NC", 30: "GND",
    31: "NC", 32: "NC", 33: "NC", 34: "GND", 35: "NC", 36: "NC", 37: "NC", 38: "NC",
    39: "GND", 40: "NC",
}

# (text, x, y, size, layer, horizontal justification, rotation deg)
# Direct-header pin names point inward (vertical text between/in front of the rows),
# so they never push the board edge outward.
SILK = [
    ("VDS4E BRIDGE ONE", 38.0, 36.0, 1.6, "B", "center", 0),
    ("rev F placement preview", 38.0, 38.5, 0.8, "B", "center", 0),
    ("RPi 40-pin: 3/5 I2C0  8/10 UART  19-26 SPI0  27/28 I2C1", 34.0, 8.6, 0.7, "B", "center", 0),
    ("1", PI_PIN1[0] - 2.6, PI_PIN1[1], 0.8, "F", "center", 0),
] + [
    (name, direct_pin_xy(pin)[0],
     direct_pin_xy(pin)[1] + (3.25 if pin % 2 else -3.25), 0.55, "F", "center", 90)
    for pin, name in enumerate(DIRECT_PINS, start=1)
]


def mm(v):
    return pcbnew.FromMM(v)


def add_outline(board):
    r = CORNER_R
    w, h = BOARD_W, BOARD_H

    def seg(a, b):
        s = pcbnew.PCB_SHAPE(board)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
        s.SetEnd(pcbnew.VECTOR2I(mm(b[0]), mm(b[1])))
        s.SetWidth(mm(0.1))
        board.Add(s)

    def arc(start, mid, end):
        s = pcbnew.PCB_SHAPE(board)
        s.SetShape(pcbnew.SHAPE_T_ARC)
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetArcGeometry(*(pcbnew.VECTOR2I(mm(p[0]), mm(p[1])) for p in (start, mid, end)))
        s.SetWidth(mm(0.1))
        board.Add(s)

    k = r * (1 - 0.70710678)
    seg((r, 0), (w - r, 0))
    arc((w - r, 0), (w - k, k), (w, r))
    seg((w, r), (w, h - r))
    arc((w, h - r), (w - k, h - k), (w - r, h))
    seg((w - r, h), (r, h))
    arc((r, h), (k, h - k), (0, h - r))
    seg((0, h - r), (0, r))
    arc((0, r), (k, k), (r, 0))


def add_silk(board):
    justify = {"center": pcbnew.GR_TEXT_H_ALIGN_CENTER, "left": pcbnew.GR_TEXT_H_ALIGN_LEFT}
    for text, x, y, size, side, align, rot in SILK:
        t = pcbnew.PCB_TEXT(board)
        t.SetLayer(pcbnew.B_SilkS if side == "B" else pcbnew.F_SilkS)
        t.SetText(text)
        t.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
        t.SetTextThickness(mm(size * 0.15))
        t.SetHorizJustify(justify[align])
        t.SetTextAngleDegrees(rot)
        t.SetMirrored(side == "B")
        board.Add(t)


def staged_position(index):
    # Park parts in a grid to the right of the board.
    col, row = divmod(index, 12)
    return BOARD_W + 15.0 + col * 14.0, row * 7.0 + 3.0


def main():
    staged = "--staged" in sys.argv
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    board.SetLayerName(pcbnew.In1_Cu, "GND")
    board.SetLayerName(pcbnew.In2_Cu, "PWR")
    add_outline(board)
    add_silk(board)

    placement = []
    for index, (ref, value, lib, name, x, y, rot, role) in enumerate(PARTS):
        lib_dir = os.path.join(LOCAL_LIB, lib + ".pretty") if lib == "BridgeOne" else LIB + lib + ".pretty"
        fp = pcbnew.FootprintLoad(lib_dir, name)
        if fp is None:
            raise RuntimeError(f"missing footprint {lib}:{name}")
        fp.SetReference(ref)
        fp.SetValue(value)
        px, py = staged_position(index) if staged else (x, y)
        fp.SetPosition(pcbnew.VECTOR2I(mm(px), mm(py)))
        fp.SetOrientationDegrees(0 if staged else rot)
        if name in MODEL_OVERRIDES and len(fp.Models()):
            fp.Models()[0].m_Filename = MODEL_OVERRIDES[name]
        if ref.startswith(HIDDEN_REF_PREFIXES) or (ref.startswith("D") and value in ("PWR", "LINK", "FPGA", "VTREF")):
            fp.Reference().SetVisible(False)
        board.Add(fp)
        if ref in BOTTOM:
            # Flip only once the footprint belongs to the board (pcbnew crashes otherwise).
            fp.SetLayerAndFlip(pcbnew.B_Cu)
        entry = {"ref": ref, "value": value, "footprint": f"{lib}:{name}",
                 "x": x, "y": y, "rot": rot, "role": role}
        if not staged:
            # Courtyard bounds let the enclosure place connector/button cutouts.
            entry["side"] = "bottom" if ref in BOTTOM else "top"
            courtyard = fp.GetCourtyard(pcbnew.B_CrtYd if ref in BOTTOM else pcbnew.F_CrtYd)
            if courtyard.OutlineCount():
                bb = courtyard.BBox()
                entry["courtyard"] = [round(pcbnew.ToMM(v), 3) for v in
                                      (bb.GetLeft(), bb.GetTop(), bb.GetRight(), bb.GetBottom())]
        placement.append(entry)

    pcbnew.SaveBoard(PCB_PATH, board)
    with open(PLACEMENT_PATH, "w", encoding="utf-8") as f:
        json.dump({"board_mm": [BOARD_W, BOARD_H], "parts": placement}, f, indent=1)
    print(f"{len(PARTS)} footprints -> {PCB_PATH}{' (staged)' if staged else ''}")
    if not staged:
        # The enclosure generator consumes this STEP; keep it in sync with the board.
        subprocess.run(["kicad-cli", "pcb", "export", "step", "--subst-models", "--force",
                        "--user-origin", "0x0mm", "-o", STEP_PATH, PCB_PATH],
                       check=True, stdout=subprocess.DEVNULL)
        print(f"STEP -> {STEP_PATH}")


if __name__ == "__main__":
    main()
