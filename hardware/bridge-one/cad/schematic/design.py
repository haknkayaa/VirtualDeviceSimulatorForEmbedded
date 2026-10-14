"""Bridge One schematic source of truth: groups, parts and pin-to-net maps.

render.py turns this into a grouped KiCad schematic. Net names follow
docs/pin-allocation.md. Part choices cite the research note that selected them.
"""

from dataclasses import dataclass, field

TITLE = {
    "title": "VDS4E Bridge One",
    "date": "2026-10-14",
    "rev": "F-sch0.1",
    "company": "VDS4E",
    "comment": "Generated from cad/schematic/design.py - do not edit the .kicad_sch by hand",
}
COLUMN_WIDTH = 270.0
OVERVIEW = [
    "USB-C (any source, 5-24 V tolerated) -> PTC + TVS -> AP63203 buck -> +3V3 for the whole board.",
    "ESP32-S3: USB to the PC, I2C0/I2C1 + UART target ports, OLED, FPGA configuration and control.",
    "iCE40UP5K: target SPI engine (same-CS decode) + 8-channel GPIO bank + QSPI PSRAM flash image.",
    "All target signals pass level translators (A = +3V3, B = VTREF) and ESD; isolated by default.",
    "TARGET I/O: Raspberry Pi 40-pin header + labelled direct header with 5V_OUT/3V3_OUT accessories.",
    "Generated from cad/schematic/design.py; verify with tools/verify_netlist.py after every change.",
]

# Nets intentionally connected to a single pin (test points, header-only signals
# whose other end lives in a group that is not drawn yet are NOT listed here).
SINGLE_PIN_OK = set()

R0402 = "Resistor_SMD:R_0402_1005Metric"
R0603 = "Resistor_SMD:R_0603_1608Metric"
C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0603 = "Capacitor_SMD:C_0603_1608Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
C1206 = "Capacitor_SMD:C_1206_3216Metric"

GND, V3 = "GND", "+3V3"


@dataclass
class Part:
    ref: str
    lib_id: str
    value: str
    footprint: str
    nets: dict
    nc: tuple = ()
    mpn: str = ""
    datasheet: str = ""
    dnp: bool = False
    fields: dict = field(default_factory=dict)

    def __post_init__(self):
        if "(candidate)" in self.mpn:
            # Keep the MPN field machine-readable; record the selection status separately.
            self.mpn = self.mpn.replace("(candidate)", "").strip()
            self.fields = {"Status": "candidate - verify before release", **self.fields}
        if self.mpn:
            self.fields = {"MPN": self.mpn, **self.fields}


@dataclass
class Group:
    key: str
    title: str
    notes: list
    parts: list


def R(ref, value, a, b, fp=R0402, mpn="", dnp=False):
    return Part(ref, "Device:R", value, fp, {"1": a, "2": b}, mpn=mpn, dnp=dnp)


def C(ref, value, a, b=GND, fp=C0402, mpn="", dnp=False):
    return Part(ref, "Device:C", value, fp, {"1": a, "2": b}, mpn=mpn, dnp=dnp)


def TP(ref, net):
    return Part(ref, "Connector:TestPoint", net, "TestPoint:TestPoint_Pad_D1.0mm", {"1": net})


def FLAG(ref, net):
    return Part(ref, "power:PWR_FLAG", "PWR_FLAG", "", {"1": net})


# --- 1. USB-C universal power input ---------------------------------------
power_in = Group("power_in", "USB-C universal power input", [
    "Non-PD sink: 5.1k Rd on CC1/CC2 -> compliant sources give 5 V only.",
    "Survives non-compliant 9-24 V on VBUS: 30 V PTC + SMAJ24A clamp, buck rated 32 V.",
    "USB D+/D- ESD has no VBUS reference pin (TPD2E2U06), so VBUS faults cannot reach it.",
    "Ref: research/power-input-universal.md",
], [
    Part("J1", "Connector:USB_C_Receptacle_USB2.0_16P", "USB-C 16P",
         "Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal",
         {"A1": GND, "A12": GND, "B1": GND, "B12": GND, "SH": GND,
          "A4": "VBUS_RAW", "A9": "VBUS_RAW", "B4": "VBUS_RAW", "B9": "VBUS_RAW",
          "A5": "USB_CC1", "B5": "USB_CC2",
          "A6": "USB_DP", "B6": "USB_DP", "A7": "USB_DN", "B7": "USB_DN"},
         nc=("A8", "B8"), mpn="USB4105-GF-A-120 (candidate)"),
    R("R1", "5k1", "USB_CC1", GND),
    R("R2", "5k1", "USB_CC2", GND),
    Part("F1", "Device:Polyfuse", "0.5A/30V", "Fuse:Fuse_1812_4532Metric",
         {"1": "VBUS_RAW", "2": "VBUS"}, mpn="BSMD1812-050-30V"),
    Part("D11", "Device:D_Zener", "SMAJ24A", "Diode_SMD:D_SMA",
         {"1": "VBUS", "2": GND}, mpn="SMAJ24A"),
    Part("D1", "Power_Protection:TPD2E2U06DRL", "TPD2E2U06", "Package_TO_SOT_SMD:SOT-553",
         {"3": "USB_DP", "5": "USB_DN", "4": GND}, nc=("1", "2"), mpn="TPD2E2U06DRLR"),
    FLAG("#FLG1", "VBUS"),
    FLAG("#FLG2", GND),
])

