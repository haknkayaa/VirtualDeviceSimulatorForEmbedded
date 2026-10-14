# Independent electrical review — sch0.1

2026-10-14 · Reviewed `cad/schematic/design.py` (`F-sch0.1`), pin allocation, schematic README/PDF and the seven requested research notes. Manufacturer PDFs below were downloaded and read independently. **Do not release this revision for fabrication.** No bench measurements, ERC rerun, application tests or host conformance tests were performed.

**VERIFIED** = connection, rating or calculation supported by the pin map and cited manufacturer document; it does not mean bench validated. **ASSUMPTION** = plausible behavior or an unclosed design guarantee. Calculations are nominal unless stated otherwise. Source abbreviations link directly to manufacturer documents in the final section.

## Findings, sorted by severity

| Severity / status | Ref / pins | Problem | Evidence (manufacturer URL via source link + section) | Concrete fix in `design.py` terms |
|---|---|---|---|---|
| **BLOCKER · VERIFIED** | D11; U14.2 EN; C1 | The stated SMAJ24A surge protection is not coordinated: its 38.9 V clamp exceeds EN's **35 V absolute maximum** and C1's **35 V** rating. VIN's 40 V/400 ms exception does **not** extend to EN. This is a surge-rating failure, not a claim that ordinary 24 V DC damages the board. | [TVS], electrical-characteristics row SMAJ24A; [BUCK], Absolute Maximum Ratings, p.4. | Replace D11/front end with a quantitatively coordinated clamp or surge cutoff that stays within every downstream rating at the specified pulse; change C1 to an exact 50 V part. Separate U14.2 from `VBUS` and add a rated EN divider/clamp, or use the documented floating-EN startup option after review. Review F1's 30 V interrupt rating against that same fault envelope. |
| **BLOCKER · VERIFIED** | U15.5 OVP; R18/R19 | OVP divider gives `0.19936 × VBUS`: **4.785 V at 24 V**, above the 4 V recommended pin range; **7.755 V at 38.9 V**, above the **5 V absolute maximum**. The 60 V IN rating does not protect OVP. | [EFUSE] §§7.1, 7.3, 9.3.2. | Add a low-leakage clamp on `AUX5_OVP` keeping it below 4 V over the input-fault envelope, retaining the 1.19 V trip accuracy; or redesign the sensing/protection stage. Select actual clamp MPN and include leakage/tolerance in R18/R19 calculations. |
| **MAJOR · VERIFIED** | U21.4; R42–R44/C47 | Fast comparator reads the **same filtered node** as the ADC. R44=1 kΩ does not isolate C47 from `VTREF_DIV`: time constant ≈23.6 ms. After an ideal 3.3→0 V VTREF step, `VTREF_BAD` remains low for ≈**18 ms** (≈4 ms from 1.8 V). Hardware isolation therefore lags loss of target power. | [CMP] §7.4.1 and §6.8; pin map R42/R43=470 kΩ, R44=1 kΩ, C47=100 nF. Derived RC response. | Give U21.4 its own divider from VTREF (e.g. a separate 47 kΩ/47 kΩ pair on `VTREF_CMP`); retain R42/R43/R44/C47 solely for ADC filtering. Specify maximum shutdown latency and keep comparator filtering small enough to meet it. |
| **MAJOR · VERIFIED** | U8/U9.7–8; R47–R50/C49/C51 | At VTREF=3.3 V, EN/VREF2 is approximately **3.0 V**, not VREF1=3.3 V. This meets neither documented translation headroom nor the documented equal-reference switch topology. Existing research's equal-rail justification incorrectly treats the present wiring as Figure 8-5. Passing lows may work, but full-range conformance is unproven. The 10 nF capacitors also make disable slow: τ≈1.83 ms; 3→0.6 V takes ≈2.95 ms. | [I2C] §6.3 note 1, §8.1.5 Figures 8-5/8-6, §8.4 function-table note 1, §10. | Replace U8/U9 and their bias networks with translators explicitly supporting 1.8/3.3 V **and equal rails**, with enable and powered-off isolation; alternatively create separately selected, datasheet-correct translation/switch networks. Add an active EN discharge and reduce C49/C51 against a defined shutdown budget. Do not simply hardwire EN high or VREF2 to a higher supply. |
| **MAJOR · ASSUMPTION** | U17.3; U3.29; R30/C34/C35 | ON senses **core only**, not filtered VCCPLL. VCCPLL lags through 100 Ω ×4.8 µF≈0.48 ms. TPS22917's 1.0 V VIH is a guaranteed-high level, **not a guaranteed 1.0 V turn-on threshold**; ON may switch in the undefined 0.35–1.0 V region. No worst-case proof establishes VCCPLL≥0.5 V before FPGA_3V3 starts. | [SW] §§7.3, 7.6, Figure 7-5; [LAT-H] §2.3; [LAT-D] §4.5. | Replace direct `U17.nets['3']=F12` with `FPGA_RAILS_OK` from a supervisor/sequencer checking core **and PLL**. Preserve C64 from CT to VIN and QOD to VOUT; specify/review thresholds, startup and partial-restart timing. |
| **MAJOR · ASSUMPTION** | R39/R40; U3.46/.12; U6/U10/U11/U13 A-side; U1 configuration link | FPGA bank supplies are switched, but R39/R40 pull FPGA-connected pins to unswitched +3V3. Armed translators and an independently resetting MCU can also drive an unpowered FPGA. Reset is not electrical isolation; the referenced documents do not establish a zero-backfeed guarantee for these paths. | [LAT-H] §2.3; [LAT-D] §§4.1, 4.5–4.6; [AVC] §7.4 (enabled outputs); actual pin map. | Move R39/R40 upper terminals to F3; their gate outputs already have separate +3V3 pulls R36/R37. Gate translator enables with FPGA power-good and isolate/sequence MCU→FPGA signals across partial-rail restart. Require firmware to hold config outputs safe until rail-good; add hardware isolation where that cannot be guaranteed. |
| **MAJOR · VERIFIED** | D8.4 VTREF; R41; U6/U7/U10.2, U11/U13.13 | TPD4E05U06 is a **5.5 V standoff / ≥6.5 V breakdown** ESD part, not VTREF overvoltage protection. A mistaken 5 V VTREF reaches translator supplies almost directly through 10 Ω; AVC/AXC supply absolute maxima are 4.6/4.2 V. Low-only comparator cannot prevent this. Its ≈10 V clamp at 1 A also does not alone prove downstream signal-pin survival. | [ESD4] §§5.1, 5.3, 6.3.5–6.3.7; [AVC]/[AXC] §5.1. | Add a precision VTREF overvoltage disconnect/clamp before `VTREF_IO`, with worst-case limit below translator supply maxima and adequate normal 3.6 V margin. Keep ESD protection separately; review signal clamps/series resistance against specified residual pulse current rather than calling D6–D10 complete protection. |
| **MAJOR · ASSUMPTION** | U1.39; R42/R43/R44 | With +3V3 absent and target powered, ADC is outside its documented powered operating conditions. Divider limits possible pad-injection current to ≈7 µA at 3.3 V (≈5.7 µA assuming a 0.3 V pad clamp), not zero; the research estimate of ≈3 µA is not a worst-case bound. Rail rise depends on unknown off-state loads. U21 itself has fault-tolerant inputs and is not the identified positive-rail backfeed path. | [ESP] §6.3 (input range tied to VDD); [CMP] §7.4.1 (inputs isolated from VCC); resistor network. | Disconnect `VTREF_ADC` from U1 with a powered-off-protected analog switch/buffer, or implement and substantiate an injection/rail-bleed design. Do not describe the existing network as “clamped”: no separate clamp exists. |
| **MAJOR · ASSUMPTION** | L1/F1; U1/U14; auxiliary loads | “225 mA worst” is unsupported for this module: Espressif requires a supply capable of ≥0.5 A and documents Wi-Fi TX currents above 225 mA. Two accessory outputs plus board load can exceed F1's 0.5 A hold at 5 V input. L1's `Isat>=1A` placeholder has no exact saturation/DC-bias evidence. | [ESP] §6.2 Table 6-2, §6.4.1 Table 6-4; [BUCK] §10, equations 7–8. | Replace L1 candidate with an exact reviewed part; calculate peak current over 5–24 V including full enabled loads. Add a source/current budget to the aux notes and enforce it through enable policy; revise F1 only after USB/source, cable and fault-current review. |
| **MINOR · VERIFIED** | U4.8/C42; U22.8/C63; U17.1 | PSRAM has only 100 nF per footprint, omitting the recommended local 1 µF. U17 has no explicitly dedicated input bypass; other +3V3 capacitors do not establish close placement. | [RAM] §16.4; [SW] §11. | Add `C(new,'1u',F3)` at each populated PSRAM and `C(new,'1u',V3)` at U17.1; DNP the U22-specific capacitor with U22. Retain 100 nF caps. |
| **MINOR · VERIFIED** | U3.1/.22/.24/.33/.5/.30; C31–C40 | Four 100 nF caps cover the four F3 supply pins, but a single 4.7 µF C36 does not implement the checklist's **4.7 µF +100 nF per pin** recommendation. Core also shares one 4.7 µF between two pins. The 100 nF core/PLL cap counts and PLL bulk are present; placement is unverified. | [LAT-H] §2.1 Table 2.2, §7 PCB decoupling guidance. | Add three F3 and one F12 4.7 µF capacitors; annotate each bulk/100 nF pair with its U3 pad assignment. Retain the PLL filter. |
| **MINOR · VERIFIED** | U15.6; R25 DNP; U16.5/R26 | R25 is named `0R DNP` but **`dnp=True` is absent**. Assembly export can populate it and silently change U15 from circuit breaker to continuous current limiting. “300 mA” is nominal, not a guaranteed accessory rating. | [EFUSE] §9.3.5.1 Table 1; [USB-SW] §10.2.1.2 current-limit equations. | Set R25 `.dnp=True` (and an unambiguous value); document whether circuit-breaker or current-limit behavior is intended. State U16 nominal ≈300 mA, calculated ≈265–339 mA before resistor tolerance; rate accessory load below minimum limit. |
| **MINOR · VERIFIED** | J10; TP1–TP5 | DIRECT array omits **both UART nets**; UART is available only on J3. Dedicated power/sequence/enable probe pads are also missing. | [AVC] Table 4-1 (U10 UART paths); [LAT-H] §§2.3, 3 Table 3.1; `DIRECT`, `PI`, `TP()` maps. | If J10 promises every target bus, extend/reallocate it to include `UART_TXD_TGT` and `UART_RXD_TGT`. Add TP calls for VTREF/VTREF_IO, FPGA_1V2/VCCPLL/F3, CDONE/reset, PORT_GATE_N, VTREF_BAD and both I2C EN nodes. |
| **MINOR · VERIFIED** | U8/U9 SCL1/SDA1; translator group notes | Notes claim target pull-ups are DNP, but there are **no target pull-up parts or jumpers** in the source. Operation therefore depends entirely on the attached target providing them; bare fixtures cannot select them. | [I2C] §8.3.2 (pull-ups on both bus sides), §9.2.2.2. | Add four optional `R(new,'4k7','VTREF_IO',I2Cn_line_TGT)` parts with `.dnp=True` and/or selection jumpers; document total parallel resistance/current with target pull-ups. Keep R51–R54 on +3V3. |
| **NOTE · ASSUMPTION** | J1 CC1/CC2; J6; Y1 | CC lines have no external ESD protection; OLED contact orientation and exact oscillator identity/land pattern remain unclosed. These are not resolved by a correct electrical net map. | [GCT] USB4105 contact table/drawing; [ESD2] Pin Functions (D1 protects only DP/DN); `oled-panel.md` / `fpga-support-parts.md` manufacturer-identification caveats. | Add suitable CC protection if required by the connector ESD target; set J6/Y1 exact `datasheet` and `footprint` only after panel-tail/contact-side and oscillator ordering-code confirmation. No VERIFIED OLED/oscillator release claim is made here. |

