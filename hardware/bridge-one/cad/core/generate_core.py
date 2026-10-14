#!/usr/bin/env python3
"""
generate_core.py - Deterministic KiCad 6 Core Schematic & Project Generator for Bridge One

This script generates:
  1. hardware/bridge-one/cad/core/bridge-one-core.kicad_pro (valid KiCad 6 JSON)
  2. hardware/bridge-one/cad/core/bridge-one-core.kicad_sch (valid KiCad 6 S-expression)
  3. hardware/bridge-one/cad/core/core-net-manifest.json   (structured netlist manifest)

Architectural Rules Applied:
  - Exact symbol pin coordinates computed from embedded library geometry + instance (at X Y R).
  - Clean short stubs + global/local labels for every net connection.
  - No hand-routed crossing wires; zero split nets, zero shorts.
  - No #PWR symbol duplicates; global named labels for GND, VBUS, +3V3.
  - Direct no_connect markers placed precisely at pin coordinates; no NC stubs (PSRAM stubs forbidden).
  - Stock KiCad 6 USB_C_Receptacle_USB2.0 symbol with all 17 discrete pads (A1,A12,B1,B12,S1,A4,A9,B4,B9,A5,B5,A6,B6,A7,B7,A8,B8).
  - Stock USBLC6-2SC6 pin pairs: 1/6 (DN), 3/4 (DP), 2 (GND), 5 (VBUS).
  - LD1117AS33TR SOT-223 3-pin configuration (1=GND, 2=OUT, 3=IN; tab is pin 2 internally). Rated 1A.
  - Minimum 10uF effective output capacitance labeled; stability/sourcing unresolved.
  - 18 real placed parts; no PCB.
"""

import json
import math
import os
import uuid

CAD_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_PATH = os.path.join(CAD_DIR, "bridge-one-core.kicad_pro")
SCHEMATIC_PATH = os.path.join(CAD_DIR, "bridge-one-core.kicad_sch")
MANIFEST_PATH = os.path.join(CAD_DIR, "core-net-manifest.json")

NS = uuid.UUID("3d9e4a8b-5c21-4f1e-9a73-8b4d2e1c0f6a")

def gen_uuid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def generate_project_json():
    pro_data = {
        "board": {
            "design_settings": {
                "defaults": {
                    "board_outline_line_width": 0.05,
                    "copper_line_width": 0.2,
                    "copper_text_size_h": 1.5,
                    "copper_text_size_v": 1.5,
                    "copper_text_thickness": 0.3,
                    "courtyard_line_width": 0.05,
                    "silk_line_width": 0.12,
                    "silk_text_size_h": 1.0,
                    "silk_text_size_v": 1.0,
                    "silk_text_thickness": 0.15
                },
                "rules": {
                    "min_clearance": 0.15,
                    "min_track_width": 0.2,
                    "min_via_annular_width": 0.1,
                    "min_via_diameter": 0.45
                }
            }
        },
        "meta": {
            "filename": "bridge-one-core.kicad_pro",
            "version": 1
        },
        "net_settings": {
            "classes": [
                {
                    "clearance": 0.2,
                    "name": "Default",
                    "track_width": 0.25,
                    "via_diameter": 0.8,
                    "via_drill": 0.4
                },
                {
                    "clearance": 0.3,
                    "name": "Power",
                    "track_width": 0.5,
                    "via_diameter": 0.9,
                    "via_drill": 0.5
                },
                {
                    "clearance": 0.2,
                    "diff_pair_gap": 0.2,
                    "diff_pair_width": 0.25,
                    "name": "USB_DIFF",
                    "track_width": 0.25,
                    "via_diameter": 0.8,
                    "via_drill": 0.4
                }
            ]
        },
        "schematic": {
            "annotate_start_num": 1,
            "drawing": {
                "default_line_thickness": 0.15,
                "default_text_size": 1.27
            },
            "meta": {
                "version": 1
            }
        }
    }
    with open(PROJECT_PATH, "w") as f:
        json.dump(pro_data, f, indent=2)
    print(f"Generated project file: {PROJECT_PATH}")


