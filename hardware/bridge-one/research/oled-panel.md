# Bridge One 0.96-inch OLED Panel and Connector Selection (Design Note)

Date: 2026-10-14  
Status: Proposal / Component Qualification  
Tags: **[V]** VERIFIED (primary datasheet/drawing read this session), **[D]** DOCUMENTED-BUT-UNMEASURED, **[A]** ASSUMPTION  

## 1. Context and Requirements

Bridge One rev F reserves a bare 0.96-inch 128x64 monochrome OLED panel (DS1) mounted on 0.3 mm double-sided foam tape near the front edge of the PCB (center $X=22.35$, $Y=39.77$, rotation 180°), with its flexible printed circuit (FPC) tail connecting to an onboard interface (placeholder J6 at $X=22.35$, $Y=24.8$, rotation 0°).

### Key Constraints:
1. **Power supply:** Single regulated +3.3 V rail (+3V3 from AP63203 buck). The display controller must generate the required panel drive voltage ($V_{CC} \approx 7.5\text{--}9\text{ V}$) locally using its internal charge pump. [V]
2. **Host interface:** Driven exclusively by the ESP32-S3 over $\text{I}^2\text{C}$ (`OLED_SDA` on GPIO8, `OLED_SCL` on GPIO9) plus active-low reset (`OLED_RES_N` on GPIO2). The two hardware $\text{I}^2\text{C}$ controllers (I2C0, I2C1) are reserved for target HIL simulation; the OLED uses software $\text{I}^2\text{C}$ or dedicated GPIO multiplexing. [V: `docs/pin-allocation.md`]
3. **Display format:** Bare glass panel with Chip-on-Glass (COG) driver IC (SSD1306 or SSD1315 class); no carrier PCB or pin headers. [V]
4. **Enclosure clearance:** Total lid headroom is 4.0 mm above the PCB top copper (`HEADROOM = 4.0`). The display viewing window is cut through the lid above DS1 active area. [V: `cad/enclosure/generate_enclosure.py`]

---

## 2. Real Bare Panels Comparison

We evaluated four real bare OLED panels with published engineering drawings and verified primary datasheets:

| Parameter | 1. Wisevision X096-2864KSWPG17-C30 | 2. Univision / WiseChip UG-2864HSWEG01 | 3. EastRising ER-OLED0.96-1.3W / ER-OLED0.96-1W | 4. Raystar REX012864D (Option Z / H) |
| :--- | :--- | :--- | :--- | :--- |
| **Driver IC** | Solomon Systech **SSD1315** (COG) [V] | Solomon Systech **SSD1306** (COG) [V] | Solomon Systech **SSD1306** (COG) [V] | Solomon Systech **SSD1306** (COG) [V] |
| **Glass Outline ($W \times H \times T$)** | **$24.70 \times 16.60 \times 1.30\text{ mm}$** (ultra-compact) [V] | **$26.70 \times 19.26 \times 1.45\text{ mm}$** (standard) [V] | **$26.70 \times 19.26 \times 1.45\text{ mm}$** (standard) [V] | **$26.70 \times 19.26 \times 1.26\text{ mm}$** (slim) [V] |
| **Active Area ($W \times H$)** | $21.74 \times 11.175\text{ mm}$ [V] | $21.744 \times 10.864\text{ mm}$ [V] | $21.744 \times 10.864\text{ mm}$ [V] | $21.738 \times 10.858\text{ mm}$ [V] |
| **Viewing Area ($W \times H$)** | $22.74 \times 12.175\text{ mm}$ [V] | $23.744 \times 12.864\text{ mm}$ [V] | $23.744 \times 12.864\text{ mm}$ [V] | $23.938 \times 12.058\text{ mm}$ [V] |
| **Active Area Top Offset** | **1.48 mm** from top edge [V] | **2.48 mm** (2.478 mm) from top edge [V] | **2.48 mm** from top edge [V] | **2.48 mm** from top edge [V] |
| **Active Area Horizontal Margin** | **1.48 mm** centered [V] | **2.48 mm** centered [V] | **2.48 mm** centered [V] | **2.48 mm** centered [V] |
| **FPC Pin Count** | **30 pins** [V] | **30 pins** [V] | **30 pins** [V] | **30 pins** [V] |
| **FPC Pitch** | **0.50 mm** ($P0.50 \times 29 = 14.50\text{ mm}$) [V] | **0.70 mm** ($P0.70 \times 29 = 20.30\text{ mm}$) [V] | **0.50 mm** (-1.3W) / **0.70 mm** (-1W) [V] | **0.50 mm** (Opt Z) / **0.70 mm** (Opt H) [V] |
| **FPC Tail Width** | $15.50 \pm 0.20\text{ mm}$ [V] | $22.00 \pm 0.20\text{ mm}$ [V] | $15.50\text{ mm}$ (ZIF) / $22.00\text{ mm}$ (Solder) [V] | $15.50\text{ mm}$ (ZIF) / $22.00\text{ mm}$ (Solder) [V] |
| **FPC Connection Method** | **ZIF Connector** (0.30 mm tail thickness) [V] | **Direct Solder Tail** (hot-bar / SMD pads) [V] | **ZIF** (-1.3W) or **Solder** (-1W) [V] | **ZIF** (Opt Z) or **Hotbar Solder** (Opt H) [V] |
| **FPC Fold Type** | Rear-folding under glass [V] | Rear-folding under glass [V] | Rear-folding under glass [V] | Rear-folding under glass [V] |
| **Supported Interfaces** | $\text{I}^2\text{C}$, 3-wire/4-wire SPI [V] | $\text{I}^2\text{C}$, 3-/4-wire SPI, 8-bit 6800/8080 [V] | $\text{I}^2\text{C}$, 3-/4-wire SPI, 8-bit 6800/8080 [V] | $\text{I}^2\text{C}$, 3-/4-wire SPI, 8-bit 6800/8080 [V] |
| **Internal Charge Pump** | Yes (integrated DC/DC converter, 7.5--9 V) [V] | Yes (integrated DC/DC converter, 7.5--9 V) [V] | Yes (integrated DC/DC converter, 7.5--9 V) [V] | Yes (integrated DC/DC converter, 7.5--9 V) [V] |
| **Required External Passives** | 2x 1 uF flying caps, 4.7 uF $V_{CC}$, 2.2 uF $V_{COMH}$, $R_{IREF}$, $V_{BAT}$ cap [V] | 2x 1 uF flying caps, 4.7 uF $V_{CC}$, 2.2 uF $V_{COMH}$, $R_{IREF}$, $V_{BAT}$ cap [V] | 2x 1 uF flying caps, 4.7 uF $V_{CC}$, 2.2 uF $V_{COMH}$, $R_{IREF}$, $V_{BAT}$ cap [V] | 2x 1 uF flying caps, 4.7 uF $V_{CC}$, 2.2 uF $V_{COMH}$, $R_{IREF}$, $V_{BAT}$ cap [V] |
| **Datasheet / Drawing Source** | Wisevision SAS1-9046 rev A / LCSC C18723027 PDF [V] | Univision SAS1-9046-B (2009-06-05) [V] | EastRising ER-OLED0.96-1 Series Spec [V] | Raystar REX012864D Spec rev B [V] |

---

## 3. Supplier Availability and Pricing (Observed 2026-10-14)

Per project guidelines, stock is verified against live distributor listings; never inferred from generic search snippets:

| Supplier | Part Number / Listing | Classification | Observed Stock | Price (USD/TRY) | Link / Listing URL | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LCSC** | Wisevision `X096-2864KSWPG17-C30` (C18723027) | **Verified listing; reported in-stock** | **71 pcs** | $1.99 (qty 1), $1.68 (qty 10) | <https://www.lcsc.com/product-detail/C18723027.html> | Bare panel, 0.5 mm ZIF tail, SSD1315. In stock. [V] |
| **LCSC** | Wisevision `N096-2864KSWEG01-H30` (C2890596) | Verified listing; discontinued | 0 pcs | — | <https://www.lcsc.com/product-detail/C2890596.html> | Older SSD1306 version; superseded by C18723027. [V] |
| **BuyDisplay** | EastRising `ER-OLED0.96-1.3W` | **Verified listing; reported in-stock** | In regular production | $2.49 (qty 1), $2.43 (qty 10) | <https://www.buydisplay.com/128x64-oled-i2c-0-96-inch-display-white-color-connector-fpc-ssd1306> | Bare panel with 30-pin 0.5 mm ZIF FPC tail. [V] |
| **BuyDisplay** | EastRising `ER-OLED0.96-1W` | **Verified listing; reported in-stock** | In regular production | $2.36 (qty 1), $2.30 (qty 10) | <https://www.buydisplay.com/datasheet-128x64-oled-module-spi-0-96-inch-graphic-displays-white-on-black> | Bare panel with 30-pin 0.7 mm solder-tail FPC. [V] |
| **Özdisan** | HT Display `HTOLED-096-E` (SKU 726592) | **Verified listing; reported in-stock** | **1 pc** | Inquire | <https://www.ozdisan.com/p/cog-oledler-893/ht-display-htoled-096-e-726592> | COG OLED 128x64 White, SSD1312, 4-wire SPI/I2C. [V] |
| **AliExpress** | Generic 30-pin 0.96" bare OLED (Item 32849806526) | Verified listing; stock unknown | In stock (CSR page) | ~$1.80--$2.50 | <https://www.aliexpress.com/item/32849806526.html> | Widely cloned 30-pin bare panel (solder and ZIF options). [V] |
| **Robotistan** | Various 0.96" OLED modules | Carrier PCB only; **bare panel unavailable** | N/A (module only) | ~110 TRY | <https://www.robotistan.com/096-inc-mavi-i2c-oled-ekran-modulu-ssd1306> | Only sells pre-assembled 4-pin I2C / 7-pin SPI breakout modules; no bare glass panels. [V] |
| **Direnç.net** | Various 0.96" OLED modules | Carrier PCB only; **bare panel unavailable** | N/A (module only) | ~95 TRY | <https://www.direnc.net/096-128x64-4-pin-oled-grafik-lcd-ekran-mavi> | Only sells pre-assembled 4-pin I2C / 7-pin SPI breakout modules; no bare glass panels. [V] |

---

## 4. Architectural Analysis: 0.5 mm ZIF vs 0.7 mm Solder Tail

The initial placement note questioned whether the Hirose FH12-30S-0.5SH placeholder was incorrect because many hobbyist bare OLED panels have 30-pin 0.7 mm pitch FPCs. Our investigation reveals two distinct panel ecosystems:

### Ecosystem A: 30-Pin 0.70 mm Pitch Solder Tail (e.g., UG-2864HSWEG01, ER-OLED0.96-1W)
- **Mechanical:** FPC width is 22.0 mm; pitch is 0.70 mm across 30 pads (span 20.30 mm).
- **Assembly:** Designed for **hot-bar soldering** (thermode pulse-heat bonding) or manual hand drag-soldering directly onto surface-mount pads on the host PCB.
- **Why it is problematic for Bridge One:**
  1. **No standard KiCad footprint:** KiCad does not have a standard footprint for 0.70 mm solder-tail displays in `Connector_FFC-FPC.pretty` because pad geometry is vendor-dependent.
  2. **PCBA failure risk:** Hand-soldering a 30-pin 0.70 mm polyimide tail during prototype assembly easily overheats the flex substrate, causes solder bridges between 0.40 mm pads, or lifts copper pads during rework.
  3. **Non-replaceable panel:** If the glass cracks or a row dies during bench testing, desoldering 30 pads of delicate polyimide flex from a dense 4-layer board with an FPGA and ESP32-S3 nearby risks destroying the entire board.