# --- 2. 3V3 buck -----------------------------------------------------------
buck = Group("buck", "3V3 buck (3.8-32 V in)", [
    "AP63203: fixed 3.3 V, 2 A, 1.1 MHz, PFM at light load.",
    "EN from 100k/47k divider: EN <= 12.4 V at the 38.9 V TVS clamp (EN abs max 35 V); starts at ~3.7 V VIN.",
    "Board load ~100 mA typ, ~225 mA worst with FPGA; 3V3_OUT adds up to 300 mA.",
    "Cin rated 50 V (VBUS may sit at 24 V below the SMAJ24A clamp); C1/C5 at IN-GND, L1/Cout close to SW.",
], [
    Part("U14", "Regulator_Switching:AP63203WU", "AP63203WU-7", "Package_TO_SOT_SMD:TSOT-23-6",
         {"1": V3, "2": "BUCK_EN", "3": "VBUS", "4": GND, "5": "BUCK_SW", "6": "BUCK_BST"},
         mpn="AP63203WU-7"),
    R("R93", "100k 1%", "VBUS", "BUCK_EN"),
    R("R94", "47k 1%", "BUCK_EN", GND),
    C("C1", "10u 50V", "VBUS", fp=C1206),
    C("C5", "100n 50V", "VBUS", fp=C0603),
    C("C4", "100n", "BUCK_BST", "BUCK_SW", fp=C0603),
    Part("L1", "Device:L", "4.7uH Isat>=1A", "Inductor_SMD:L_Taiyo-Yuden_NR-30xx",
         {"1": "BUCK_SW", "2": V3}, mpn="NR3015N4R7A (candidate)"),
    C("C2", "22u", V3, fp=C0805),
    C("C3", "22u", V3, fp=C0805),
    FLAG("#FLG3", V3),
])

# --- 3. ESP32-S3 -----------------------------------------------------------
mcu = Group("mcu", "ESP32-S3 control plane", [
    "Native USB (GPIO19/20) = programming, serial/JTAG and PC link; no USB-UART chip.",
    "Both hardware I2C controllers serve the target as slaves; OLED uses software I2C.",
    "Reset defaults: target ports isolated, FPGA held in reset, aux outputs off.",
    "Straps GPIO3/45/46 unconnected; GPIO35-37 belong to the octal PSRAM.",
    "Ref: docs/pin-allocation.md",
], [
    Part("U1", "RF_Module:ESP32-S3-WROOM-1", "ESP32-S3-WROOM-1-N8R8", "RF_Module:ESP32-S3-WROOM-1",
         {"1": GND, "40": GND, "41": GND, "2": V3, "3": "CHIP_EN",
          "27": "BOOT_N", "39": "VTREF_ADC", "38": "OLED_RES_N",
          "4": "I2C0_SDA_MCU", "5": "I2C0_SCL_MCU", "6": "I2C1_SDA_MCU", "7": "I2C1_SCL_MCU",
          "12": "OLED_SDA", "17": "OLED_SCL",
          "18": "FPGA_SS_N", "19": "FPGA_MOSI", "20": "FPGA_SCK", "21": "FPGA_MISO",
          "22": "FPGA_CRESET_N", "8": "FPGA_CDONE", "9": "FPGA_IRQ",
          "10": "UART_TX_MCU", "11": "UART_RX_MCU", "13": "USB_DN", "14": "USB_DP",
          "23": "PORT_OE_N", "31": "UART_OE_N", "32": "I2C0_OFF", "33": "I2C1_OFF",
          "34": "AUX5V_EN", "35": "AUX3V3_EN", "37": "DEBUG_TX", "36": "DEBUG_RX",
          "24": "SPARE0", "25": "SPARE1"},
         nc=("15", "16", "26", "28", "29", "30"), mpn="ESP32-S3-WROOM-1-N8R8"),
    C("C6", "10u", V3, fp=C0805),
    C("C7", "100n", V3),
    R("R3", "10k", V3, "CHIP_EN"),
    C("C8", "1u", "CHIP_EN"),
    Part("SW1", "Switch:SW_Push", "RESET", "Button_Switch_SMD:SW_SPST_EVQP7A",
         {"1": "CHIP_EN", "2": GND}, mpn="EVQ-P7A01P"),
    R("R4", "10k", V3, "BOOT_N"),
    Part("SW2", "Switch:SW_Push", "BOOT", "Button_Switch_SMD:SW_SPST_EVQP7A",
         {"1": "BOOT_N", "2": GND}, mpn="EVQ-P7A01P"),
    R("R5", "10k", "FPGA_CRESET_N", GND),
    R("R6", "10k", "OLED_RES_N", GND),
    R("R7", "10k", V3, "PORT_OE_N"),
    R("R8", "10k", V3, "UART_OE_N"),
    R("R9", "10k", V3, "I2C0_OFF"),
    R("R10", "10k", V3, "I2C1_OFF"),
    TP("TP1", "DEBUG_TX"),
    TP("TP2", "DEBUG_RX"),
    TP("TP3", "SPARE0"),
    TP("TP4", "SPARE1"),
    TP("TP5", GND),
    TP("TP6", "VBUS"),
    TP("TP7", V3),
    TP("TP8", "FPGA_1V2"),
    TP("TP9", "FPGA_VCCPLL"),
    TP("TP10", "FPGA_3V3"),
    TP("TP11", "VTREF_IO"),
])

