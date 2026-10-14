# TASK S — I2C translator replacement

2026-10-14. **Recommendation (ASSUMPTION / engineering selection): NXP PCA9617ADP,118, two devices, replacing U8/U9.** Target = port A; MCU = port B. The recommendation is electrically documented, **not bench validated or fabrication released**. Tables use **V = VERIFIED** (manufacturer document and section cited), **A = ASSUMPTION** (integration judgement or missing guarantee). Supplier observations are separately identified; they are not electrical evidence.

## 1. Supply and enable comparison

Voltages are recommended operating ranges, not absolute maxima. “Equal” means both sides at 3.3 V. Unless noted, proposed orientation is A = `VTREF_IO`, B = `+3V3`.

| Part / evidence | VCCA / VCCB or reference ranges | Equal / entire 1.65–3.6 V target range | Enable and reference rail | Decision |
|---|---|---|---|---|
| **V: TI TCA9800 / TCA9801 / TCA9802**, [9800] / [9801] / [9802] §§6, 7.3, 7.5, 11 | A 0.8–3.6 V; B 1.65–3.6 V; A may be above, below or equal to B | Yes / yes | Active-high EN, referenced and internally pulled up to **A** (150–450 kΩ). EN operating input range 0–3.6 V; VIH ≥0.7×A, VIL ≤0.3×A. Thus nominal 3.3 V gate high clears VIH at A=3.6 V. | **A: viable alternative**, with target on A and MCU on B; remove R51–R54 and MCU internal pull-ups. EN powered-off injection needs separate review: bus-pin back-power protection is not an EN-pin Ioff specification. |
| **V: TI TCA9517**, [9517] §§7.3–7.5, 9.3, 10.2.1, 11 | A 0.9–5.5 V; B 2.7–5.5 V | Yes; current datasheet design requirements omit A<B (revision history explicitly records removal). TI product selector still says A≤B. | Active-high EN, internal pull-up to **B**; VIH ≥0.7×B; VIL ≤0.3×B; inputs tolerant to 5.5 V | **A: possible**, but resolve conflicting TI supply guidance for target 3.6 V > MCU 3.3 V before selecting. |
| **V: TI TCA9517A**, [9517A] §§4, 5.3–5.5, 7.1, 7.3, 8.2.1, 9 | A 0.9–5.5 V; B 2.7–5.5 V | Yes; datasheet §8.2.1 omits A≤B, while TI product selector lists it | Active-high EN, internal pull-up to **B**; VIH ≥0.7×B; VIL ≤0.3×B; 5.5 V tolerant | **A: strong alternate**, existing library symbol; same supply-guidance discrepancy as above. Higher B contention threshold than TCA9517. |
| **V: NXP PCA9517**, [P9517] §§2, 6, 9 | A 0.9–5.5 V; B 2.7–5.5 V; no A<B restriction in listed operating limits | Yes / ranges cover full target range | Active-high EN, internal pull-up and thresholds referenced to **B**, VIH ≥0.7×B, VIL ≤0.3×B | **A: viable 400 kHz alternative**, with B-side low/handoff qualification. Do not silently substitute PCA9517A for PCA9517. |
| **V: NXP PCA9617A**, [P9617] §§2, 5, 6, 9 Table 5 | A 0.8–5.5 V; B 2.2–5.5 V; **0.4×A+0.8 V ≤ B** | **Yes / yes:** at A=3.6 V, required B≥2.24 V; fixed 3.3 V satisfies it | Active-high EN, internal pull-up to **B**; VIH ≥0.7×B, VIL ≤0.3×B; 5.5 V tolerant, including either rail off | **A: selected**; explicitly documented full-range supply relationship, independent gate input, existing two-sided pull-ups retained. |
| **V: TI TCA9406**, [9406] §§3, 6.3, 8 | A 1.65–3.6 V; B 2.3–5.5 V; **A≤B** | Yes / **no**: A=3.6 with B=3.3 fails; reversed orientation fails at target 1.65 V | Active-high **OE**, referenced to A but **5.5 V tolerant**; VIH ≥0.65×A, VIL ≤0.35×A | **A: reject for full envelope**, despite small package and equal-rail support. |
| **V: TI LSF0102**, [LSF2] §§5.3, 7.3, 8.2.1.1, 8.2.4, 8.3 | Pin limits 0–5.5 V; translation reference A≥0.9 V, B normally ≥A+0.8 V, up to 5.5 V. §7.3.1 describes A≥0.95 V | **No documented equal-reference translation**; reduced-headroom exception still requires B>A | EN tied to **refB**, biased through typically 200 kΩ; disable with open-drain sink. Not an independent push-pull gate input | **A: reject as direct replacement**: reproduces bias/headroom problem. A separate lower reference/higher bias supply would require another circuit review. |
| **V: TI LSF0204**, [LSF4] §§3, 5, 7.3–7.5, 9.3.5, 10.2.1.1.1 | Functional A 0.8–4.5 V; B 1.8–5.5 V; application guideline B≥A+0.8 V | Equal operating rails do not satisfy specified reference headroom | Active-high EN referenced to **refA**; input operation 0–refA; VIH ≥0.7×refA at 1.5–4.5 V. LSF0204D reverses polarity | **A: reject for existing rails/control**; four channels do not remove reference-headroom constraint. |
| **V: Nexperia NCA9306**, [NCA] §§1, 4, 7–12, Fig. 2 | Translation examples 0.95–5 V; recommended pin voltages 0–5 V. refA is low-side reference; refB/EN test circuit uses 200 kΩ bias | **A: equal-rail/full-envelope fit unproven**; generic pin-voltage limits are not proof of proper translation bias | Active-high EN; Fig. 2 ties EN/refB together. No independently specified MCU-referenced digital EN VIH/VIL in this document | **A: reject without application evidence**. This is **Nexperia**, not NXP or onsemi; NovoSense also uses this part name, so manufacturer matters. |
| **V: onsemi NLSX4373**, [NLSX] pp.1, 3–5, 9 | VL and VCC each 1.5–5.5 V; either may exceed the other | Yes / supply ranges cover full envelope | Active-high EN referenced to **VL**, overvoltage tolerant; VIH ≥VL−0.2 V, VIL ≤0.15 V. Put VL on MCU for fixed control thresholds | **A: not selected**: no explicit either-rail-zero Ioff/isolation guarantee found; strict input-low and one-shot handoff need qualification. |
| **V: TI TCA9617B** (additional candidate), [9617B] §§1, 8.2.1.1 | A 0.8–5.5 V; B 2.2–5.5 V; application requires **A≤B** | Yes / no at target 3.6 V on A | Active-high enable; 5.5 V tolerant inputs | **A: not a full-envelope substitute**. Similar family numbers do not establish PCA9617A-equivalent supply behavior. |

