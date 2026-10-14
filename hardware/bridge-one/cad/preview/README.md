# VDS4E Bridge One — PCB 3D Component Placement Preview

**Scope:** Independent PCB 3D Component Placement Preview for Bridge One Core Subsystem.  
**Revision:** Preview-0.1  
**Generated:** 2026-10-14  

---

> [!WARNING]
> **NO ROUTING / NO FABRICATION RELEASE**  
> This preview contains component placement and mechanical layout **only**.  
> - Copper routing and signal tracks are **NOT designed or present** (track count = 0).  
> - Target bus level translators (I2C, SPI, UART, GPIO) and target connectors are **NOT implemented on this sheet**.  
> - This PCB is an architectural and mechanical visualization tool and must **NEVER** be submitted for fabrication.

---

## 1. Board Specifications

- **Outline:** 50.0 mm × 50.0 mm compact square outline on `Edge.Cuts`.
- **Stackup:** Coherent 4 copper layers:
  - Layer 1 (`F.Cu`): Front Signals / Component Placement
  - Layer 2 (`In1.Cu`): Reserved for the intended ground plane (`GND`); no plane fill implemented
  - Layer 3 (`In2.Cu`): Reserved for power / secondary routing (`PWR`); no plane fill implemented
  - Layer 4 (`B.Cu`): Bottom Signals
- **RF Antenna Keepout:** ESP32-S3 onboard antenna is positioned at the top edge ($X = 14\text{ mm}$ to $36\text{ mm}$, $Y = 0\text{ mm}$ to $9\text{ mm}$) with a dedicated rule area / keepout zone banning tracks, vias, and copper pours across all copper layers.

---

## 2. Core Manifest Part References (18 Parts)

All 18 core part references match `cad/core/core-net-manifest.json`:

| Reference | Value / Part | Footprint | 3D Model | Status / Notes |
|:---|:---|:---|:---|:---|
| **U1** | ESP32-S3-WROOM-1-N8R8 | `footprints:ESP32-S3-WROOM-1` | `ESP32-S3-WROOM-1.step` (1.9 MB) | Official KiCad upstream STEP; 40 perimeter + thermal pad 41 |
| **J1** | USB_C_PREVIEW_NOT_KLS | `Connector_USB:USB_C_Receptacle_GCT_USB4085` | `USB_C_Receptacle_GCT_USB4085.step` | **Approximate candidate placeholder only**; NOT exact KLS L-KLS1-5416-L1-01-R |
| **U2** | LD1117AS33TR | `Package_TO_SOT_SMD:SOT-223-3_TabPin2` | `SOT-223.step` | Official KiCad STEP; Pin 1=GND, Pin 2/Tab=VOUT, Pin 3=VIN |
| **U3** | USBLC6-2SC6 | `Package_TO_SOT_SMD:SOT-23-6` | `SOT-23-6.step` | Official KiCad STEP; USB ESD protection |
| **R1** | 5.1k | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; USB CC1 pull-down |
| **R2** | 5.1k | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; USB CC2 pull-down |
| **R3** | 22R | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; USB D+ impedance series |
| **R4** | 22R | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; USB D- impedance series |
| **R5** | 10k | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; CHIP_EN reset pull-up |
| **C1** | 1uF | `Capacitor_SMD:C_0603_1608Metric` | `C_0603_1608Metric.step` | Official KiCad STEP; CHIP_EN power-on delay |
| **SW1** | RESET | `Button_Switch_SMD:SW_SPST_PTS645` | `SW_Push_6x6x5mm.step` | Approximate preview button; not verified as the sourced PTS526 |
| **R6** | 10k | `Resistor_SMD:R_0603_1608Metric` | `R_0603_1608Metric.step` | Official KiCad STEP; BOOT_N (GPIO0) pull-up |
| **SW2** | BOOT | `Button_Switch_SMD:SW_SPST_PTS645` | `SW_Push_6x6x5mm.step` | Approximate preview button; not verified as the sourced PTS526 |
| **C2** | 10uF | `Capacitor_SMD:C_0805_2012Metric` | `C_0805_2012Metric.step` | Official KiCad STEP; LDO VIN bulk filter |
| **C3** | 10uF | `Capacitor_SMD:C_0805_2012Metric` | `C_0805_2012Metric.step` | Official KiCad STEP; LDO VOUT stability capacitor |
| **C4** | 10uF | `Capacitor_SMD:C_0805_2012Metric` | `C_0805_2012Metric.step` | Official KiCad STEP; ESP32-S3 +3V3 bulk bypass |
| **C5** | 100nF | `Capacitor_SMD:C_0603_1608Metric` | `C_0603_1608Metric.step` | Official KiCad STEP; ESP32-S3 HF bypass |
| **J2** | DEBUG_UART0 | `Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical` | `PinHeader_1x04_P2.54mm_Vertical.step` | Official KiCad STEP; UART0 recovery header |

---

## 3. 3D Model Sourcing and Portability

All models are stored locally under `${KIPRJMOD}/3dmodels/` and referenced relatively in the `.kicad_pcb` file for complete portability across workstations:
- **`ESP32-S3-WROOM-1.step` (1.9 MB):** Official upstream KiCad 3D model from Espressif/KiCad library.
- **`SOT-223.step` (65 KB):** Official KiCad packages3D model for LD1117A linear regulator.
- **`SOT-23-6.step` (100 KB):** Official KiCad packages3D model for USBLC6-2SC6 ESD protector.
- **`PinHeader_1x04_P2.54mm_Vertical.step` (145 KB):** Official KiCad packages3D model for UART debug header.
- **`R_0603_1608Metric.step` (41 KB) & `C_0603_1608Metric.step` (43 KB):** Official KiCad packages3D models for 0603 passives.
- **`C_0805_2012Metric.step` (44 KB):** Official KiCad packages3D model for 0805 capacitors.
- **`USB_C_Receptacle_GCT_USB4085.step` (805 KB):** **Candidate preview model** for USB-C. Because the exact KLS L-KLS1-5416-L1-01-R manufacturer CAD drawing has not yet been resolved into a verified production footprint, this standard USB-C receptacle model is provided strictly as a mechanical space-claim placeholder.
- **`SW_Push_6x6x5mm.step` (144 KB):** Standard 6x6 tactile switch 3D model for SW1 and SW2.

---

## 4. Automated Verification Results

Loaded and checked via Python 3 `pcbnew` (v6.0.2):
- **PCB File:** `bridge-one-preview.kicad_pcb`
- **Project File:** `bridge-one-preview.kicad_pro` (valid JSON format)
- **Footprint Count:** 18 (exact match with core net manifest)
- **Copper Layers:** 4 (`F.Cu`, `In1.Cu` (GND), `In2.Cu` (PWR), `B.Cu`)
- **Routing Tracks:** 0 (strictly unrouted placement preview)
- **Render Output:** `bridge-one-preview.step` generated via `/usr/bin/kicad2step`

---

## 5. How to View in KiCad 3D Viewer

1. Open KiCad:
   ```bash
   kicad hardware/bridge-one/cad/preview/bridge-one-preview.kicad_pro
   ```
2. Open PCB Editor (`bridge-one-preview.kicad_pcb`).
3. Press `Alt+3` (or menu **View -> 3D Viewer**).