# --- 4. Auxiliary outputs on J10 --------------------------------------------
aux_out = Group("aux_out", "Aux power outputs (J10 5V_OUT / 3V3_OUT)", [
    "Off at reset (pull-downs on SHDN/EN); firmware enables per user request.",
    "5V_OUT: TPS26600 opens above ~6.0 V VBUS (OVP 100k/24.9k), UVLO ~4.4 V, ILIM 0.3 A (39k).",
    "D12/D13 3.6 V zeners keep OVP/UVLO pins below their 5 V abs max at 24 V and during TVS clamping.",
    "3V3_OUT: TPS2553 limited to ~300 mA (88.7k), blocks reverse current from the user device.",
    "Never tied to VREF or the Raspberry Pi 5 V / 3.3 V pins (no back-powering).",
    "Ref: research/aux-power-outputs.md",
], [
    Part("U15", "Power_Management:TPS26600PWP", "TPS26600PWPR",
         "Package_SO:HTSSOP-16-1EP_4.4x5mm_P0.65mm_EP3.4x5mm",
         {"1": "VBUS", "2": "VBUS", "3": "AUX5_UVLO", "5": "AUX5_OVP", "6": "AUX5_MODE",
          "7": "AUX5V_EN", "8": GND, "17": GND, "9": GND, "10": "AUX5_IMON", "11": "AUX5_ILIM",
          "12": "AUX5_DVDT", "14": "AUX5_FLT_N", "15": "5V_OUT", "16": "5V_OUT"},
         nc=("4", "13"), mpn="TPS26600PWPR"),
    R("R16", "100k 1%", "VBUS", "AUX5_UVLO"),
    R("R17", "37.4k 1%", "AUX5_UVLO", GND),
    R("R18", "100k 1%", "VBUS", "AUX5_OVP"),
    R("R19", "24.9k 1%", "AUX5_OVP", GND),
    Part("D12", "Device:D_Zener", "BZT52C3V6", "Diode_SMD:D_SOD-123", {"1": "AUX5_OVP", "2": GND}, mpn="BZT52C3V6"),
    Part("D13", "Device:D_Zener", "BZT52C3V6", "Diode_SMD:D_SOD-123", {"1": "AUX5_UVLO", "2": GND}, mpn="BZT52C3V6"),
    R("R21", "39k 1%", "AUX5_ILIM", GND),
    R("R22", "10k", "AUX5V_EN", GND),
    R("R23", "10k", "AUX5_IMON", GND),
    R("R24", "100k", V3, "AUX5_FLT_N"),
    C("C23", "10n", "AUX5_DVDT"),
    R("R25", "0R", "AUX5_MODE", GND, dnp=True),
    C("C24", "1u 50V", "VBUS", fp=C0603),
    C("C25", "10u 16V", "5V_OUT", fp=C0805),
    Part("U16", "bridge_one:TPS2553DBV", "TPS2553DBVR", "Package_TO_SOT_SMD:SOT-23-6",
         {"1": V3, "2": GND, "3": "AUX3V3_EN", "4": "AUX3_FAULT_N", "5": "AUX3_ILIM", "6": "3V3_OUT"},
         mpn="TPS2553DBVR"),
    R("R26", "88.7k 1%", "AUX3_ILIM", GND),
    R("R27", "100k", "AUX3V3_EN", GND),
    R("R28", "100k", V3, "AUX3_FAULT_N"),
    C("C26", "1u", V3, fp=C0402),
    C("C27", "10u", "3V3_OUT", fp=C0805),
])

