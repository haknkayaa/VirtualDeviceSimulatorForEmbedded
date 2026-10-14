# Bridge One power budget and 3.3 V supply decision

Date: 2026-10-14. Scope: USB-C 5 V VBUS (USB 2.0 device, no PD) powering ESP32-S3-WROOM-1-N8R8 plus translators, with an optional SPI-engine FPGA.
Nothing here was measured on hardware.

Claim tags: **[V]** VERIFIED (primary source read this session), **[D]** DOCUMENTED-BUT-UNMEASURED (secondary source, or recalled from a spec not re-read), **[A]** ASSUMPTION.

**Source gap:** the ST LD1117A datasheet (st.com) could not be downloaded; every connection from this host timed out. All LD1117A electrical numbers below are therefore [D] or [A]. Re-read it before schematic release.

Primary sources read:
- ESP32-S3 series datasheet v2.2: <https://documentation.espressif.com/esp32-s3_datasheet_en.pdf>
- ESP32-S3-WROOM-1 datasheet v1.8: <https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf>
- TLV757P: <https://www.ti.com/lit/ds/symlink/tlv757p.pdf>
- AP2112: <https://www.diodes.com/assets/Datasheets/AP2112.pdf>
- TPS6216x: <https://www.ti.com/lit/ds/symlink/tps62162.pdf>
- TPS2553: <https://www.ti.com/lit/ds/symlink/tps2553.pdf>
- TPS25921: <https://www.ti.com/lit/ds/symlink/tps25921l.pdf>
- TPS2595: <https://www.ti.com/lit/ds/symlink/tps2595.pdf>
- SN74AVC4T245: <https://www.ti.com/lit/ds/symlink/sn74avc4t245.pdf>
- SN74AXC4T774: <https://www.ti.com/lit/ds/symlink/sn74axc4t774.pdf>
- PCA9306: <https://www.ti.com/lit/ds/symlink/pca9306.pdf>

## 1. Current budget (3.3 V rail)

### Verified module and chip facts

| Fact | Value | Tag |
|---|---|---|
| Module VDD33 range (WROOM-1 Table 6-2) | 3.0 / 3.3 / 3.6 V | [V] |
| Current the external supply must deliver (same table, `IVDD`) | min 0.5 A | [V] |
| Chip Wi-Fi TX peak at 3.3 V, 100% duty (Table 5-7) | 802.11b 1 Mbps @21 dBm: 340 mA; 11g 54 Mbps @19 dBm: 291 mA; 11n HT20 MCS7 @18.5 dBm: 283 mA; 11n HT40 @18 dBm: 286 mA | [V] |
| Chip Wi-Fi RX | 88 mA (HT20), 91 mA (HT40) | [V] |
| BLE TX peak | 335 mA @21 dBm | [V] |
| Active, Wi-Fi off, 240 MHz, dual core (Table 5-9) | "WAITI" idle: 32.9 mA (peripheral clocks off) or 47.6 mA (all on); dual core on 32-bit data access: 66.2 or 81.3 mA; dual core on 128-bit data access: 91.7 or 107.9 mA | [V] |
| Flash note | up to about 10 mA extra while accessing flash | [V] |
| Table 5-9 scope | The datasheet says chips with PSRAM "might be higher". | [V] |
| Octal PSRAM current | Light-sleep note lists 140 µA for 8 MB 8-line 3.3 V PSRAM. The active figure is not given. | [V] |
| Deep-sleep / light-sleep | 7 to 8 µA / 240 µA | [V] |
| Power-up timing | 3V3 must be stable at least 50 µs before EN goes high | [V] |

### Translators and ESD

| Part | Figure | Tag |
|---|---|---|
| SN74AVC4T245 static supply | ICCA+ICCB ≤ 16 µA max | [V] |
| SN74AVC4T245 Ioff | Supports partial power-down. | [V] |
| SN74AVC4T245 OE | Must be tied to VCCA with a pull-up so outputs stay Hi-Z through power up and down. | [V] |
| SN74AXC4T774 static | ICCB ≤ 18 µA | [V] |
| SN74AXC4T774 Ioff | Supports partial power-down. | [V] |
| PCA9306 | Passive FET switch with no supply pin. It loads the 3.3 V rail only through pull-ups. A 4.7 k pull-up held low draws about 0.6 mA, so 4 lines draw at most about 2.5 mA. | [A] |
| Dynamic translator current | CV²f arithmetic: 30 pF at 20 MHz SPI is about 2 mA per toggling line. Estimate 3 to 10 mA total on the 3.3 V side. The VTREF side is paid for by the target. | [A] |
| ESD arrays (USBLC6, TVS) | Leakage in µA, negligible. | [A] |