def generate_manifest():
    manifest = {
        "design": "VDS4E Bridge One — Core Subsystem",
        "revision": "0.1-core",
        "date": "2026-10-14",
        "author": "Antigravity Engineering Pair",
        "scope": "Core MCU, Native USB-C, 3.3V Power, Decoupling, Reset/Boot, Debug Header",
        "status": "DRAFT — Target bus level translators not implemented on this sheet; no PCB fabrication release",
        "mcu": {
            "part_number": "ESP32-S3-WROOM-1-N8R8",
            "flash": "8MB Quad SPI Flash (Quad variant)",
            "psram": "8MB Octal SPI PSRAM (IO35/36/37 dedicated and not broken out)",
            "total_pads": 41,
            "perimeter_pins": 40,
            "thermal_ground_pad": 41
        },
        "power_rails": {
            "VBUS": {"nominal_voltage": 5.0, "source": "USB-C Receptacle J1"},
            "+3V3": {"nominal_voltage": 3.3, "source": "LDO Regulator U2 (LD1117AS33TR)"},
            "GND": {"nominal_voltage": 0.0, "type": "Continuous Ground"}
        },
        "components": [
            {"ref": "U1", "val": "ESP32-S3-WROOM-1-N8R8", "pkg": "RF_Module:ESP32-S3-WROOM-1", "desc": "Espressif ESP32-S3 Wireless Module with Octal PSRAM"},
            {"ref": "J1", "val": "USB_C_Receptacle_USB2.0", "pkg": "", "desc": "KLS L-KLS1-5416-L1-01-R USB 2.0 Type-C Receptacle (footprint unverified pending custom CAD)"},
            {"ref": "U2", "val": "LD1117AS33TR", "pkg": "Package_TO_SOT_SMD:SOT-223-3_TabPin2", "desc": "STMicroelectronics 3.3V 1A Low Dropout Linear Regulator (Tab=Pin2)"},
            {"ref": "U3", "val": "USBLC6-2SC6", "pkg": "Package_TO_SOT_SMD:SOT-23-6", "desc": "STMicroelectronics Very Low Capacitance ESD Protection for High Speed USB"},
            {"ref": "R1", "val": "5.1k", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "USB Type-C CC1 5.1kΩ pull-down resistor"},
            {"ref": "R2", "val": "5.1k", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "USB Type-C CC2 5.1kΩ pull-down resistor"},
            {"ref": "R3", "val": "22R", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "USB D+ series impedance matching resistor"},
            {"ref": "R4", "val": "22R", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "USB D- series impedance matching resistor"},
            {"ref": "R5", "val": "10k", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "CHIP_EN reset line pull-up resistor"},
            {"ref": "C1", "val": "1uF", "pkg": "Capacitor_SMD:C_0603_1608Metric", "desc": "CHIP_EN power-on delay capacitor"},
            {"ref": "SW1", "val": "RESET", "pkg": "", "desc": "Tactile reset pushbutton (PTS526 vs PTS645 unverified footprint)"},
            {"ref": "R6", "val": "10k", "pkg": "Resistor_SMD:R_0603_1608Metric", "desc": "BOOT_N (GPIO0) strapping pull-up resistor"},
            {"ref": "SW2", "val": "BOOT", "pkg": "", "desc": "Tactile boot pushbutton (PTS526 vs PTS645 unverified footprint)"},
            {"ref": "C2", "val": "10uF", "pkg": "Capacitor_SMD:C_0805_2012Metric", "desc": "LDO VIN bulk filter capacitor (0805 candidate)"},
            {"ref": "C3", "val": "10uF", "pkg": "Capacitor_SMD:C_0805_2012Metric", "desc": "LDO VOUT stability capacitor (min 10uF effective, stability/part unresolved)"},
            {"ref": "C4", "val": "10uF", "pkg": "Capacitor_SMD:C_0805_2012Metric", "desc": "ESP32-S3 module +3V3 bulk decoupling capacitor (0805 candidate)"},
            {"ref": "C5", "val": "100nF", "pkg": "Capacitor_SMD:C_0603_1608Metric", "desc": "ESP32-S3 module high frequency ceramic bypass capacitor"},
            {"ref": "J2", "val": "DEBUG_UART0", "pkg": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical", "desc": "1x4 2.54mm pitch UART0 debug/flashing header"}
        ],
        "nets": {
            "VBUS": ["J1:A4", "J1:A9", "J1:B4", "J1:B9", "U3:5", "U2:3", "C2:1"],
            "+3V3": ["U2:2", "C3:1", "C4:1", "C5:1", "U1:2", "R5:1", "R6:1", "J2:1"],
            "GND": [
                "J1:A1", "J1:A12", "J1:B1", "J1:B12", "J1:S1",
                "U3:2", "U2:1", "C2:2", "C3:2", "C4:2", "C5:2", "C1:2",
                "SW1:2", "SW2:2", "R1:2", "R2:2", "U1:1", "U1:40", "U1:41", "J2:4"
            ],
            "USB_CC1": ["J1:A5", "R1:1"],
            "USB_CC2": ["J1:B5", "R2:1"],
            "USB_DP": ["J1:A6", "J1:B6", "U3:3", "U3:4", "R3:1"],
            "USB_DN": ["J1:A7", "J1:B7", "U3:1", "U3:6", "R4:1"],
            "USB_D_PLUS": ["R3:2", "U1:14"],
            "USB_D_MINUS": ["R4:2", "U1:13"],
            "CHIP_EN": ["U1:3", "R5:2", "C1:1", "SW1:1"],
            "BOOT_N": ["U1:27", "R6:2", "SW2:1"],
            "DEBUG_TX": ["U1:37", "J2:2"],
            "DEBUG_RX": ["U1:36", "J2:3"],
            "I2C0_SDA_MCU": ["U1:4"],
            "I2C0_SCL_MCU": ["U1:5"],
            "I2C1_SDA_MCU": ["U1:6"],
            "I2C1_SCL_MCU": ["U1:7"],
            "TARGET_GPIO0_MCU": ["U1:8"],
            "SPI_DIR_MISO": ["U1:9"],
            "UART_TX_MCU": ["U1:10"],
            "UART_RX_MCU": ["U1:11"],
            "TARGET_GPIO2_MCU": ["U1:12"],
            "TARGET_GPIO3_MCU": ["U1:17"],
            "SPI_CS_MCU": ["U1:18"],
            "SPI_MOSI_MCU": ["U1:19"],
            "SPI_SCLK_MCU": ["U1:20"],
            "SPI_MISO_MCU": ["U1:21"],
            "PORT_OE_N": ["U1:22"],
            "I2C_ISOLATE": ["U1:23"],
            "SPI_DIR_MAIN": ["U1:24"],
            "SPI_MISO_OE_N": ["U1:25"],
            "UART_OE_N": ["U1:31"],
            "GPIO_DIR0": ["U1:32"],
            "GPIO_DIR1": ["U1:33"],
            "GPIO_DIR2": ["U1:34"],
            "GPIO_DIR3": ["U1:35"],
            "TARGET_GPIO1_MCU": ["U1:38"],
            "VTREF_ADC": ["U1:39"]
        },
        "no_connect_pins": {
            "U1:15": "GPIO3 (strapping reserved)",
            "U1:16": "GPIO46 (strapping reserved, input-only)",
            "U1:26": "GPIO45 (VDD_SPI strapping reserved)",
            "U1:28": "GPIO35 (dedicated to internal octal PSRAM)",
            "U1:29": "GPIO36 (dedicated to internal octal PSRAM)",
            "U1:30": "GPIO37 (dedicated to internal octal PSRAM)",
            "J1:A8": "SBU1 (unused in USB 2.0)",
            "J1:B8": "SBU2 (unused in USB 2.0)"
        }
    }
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Generated net manifest: {MANIFEST_PATH}")
    return manifest


def generate_schematic(manifest):
    # Symbol Library Definitions (exact KiCad 6 syntax)
    # Each symbol definition defines exact pin positions (px, py)
    # In KiCad symbol lib coordinates: Y is positive UP.
    # When placed at (ox, oy) with angle=0:
    #   world_x = round(ox + px, 3)
    #   world_y = round(oy - py, 3)

    lib_symbols_dict = {
        "RF_Module:ESP32-S3-WROOM-1-N8R8": {
            "pins": [
                # Left pins (rot=0, connects at left)
                (1, "GND", "power_in", -35.56, 38.10, 0),
                (2, "3V3", "power_in", -35.56, 34.29, 0),
                (3, "EN", "input", -35.56, 30.48, 0),
                (4, "IO4", "bidirectional", -35.56, 26.67, 0),
                (5, "IO5", "bidirectional", -35.56, 22.86, 0),
                (6, "IO6", "bidirectional", -35.56, 19.05, 0),
                (7, "IO7", "bidirectional", -35.56, 15.24, 0),
                (8, "IO15", "bidirectional", -35.56, 11.43, 0),
                (9, "IO16", "bidirectional", -35.56, 7.62, 0),
                (10, "IO17", "bidirectional", -35.56, 3.81, 0),
                (11, "IO18", "bidirectional", -35.56, 0.00, 0),
                (12, "IO8", "bidirectional", -35.56, -3.81, 0),
                (13, "IO19", "bidirectional", -35.56, -7.62, 0),
                (14, "IO20", "bidirectional", -35.56, -11.43, 0),
                (15, "IO3", "bidirectional", -35.56, -15.24, 0),
                (16, "IO46", "input", -35.56, -19.05, 0),
                (17, "IO9", "bidirectional", -35.56, -22.86, 0),
                (18, "IO10", "bidirectional", -35.56, -26.67, 0),
                (19, "IO11", "bidirectional", -35.56, -30.48, 0),
                (20, "IO12", "bidirectional", -35.56, -34.29, 0),
                (21, "IO13", "bidirectional", -35.56, -38.10, 0),
                # Right pins (rot=180, connects at right)
                (40, "GND", "power_in", 35.56, 38.10, 180),
                (39, "IO1", "bidirectional", 35.56, 34.29, 180),
                (38, "IO2", "bidirectional", 35.56, 30.48, 180),
                (37, "IO43_TXD0", "bidirectional", 35.56, 26.67, 180),
                (36, "IO44_RXD0", "bidirectional", 35.56, 22.86, 180),
                (35, "IO42", "bidirectional", 35.56, 19.05, 180),
                (34, "IO41", "bidirectional", 35.56, 15.24, 180),
                (33, "IO40", "bidirectional", 35.56, 11.43, 180),
                (32, "IO39", "bidirectional", 35.56, 7.62, 180),
                (31, "IO38", "bidirectional", 35.56, 3.81, 180),
                (30, "IO37_NC", "no_connect", 35.56, 0.00, 180),
                (29, "IO36_NC", "no_connect", 35.56, -3.81, 180),
                (28, "IO35_NC", "no_connect", 35.56, -7.62, 180),
                (27, "IO0", "bidirectional", 35.56, -11.43, 180),
                (26, "IO45", "bidirectional", 35.56, -15.24, 180),
                (25, "IO48", "bidirectional", 35.56, -19.05, 180),
                (24, "IO47", "bidirectional", 35.56, -22.86, 180),
                (23, "IO21", "bidirectional", 35.56, -26.67, 180),
                (22, "IO14", "bidirectional", 35.56, -30.48, 180),
                # Bottom pad 41 (rot=90, connects at bottom)
                (41, "GND_PAD", "power_in", 0.00, -48.26, 90)
            ],
            "body": '(rectangle (start -27.94 40.64) (end 27.94 -40.64) (stroke (width 0.254) (type solid) (color 0 0 0 0)) (fill (type background)))'
        },
        "Connector:USB_C_Receptacle_USB2.0": {
            "pins": [
                # In stock KiCad 6:
                ("A1", "GND", "passive", 0.0, -22.86, 90),
                ("A12", "GND", "passive", 0.0, -22.86, 90),
                ("B1", "GND", "passive", 0.0, -22.86, 90),
                ("B12", "GND", "passive", 0.0, -22.86, 90),
                ("S1", "SHIELD", "passive", -7.62, -22.86, 90),
                ("A4", "VBUS", "passive", 15.24, 15.24, 180),
                ("A9", "VBUS", "passive", 15.24, 15.24, 180),
                ("B4", "VBUS", "passive", 15.24, 15.24, 180),
                ("B9", "VBUS", "passive", 15.24, 15.24, 180),
                ("A5", "CC1", "bidirectional", 15.24, 10.16, 180),
                ("B5", "CC2", "bidirectional", 15.24, 7.62, 180),
                ("A7", "D-", "bidirectional", 15.24, 2.54, 180),
                ("B7", "D-", "bidirectional", 15.24, 0.0, 180),
                ("A6", "D+", "bidirectional", 15.24, -2.54, 180),
                ("B6", "D+", "bidirectional", 15.24, -5.08, 180),
                ("A8", "SBU1", "bidirectional", 15.24, -12.7, 180),
                ("B8", "SBU2", "bidirectional", 15.24, -15.24, 180)
            ],
            "body": '(rectangle (start -10.16 17.78) (end 10.16 -17.78) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background)))'
        },
        "Power_Protection:USBLC6-2SC6": {
            "pins": [
                ("1", "I/O1", "passive", -10.16, -2.54, 0),
                ("6", "I/O1", "passive", -10.16, 2.54, 0),
                ("3", "I/O2", "passive", 10.16, -2.54, 180),
                ("4", "I/O2", "passive", 10.16, 2.54, 180),
                ("2", "GND", "passive", 0.0, -10.16, 90),
                ("5", "VBUS", "passive", 0.0, 10.16, 270)
            ],
            "body": '(rectangle (start -7.62 -7.62) (end 7.62 7.62) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background)))'
        },
        "Regulator_Linear:LD1117AS33TR": {
            "pins": [
                ("1", "GND", "power_in", 0.0, -7.62, 90),
                ("2", "VO", "power_out", 7.62, 0.0, 180),
                ("3", "VI", "power_in", -7.62, 0.0, 0)
            ],
            "body": '(rectangle (start -5.08 -5.08) (end 5.08 1.905) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background)))'
        },
        "Device:R": {
            "pins": [
                ("1", "~", "passive", 0.0, 3.81, 270),
                ("2", "~", "passive", 0.0, -3.81, 90)
            ],
            "body": '(rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none)))'
        },
        "Device:C": {
            "pins": [
                ("1", "~", "passive", 0.0, 3.81, 270),
                ("2", "~", "passive", 0.0, -3.81, 90)
            ],
            "body": '(polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762)) (stroke (width 0.508) (type default) (color 0 0 0 0)) (fill (type none)))\n      (polyline (pts (xy -2.032 0.762) (xy 2.032 0.762)) (stroke (width 0.508) (type default) (color 0 0 0 0)) (fill (type none)))'
        },
        "Switch:SW_Push": {
            "pins": [
                ("1", "1", "passive", -5.08, 0.0, 0),
                ("2", "2", "passive", 5.08, 0.0, 180)
            ],
            "body": '(circle (center -2.032 0) (radius 0.508) (stroke (width 0) (type default) (color 0 0 0 0)) (fill (type none)))\n      (circle (center 2.032 0) (radius 0.508) (stroke (width 0) (type default) (color 0 0 0 0)) (fill (type none)))'
        },
        "Connector:Conn_01x04_Male": {
            "pins": [
                ("1", "Pin_1", "passive", -5.08, 3.81, 0),
                ("2", "Pin_2", "passive", -5.08, 1.27, 0),
                ("3", "Pin_3", "passive", -5.08, -1.27, 0),
                ("4", "Pin_4", "passive", -5.08, -3.81, 0)
            ],
            "body": '(rectangle (start -3.81 5.08) (end 3.81 -5.08) (stroke (width 0.254) (type solid) (color 0 0 0 0)) (fill (type background)))'
        }
    }

    # Placed Component Instances (x, y) coordinates
    instances_def = [
        {"ref": "U1", "lib": "RF_Module:ESP32-S3-WROOM-1-N8R8", "val": "ESP32-S3-WROOM-1-N8R8", "fp": "RF_Module:ESP32-S3-WROOM-1", "x": 210.82, "y": 160.02},
        {"ref": "J1", "lib": "Connector:USB_C_Receptacle_USB2.0", "val": "USB_C_Receptacle_USB2.0", "fp": "", "x": 50.80, "y": 63.50},
        {"ref": "U3", "lib": "Power_Protection:USBLC6-2SC6", "val": "USBLC6-2SC6", "fp": "Package_TO_SOT_SMD:SOT-23-6", "x": 96.52, "y": 63.50},
        {"ref": "R3", "lib": "Device:R", "val": "22R", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 132.08, "y": 48.26},
        {"ref": "R4", "lib": "Device:R", "val": "22R", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 132.08, "y": 78.74},
        {"ref": "R1", "lib": "Device:R", "val": "5.1k", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 50.80, "y": 124.46},
        {"ref": "R2", "lib": "Device:R", "val": "5.1k", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 76.20, "y": 124.46},
        {"ref": "U2", "lib": "Regulator_Linear:LD1117AS33TR", "val": "LD1117AS33TR", "fp": "Package_TO_SOT_SMD:SOT-223-3_TabPin2", "x": 55.88, "y": 182.88},
        {"ref": "C2", "lib": "Device:C", "val": "10uF", "fp": "Capacitor_SMD:C_0805_2012Metric", "x": 33.02, "y": 182.88},
        {"ref": "C3", "lib": "Device:C", "val": "10uF", "fp": "Capacitor_SMD:C_0805_2012Metric", "x": 83.82, "y": 182.88},
        {"ref": "C4", "lib": "Device:C", "val": "10uF", "fp": "Capacitor_SMD:C_0805_2012Metric", "x": 129.54, "y": 137.16},
        {"ref": "C5", "lib": "Device:C", "val": "100nF", "fp": "Capacitor_SMD:C_0603_1608Metric", "x": 129.54, "y": 160.02},
        {"ref": "R5", "lib": "Device:R", "val": "10k", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 129.54, "y": 203.20},
        {"ref": "C1", "lib": "Device:C", "val": "1uF", "fp": "Capacitor_SMD:C_0603_1608Metric", "x": 129.54, "y": 226.06},
        {"ref": "SW1", "lib": "Switch:SW_Push", "val": "RESET", "fp": "", "x": 152.40, "y": 213.36},
        {"ref": "R6", "lib": "Device:R", "val": "10k", "fp": "Resistor_SMD:R_0603_1608Metric", "x": 287.02, "y": 203.20},
        {"ref": "SW2", "lib": "Switch:SW_Push", "val": "BOOT", "fp": "", "x": 309.88, "y": 203.20},
        {"ref": "J2", "lib": "Connector:Conn_01x04_Male", "val": "DEBUG_UART0", "fp": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical", "x": 314.96, "y": 142.24}
    ]

    # Invert manifest nets: map (ref, pin_num_str) -> net_name
    pin_to_net = {}
    for net, pin_list in manifest["nets"].items():
        for item in pin_list:
            ref, num = item.split(":")
            pin_to_net[(ref, num)] = net

    no_connect_pins = set(manifest["no_connect_pins"].keys())

    # Generate schematic text
    lines = []
    lines.append('(kicad_sch (version 20211123) (generator "eeschema")')
    lines.append(f'  (uuid {gen_uuid("sheet:bridge-one-core")})')
    lines.append('  (paper "A3")')
    lines.append('  (title_block')
    lines.append('    (title "VDS4E Bridge One — Core MCU & Host Interface (Draft)")')
    lines.append('    (date "2026-10-14")')
    lines.append('    (rev "0.1-core")')
    lines.append('    (company "VDS4E Project")')
    lines.append('    (comment 1 "Core Subsystem: MCU, Native USB, 3.3V Power, Decoupling, Reset/Boot, Debug Header")')
    lines.append('    (comment 2 "Target-facing bus level translators NOT on this sheet (isolated CAD scope)")')
    lines.append('    (comment 3 "Firmware SPI same-CS decoding gated; Bench qualification required")')
    lines.append('    (comment 4 "Status: Engineering Draft — No PCB fabrication release implied")')
    lines.append('  )')
    lines.append('')

    # --- Embedded lib_symbols ---
    lines.append('  (lib_symbols')
    for lib_id, sym in lib_symbols_dict.items():
        lines.append(f'    (symbol "{lib_id}" (in_bom yes) (on_board yes)')
        sym_name = lib_id.split(":")[1]
        prefix = "U" if "ESP32" in lib_id or "LD1117" in lib_id or "USBLC" in lib_id else "J" if "Conn" in lib_id or "USB_C" in lib_id else "R" if ":R" in lib_id else "C" if ":C" in lib_id else "SW"
        lines.append(f'      (property "Reference" "{prefix}" (id 0) (at 0 2.54 0) (effects (font (size 1.27 1.27))))')
        lines.append(f'      (property "Value" "{sym_name}" (id 1) (at 0 -2.54 0) (effects (font (size 1.27 1.27))))')
        lines.append('      (property "Footprint" "" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))')
        lines.append(f'      (symbol "{sym_name}_0_1"')
        lines.append(f'        {sym["body"]}')
        lines.append('      )')
        lines.append(f'      (symbol "{sym_name}_1_1"')
        for pin in sym["pins"]:
            num, name, ptype, px, py, rot = pin
            lines.append(f'        (pin {ptype} line (at {px:.2f} {py:.2f} {rot}) (length 2.54)')
            lines.append(f'          (name "{name}" (effects (font (size 1.016 1.016))))')
            lines.append(f'          (number "{num}" (effects (font (size 1.016 1.016))))')
            lines.append('        )')
        lines.append('      )')
        lines.append('    )')
    lines.append('  )')
    lines.append('')

    # Place Instances
    for inst in instances_def:
        ref = inst["ref"]
        lib = inst["lib"]
        val = inst["val"]
        fp = inst["fp"]
        ox = inst["x"]
        oy = inst["y"]
        lines.append(f'  (symbol (lib_id "{lib}") (at {ox:.2f} {oy:.2f} 0) (unit 1)')
        lines.append('    (in_bom yes) (on_board yes)')
        lines.append(f'    (uuid {gen_uuid(f"inst:{ref}")})')
        lines.append(f'    (property "Reference" "{ref}" (id 0) (at {ox:.2f} {oy - 5.08:.2f} 0) (effects (font (size 1.27 1.27))))')
        lines.append(f'    (property "Value" "{val}" (id 1) (at {ox:.2f} {oy + 5.08:.2f} 0) (effects (font (size 1.27 1.27))))')
        lines.append(f'    (property "Footprint" "{fp}" (id 2) (at {ox:.2f} {oy:.2f} 0) (effects (font (size 1.27 1.27)) hide))')
        for pin in lib_symbols_dict[lib]["pins"]:
            pnum = str(pin[0])
            lines.append(f'    (pin "{pnum}" (uuid {gen_uuid(f"{ref}:pin:{pnum}")}))')
        lines.append('  )')
    lines.append('')

    # Connect Every Pin: Short stub + Global Label OR No_Connect directly at pin
    # Keep track of generated stubs to avoid duplicate stubs at identical coordinates (e.g. stacked USB pins)
    generated_nodes = set()
    stub_length = 5.08

    for inst in instances_def:
        ref = inst["ref"]
        lib = inst["lib"]
        ox = inst["x"]
        oy = inst["y"]

        for pin in lib_symbols_dict[lib]["pins"]:
            pnum, pname, ptype, px, py, rot = pin
            pnum_str = str(pnum)
            pin_key = f"{ref}:{pnum_str}"

            # Calculate exact world coordinates according to review_connectivity.py math
            # at angle=0: world_x = ox + px, world_y = oy - py
            wx = round(ox + px, 3)
            wy = round(oy - py, 3)

            if pin_key in no_connect_pins:
                # Place no_connect directly at the pin! NO stub!
                lines.append(f'  (no_connect (at {wx:.2f} {wy:.2f}))')
                continue

            net_name = pin_to_net.get((ref, pnum_str))
            if not net_name:
                continue

            node_key = (wx, wy)
            if node_key in generated_nodes:
                # Already wired by another stacked pin at this exact position (e.g. A1/A12/B1/B12 on J1)
                continue
            generated_nodes.add(node_key)

            # Determine stub vector away from symbol body
            if rot == 0:
                # Pin points right in lib, connects at left -> stub points left
                sx = round(wx - stub_length, 3)
                sy = wy
                lbl_rot = 180
            elif rot == 180:
                # Pin points left in lib, connects at right -> stub points right
                sx = round(wx + stub_length, 3)
                sy = wy
                lbl_rot = 0
            elif rot == 90:
                # Pin points up in lib, connects at bottom -> stub points down (wy increases)
                sx = wx
                sy = round(wy + stub_length, 3)
                lbl_rot = 270
            elif rot == 270:
                # Pin points down in lib, connects at top -> stub points up (wy decreases)
                sx = wx
                sy = round(wy - stub_length, 3)
                lbl_rot = 90
            else:
                sx = round(wx + stub_length, 3)
                sy = wy
                lbl_rot = 0

            # Wire stub
            wire_uuid = gen_uuid(f"stub:{ref}:{pnum_str}")
            lines.append(f'  (wire (pts (xy {wx:.2f} {wy:.2f}) (xy {sx:.2f} {sy:.2f}))')
            lines.append('    (stroke (width 0) (type solid) (color 0 0 0 0))')
            lines.append(f'    (uuid {wire_uuid})')
            lines.append('  )')

            # Global label at stub endpoint
            lbl_shape = "passive" if net_name in ("GND", "+3V3", "VBUS") else "bidirectional"
            lbl_uuid = gen_uuid(f"lbl:{ref}:{pnum_str}:{net_name}")
            lines.append(f'  (global_label "{net_name}" (shape {lbl_shape}) (at {sx:.2f} {sy:.2f} {lbl_rot})')
            lines.append('    (effects (font (size 1.27 1.27)) (justify left bottom))')
            lines.append(f'    (uuid {lbl_uuid})')
            lines.append('  )')

    lines.append(')')
    lines.append('')

    with open(SCHEMATIC_PATH, "w") as f:
        f.write("\n".join(lines))
    print(f"Generated schematic file: {SCHEMATIC_PATH}")


if __name__ == "__main__":
    generate_project_json()
    manifest = generate_manifest()
    generate_schematic(manifest)
    print("Core CAD artifacts generated successfully.")