# --- 5. Status ---------------------------------------------------------------
status = Group("status", "Status LEDs", [
    "PWR is hard-wired to +3V3. LINK / VTREF / FPGA LEDs sink into iCE40 RGB0-2 (FPGA group).",
], [
    R("R29", "1k", V3, "LED_PWR_A"),
    Part("D2", "Device:LED", "PWR green", "LED_SMD:LED_0603_1608Metric",
         {"2": "LED_PWR_A", "1": GND}),
])

# --- 6. FPGA bus engine ------------------------------------------------------
F3, F12 = "FPGA_3V3", "FPGA_1V2"
fpga = Group("fpga", "iCE40UP5K SPI/GPIO bus engine", [
    "Configured by the S3 over SPI (slave mode, no config flash); same 4 wires become the data link.",
    "Sequence: TPS22917 ON senses FPGA_VCCPLL (lags the core); CT 1 nF -> ~1.8 V/ms ramp. OPEN: supervisor for a hard threshold.",
    "Pins per research/ice40-pin-plan.md: CLK on G0/PLL pin 35, target SCK on G1 pin 37.",
    "RGB0-2 current sinks drive the FPGA / LINK / VTREF LEDs (anodes on +3V3, no series R).",
    "PSRAM: 8 MB fitted, second 8 MB footprint DNP (pin 20). 32 MB needs 2 more CS pins (open).",
    "READ 0x03 arbitrary address ~1 MHz; FAST_READ 0x0B ~20 MHz (calculated, research/spi-backing-memory.md).",
], [
    Part("U3", "FPGA_Lattice:ICE40UP5K-SG48ITR", "iCE40UP5K-SG48I",
         "Package_DFN_QFN:QFN-48-1EP_7x7mm_P0.5mm_EP5.6x5.6mm",
         {"1": F3, "22": F3, "33": F3, "24": F3, "5": F12, "30": F12, "29": "FPGA_VCCPLL", "49": GND,
          "7": "FPGA_CDONE", "8": "FPGA_CRESET_N",
          "14": "FPGA_MISO", "15": "FPGA_SCK", "16": "FPGA_SS_N", "17": "FPGA_MOSI", "13": "FPGA_IRQ",
          "37": "T_SCK", "6": "T_MOSI", "9": "T_CS0", "10": "T_CS1", "11": "T_MISO", "12": "T_MISO_OE_N",
          "23": "GPIO_DATA0", "25": "GPIO_DATA1", "26": "GPIO_DATA2", "27": "GPIO_DATA3",
          "28": "GPIO_DATA4", "31": "GPIO_DATA5", "32": "GPIO_DATA6", "34": "GPIO_DATA7",
          "36": "GPIO_DIR0", "38": "GPIO_DIR1", "42": "GPIO_DIR2", "43": "GPIO_DIR3",
          "2": "GPIO_DIR4", "3": "GPIO_DIR5", "4": "GPIO_DIR6", "45": "GPIO_DIR7", "46": "GPIO_OE_N",
          "18": "PSRAM_CS_N", "44": "PSRAM_SCK", "19": "PSRAM_IO0", "21": "PSRAM_IO1",
          "47": "PSRAM_IO2", "48": "PSRAM_IO3", "35": "CLK_12M",
          "39": "LED_FPGA_K", "40": "LED_LINK_K", "41": "LED_VTREF_K", "20": "PSRAM_CS1_N"},
         mpn="ICE40UP5K-SG48I"),
    Part("U5", "Regulator_Linear:TLV75712PDBV", "TLV75712P", "Package_TO_SOT_SMD:SOT-23-5",
         {"1": V3, "2": GND, "3": V3, "5": F12}, nc=("4",), mpn="TLV75712PDBVR"),
    C("C30", "1u", V3),
    C("C31", "4u7", F12, fp=C0603),
    C("C32", "100n", F12),
    C("C33", "100n", F12),
    R("R30", "100R", F12, "FPGA_VCCPLL"),
    C("C34", "4u7", "FPGA_VCCPLL", fp=C0603),
    C("C35", "100n", "FPGA_VCCPLL"),
    Part("U17", "Power_Management:TPS22917DBV", "TPS22917DBV", "Package_TO_SOT_SMD:SOT-23-6",
         {"1": V3, "2": GND, "3": "FPGA_VCCPLL", "4": "FPGA_3V3_CT", "5": F3, "6": F3}, mpn="TPS22917DBVR"),
    C("C70", "1u", V3),
    C("C64", "1n 25V C0G", "FPGA_3V3_CT", V3),
    C("C36", "4u7", F3, fp=C0603),
    C("C71", "4u7", F3, fp=C0603),
    C("C72", "4u7", F3, fp=C0603),
    C("C73", "4u7", F12, fp=C0603),
    C("C37", "100n", F3),
    C("C38", "100n", F3),
    C("C39", "100n", F3),
    C("C40", "100n", F3),
    R("R13", "2k2", F3, "FPGA_CDONE"),
    R("R32", "10k", "FPGA_SS_N", GND),
    R("R33", "10k", F3, "FPGA_SCK"),
    Part("Y1", "Oscillator:ASE-xxxMHz", "12MHz 3V3", "BridgeOne:Oscillator_SMD_YXC_2016-4Pin_2.0x1.6mm",
         {"1": F3, "2": GND, "3": "CLK_12M", "4": F3}, mpn="OT201612MJBA4SL (candidate)"),
    C("C41", "100n", F3),
    Part("U4", "Memory_RAM:APS6404L-3SQRx-SN", "APS6404L 8MB", "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
         {"1": "PSRAM_CS_N", "2": "PSRAM_IO1", "3": "PSRAM_IO2", "4": GND, "5": "PSRAM_IO0",
          "6": "PSRAM_SCK", "7": "PSRAM_IO3", "8": F3}, mpn="APS6404L-3SQR-SN (candidate)"),
    R("R34", "10k", F3, "PSRAM_CS_N"),
    C("C68", "1u", F3),
    C("C42", "100n", F3),
    Part("D4", "Device:LED", "FPGA", "LED_SMD:LED_0603_1608Metric", {"2": V3, "1": "LED_FPGA_K"}),
    Part("D3", "Device:LED", "LINK", "LED_SMD:LED_0603_1608Metric", {"2": V3, "1": "LED_LINK_K"}),
    Part("D5", "Device:LED", "VTREF", "LED_SMD:LED_0603_1608Metric", {"2": V3, "1": "LED_VTREF_K"}),
    Part("U22", "Memory_RAM:APS6404L-3SQRx-SN", "APS6404L 8MB (DNP, 16MB option)",
         "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
         {"1": "PSRAM_CS1_N", "2": "PSRAM_IO1", "3": "PSRAM_IO2", "4": GND, "5": "PSRAM_IO0",
          "6": "PSRAM_SCK", "7": "PSRAM_IO3", "8": F3}, mpn="APS6404L-3SQR-SN", dnp=True),
    R("R86", "10k", F3, "PSRAM_CS1_N"),
    C("C63", "100n", F3, dnp=True),
    C("C69", "1u", F3, dnp=True),
])