## 2. Power-off, low levels and clock stretching

| Family / evidence | EN low; target off / MCU off | Low level, buffering and interoperability | Stretching, accelerators and speed |
|---|---|---|---|
| **V: TCA9800/1/2**, §§7.5–7.7, 9.3–9.4, 10.1 | EN isolates A from B but **B current sources remain on** with B powered. Either rail below UVLO makes A Hi-Z. B current source shuts off below B UVLO, leaving a weak pull-up following B. All **bus** pins protect against current into VCC. B powered-off leakage ±10 µA specified at B=0, bus=3.6 V; not an EN leakage guarantee. | No static offset; A VOL≤0.13 V at 6 mA, B≤0.26 V. B requires pull-down resistance ≤150 Ω and contention sink ≥0.3/0.5/0.8 mA respectively. Typical internal pull-up currents 0.54/1.1/2.2 mA (±25%). **No external B pull-ups**, current-source/accelerator sources, static-offset outputs or ordinary pass-FET translator chains on B. | Explicit stretch/multicontroller arbitration support; 400 kHz. Current-source pull-up, not a timed strong one-shot overriding a sustained low. **A:** ms hold has no documented duration timeout; MCU sink and handoff remain unmeasured. |
| **V: TCA9517 / TCA9517A**, §§7.1/9.1, feature descriptions and power recommendations | EN low disables drivers. Outputs off until A>0.8 V and B>2.5 V; arbitrary sequencing. I/O and EN remain 5.5 V tolerant with **A and/or B=0**. No separate numeric either-rail-off Ioff bound identified; do not repurpose powered leakage numbers as Ioff. | Target A VOL≤0.2 V; B static offset up to 0.6 V. B external sink must beat contention level, about 0.4 V (9517) / 0.45 V (9517A), plus offset margin. Do not connect offset B ports together; A-to-B chains add delay. | 400 kHz; explicit clock-stretch support with pull-up sizing to limit handoff overshoot. No strong rise accelerator used for translation. **A:** ACK/repeated START/arbitration follow I2C buffering; loaded handoff must be measured. |
| **V: PCA9517**, §§1–2, 6, 9–10 | EN low disables drivers; A>0.8 V and B>2.5 V required. All I/O and inputs tolerant with either supply at 0; powered-off bus Hi-Z. Numeric separate Ioff not given. | A VOL≤0.2 V, B≤0.6 V; B external low must be below ~0.4 V during contention. B must not meet another offset B port or incompatible accelerator buffer; A-to-B cascade possible. | 0–400 kHz; arbitration/stretching documented. Resistive pull-ups; no translator rise accelerator. **A:** sustained ms low does not need periodic edges. |
| **V: PCA9617A**, §§2, 6–6.2, 9–10 | Either rail off: drivers off, pins tolerate 5.5 V. EN low isolates ports; about **400 µs reference settling after B power-up**, not after each EN assertion. No separately tabulated powered-off Ioff maximum found. | A VOL≤0.2 V; B offset≤0.60 V; B **external low≤0.4 V**. B ports of offset repeaters must not be tied together. Target on A avoids exposing a low-voltage target to the offset. | **0–1 MHz**, arbitration and clock stretching explicit. No rise-time accelerator; external pull-ups. **B-side RC≥67.5 ns** to limit turnaround bounce. **A:** indefinite static low permits ms stretching in principle; actual hold/release and protocol margin unmeasured. |
| **V: TCA9406**, §§3, 6.3–6.5, 8.1–8.3 | OE low disables pins and internal 10 kΩ pull-ups. Either supply=GND isolates both ports; Ioff≤±2 µA on specified off-side test rows | Pass-gate, no static offset, but specified driving input VIL≤0.15 V for guaranteed output VOL≤0.4 V at 1 mA. Include internal pull-ups in sink-current budget. | 1 MHz I2C, integrated edge one-shots. **A:** one-shots respond to edges, not a timer limiting stretched SCL; release/handoff glitches and sink contention still require measurement. Already excluded by rail envelope. |
| **V/A: LSF0102 / LSF0204**, cited bias sections | EN low provides Hi-Z. LSF0102 documents bias current into refA: unsafe to equate “no sequencing” with no back-power. LSF0204 Ioff≤±1 µA is tested with **both references=0 and EN=0**, not either reference alone at zero. **A:** asymmetric-off safety needs an explicitly gated bias design. | Passive switch, no static offset; VOL includes sink voltage plus I×RON. Pull-ups on relevant sides; sink may carry both sides' currents. | Advertised ~100 MHz under small-load/strong-pull-up conditions, **not an I2C bus-capacitance guarantee**. No accelerators; **A:** open-drain lows, arbitration and stretch pass when bias is valid, which existing circuit does not establish. |
| **V/A: NCA9306**, §§8, 11–12, Fig. 2 | EN low Hi-Z; leakage ≤5 µA specified across pins at 0–5 V. **A:** no explicit either-reference-off Ioff isolation/bias proof found | Passive switch; no offset. **A:** low includes RON drop; arbitrary target buffer compatibility not guaranteed by package/pin similarity | Up to 100 MHz at ≤30 pF, lower at 50 pF; **A:** static lows/stretch/arbitration plausible with correct bias, not validated here. |
| **V/A: NLSX4373**, pp.3–5, 9 | EN low Hi-Z, IOZ 1 µA at 25°C. **A:** this is not either-supply-zero Ioff; no power-off guarantee accepted | Pass-gate with 10 kΩ pull-ups, no static offset; specified input VIL≤0.15 V. Published output limits do not independently prove every 1.65 V target's low margin | 20 Mb/s at specified load; rising/falling one-shots. **A:** I2C use documented, but ms stretch/arbitration handoff and asymmetric-off safety remain unproven. |