## Logic, reset and power-state checks

**VERIFIED** ([OR]/[NOR], Pin Functions and §8.4 Table 1): U18/U19/U20 use the correct DCU pads: inputs 1/2→output 7, inputs 5/6→output 3; supply 8, ground 4.

`G=PORT_OE_N OR VTREF_BAD`; `UART_OE_HW_N=UART_OE_N OR G`; `GPIO_OE_HW_N=GPIO_OE_N OR G`; `MISO_OE_HW_N=T_MISO_OE_N OR G`; `I2Cn_EN_DRV=NOT(I2Cn_OFF OR G)`.

| G | Per-port `_OE_N` / `I2Cn_OFF` | Push-pull OE output (OR) | I2C drive output (NOR) |
|---|---|---|---|
| 0 | 0 | 0, enabled | 1, requests enable |
| 0 | 1 | 1, isolated | 0, requests disable |
| 1 | 0 | 1, isolated | 0, requests disable |
| 1 | 1 | 1, isolated | 0, requests disable |

U6 enables depend on G alone. Analog I2C EN nodes follow **after RC delay**, not instantaneously.

**VERIFIED** ([AVC] Table 4-1 RSV column, §7.4 Table 7-1; [AXC] Table 4-1 RSV column, §7.4 Table 7-1):