# --- 7. Isolation logic and VTREF sense ---------------------------------------
gating = Group("gating", "Target isolation logic + VTREF sense", [
    "Global wins: PORT_GATE_N = PORT_OE_N OR VTREF_BAD; every port enable is gated by it in hardware.",
    "Reset default = isolated (pull-ups on *_OE_N / *_OFF, FPGA outputs Hi-Z until configured).",
    "VTREF_BAD when VTREF < ~1.5 V (TLV7011 vs 0.76 V ref, own unfiltered 47k/47k divider: fast); runs from +3V3.",
    "VTREF is an input reference only: 470k/470k divider keeps backfeed ~3 uA.",
    "Ref: research/target-interface-spec.md, research/pinouts-and-gates.md",
], [
    Part("U18", "74xGxx:74LVC2G32", "SN74LVC2G32DCU", "Package_SO:VSSOP-8_2.3x2mm_P0.5mm",
         {"1": "PORT_OE_N", "2": "VTREF_BAD", "7": "PORT_GATE_N",
          "5": "UART_OE_N", "6": "PORT_GATE_N", "3": "UART_OE_HW_N", "8": V3, "4": GND},
         mpn="SN74LVC2G32DCUR"),
    Part("U19", "74xGxx:74LVC2G32", "SN74LVC2G32DCU", "Package_SO:VSSOP-8_2.3x2mm_P0.5mm",
         {"1": "GPIO_OE_N", "2": "PORT_GATE_N", "7": "GPIO_OE_HW_N",
          "5": "T_MISO_OE_N", "6": "PORT_GATE_N", "3": "MISO_OE_HW_N", "8": V3, "4": GND},
         mpn="SN74LVC2G32DCUR"),
    Part("U20", "74xGxx:74LVC2G02", "SN74LVC2G02DCU", "Package_SO:VSSOP-8_2.3x2mm_P0.5mm",
         {"1": "I2C0_OFF", "2": "PORT_GATE_N", "7": "I2C0_EN_DRV",
          "5": "I2C1_OFF", "6": "PORT_GATE_N", "3": "I2C1_EN_DRV", "8": V3, "4": GND},
         mpn="SN74LVC2G02DCUR"),
    C("C43", "100n", V3), C("C44", "100n", V3), C("C45", "100n", V3),
    R("R35", "100k", V3, "UART_OE_HW_N"),
    R("R36", "100k", V3, "GPIO_OE_HW_N"),
    R("R37", "100k", V3, "MISO_OE_HW_N"),
    R("R38", "100k", V3, "PORT_GATE_N"),
    R("R39", "10k", "FPGA_3V3", "GPIO_OE_N"),
    R("R40", "10k", "FPGA_3V3", "T_MISO_OE_N"),
    R("R41", "10R", "VTREF", "VTREF_IO"),
    C("C46", "1u", "VTREF_IO"),
    R("R42", "470k 1%", "VTREF", "VTREF_DIV"),
    R("R43", "470k 1%", "VTREF_DIV", GND),
    R("R44", "1k", "VTREF_DIV", "VTREF_ADC"),
    C("C47", "100n", "VTREF_ADC"),
    R("R45", "100k 1%", V3, "VREF_LOW"),
    R("R46", "30k 1%", "VREF_LOW", GND),
    Part("U21", "Comparator:TLV7031DBV", "TLV7011DBV", "Package_TO_SOT_SMD:SOT-23-5",
         {"1": "VTREF_BAD", "2": GND, "3": "VREF_LOW", "4": "VTREF_CMP", "5": V3}, mpn="TLV7011DBVR"),
    R("R91", "47k 1%", "VTREF", "VTREF_CMP"),
    R("R92", "47k 1%", "VTREF_CMP", GND),
    C("C48", "100n", V3),
    FLAG("#FLG6", "VTREF"),
    FLAG("#FLG7", "VTREF_IO"),
    FLAG("#FLG8", "I2C0_EN_NODE"),
    FLAG("#FLG9", "I2C1_EN_NODE"),
])