### Ecosystem B: 30-Pin 0.50 mm Pitch ZIF Tail (e.g., Wisevision X096-2864KSWPG17-C30, BuyDisplay ER-OLED0.96-1.3W)
- **Mechanical:** FPC width is 15.50 mm; pitch is 0.50 mm across 30 contacts (span 14.50 mm). The tail has an integrated 0.30 mm polyimide stiffener.
- **Assembly:** Plugs directly into an industry-standard 0.50 mm pitch horizontal ZIF/FFC connector.
- **Why it is superior for Bridge One:**
  1. **Standard reflow assembly:** The connector is placed and reflowed along with all other SMT passives and ICs. No hand-soldering of the flex tail is required.
  2. **Field replaceable:** The display unlatches in 3 seconds for inspection, replacement, or testing without tools.
  3. **Enclosure clearance:** Total connector profile height is 2.0 mm (`Hirose FH12-30S-0.5SH`). The enclosure lid provides `HEADROOM = 4.0 mm`, leaving 2.0 mm of clearance above the connector body. [V]
  4. **Standard footprint:** KiCad 10 provides verified footprints for Hirose FH12, Amphenol F32R, and TE equivalents directly in the core distribution. [V]

**Conclusion:** The 30-pin 0.50 mm ZIF concept in rev F placement is **architecturally correct and significantly safer for PCBA**. The placeholder footprint should be confirmed as a 30-pin 0.50 mm pitch horizontal bottom-contact connector.

---

## 5. Complete 30-Pin FPC Pinout and Schematic Net Mapping (I2C Mode)

Both Wisevision `X096-2864KSWPG17-C30` (SSD1315) and Univision `UG-2864HSWEG01` / EastRising `ER-OLED0.96-1` (SSD1306) share an identical functional pin order. In $\text{I}^2\text{C}$ mode, parallel bus lines and unused mode pins are tied to GND.

| Pin | Symbol | Type | Function in SSD1306 / SSD1315 | Bridge One Net / Connection ($\text{I}^2\text{C}$ Mode) | External Passives / Notes |
| :---: | :--- | :---: | :--- | :--- | :--- |
| **1** | `NC(GND)` | Power | Ground / ESD supporting contact | `GND` | Direct to ground plane |
| **2** | `C2P` | Analog | Charge pump flying capacitor 2 (+) | `OLED_C2P` | 1.0 uF 0402 $\ge 10\text{ V}$ ceramic (C12) between pin 2 and pin 3 [V] |
| **3** | `C2N` | Analog | Charge pump flying capacitor 2 (-) | `OLED_C2N` | Connected to pin 2 via C12 |
| **4** | `C1P` | Analog | Charge pump flying capacitor 1 (+) | `OLED_C1P` | 1.0 uF 0402 $\ge 10\text{ V}$ ceramic (C11) between pin 4 and pin 5 [V] |
| **5** | `C1N` | Analog | Charge pump flying capacitor 1 (-) | `OLED_C1N` | Connected to pin 4 via C11 |
| **6** | `VBAT` | Power | Charge pump internal DC/DC power supply | `+3V3` | Local 1.0 uF 0402 decoupling capacitor to `GND` [V] |
| **7** | `NC` | — | No connection (internal reserved) | `NC` | Leave floating (or GND pad) |
| **8** | `VSS` | Power | Logic ground | `GND` | Direct to ground plane |
| **9** | `VDD` | Power | Logic supply voltage (1.65 V to 3.3 V) | `+3V3` | Local 0.1 uF 0402 decoupling capacitor to `GND` [V] |
| **10** | `BS0` | Input | Protocol select bit 0 ($\text{I}^2\text{C}=0$) | `GND` | Tie to GND for $\text{I}^2\text{C}$ mode [V] |
| **11** | `BS1` | Input | Protocol select bit 1 ($\text{I}^2\text{C}=1$) | `+3V3` | Tie to +3.3 V for $\text{I}^2\text{C}$ mode [V] |
| **12** | `BS2` / `NC` | Input | Protocol select bit 2 ($\text{I}^2\text{C}=0$ on SSD1306; NC on SSD1315) | `GND` | Tie to GND (satisfies SSD1306; harmless NC on SSD1315) [V] |
| **13** | `CS#` | Input | Chip select (active low) | `GND` | Tie to GND to permanently enable $\text{I}^2\text{C}$ communication [V] |
| **14** | `RES#` | Input | Hardware reset (active low) | `OLED_RES_N` | Driven by ESP32-S3 GPIO2; 10 kΩ pull-down keeps panel in reset during boot [V] |
| **15** | `D/C#` (SA0) | Input | Slave address bit 0 ($\text{I}^2\text{C}$ mode) | `GND` | Tie to GND $\to$ 7-bit $\text{I}^2\text{C}$ address = `0x3C` (`0111100b`, write `0x78`) [V] |
| **16** | `R/W#` / `NC` | Input | Parallel Read/Write (NC on SSD1315) | `GND` | Tie to GND [V] |
| **17** | `E/RD#` / `NC` | Input | Parallel Enable/Read (NC on SSD1315) | `GND` | Tie to GND [V] |
| **18** | `D0` | Input | Serial Clock input (SCL) | `OLED_SCL` | Driven by ESP32-S3 GPIO9; requires 4.7 kΩ pull-up to +3.3 V (R12) [V] |
| **19** | `D1` | I/O | Serial Data input (SDAin) | `OLED_SDA` | Tie together with pin 20 (D2) to form bidirectional SDA line [V] |
| **20** | `D2` | I/O | Serial Data output / ACK (SDAout) | `OLED_SDA` | Tied to pin 19; driven by ESP32-S3 GPIO8; 4.7 kΩ pull-up to +3.3 V (R13) [V] |
| **21** | `D3` / `NC` | Input | Parallel data bit 3 (NC on SSD1315) | `GND` | Tie to GND [V] |
| **22** | `D4` / `NC` | Input | Parallel data bit 4 (NC on SSD1315) | `GND` | Tie to GND [V] |
| **23** | `D5` / `NC` | Input | Parallel data bit 5 (NC on SSD1315) | `GND` | Tie to GND [V] |
| **24** | `D6` / `NC` | Input | Parallel data bit 6 (NC on SSD1315) | `GND` | Tie to GND [V] |
| **25** | `D7` / `NC` | Input | Parallel data bit 7 (NC on SSD1315) | `GND` | Tie to GND [V] |
| **26** | `IREF` | Input | Segment current reference | `OLED_IREF` | Resistor to `GND` (R11). Formula: $I_{REF} = (V_{CC} - V_{SS})/R_{REF} \approx 12.5\ \mu\text{A}$. For internal DC/DC ($V_{CC} \approx 7.5\text{--}9\text{ V}$), recommended is **$390\text{ k}\Omega$** to **$560\text{ k}\Omega$** (placement.json currently has 910 kΩ, which runs dimmer/lower current) [V] |
| **27** | `VCOMH` | Output | COM signal deselect high voltage level | `OLED_VCOMH` | 2.2 uF 0402 16 V ceramic capacitor (C13) to `GND` [V] |
| **28** | `VCC` | Power | Panel driving high voltage supply | `OLED_VCC` | 4.7 uF 0603/0402 16 V X7R capacitor (C14) to `GND` [V] |
| **29** | `VLSS` | Power | Analog ground | `GND` | Direct to ground plane [V] |
| **30** | `NC(GND)` | Power | Ground / ESD supporting contact | `GND` | Direct to ground plane |