### Totals on the 3.3 V rail

| Case | S3 module | Translators | Pull-ups | LEDs (3 to 4 at ≤3 mA) | 3.3 V total |
|---|---|---|---|---|---|
| A. Wi-Fi and BT off, 240 MHz, PSRAM in use (default plan) | typical 70 to 100 mA, worst about 140 mA (108 mA table value + about 30 mA PSRAM, [A]) | 3 to 10 mA | up to 3 mA | 6 to 12 mA | typical about 100 mA, worst about 165 mA |
| A + FPGA (iCE40UP5K plus config flash, [A]) | same | same | same | same | add 25 to 60 mA, worst about 225 mA |
| B. Wi-Fi enabled, continuous TX (worst bound) | 340 mA + CPU/PSRAM about 60 to 90 mA [A] | same | same | same | about 430 to 480 mA peak; the margin to 500 mA is thin |

- Case B stays under the 500 mA the module wants only by a thin margin. Average Wi-Fi use is far lower (RX 88 mA, bursty TX), but a linear regulator passes the peak straight to VBUS (about 0.45 to 0.48 A at 5 V) [A].
- A buck at 85 to 90% efficiency turns 3.3 V × 0.47 A into about 0.33 to 0.36 A from VBUS [A].
- **Product decision:** Wi-Fi/BT stay disabled by firmware (USB is the transport). Case A is the design point. Case B is a compliance bound only, not a feature.

### Pre-enumeration (USB 2.0 and Type-C)

- USB 2.0 limits [D]: an unconfigured device draws at most 100 mA, a configured high-power device at most 500 mA (`bMaxPower`), and suspend is at most 2.5 mA. The Type-C 5.1 kΩ Rd pull-downs only identify a sink; a default-power source (Rp 56 kΩ) offers USB 2.0 levels. Re-read the USB 2.0 and Type-C specs before release.
- Boot-time draw is [A]: ROM, bootloader, flash and PSRAM init at 160 MHz with no RF is probably 60 to 100 mA. That is marginal against 100 mA. Measure it on the bench.
- Firmware must:
  1. Bring up USB first with a descriptor whose `bMaxPower` is the measured steady-state figure (for example 250, meaning 500 mA), before enabling anything else.
  2. Not start Wi-Fi or BT at all.
  3. Hold translators disabled until SET_CONFIGURATION. The OE pull-ups default them off.
  4. Hold LEDs, the FPGA (reset and unconfigured) and the target-facing buffers off until SET_CONFIGURATION.
  5. Drop the CPU to 80 MHz while unconfigured.
  6. Go to light-sleep on USB suspend. The 2.5 mA suspend limit cannot be met with an LD1117-class part. A 1117 draws milliamps of quiescent current (Digi-Key listing for LD1117S33 quotes 10 mA, [D]). LEDs and pull-ups also draw.
- If boot exceeds 100 mA, the only hardware fix is an enable-controlled supply the host cannot gate before enumeration. That is not possible with a bus-powered MCU. Accept and document, as most ESP32 boards do.

## 2. LD1117AS33TR (current draft, SOT-223)

LD1117A figures are [D] or [A] because the ST datasheet was unreachable (see source gap).

**Dissipation** P = (VBUS − 3.3 V) × I + Iq × VBUS. At 5.25 V the drop is 1.95 V.

| 3.3 V load | Pass-element power | Tag |
|---|---|---|
| 100 mA | 0.20 W | [A] |
| 165 mA (Case A worst) | 0.32 W | [A] |
| 300 mA | 0.59 W | [A] |
| 480 mA (Case B) | 0.94 W | [A] |

Add about 0.05 W for Iq if it is 10 mA [D].

**Thermal.** SOT-223 with the tab soldered to a GND/3V3 pour plus vias on a 4-layer 50×50 mm board has an assumed θJA of 45 to 65 °C/W [A]. ST's own figure was not read.
- Case A worst (0.37 W): ΔT is about 17 to 24 °C. At 40 °C ambient that is about 60 to 65 °C junction.
- Case B (0.94 W): ΔT is about 42 to 61 °C, so junction is 85 to 100 °C against ST's 125 °C limit [A, assumed].
- Heat is not the main problem. Dropout, quiescent current and RF-supply noise are.