# --- 8. Translators -----------------------------------------------------------
def i2c_port(n, u, r_en, r_pd, c_en, c_v, r_tgt):
    return [
        R(r_tgt[0], "4k7 DNP", "VTREF_IO", f"I2C{n}_SDA_TGT", dnp=True),
        R(r_tgt[1], "4k7 DNP", "VTREF_IO", f"I2C{n}_SCL_TGT", dnp=True),
        Part(u, "Interface:PCA9306DC", "PCA9306DCU", "Package_SO:VSSOP-8_2.3x2mm_P0.5mm",
             {"1": GND, "2": "VTREF_IO", "3": f"I2C{n}_SCL_TGT", "4": f"I2C{n}_SDA_TGT",
              "5": f"I2C{n}_SDA_MCU", "6": f"I2C{n}_SCL_MCU", "7": f"I2C{n}_EN_NODE", "8": f"I2C{n}_EN_NODE"},
             mpn="PCA9306DCUR"),
        R(r_en, "200k", f"I2C{n}_EN_DRV", f"I2C{n}_EN_NODE"),
        R(r_pd, "2.2M", f"I2C{n}_EN_NODE", GND),
        C(c_en, "10n", f"I2C{n}_EN_NODE"),
        C(c_v, "100n", "VTREF_IO"),
    ]


AVC = "bridge_one:SN74AVC4T245RSV"
AXC = "bridge_one:SN74AXC4T774RSV"
QFN = "Package_DFN_QFN:UQFN-16_1.8x2.6mm_P0.4mm"