## 3. Packages and local KiCad 10 libraries

**VERIFIED locally:** KiCad CLI 10.0.6; searched `/usr/share/kicad/symbols` and `/usr/share/kicad/footprints` using `rg`. “Missing” means no matching stock symbol was found, not that a proposed custom symbol exists. Package choices below are manufacturer-documented; footprint existence is not finished layout/land-pattern validation.

| Part | Small package options | Existing symbol | Footprint / caveat |
|---|---|---|---|
| TCA9800/1/2 | DGK VSSOP-8, 3×3 mm, 0.65 mm | `Interface:TCA9800`, `Interface:TCA9801`, `Interface:TCA9802` | `Package_SO:VSSOP-8_3x3mm_P0.65mm`; original DCU 2.3×2 footprint is wrong |
| TCA9517 / A | DGK VSSOP-8; 9517 also SOIC-8 | `Logic_LevelTranslator:TCA9517ADGK`; `Logic_LevelTranslator:TCA9517D` for SOIC variant | DGK: `Package_SO:VSSOP-8_3x3mm_P0.65mm`; D: `Package_SO:SOIC-8_3.9x4.9mm_P1.27mm` |
| PCA9517DP / PCA9617ADP | SOT505-1 TSSOP/MSOP-8, 3×3 mm, 0.65 mm; PCA9617ATP HWSON-8 has **different pin order** | Missing; proposed `bridge_one:PCA9617ADP`, derived from checked 9517ADGK pin topology | `Package_SO:TSSOP-8_3x3mm_P0.65mm` exists; verify pads against [P9617] §11. HWSON exact footprint not found |
| TCA9406 | DCU US8 2.3×2 mm; DCT SM8 2.95×2.8 mm; DSBGA | `Interface:TCA9406DC` | DCU `Package_SO:VSSOP-8_2.3x2mm_P0.5mm`; DCT `Package_SO:SSOP-8_2.95x2.8mm_P0.65mm` |
| TI LSF0102 | DCU, DCT, X2SON DQE/DTM, DSBGA, SOT-23-8 | Missing (LSF0108 symbols are not substitutes) | DCU/DCT footprints above exist. `Package_SON:X2SON-8_1.4x1mm_P0.35mm` exists, but **A:** do not assign to DQE/DTM without exact pad review |
| TI LSF0204 | RUT UQFN-12 **2×1.7 mm**; PW TSSOP-14; RGY VQFN-14; DSBGA | Missing | Exact RUT footprint not found; installed `UQFN-12-1EP_2x2mm_P0.4mm_EP1.1x1.1mm` is **not equivalent** |
| Nexperia NCA9306 | DC VSSOP-8 2.3 mm; DP TSSOP-8; GS XSON 1.35×1 mm; GX X2SON 1.35×0.8 mm | Missing | DC VSSOP footprint above exists. Exact GS/GX footprint not found; do not substitute 1.4×1 mm X2SON blindly |
| onsemi NLSX4373 | UDFN8 1.8×1.2 mm; Micro8; SOIC8 | Missing | SOIC footprint above exists; exact UDFN footprint not found |
| TI TCA9617B | DGK VSSOP-8 3×3 mm | Missing | DGK footprint above exists; rejected for full rail range |