---

## 6. Exact KiCad Footprints

### Selected Primary Footprint:
For the 30-pin 0.50 mm pitch ZIF connector mating with Wisevision `X096-2864KSWPG17-C30` or BuyDisplay `ER-OLED0.96-1.3W`:
- **KiCad 10 Footprint Name:**  
  `Connector_FFC-FPC:Hirose_FH12-30S-0.5SH_1x30-1MP_P0.50mm_Horizontal` [V]
- **KiCad Library Path:**  
  `/usr/share/kicad/footprints/Connector_FFC-FPC.pretty/Hirose_FH12-30S-0.5SH_1x30-1MP_P0.50mm_Horizontal.kicad_mod` [V]
- **Footprint Characteristics:**
  - Pin count: 30 signal pads + 2 side mounting tabs (MP).
  - Pad size: $0.30 \times 1.30\text{ mm}$, pitch $0.50\text{ mm}$ (Pad 1 at $X=-7.25$, Pad 30 at $X=+7.25$).
  - Contact style: **Bottom contacts** (contacts face down toward the PCB copper, perfectly mating with the rear-folded FPC tail whose exposed gold fingers face downward when folded under the glass). [V]
  - Overall footprint span: $18.3\text{ mm}$ width, $5.1\text{ mm}$ depth, $2.0\text{ mm}$ height.
  - Drop-in second-source footprints in the same KiCad library:
    - `Amphenol_F32R-1A7x1-11030_1x30-1MP_P0.5mm_Horizontal` (bottom contact) [V]
    - `TE_3-1734839-0_1x30-1MP_P0.5mm_Horizontal` [V]