translators = Group("translators", "Target level translators (A = +3V3 side, B = VTREF side)", [
    "VCCA = +3V3, VCCB = VTREF_IO (1.65-3.6 V); DIR/OE referenced to VCCA; Ioff isolates when unpowered.",
    "PCA9306 EN/VREF2 driven from gated I2Cn_EN_DRV via 200k (no backfeed into an unpowered target).",
    "UART: bank 1 bridge->target, bank 2 target->bridge, fixed. SPI: U6 target->FPGA, U7 MISO only.",
    "GPIO: per-bit DIR from FPGA (10k pull-down = B->A input default), common OE gated.",
    "MCU-side I2C pull-ups 4k7 fitted; target-side 4k7 to VTREF_IO DNP (R87-R90): targets usually have their own.",
], i2c_port(0, "U8", "R47", "R48", "C49", "C50", ("R87", "R88")) + i2c_port(1, "U9", "R49", "R50", "C51", "C52", ("R89", "R90")) + [
    R("R51", "4k7", V3, "I2C0_SDA_MCU"), R("R52", "4k7", V3, "I2C0_SCL_MCU"),
    R("R53", "4k7", V3, "I2C1_SDA_MCU"), R("R54", "4k7", V3, "I2C1_SCL_MCU"),
    Part("U10", AVC, "SN74AVC4T245RSV", QFN,
         {"3": V3, "2": "VTREF_IO", "4": V3, "5": GND, "6": "UART_TX_MCU", "7": GND,
          "8": "UART_RX_MCU", "10": GND, "11": GND, "12": GND, "13": "UART_RXD_RAW",
          "15": "UART_TXD_RAW", "1": "UART_OE_HW_N", "16": "UART_OE_HW_N"},
         nc=("9", "14"), mpn="SN74AVC4T245RSVR"),
    R("R55", "33R", "UART_TXD_RAW", "UART_TXD_TGT"),
    R("R56", "33R", "UART_RXD_TGT", "UART_RXD_RAW"),
    R("R57", "100k", "VTREF_IO", "UART_RXD_RAW"),
    C("C53", "100n", V3), C("C54", "100n", "VTREF_IO"),
    Part("U6", AVC, "SN74AVC4T245RSV", QFN,
         {"3": V3, "2": "VTREF_IO", "4": GND, "5": GND, "6": "T_SCK", "7": "T_MOSI",
          "8": "T_CS0", "9": "T_CS1", "10": GND, "11": GND, "15": "SPI_SCK_TGT", "14": "SPI_MOSI_TGT",
          "13": "SPI_CS0_TGT", "12": "SPI_CS1_TGT", "1": "PORT_GATE_N", "16": "PORT_GATE_N"},
         mpn="SN74AVC4T245RSVR"),
    R("R58", "100k", V3, "T_CS0"), R("R59", "100k", V3, "T_CS1"),
    R("R60", "100k", "VTREF_IO", "SPI_CS0_TGT"), R("R61", "100k", "VTREF_IO", "SPI_CS1_TGT"),
    R("R62", "100k", "SPI_SCK_TGT", GND), R("R63", "100k", "SPI_MOSI_TGT", GND),
    C("C55", "100n", V3), C("C56", "100n", "VTREF_IO"),
    Part("U7", AVC, "SN74AVC4T245RSV", QFN,
         {"3": V3, "2": "VTREF_IO", "4": V3, "5": GND, "6": "T_MISO", "7": GND,
          "10": GND, "11": GND, "13": GND, "12": GND, "15": "SPI_MISO_RAW",
          "1": "MISO_OE_HW_N", "16": V3},
         nc=("8", "9", "14"), mpn="SN74AVC4T245RSVR"),
    R("R64", "33R", "SPI_MISO_RAW", "SPI_MISO_TGT"),
    C("C57", "100n", V3), C("C58", "100n", "VTREF_IO"),
] + [part for bank, u, ca, cb in ((0, "U11", "C59", "C60"), (1, "U13", "C61", "C62")) for part in [
    Part(u, AXC, "SN74AXC4T774RSV", QFN,
         {"14": V3, "13": "VTREF_IO", "8": GND, "7": "GPIO_OE_HW_N",
          **{str(a): f"GPIO_DATA{bank * 4 + i}" for i, a in enumerate((1, 2, 3, 4))},
          **{str(d): f"GPIO_DIR{bank * 4 + i}" for i, d in enumerate((15, 16, 5, 6))},
          **{str(b): f"GPIO{bank * 4 + i}_RAW" for i, b in enumerate((12, 11, 10, 9))}},
         mpn="SN74AXC4T774RSVR"),
    C(ca, "100n", V3), C(cb, "100n", "VTREF_IO"),
]] + [R(f"R{65 + i}", "10k", f"GPIO_DIR{i}", GND) for i in range(8)]
  + [R(f"R{73 + i}", "33R", f"GPIO{i}_RAW", f"GPIO{i}_TGT") for i in range(8)])

# --- 9. Target connectors and ESD ---------------------------------------------
PI = {1: "VTREF", 3: "I2C0_SDA_TGT", 5: "I2C0_SCL_TGT", 6: GND, 7: "GPIO0_TGT", 8: "UART_RXD_TGT",
      9: GND, 10: "UART_TXD_TGT", 11: "GPIO1_TGT", 12: "GPIO2_TGT", 13: "GPIO3_TGT", 14: GND,
      15: "GPIO4_TGT", 16: "GPIO5_TGT", 17: "VTREF", 18: "GPIO6_TGT", 19: "SPI_MOSI_TGT", 20: GND,
      21: "SPI_MISO_TGT", 22: "GPIO7_TGT", 23: "SPI_SCK_TGT", 24: "SPI_CS0_TGT", 25: GND,
      26: "SPI_CS1_TGT", 27: "I2C1_SDA_TGT", 28: "I2C1_SCL_TGT", 30: GND, 34: GND, 39: GND}
DIRECT = ["VTREF", GND, "I2C0_SDA_TGT", "I2C0_SCL_TGT", "I2C1_SDA_TGT", "I2C1_SCL_TGT",
          "SPI_CS0_TGT", "SPI_CS1_TGT", "SPI_SCK_TGT", "SPI_MOSI_TGT", "SPI_MISO_TGT", GND] + \
         [f"GPIO{i}_TGT" for i in range(8)] + ["5V_OUT", GND, "3V3_OUT", GND]


def esd(ref, lines):
    return Part(ref, "Power_Protection:TPD4E05U06DQA", "TPD4E05U06", "BridgeOne:USON-10_2.5x1.0mm_P0.5mm_TI_DQA",
                {"1": lines[0], "2": lines[1], "4": lines[2], "5": lines[3], "3": GND, "8": GND},
                nc=("6", "7", "9", "10"), mpn="TPD4E05U06DQAR")