## 4. LCSC / JLCPCB observations

**Observation date: 2026-10-14; candidate requirement = 2 ICs.** Counts below are **reported on opened product pages**, sometimes from cached web retrievals (days/months old), not a live warehouse reservation. Recheck before BOM promotion. Search snippets, related-part counts and generic family pages were not used to establish stock. Stock statuses distinguish verified listing, reported in-stock, unavailable and unknown. LCSC inventory is **not** proof of JLCPCB assembly inventory. Requested suppliers take precedence here; no purchases authorized.

| Exact manufacturer MPN | LCSC C-number / direct product page | LCSC status observed | JLCPCB status |
|---|---|---|---|
| TI TCA9800DGKR | [C2677364](https://www.lcsc.com/product-detail/C2677364.html) | Verified listing; **reported in-stock 153** | Unknown |
| TI TCA9801DGKR | [C2677616](https://www.lcsc.com/product-detail/C2677616.html) | Verified listing; **unavailable / Out of Stock** | Unknown |
| TI TCA9802DGKR | [C2677618](https://www.lcsc.com/product-detail/C2677618.html) | Verified listing; **reported in-stock 11** | [Listing verified](https://jlcpcb.com/partdetail/TexasInstruments-TCA9802DGKR/C2677618); count not exposed, **unknown** |
| TI TCA9517DGKR | [C544515](https://www.lcsc.com/product-detail/C544515.html) | Verified listing; **reported in-stock 877** | Unknown |
| TI TCA9517ADGKR | [C201698](https://www.lcsc.com/product-detail/C201698.html) | Verified listing; **reported in-stock 18,561** | Unknown |
| NXP PCA9517DP,118 | [C2652381](https://www.lcsc.com/product-detail/translators-level-shifters_nxp-pca9517dp-118_C2652381.html) | Search identified listing; direct retrieval failed; **stock unknown** | Unknown |
| **NXP PCA9617ADP** | [C3445222](https://www.lcsc.com/product-detail/C3445222.html) | Verified listing; **reported in-stock 25,870**. Older indexed page said out of stock; opened canonical page reports count. **Ordering suffix `,118` not exposed**: confirm packing code before procurement | Direct retrieval failed; **unknown**, including assembly availability |
| TI TCA9406DCTR | [C337496](https://www.lcsc.com/product-detail/C337496.html) | Verified listing; **reported in-stock 1,257**; DCT, not DCU | Unknown |
| TI LSF0102DCTR | [C132024](https://www.lcsc.com/product-detail/C132024.html) | Verified listing; **reported in-stock 13,583**; DCU listing not established | Unknown |
| TI LSF0204RUTR | [C967437](https://www.lcsc.com/product-detail/C967437.html) | Verified listing; **reported in-stock 57** | [Opened JLC page](https://jlcpcb.com/partdetail/TexasInstruments-LSF0204RUTR/C967437): **reported 4,519 in stock; available order quantity 4,278**; cached page, recheck |
| Nexperia NCA9306DCH | [C4364246](https://www.lcsc.com/product-detail/C4364246.html) | Verified listing; **unavailable / Out of Stock** | Unknown |
| onsemi NLSX4373DR2G | [C725710](https://www.lcsc.com/product-detail/Translators-Level-Shifters_onsemi-NLSX4373DR2G_C725710.html) | Search identified listing; direct retrieval failed; **stock unknown** | Unknown |
| TI TCA9617B | Exact variant/C-number not established | **Unknown** | Unknown |

Tooling limitation: `agy --help` and `agy mcp list` worked; only KiCad MCP was listed. A sandboxed, permission-preserving headless read-only research request (`agy -p … --output-format json`) timed out at 90 s with empty response. **No actual successful MCP call or delegated sourcing result is claimed.** Independent manufacturer/retailer retrievals above supplied the evidence; jlcsearch JSON requests returned HTTP 403. No CAD mutation was attempted.

## 5. Recommended U8/U9 wiring proposal

**VERIFIED [P9617] §5 Table 3:** this map is for **PCA9617ADP TSSOP/MSOP-8**, not PCA9617ATP HWSON. Use U8 for n=0 and U9 for n=1. Symbol must describe port A as **target** for this circuit; do not retain the group-wide “A = MCU” assertion for I2C.

| Pin | Name | Exact `design.py` net |
|---|---|---|
| 1 | VCC(A) | `VTREF_IO` |
| 2 | SCLA | `I2Cn_SCL_TGT` |
| 3 | SDAA | `I2Cn_SDA_TGT` |
| 4 | GND | `GND` |
| 5 | EN | `I2Cn_EN_DRV` **directly** |
| 6 | SDAB | `I2Cn_SDA_MCU` |
| 7 | SCLB | `I2Cn_SCL_MCU` |
| 8 | VCC(B) | `+3V3` |

```python
# Proposal only; do not apply as part of TASK S.
Part(u, "bridge_one:PCA9617ADP", "PCA9617ADP",
     "Package_SO:TSSOP-8_3x3mm_P0.65mm",
     {"1": "VTREF_IO", "2": f"I2C{n}_SCL_TGT",
      "3": f"I2C{n}_SDA_TGT", "4": GND,
      "5": f"I2C{n}_EN_DRV", "6": f"I2C{n}_SDA_MCU",
      "7": f"I2C{n}_SCL_MCU", "8": V3},
     mpn="PCA9617ADP,118",
     datasheet="https://www.nxp.com/docs/en/data-sheet/PCA9617A.pdf")
```

**A: implementation recommendations:** delete R47/R49 200 kΩ bias paths and C49/C51 10 nF EN capacitors; remove obsolete `I2Cn_EN_NODE` nets and #FLG8/#FLG9. Repurpose R48/R50 as **10 kΩ EN-to-GND** pulls on `I2Cn_EN_DRV`; retain C50/C52 100 nF on target supply and add one 100 nF at each new pin 8 to GND. Keep U20 NOR equations unchanged: `I2Cn_EN_DRV = NOT(I2Cn_OFF OR PORT_GATE_N)`. Both rails derive from their respective domain, with no bias resistor feeding VTREF from +3V3. Target pull-ups remain exclusively to VTREF_IO; MCU pull-ups exclusively to +3V3.

**V [P9617] §6.1:** EN changes belong at bus idle; safety isolation during a fault overrides transaction completion and can truncate the current transfer. **A:** keep EN low during startup, permit arming only after rail/reference settling, and treat any isolation during traffic as an aborted transaction requiring recovery. Do not promise seamless disable in the middle of an ACK or stretched clock.

## 6. Pull-ups, low margins and remaining release blockers

| Item | Recommendation / evidence |
|---|---|
| MCU pull-ups | **A:** retain R51–R54 = 4.7 kΩ to +3V3 for 100 kHz and initially 400 kHz. Buffered capacitances do not sum as on PCA9306. At assumed MCU C=25 pF: RC=117.5 ns, rise time≈100 ns, satisfying [P9617] §6.2 **RC≥67.5 ns**. Measure C/rise time; do not automatically halve R for 400 kHz. |
| Target pull-ups | **A:** R87–R90 stay DNP when target supplies adequate pull-ups; fit 4.7 kΩ to VTREF_IO for a bare 100 kHz fixture. At assumed target C=150 pF, rise≈597 ns. For 400 kHz, 2.2 kΩ gives ≈280 ns. Include connector/cable/TVS and all existing board pulls; Raspberry Pi pull-up values are **not verified here**. |
| Pull-up limits | **V:** [I2C] §7.1/Eqs.1–2: `Rmin=(VDD−VOLmax)/IOL`, `Rmax=tr/(0.8473×C)`. Using 3 mA and VOL=0.4 V gives Rmin≈1.067 kΩ at 3.6 V; 100/400 kHz rise limits 1000/300 ns. **A:** apply to total parallel pull-ups, with actual target sink rating. MCU B also needs RC≥67.5 ns and sufficient current for the buffer's specified minimum load. |
| Target receives bridge-driven low | **V:** [P9617] Table 5 A VOL≤0.2 V; generic 0.3×1.65 V low threshold=0.495 V, nominal margin≥0.295 V. **A:** confirm the attached target's actual VIL and ground/noise budget. Offset is on MCU side, not target. |
| MCU receives target-driven low | **V:** B offset≤0.60 V; [ESP] DC Characteristics VIL≤0.25×VDD gives 0.825 V at 3.3 V. Nominal margin 0.225 V. **A:** retain margin across tolerance, ground shift and overshoot. |
| MCU drives ACK / clock stretch | **V:** PCA9617A requires B external low≤0.4 V, including handoff. **V:** [ESP] VOL≤0.1×VDD is explicitly measured with **high-impedance load**, so its nominal 0.33 V figure does **not prove** VOL under pull-up current. **A / release blocker:** substantiate ESP32-S3 open-drain sink≤0.4 V at selected current, temperature and drive setting; measure stretching overlap and release bounce. |
| Target drives into port A at 1.65 V | **V:** [P9617] Table 5 A input-low limit 0.25×A = **0.4125 V**. A target specified only VOL≤0.4 V has just 12.5 mV guaranteed nominal margin. **A / release blocker:** qualify target sink voltage and noise/ground budget; no claim of universal 1.65 V target compatibility. |
| Target/bridge off | **V:** [P9617] §6 covers either rail at zero, Hi-Z and tolerant I/O. **A / release blocker:** check leakage/rail rise with each side off, residual VTREF_IO charge and all external paths. Hi-Z permits finite leakage; it is not a zero-current system guarantee. Existing ADC injection and delayed comparator findings remain outside the translator fix. |
| Brownout / gate latency | **V:** [P9617] §6 allows A operation down to 0.8 V. **A / release blocker:** it will not automatically isolate throughout the target-invalid 0.8–1.65 V ramp region. The review's filtered VTREF comparator delay must be fixed/qualified separately; fast EN wiring alone cannot make `PORT_GATE_N` assert promptly. |
| Protocol and speed | **V:** manufacturer specifies I2C modes, arbitration and stretching at 0–1 MHz. **A / release blocker:** verify 100 kHz first at 1.65/1.8/3.3/3.6 V, then 400 kHz: repeated START reads, ACK/NACK, competing low assertions, ms stretch and release, EN isolation and power removal. No such tests were run. ESP32-S3 slave behavior and target-controller stretch timeouts are separate from translator capability. |

100 kHz is the **planned minimum**, 400 kHz is **planned/desirable**; neither is a validated Bridge One capability from this research alone. This replacement preserves the hardware HIL path and the existing native x86_64 Linux ABI architecture. No application, runtime, adapter or CAD changes are part of this task.

## Manufacturer evidence

- [9800]: [TI TCA9800 SCPS264B](https://www.ti.com/lit/ds/symlink/tca9800.pdf), §§6–7, 9–11.
- [9801]: [TI TCA9801 SCPS265B](https://www.ti.com/lit/ds/symlink/tca9801.pdf), §§6–7, 9–11.
- [9802]: [TI TCA9802 SCPS266B](https://www.ti.com/lit/ds/symlink/tca9802.pdf), §§6–7, 9–11.
- [9517]: [TI TCA9517 SCPS242D](https://www.ti.com/lit/ds/symlink/tca9517.pdf), §§7, 9–11; [TI selector supply restriction](https://www.ti.com/product/TCA9517).
- [9517A]: [TI TCA9517A SCPS245E, October 2025](https://www.ti.com/lit/ds/symlink/tca9517a.pdf), §§4–5, 7–9; [TI selector supply restriction](https://www.ti.com/product/TCA9517A).
- [P9517]: [NXP PCA9517 Rev.3](https://www.nxp.com/docs/en/data-sheet/PCA9517.pdf), §§1–2, 6, 9–10.
- [P9617]: [NXP PCA9617A Rev.1.1, March 2026](https://www.nxp.com/docs/en/data-sheet/PCA9617A.pdf), §§2, 5–6, 9–11.
- [9406]: [TI TCA9406 SCPS221G](https://www.ti.com/lit/ds/symlink/tca9406.pdf), §§3, 6, 8.
- [LSF2]: [TI LSF0102 SDLS972B](https://www.ti.com/lit/ds/symlink/lsf0102.pdf), §§5, 7–8. Current standalone datasheet supersedes older combined-family assumptions.
- [LSF4]: [TI LSF0204/LSF0204D SLVSCP5H](https://www.ti.com/lit/ds/symlink/lsf0204.pdf), §§3, 5–7, 9–10.
- [NCA]: [Nexperia NCA9306 Rev.3.1](https://assets.nexperia.com/documents/data-sheet/NCA9306.pdf), §§1, 4, 7–12. Do not mix its specifications with NovoSense's homonymous IC.
- [NLSX]: [onsemi NLSX4373/D Rev.7](https://www.onsemi.com/download/data-sheet/pdf/nlsx4373-d.pdf), pp.1, 3–5, 9.
- [9617B]: [TI TCA9617B SCPS259F](https://www.ti.com/lit/ds/symlink/tca9617b.pdf), §§1, 8.2.1.1.
- [ESP]: [Espressif ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf), DC Characteristics table and its high-impedance-load footnote.
- [I2C]: [NXP UM10204 I2C-bus specification](https://www.nxp.com/docs/en/user-guide/UM10204.pdf), §7.1 pull-up sizing and Standard/Fast-mode timing limits.