**Dropout.** Dropout is about 1.2 V max at 800 mA for 3.3 V LD1117-family parts (Digi-Key LD1117S33TR listing, [D]).
- VBUS minimum is 4.75 V at a USB 2.0 high-power port [D]. A low-power port can be 4.4 V [D].
- Cable plus connector drop of 0.1 to 0.25 V and switch or fuse drop of 0.05 to 0.1 V gives about 4.4 to 4.6 V at the LDO input [A].
- Headroom to 3.3 V is then 1.1 to 1.3 V. That is exactly the dropout figure at hundreds of mA, so the output sags below 3.3 V under load. The module tolerates 3.0 V minimum [V], but this is thin and gets worse with Wi-Fi.

**Output capacitance and ESR.**
- BOM and manifest say 10 µF minimum effective, with no ESR window sourced.
- Older LD1117 parts need a bulk output capacitor with some ESR; an ST statement was not re-read [A].
- A 10 µF 0805 X5R at 3.3 V DC bias loses about 30 to 50% [A]. Use 22 µF (effective at least 10 µF), or a tantalum or polymer, and confirm the ESR window in the ST datasheet.

**Verdict:** the LD1117AS33 works for Case A, but it is a poor fit.
- It has the highest dissipation of the options, with no benefit.
- It has milliamp-level quiescent current, so it breaks the USB suspend budget.
- It has 1 V-class dropout at the VBUS minimum.
- It has unsourced ESR stability constraints.
- It has no enable pin and no reverse protection.

Ozdisan listing (page read 2026-10-14): LD1117AS33TR, in stock shown as 8,229, lead time 4 to 5 weeks, <https://www.ozdisan.com/p/lineer-voltaj-regulatorleri-279/stm-ld1117as33tr-535478>. [V] listing. No supplier SKU is shown on the page; the BOM SKU 535478 matches the URL suffix.

## 3. Alternatives

All "stock" cells come from the Ozdisan page text actually fetched. "Unknown" means no direct product page was found, never an inference.

| | TLV75733P (LDO) | AP2112K-3.3 (LDO) | TPS62162 3.3 V fixed (buck) |
|---|---|---|---|
| Vin range | 1.45 to 5.5 V [V] | 2.5 to 6 V (abs max 6.5 V) [V] | 3 to 17 V [V] |
| Iout | 1 A (limit 1.2 to 1.78 A) [V] | 600 mA min [V] | 1 A [V] |
| Dropout (3.3 V) | 300 mV typ, 425 mV max at 1 A (DBV); 450 mV max (DYD) [V] | 250 mV typ, 400 mV max at 600 mA [V] | none: 100% duty mode [V] |
| Quiescent current | 25 µA typ [V] | 55 µA typ, 0.01 µA standby [V] | 17 µA typ in power-save [V] |
| Noise / PSRR | 71.5 µVrms (1.2 V, 1 A, 10 Hz to 100 kHz); PSRR 46 dB at 100 kHz [V] | 50 µVrms; PSRR -65 dB at 100 Hz and 1 kHz [V] | 2.25 MHz switching with PFM ripple at light load; needs LC post-filter [A] |
| Efficiency | about 66 to 70% (3.3/4.75 to 3.3/5) | same | about 90% [D]; the curve was not read |
| Thermal | RθJA 60.3 °C/W (DYD), 92.5 °C/W (DBV) [V] | RθJA 184 °C/W (SOT25, no heatsink) [V] | negligible |
| Passives | 1 µF in, 1 µF out minimum; stable with 1 to 200 µF ceramic [V] | 1 µF X5R/X7R in and out [V] | 2.2 µH inductor, 22 µF out, 10 µF in |
| Part count | lowest (2 caps) | lowest | highest (inductor, 3 caps) |
| Ozdisan | Unknown: no product page found. Web search returned no Ozdisan page for TLV75733PDBVR or PDYDR. TLV76733DRVR (1 A, WSON-6): <https://www.ozdisan.com/en/p/linear-voltage-regulators-279/texas-tlv76733drvr-738599>, "In Stock: 0", lead time 5 to 6 weeks (not a drop-in; datasheet not read) | <https://www.ozdisan.com/en/p/linear-voltage-regulators-279/diodes-ap2112k-3-3trg1-588305>: "In Stock: 0", lead time 5 to 6 weeks [V page] | Unknown: no Ozdisan page found for TPS62162 or TLV62569 |