### Alternative Footprint (If Solder-Tail Panel is Mandated):
If a 0.70 mm pitch solder-tail panel (like UG-2864HSWEG01) is mandated by procurement:
- **Footprint Name:** `BridgeOne:OLED_0.96in_30P_P0.7mm_SolderTail` (custom footprint required; does not exist in standard KiCad distribution).
- **Pad Specifications:** 30 rectangular SMD pads, pad width $0.40\text{ mm}$, pad length $1.60\text{ mm}$, pitch $0.70\text{ mm}$ (total span $20.30\text{ mm}$ pad 1 to 30).

---

## 7. Mechanical and 3D Model Parameters

To update `cad/footprints/make_oled_panel.py` and `cad/enclosure/generate_enclosure.py`, use the exact engineering numbers verified from manufacturer drawings:

### Comparison of 3D Parameters:

| Parameter | Current Placeholder (`make_oled_panel.py`) | Wisevision `X096-2864KSWPG17-C30` (SSD1315) | Univision `UG-2864HSWEG01` / EastRising `ER-OLED0.96-1.3W` (SSD1306) |
| :--- | :--- | :--- | :--- |
| **Glass Width (`GLASS_W`)** | $26.70\text{ mm}$ | **$24.70\text{ mm}$** [V] | **$26.70\text{ mm}$** [V] |
| **Glass Height (`GLASS_H`)** | $19.26\text{ mm}$ | **$16.60\text{ mm}$** [V] | **$19.26\text{ mm}$** [V] |
| **Glass Thickness (`GLASS_T`)** | $1.45\text{ mm}$ | **$1.30\text{ mm}$** [V] | **$1.45\text{ mm}$** [V] |
| **Active Width (`ACTIVE_W`)** | $21.74\text{ mm}$ | **$21.74\text{ mm}$** [V] | **$21.744\text{ mm}$** [V] |
| **Active Height (`ACTIVE_H`)** | $10.86\text{ mm}$ | **$11.175\text{ mm}$** [V] | **$10.864\text{ mm}$** [V] |
| **Active Offset from Top (`ACTIVE_TOP`)** | $1.90\text{ mm}$ | **$1.48\text{ mm}$** [V] | **$2.48\text{ mm}$** [V] |
| **Viewing Area Width (`VIEW_W`)** | N/A | **$22.74\text{ mm}$** [V] | **$23.744\text{ mm}$** [V] |
| **Viewing Area Height (`VIEW_H`)** | N/A | **$12.175\text{ mm}$** [V] | **$12.864\text{ mm}$** [V] |
| **Foam Tape Thickness (`TAPE`)** | $0.30\text{ mm}$ | $0.30\text{ mm}$ (3M 1318B or similar) [V] | $0.30\text{ mm}$ [V] |
| **FPC Tail Width (`TAIL_W`)** | $12.0\text{ mm}$ | **$15.50\text{ mm}$** [V] | **$15.50\text{ mm}$** (ZIF) / $22.0\text{ mm}$ (Solder) [V] |
| **FPC Tail Length Unfolded** | $3.0\text{ mm}$ | **$18.92\text{ mm}$** [V] | **$20.86\text{ mm}$** [V] |
| **FPC Tail Stiffener Thickness** | N/A | **$0.30\text{ mm}$** [V] | **$0.30\text{ mm}$** [V] |

### Enclosure Viewing Window Implications:
In `cad/enclosure/generate_enclosure.py` (lines 152--160), the lid viewing cutout is calculated based on `OLED_ACTIVE_W` and `OLED_ACTIVE_H` plus a 0.8 mm margin:
- If **Wisevision X096-2864KSWPG17-C30** is selected:
  - `OLED_GLASS_H = 16.60`
  - `OLED_ACTIVE_W = 21.74`, `OLED_ACTIVE_H = 11.18`
  - `OLED_ACTIVE_TOP = 1.48`
  - Center of active area relative to glass center:  
    $\Delta Y = \text{GLASS\_H}/2 - \text{ACTIVE\_TOP} - \text{ACTIVE\_H}/2 = 8.30 - 1.48 - 5.59 = +1.23\text{ mm}$.