| Part | OE / DIR pads and actual mapping | Result |
|---|---|---|
| U6 | OE1=1/OE2=16→G; DIR1=4/DIR2=5→GND; A=6/7/8/9, corresponding B=15/14/13/12 | Both banks target→FPGA when enabled; correct. |
| U7 | OE1=1→MISO gate; DIR1=4→+3V3; A6→B15. OE2=16→+3V3, DIR2=5→GND | MISO FPGA→target; unused bank disabled, B12/B13 grounded and A8/A9 NC; correct. Unused A7 grounded/B14 NC. |
| U10 | OE1=1/OE2=16→UART gate; DIR1=4→+3V3, DIR2=5→GND | TX A6→B15; RX B13→A8; unused inputs A7/B12 grounded, outputs B14/A9 NC; correct. |
| U11/U13 | OE7→GPIO gate; DIR1/2/3/4=15/16/5/6, 10 kΩ down; A1/2/3/4↔B12/11/10/9 | DIR=0 target→FPGA, DIR=1 FPGA→target; OE=1 isolates all four. Correct. |

All AVC VCCA3/VCCB2/GND10+11 and AXC VCCA14/VCCB13/GND8 maps are correct; controls reference VCCA. One 100 nF per supply per translator is present. No unused AVC input is inadvertently an enabled output shorted to ground. AXC integrates weak data pulldowns ([AXC] §7.3.9); active-mode UART TX/MISO A inputs still require defined upstream drive before enabling.