- **TLV75733P:** the best LDO fit. 1 A covers the 500 mA module requirement with margin. Dropout is about half that of the 1117, and Iq is about 25 µA. Heat is similar to the 1117. In SOT-23-5 (DBV) at 0.59 W (300 mA) the ΔT is about 54 °C at 92.5 °C/W, so use the DYD thermal-pad variant or a good copper pour [V/A]. The 3.3 V option's part number per Digi-Key and JLCPCB listings is TLV75733PDBVR (secondary, [D]). Input is 5.5 V maximum recommended, so a 5.25 V VBUS leaves little margin for spikes (see section 4).
- **AP2112K-3.3:** 600 mA is only just enough for Case B, and the SOT25 pad is thermally weak (184 °C/W). Cheapest, and the Ozdisan page is known, but stock is 0.
- **Buck (TPS62162 or the TLV62569 class):** only worth it if Wi-Fi is enabled (Case B), because it cuts VBUS current by about 25 to 30%. It costs an inductor and 2.25 MHz ripple that must stay out of the 3V3 RF supply. The TLV62569 (2.5 to 5.5 V, 2 A, adjustable, SOT-23-5, 1.5 MHz) was not datasheet-checked and needs feedback resistors [D]. Not selected.

## 4. VBUS input protection

| Topic | Finding | Tag |
|---|---|---|
| Inrush | USB 2.0 allows about 10 µF at attach; more requires inrush limiting. Keep total VBUS-side capacitance at 10 µF or less before any switch, or use a soft-start switch. | [D] (spec not re-read) |
| TPS2553 soft start | Output rise time 1.1 ms typ and 1.5 ms max (1 µF, 100 Ω, VIN 6.5 V). Inrush into 10 to 22 µF is about 50 to 100 mA. | [V] |
| TPS2553 abs max | -0.3 to 7 V on IN, OUT, EN, ILIM, FAULT. | [V] |
| TPS2553 reverse protection | The reverse-voltage comparator turns the FET off when OUT exceeds IN by 135 mV typ for 4 ms typ, and asserts FAULT. | [V] |
| TPS2553 current limit | Adjustable 75 mA to 1.7 A via RILIM (15 to 232 kΩ); ±6% accuracy at high settings; rDS(on) about 85 mΩ. | [V] |
| TPS2553 UVLO | Rising threshold 2.35 to 2.45 V. | [V] |
| TPS2553 supply range | 2.5 to 6.5 V. | [V] |
| TPS25921 | 4.5 to 18 V operating, 20 V max; has OVP/UVLO and dV/dt control. The 4.5 V minimum is too close to the USB 4.4 to 4.75 V minimum, so a UVLO trip is likely. Not recommended. | [V] |
| TPS2595 (TPS2595x5 variants) | 2.7 to 18 V, 20 V abs max, fast overvoltage clamp (5.7 V option), rated to 4 A. Useful if a hot-unplug surge on VBUS must be clamped below 7 V. Overkill and Ozdisan availability unknown. | [V] datasheet; stock unknown |
| Polyfuse alternative | Cheap and needs no IC. It gives no reverse protection, no controlled inrush and no overvoltage protection, and its hold and trip current drifts with temperature. It is a single point of failure for sustained faults but is acceptable if the load is fixed. | [A] |

- **TPS2553 abs max problem:** a conventional 5 V standoff TVS on VBUS clamps to roughly 9 V or more at surge current, which exceeds 7 V on TPS2553 IN. A TVS can only protect it if its clamp stays below 7 V at the expected current. Choose a low-clamp part, or use TPS2595x5 (20 V abs max) instead. This is an open item.
- **Backfeed (target VTREF present, USB unplugged):**
  - The tree must never connect VTREF to +3V3. VTREF only reaches translator VCCB pins and the target-side pull-ups.
  - Translator Ioff partial-power-down behavior (VCCA = 0 V, VCCB = VTREF) is [V]: ICCB ≤ 8 µA for the AVC4T245 and ≤ 18 µA for the AXC4T774.
  - The AVC4T245 OE must be pulled up to VCCA so its outputs stay Hi-Z during power-up and power-down [V].
  - Verify on the bench that the A-side ESP32 pins do not back-power 3V3 through ESD diodes.
  - PCA9306 is passive. Its EN pin must be pulled low or to VCCA so a powered VREF2 side cannot back-feed through the pass FET. Its EN/bias network needs separate review.
  - TPS2553 reverse protection covers VBUS only, so a target that drives VBUS (not expected) would be blocked.