target_io = Group("target_io", "TARGET I/O (back edge)", [
    "J3 = Raspberry Pi 40-pin numbering (ribbon cable); J10 = labelled direct-plug header. Same nets.",
    "Pi 5 V pins (2/4) are NOT connected; VTREF (pins 1/17) is an input reference only.",
    "J10 21/23 = 5V_OUT / 3V3_OUT accessory supplies (aux_out group). Connect one target at a time.",
    "TPD4E05U06 flow-through: route each line straight under the part (NC pads are pass-through).",
    "Ref: docs/pi-header-pinout.md",
], [
    Part("J3", "Connector_Generic:Conn_02x20_Odd_Even", "RPi 40-pin",
         "Connector_PinHeader_2.54mm:PinHeader_2x20_P2.54mm_Vertical",
         {str(k): v for k, v in PI.items()}, nc=tuple(str(k) for k in range(1, 41) if k not in PI)),
    Part("J10", "Connector_Generic:Conn_02x12_Odd_Even", "DIRECT I/O",
         "Connector_PinHeader_2.54mm:PinHeader_2x12_P2.54mm_Vertical",
         {str(i + 1): n for i, n in enumerate(DIRECT)}),
    esd("D6", ["I2C0_SDA_TGT", "I2C0_SCL_TGT", "I2C1_SDA_TGT", "I2C1_SCL_TGT"]),
    esd("D7", ["UART_TXD_TGT", "UART_RXD_TGT", "SPI_SCK_TGT", "SPI_MOSI_TGT"]),
    esd("D8", ["SPI_CS0_TGT", "SPI_CS1_TGT", "SPI_MISO_TGT", "VTREF"]),
    esd("D9", ["GPIO0_TGT", "GPIO1_TGT", "GPIO2_TGT", "GPIO3_TGT"]),
    esd("D10", ["GPIO4_TGT", "GPIO5_TGT", "GPIO6_TGT", "GPIO7_TGT"]),
])

# --- 10. OLED -----------------------------------------------------------------
OLED_PINS = {1: GND, 2: "OLED_C2P", 3: "OLED_C2N", 4: "OLED_C1P", 5: "OLED_C1N", 6: V3, 8: GND, 9: V3,
             10: GND, 11: V3, 12: GND, 13: GND, 14: "OLED_RES_N", 15: GND, 16: GND, 17: GND,
             18: "OLED_SCL", 19: "OLED_SDA", 20: "OLED_SDA", 21: GND, 22: GND, 23: GND, 24: GND, 25: GND,
             26: "OLED_IREF", 27: "OLED_VCOMH", 28: "OLED_VCC", 29: GND, 30: GND}
oled = Group("oled", "Status OLED 0.96in 128x64 (SSD1315, I2C 0x3C)", [
    "Panel: Wisevision X096-2864KSWPG17-C30 (30-pin 0.5 mm ZIF tail); 2nd source ER-OLED0.96-1.3W.",
    "I2C mode: BS0=0, BS1=1, BS2=0, CS#=0, D/C#(SA0)=0 -> address 0x3C; D1+D2 tied = SDA.",
    "Internal charge pump from +3V3 (VBAT): 2x 1 uF flying caps, VCC 4.7 uF, VCOMH 2.2 uF.",
    "IREF 390k ~ 12.5 uA (560k = dimmer). Software I2C master on GPIO8/9; reset held low at boot.",
    "REVIEW: FPC contact side / fold direction decides whether panel pin 1 meets connector pin 1.",
    "Ref: research/oled-panel.md",
], [
    Part("J6", "Connector_Generic_MountingPin:Conn_01x30_MountingPin", "FH12-30S-0.5SH",
         "Connector_FFC-FPC:Hirose_FH12-30S-0.5SH_1x30-1MP_P0.50mm_Horizontal",
         {**{str(k): v for k, v in OLED_PINS.items()}, "MP": GND}, nc=("7",), mpn="FH12-30S-0.5SH(55)",
         fields={"Panel": "X096-2864KSWPG17-C30 (LCSC C18723027)"}),
    C("C20", "1u 10V", "OLED_C1P", "OLED_C1N"),
    C("C21", "1u 10V", "OLED_C2P", "OLED_C2N"),
    C("C22", "2u2 16V", "OLED_VCOMH"),
    C("C65", "4u7 16V", "OLED_VCC", fp=C0603),
    R("R20", "390k 1%", "OLED_IREF", GND),
    C("C66", "1u", V3),
    C("C67", "100n", V3),
    R("R14", "4k7", V3, "OLED_SDA"),
    R("R15", "4k7", V3, "OLED_SCL"),
])

GROUPS = [power_in, buck, mcu, aux_out, status, fpga, gating, translators, target_io, oled]

SINGLE_PIN_OK |= {"DEBUG_TX", "DEBUG_RX", "SPARE0", "SPARE1", "AUX5_IMON", "AUX5_FLT_N",
                  "AUX3_FAULT_N"}