**VERIFIED under the requested high-Z reset premise:** R7–R10/R39/R40 pull isolate requests high; R65–R72 pull directions low; R22/R27 turn accessories off; R5 holds FPGA reset. Thus settled, powered logic isolates all ports. This is not proof for every ROM/JTAG pin state or rail ramp. TLV7011 POR drives `VTREF_BAD` **low**, not high ([CMP] §7.4); startup isolation relies on PORT_OE_N and OE pulls until the comparator settles.

**VTREF absent, +3V3 present:** after settling, U21 drives BAD high, NOR gates discharge EN, AVC isolates with VCCB=0 ([AVC] §7.3.3 and device description), AXC isolates below 100 mV ([AXC] §§7.3.3–7.3.4). **+3V3 absent, target present:** AVC/AXC provide specified partial-power-down isolation; U21 inputs remain high impedance. PCA9306 EN is pulled down through 2.2 MΩ, but transitions, residual capacitor charge and leakage require qualification; do not claim zero current. PCA bias current flows into VREF1 when enabled ([I2C] §§8.1.7–8.1.8). ADC and FPGA paths are findings above.

## Other checked circuits

- **VERIFIED — U21 polarity/threshold:** DBV OUT1/GND2/IN+3/IN−4/VCC5 matches [CMP] Pin Functions. `IN+=3.3×30/130=0.7615 V`; `IN−=VTREF/2`; BAD is high below **1.523 V nominal**. Internal hysteresis is 4.2 mV typical, **8.4 mV referred to VTREF**, not 20 mV. With 1% resistor extremes, ±8 mV offset and maximum 14 mV hysteresis, trips are approximately **1.455–1.593 V at exactly 3.3 V**, additionally scaling with supply tolerance ([CMP] §6.8). ADC nominal is 0.9/1.65/1.8 V for 1.8/3.3/3.6 V VTREF; divider input load is ≈1.9/3.5/3.8 µA. Acquisition accuracy requires ADC characterization; passive scaling alone does not verify it.
- **VERIFIED — U14:** FB1→+3V3, EN2/VIN3→VBUS, GND4, SW5 and BST6 with 100 nF C4 to SW are correct for fixed 3.3 V ([BUCK] Pin Descriptions, typical fixed-output circuit, §§8–9). Keep FB on quiet output copper. Surge exceptions are above.
- **VERIFIED — U15:** HTSSOP IN1/2, UVLO3, OVP5, MODE6, SHDN7, RTN8, GND9, IMON10, ILIM11, dVdT12, FLT14, OUT15/16 and thermal pad→RTN are correctly mapped; NC4/13 correct. RTN tied to GND is acceptable for this positive-input design, but forfeits reverse-input protection ([EFUSE] Pin Functions, §§9.3.3, 9.3.5.5). UVLO nominal rising/falling **4.372/4.041 V**; OVP **5.969/5.518 V**. Including resistor and comparator extremes, rising UVLO≈**4.25–4.57 V**, OVP≈**5.78–6.24 V**, excluding input leakage. Thus `5V_OUT` is an unregulated switched VBUS and can approach 6 V: label its allowed accessory range. R21 gives **12/39=0.308 A nominal**; MODE open means circuit breaker with auto-retry, not a guaranteed continuous 308 mA limiter. C23=10 nF gives ≈11.56 V/ms nominal output slew, ≈0.43 ms to 5 V. R22 can sink the specified SHDN current and establishes off; 3.3 V establishes on ([EFUSE] §7.5, §§9.3.4–9.3.5.7).
- **VERIFIED — U16/U5/U17:** TPS2553 DBV pins 1–6 IN/GND/EN/FAULT/ILIM/OUT match; EN active high, R27 defaults off; reverse protection has a finite trip/delay ([USB-SW] §6, §9.3.2). TLV75712 DBV IN1/GND2/EN3/NC4/OUT5 is correct with C30/C31, subject to effective capacitance >0.47 µF ([LDO] Table 4-1, §7.1.1). TPS22917 VIN1/GND2/ON3/CT4/QOD5/VOUT6 is correct; C64 to VIN and QOD tied to VOUT are explicitly allowed. 1 nF implies roughly 1.8 V/ms typical, **not a min/max ramp guarantee** ([SW] Table 6-1, §§7.6, 9.3.2–9.3.3).
- **VERIFIED — FPGA supplies/config:** U3 core5/30→1.2 V, PLL29 through R30 with C34/C35, banks1/22/33 and VPP24→F3, paddle49→GND are consistent with [LAT-D] §5.2 and [LAT-H] Tables 2.1–2.2. VPP=3.3 V is permitted for SPI configuration/RGB, **not NVCM programming**; shared VPP/SPI rail is permitted ([LAT-D] §4.2, Figure 4.2). R13=2.2 kΩ CDONE pull-up, R32=10 kΩ SPI_SS pulldown for target mode and R33=10 kΩ SCK pull-up agree with [LAT-H] Table 3.1; CDONE value still depends on clock/capacitance. CRESET pulldown intentionally replaces the checklist pull-up to hold reset; MCU must actively release only after all rails are valid and reset timing is met ([LAT-D] §4.6). Add this requirement to FPGA notes. RAM startup must keep CS high/CLK low for ≥150 µs and issue reset ([RAM] §8); no external PSRAM clock pulldown is present—add one if FPGA startup behavior cannot guarantee low.
- **VERIFIED — ESP32 module pads:** [ESP] Table 3-1 matches every U1 entry: `GPIO:pad` = 0:27, 1:39, 2:38, 4:4, 5:5, 6:6, 7:7, 8:12, 9:17, 10:18, 11:19, 12:20, 13:21, 14:22, 15:8, 16:9, 17:10, 18:11, 19:13, 20:14, 21:23, 38:31, 39:32, 40:33, 41:34, 42:35, 43:37, 44:36, 47:24, 48:25. GND1/40/41, supply2, EN3 correct. NC15/16/26 are straps GPIO3/46/45; NC28–30 reserve N8R8 PSRAM GPIO35–37. BOOT GPIO0 pull-up/button and EN 10 kΩ/1 µF match §§4, 9. USB D− pad13/GPIO19 and D+ pad14/GPIO20 are correct. No swapped pad numbers found.
- **VERIFIED — USB/ESD maps:** [GCT] USB4105 contact table matches J1 VBUS/GND, separate A5/B5 CC resistors, paired A6/B6 D+ and A7/B7 D−; SBU NC and grounded shield are explicit. Rd=5.1 kΩ is consistent with the specified non-PD sink topology; source-current detection is absent. D1 DRL IO3/5/GND4, NC1/2 agrees with [ESD2] Pin Functions. D6–D10 DQA signal1/2/4/5 and GND3/8 agree with [ESD4] Table 4-2. NC6/7/9/10 are **not internally connected** flow-through pairs: route copper continuously to the protected pads; if opposite pads carry the same trace, assign their same nets in `esd()` rather than `nc` before PCB routing. No ESD die has a VBUS/+3V3 reference pin. Placement/return-path effectiveness is not established by this schematic review.