## 5. Optional FPGA

FPGA rails below come from memory, not datasheet reading, and are [A]. Check them in the Lattice datasheet before schematic release.

- **iCE40UP5K:** 1.2 V core and PLL (VCC, VCCPLL), VCCIO banks at 1.8 to 3.3 V, VCC_SPI for the configuration flash (1.8 to 3.3 V), and a VPP_2V5 pin (verify whether it may be tied to 3.3 V). Sequencing is relaxed, but VCC_SPI must be valid before configuration and the 3V3 rail should come up before the FPGA is released from reset.
- **ECP5:** 1.1 V core, 2.5 V VCCAUX and VCCIO banks, with a sequencing recommendation. Current is in the hundreds of mA, so a buck is required. It is considerably more power-tree work and is not recommended unless needed.
- **Simplest compliant power tree for the UP5K option:**
  - Add a second 1.2 V LDO fed from +3V3. The TLV757P family offers 1.2 V (0.6 to 5 V in 50 mV steps) [V]. At 50 mA and 2.1 V drop that dissipates about 0.1 W, which is fine.
  - Release the FPGA reset (or config pin) only after SET_CONFIGURATION, which also keeps pre-enumeration current within 100 mA.
  - Budget +25 to 60 mA in Case A [A].
- **Extra PSRAM:** only if the FPGA needs it. N8R8 reserves IO35 to IO37 and pads 28 to 30 are unavailable [V from BOM note]. Expect 8 to 20 mA for a small SPI PSRAM [A].

## Recommendation

One power tree, all parts within a single 3.3 V rail:

| Stage | Part | Note |
|---|---|---|
| Input limit and reverse protection | **TPS2553DBVR** | Ozdisan <https://www.ozdisan.com/en/p/power-switches-283/texas-tps2553dbvr-607422>: "In Stock: 340" as seen 2026-10-14 [V page]. RILIM about 600 to 700 mA limit. Drives FAULT to the MCU. |
| Input spike protection | low-clamp TVS (clamp below 7 V) to be chosen | Open item. Alternative: swap TPS2553 for TPS2595x5. |
| 3.3 V regulator | **TLV75733PDBVR** (SOT-23-5, 1 A) or the DYD variant | 1 µF to 10 µF in and out. Stock unknown at Ozdisan. Fallback AP2112K-3.3TRG1 (stock 0, lead time 5 to 6 weeks) for Wi-Fi-off use only. |
| Module and translators | ESP32-S3-WROOM-1-N8R8, SN74AVC4T245PWR, SN74AXC4T774RSVR, PCA9306DCTR | VCCB and VTREF stay isolated from 3V3. |
| Optional FPGA rail | TLV75712P-class 1.2 V LDO from +3V3 | Only if an iCE40UP5K is added. |

Decision rationale:
- Replace LD1117AS33TR: 1.95 V × load worth of heat, milliamp-class Iq, and about 1.1 V dropout at the USB minimum.
- A TLV757P-class LDO has far lower dropout, about 25 µA Iq, and a 1 A rating, with a simpler output-capacitor requirement.
- Keep Wi-Fi off. If it is ever enabled, move to a buck, because a linear regulator would need nearly the whole 500 mA budget from VBUS.

## Open questions / bench tests

1. Read the ST LD1117A datasheet (dropout vs current, ESR, Rθ) before deciding to keep it. Re-read the USB 2.0 and Type-C power clauses.
2. Measure boot current of N8R8 with Wi-Fi off, plus flash and PSRAM init, against the 100 mA limit (use a USB power meter or shunt at 5 mV/mA or better).
3. Measure steady-state 3.3 V current in Case A with all translators toggling, and suspend current with light-sleep.
4. Measure VBUS at the board input with a worst-case cable at 0.3 to 0.5 A, and 3V3 sag if an LDO is kept.
5. Check ripple and noise on 3V3 near the RF section (scope, 20 MHz BW).
6. Choose a VBUS TVS whose clamp is below 7 V (TPS2553) or confirm the TPS2595x5 alternative. Confirm Ozdisan availability for the chosen regulator (TLV75733P stock unknown) and for TPS2595.
7. Bench-test VTREF-powered, USB-unplugged backfeed into 3V3 and the ESP32 pins; confirm the PCA9306 EN/bias network.
8. Confirm FPGA rails, VPP_2V5 range and sequencing in the Lattice datasheet if the UP5K option is pursued.