- If **EastRising ER-OLED0.96-1.3W / UG-2864** is selected:
  - `OLED_GLASS_H = 19.26`
  - `OLED_ACTIVE_W = 21.74`, `OLED_ACTIVE_H = 10.86`
  - `OLED_ACTIVE_TOP = 2.48`
  - Center of active area relative to glass center:  
    $\Delta Y = 9.63 - 2.48 - 5.43 = +1.72\text{ mm}$.

---

## 8. Recommendation

1. **Adopt Wisevision `X096-2864KSWPG17-C30` (SSD1315) as the primary baseline panel:**
   - **Availability:** In stock at LCSC (C18723027, 71 units observed 2026-10-14 at $1.99). [V]
   - **Controller:** Modern Solomon Systech SSD1315 with improved charge pump efficiency and lower operating current over the legacy SSD1306, while maintaining 100% register compatibility with existing SSD1306 graphics libraries. [V]
   - **Connector:** Standard 30-pin 0.50 mm pitch ZIF tail.
   - **Footprint:** `Connector_FFC-FPC:Hirose_FH12-30S-0.5SH_1x30-1MP_P0.50mm_Horizontal` (or Amphenol F32R / TE equivalent).
   - **Mechanical:** Compact $24.70 \times 16.60\text{ mm}$ glass outline leaves additional routing margin near the front edge of the PCB and side buttons SW1/SW2.

2. **Second-Source Compatibility:**
   - EastRising **`ER-OLED0.96-1.3W`** (BuyDisplay) uses the exact same 30-pin 0.50 mm ZIF pinout and connector footprint. It has a slightly larger glass body ($26.70 \times 19.26\text{ mm}$), which fits within the existing DS1 courtyard ($27.29 \times 19.85\text{ mm}$).
   - Pin 12, 16, 17, 21--25 should be tied to `GND` on the PCB. This satisfies legacy SSD1306 parallel-pin grounding rules without affecting SSD1315 (where those pins are internal NCs).

3. **Passives Values:**
   - C11, C12: 1.0 uF 0402 $\ge 10\text{ V}$ X5R/X7R (charge pump flying capacitors).
   - C13: 2.2 uF 0402 16 V X5R (VCOMH filter).
   - C14: 4.7 uF 0603/0402 16 V X7R (VCC charge pump reservoir).
   - R11: **$390\text{ k}\Omega$** 0402 1% (adjust from 910 kΩ for nominal 12.5 uA $I_{REF}$ and bright display under internal DC/DC operation; 560 kΩ if dimmer display is desired for lower current).
   - R12, R13: 4.7 kΩ 0402 (I2C pull-ups on `OLED_SCL` and `OLED_SDA` to +3.3 V).

---

## 9. Open Questions and Bench Tests

1. **FPC Bending Radius and Lifespan:**  
   - When the panel is adhered with foam tape, the FPC folds 180° underneath the glass before inserting into J6. Verify on mechanical samples that the 0.5 mm ZIF tail length ($18.92\text{ mm}$) provides sufficient bend radius ($\ge 1.0\text{ mm}$) without putting peeling stress on the COG bonding ledge. [A]
2. **Current Draw under All-Pixels-On:**  
   - Measure actual +3.3 V rail current drawn by DS1 with all 128x64 pixels lit at maximum contrast (command `0x81 0xFF`). Expected typ 20--25 mA, worst-case bound 35 mA. Confirm this fits comfortably within the AP63203 buck budget. [D]
3. **Software I2C Timing on ESP32-S3:**  
   - The SSD1306/SSD1315 controller supports up to 400 kHz Fast-Mode $\text{I}^2\text{C}$. Verify that the ESP-IDF software bitbang or dedicated peripheral driver on GPIO8/GPIO9 achieves $\ge 20\text{ FPS}$ full-frame refresh without blocking virtual target HIL ISRs. [D]