Antigravity CLI was attempted as required by AGENTS.md, with no write scope delegated. Persistent read-only filesystem errors prevented a completed result/read-only MCP connectivity proof; it was stopped. No delegated claim is used as electrical evidence.

## Manufacturer documents read

- [OR] — SCES201N.
- [NOR] — SCES194N.
- [AVC] — SCES576I.
- [AXC] — SCES898C.
- [I2C] — SCPS113O.
- [CMP] — SLVSDM5F.
- [BUCK] — DS41326 rev.3-2.
- [EFUSE] — SLVSDG2G.
- [USB-SW] — SLVS841F.
- [SW] — SLVSDW8B.
- [LDO] — SBVS322C.
- [LAT-H] — FPGA-TN-02006-2.4.
- [LAT-D] — FPGA-DS-02008-2.4.
- [ESP] — module datasheet v1.8.
- [GCT] — USB4105 manufacturer drawing/contact table.
- [ESD2] — SLLSEG9C.
- [ESD4] — SLVSBO7O.
- [TVS] — AOS SMAJ family, electrical-characteristics table. D11 has no manufacturer-specific ordering code; this establishes the cited AOS variant only.
- [RAM] — APS6404L-3SQR rev.2.7.

[OR]: https://www.ti.com/lit/ds/symlink/sn74lvc2g32.pdf
[NOR]: https://www.ti.com/lit/ds/symlink/sn74lvc2g02.pdf
[AVC]: https://www.ti.com/lit/ds/symlink/sn74avc4t245.pdf
[AXC]: https://www.ti.com/lit/ds/symlink/sn74axc4t774.pdf
[I2C]: https://www.ti.com/lit/ds/symlink/pca9306.pdf
[CMP]: https://www.ti.com/lit/ds/symlink/tlv7011.pdf
[BUCK]: https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf
[EFUSE]: https://www.ti.com/lit/ds/symlink/tps2660.pdf
[USB-SW]: https://www.ti.com/lit/ds/symlink/tps2553.pdf
[SW]: https://www.ti.com/lit/ds/symlink/tps22917.pdf
[LDO]: https://www.ti.com/lit/ds/symlink/tlv757p.pdf
[LAT-H]: https://www.latticesemi.com/view_document?document_id=47779
[LAT-D]: https://www.latticesemi.com/view_document?document_id=51968
[ESP]: https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf
[GCT]: https://gct.co/files/drawings/usb4105.pdf
[ESD2]: https://www.ti.com/lit/ds/symlink/tpd2e2u06.pdf
[ESD4]: https://www.ti.com/lit/ds/symlink/tpd4e05u06.pdf
[TVS]: https://www.aosmd.com/sites/default/files/res/datasheets/SMAJ78A.pdf
[RAM]: https://www.apmemory.com/cn/downloadFiles/032411212009597427
