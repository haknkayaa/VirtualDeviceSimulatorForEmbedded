# Bridge One Core Subsystem Schematic Review (Rev 0.1-core)

**Status:** DRAFT CORE ONLY — Architect Gated — No PCB Fabrication Release  
**Schematic:** [`hardware/vds4e-bridge/cad/bridge-one-core.kicad_sch`](file:///home/ubuntu/Desktop/PersonelProjects/VirtualDeviceSimulatorForEmbedded/hardware/vds4e-bridge/cad/bridge-one-core.kicad_sch)  
**Project:** [`hardware/vds4e-bridge/cad/bridge-one-core.kicad_pro`](file:///home/ubuntu/Desktop/PersonelProjects/VirtualDeviceSimulatorForEmbedded/hardware/vds4e-bridge/cad/bridge-one-core.kicad_pro)  
**Generator:** [`hardware/vds4e-bridge/cad/generate_core.py`](file:///home/ubuntu/Desktop/PersonelProjects/VirtualDeviceSimulatorForEmbedded/hardware/vds4e-bridge/cad/generate_core.py)  
**Manifest:** [`hardware/vds4e-bridge/cad/core-net-manifest.json`](file:///home/ubuntu/Desktop/PersonelProjects/VirtualDeviceSimulatorForEmbedded/hardware/vds4e-bridge/cad/core-net-manifest.json)  

---

## 1. Initial Rejection & Geometric Fix

- **Root Cause of Rejection:** The previous generator relied on comment-derived endpoint coordinates instead of symbol library pin geometry. This inverted vertical coordinates, placed MCU USB pads 13/14 at world Y=152.40/148.59 (overlapping GPIO8/9) rather than exact world Y=167.64/171.45, caused wire crossovers, shorted USB data with CC lines, created invalid duplicate `#PWR` references, and placed `no_connect` symbols on wire stub ends rather than directly at pins.
- **Architectural Correction in `generate_core.py`:**
  - Pin positions are calculated deterministically from embedded symbol library definitions: `world_x = round(ox + px, 3)`, `world_y = round(oy - py, 3)` (KiCad world Y-axis inversion).
  - All manually routed crossing wires and `#PWR` power instances were removed.
  - Every active pin connects via a short, non-overlapping stub to a named global label (`GND`, `+3V3`, `VBUS`, `USB_DP`, `USB_DN`, etc.). All same-name labels connect cleanly.
  - `no_connect` markers are placed directly at the pin origin with no stubs (PSRAM stubs strictly forbidden).

---

## 2. Independent Geometric Verification (`review_connectivity.py`)

Execution of `hardware/vds4e-bridge/cad/tools/review_connectivity.py` confirms:
- **Placed Instances:** **18 actual parts** (`U1`, `J1`, `U3`, `U2`, `R1`–`R6`, `C1`–`C5`, `SW1`, `SW2`, `J2`). No `#PWR` pseudo-instances.
- **Wire Stubs:** **83 individual stubs** connecting pins to net labels.
- **Manifest Issues:** **0** (all expected nets verified without split groups).
- **Multiple Named Nets (Shorts):** **0** (zero cross-net shorts).
- **Misplaced NC Pins:** **0** (all NC markers at exact pin origins).

---

## 3. Toolchain & MCP Parser Limitations

- **Syntax & Project Validation:**
  - `bridge-one-core.kicad_pro` is verified valid KiCad 6 JSON (`version: 1`).
  - S-expression schematic syntax passes standalone Python s-expression parsing.
  - MCP `validate_project` confirms project JSON validity, flagging only missing PCB layout (PCB design is out of scope for this core schematic task).
- **MCP Netlist Extraction:**
  - MCP `extract_schematic_netlist` reports 24 symbols (18 placed instances + 6 embedded `lib_symbols` definitions) and 38 global label nets.
  - **Critical Distinction:** MCP parsing uses regex pattern matching on labels/wires; **it is not an Electrical Rules Check (ERC)** and cannot prove physical design rule compliance or trace impedance.

---

## 4. Hardware Sourcing & Technical Corrections

1. **Memory Configuration:** ESP32-S3-WROOM-1-N8R8 features **8 MB Quad SPI Flash** (`N8`) and **8 MB Octal SPI PSRAM** (`R8`). Octal PSRAM consumes GPIO35, GPIO36, and GPIO37 (pads 28, 29, 30); these are marked strictly `no_connect` with no stubs.
2. **USB-C Receptacle (`J1`):** Uses stock KiCad 6 `USB_C_Receptacle_USB2.0` symbol with all 17 discrete pads (GND: A1, A12, B1, B12, S1; VBUS: A4, A9, B4, B9; CC1/CC2: A5, B5 with separate 5.1 kΩ pull-downs; D+: A6, B6; D-: A7, B7; SBU1/SBU2: A8, B8 marked NC). Footprint for KLS `L-KLS1-5416-L1-01-R` is **unverified**; footprint field left blank pending custom CAD.
3. **ESD Protection (`U3`):** `USBLC6-2SC6` mapped with matched pairs (pins 1/6 for DN, 3/4 for DP, 2 GND, 5 VBUS). Supplier sourcing remains **unknown/unresolved**.
4. **3.3 V LDO Regulator (`U2`):** STMicroelectronics `LD1117AS33TR` is rated **1 A** (not 800 mA). Symbol uses exact 3-pin configuration (1=GND, 2=OUT, 3=IN; SOT-223 tab is Pin 2 internally). Stability requires **minimum 10 µF effective output capacitance**; exact capacitor behavior, current budget and PCB thermal performance remain **unmeasured/unresolved**.
5. **Passive Candidate Footprints:** 10 µF capacitors (`C2`, `C3`, `C4`) use `0805` as BOM candidate; buttons (`SW1`, `SW2`) have footprints left blank (PTS526 vs PTS645 unverified).
6. **Target Bus Isolation:** All target bus connections (`I2C0/1`, `SPI2`, `UART`, `GPIO0-3`) are **labels-only**. Unshifted MCU IO is not connected to target connectors. Level translator sheets must include safe direction/OE gating (cannot use unisolated `SN74LVC1T45` alone).
7. **Firmware Gating:** ESP32-S3 SPI slave same-CS transaction decoding remains an unproven release gate. No PCB fabrication release has been issued.

The architect subsequently opened the corrected sheet in KiCad 6 and visually
confirmed that symbols and connections render. This is a file-open check, not
ERC or bench qualification. A separate mechanical PCB preview is under
`preview/`; it must not be confused with a routed implementation of this circuit.
