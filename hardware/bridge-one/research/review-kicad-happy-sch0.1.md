# Bridge One sch0.1 - automated review with kicad-happy (schematic level)

Date: 2026-10-14. Scope: `cad/schematic/bridge-one.kicad_sch` (root + 10 hierarchical sheets, KiCad 10,
generated from `design.py`). Tool: kicad-happy 2.3.1 (`kicad` skill; repo clone at
`/tmp/claude-1000/kicad-happy/skills/kicad/scripts`). No project file was modified; all analyzer output
went to `/tmp/claude-1000/bo/`. No purchases, no commits.

Status labels used below: **ANALYZER** = analyzer finding as emitted (rule id, confidence); **MANUAL** =
found by reading `design.py` against the analyzer JSON. Nothing in this review is "datasheet-verified" by
the analyzer: it reported `DS-002` (no `datasheets/` directory, 33/171 parts with MPN) and
`datasheet_backed: 0` in `trust_summary`, so every pin/electrical statement from the analyzer is
**consistency only**. Where I cite a datasheet fact it comes from the project's own research notes.

## 1. Commands run and trimmed output

```
$ S=/tmp/claude-1000/kicad-happy/skills/kicad/scripts
$ python3 $S/analyze_schematic.py bridge-one.kicad_sch --output /tmp/claude-1000/bo/sch.json
Written to /tmp/claude-1000/bo/sch.json
```
Summary read from the JSON:
```
summary: total_findings 100  by_severity {error: 22, warning: 7, info: 71}
trust_summary.by_confidence: deterministic 56, heuristic 44, datasheet_backed 0
statistics: 177 components, 70 unique parts, 189 nets, 686 wires, 50 no-connects, dnp_parts 0 (see FP-9)
rules fired (count): PP-001 x17 (error), PR-001 x3 (error), SS-001 x1 (error), VM-001 x1 (error),
  DS-002 x1, PU-001 x2, RS-001 x2, UC-001, UC-002 (warnings), 71 info (DC-DET, EP-AUD, PD-DET, LS-DET, ...)
```
```
$ kicad-cli sch erc --severity-all -o /tmp/claude-1000/bo/erc.rpt bridge-one.kicad_sch
Found 6 violations
  1 error  : [pin_to_pin] Open collector (U17 pin 5 QOD) and Power output (U17 pin 6 VOUT)
  5 warning: [pin_to_pin] Bidirectional (U7 1A2/2B1/2B2, U10 1A2/2B2) tied to GND (#FLG2 net)
```
Not run, with reason:
- `analyze_pcb.py`, `cross_analysis.py`, `analyze_emc.py`, `analyze_thermal.py`, `analyze_gerbers.py`: no
  `.kicad_pcb`/gerbers exist yet (the EMC skill needs PCB data; no EMC claim is made here).
- SPICE: `which ngspice ltspice xyce` -> none installed.
- Lifecycle audit (`--lifecycle`): needs distributor API credentials/network; analyzer emitted `LC-007` (skipped).
- Datasheet sync: no distributor API keys; DS-002 stands. Prior-review delta: `research/review-codex-sch0.1.md`
  exists but was not diffed (not an analyzer run).
- `tools/verify_netlist.py` not re-run (outside this task).

Per-IC decoupling and ESD checks (analyzer only reports per rail, `DC-DET`), done by MANUAL read of `design.py`:
every IC has a local 100n on each supply group (U1 C6/C7; U14 C1/C5 + C2/C3; U5 C30/C31-33; U3 C36-C40 on 3V3,
C32/C33 on 1V2, C34/C35 on VCCPLL; U4 C42; U22 C63; Y1 C41; U17 C30/C36; U18/U19/U20 C43-C45; U21 C48;
U10 C53/C54; U6 C55/C56; U7 C57/C58; U11 C59/C60; U13 C61/C62; U15 C24/C25; U16 C26/C27; OLED C66/C67/C65).
Placement distance cannot be judged without a PCB.

## 2. Genuine findings (sorted by severity)

No blocker was found in the electrical topology. Everything with `error` severity from the analyzer is
either a false positive (section 3) or a process gap (rows 3-4).

| # | Sev | Ref / net | Problem | Evidence / confidence | Suggested fix (design.py) |
|---|-----|-----------|---------|-----------------------|---------------------------|
| 1 | Medium | C1 (VBUS) | `C("C1","10u 35V",...)` on a rail that sees up to 24 V continuous, with D11 SMAJ24A clamping up to ~38.9 V at its rated surge current. X7R loses a large part of its capacitance at 24 V bias, and 35 V is below the clamp peak. The analyzer says the opposite (`VD-004` "over-designed", assumes a 5 V rail). | MANUAL; analyzer VD-004 heuristic is wrong here (FP-7). Clamp value is from memory of the SMAJ24A class, not checked against the datasheet. The PTC F1 limits real surge current, so the risk is margin, not a certain failure. | In the `power_in`/`buck` group change `C("C1", "10u 35V", "VBUS", fp=C1206)` to `"10u 50V"` (1206 or 1210); keep C5/C24 at 50 V. Check AP63203 and TPS26600 abs-max VIN against the 38.9 V clamp when datasheets are added. |
| 2 | Medium | I2C0/I2C1 target side (`I2Cn_SDA_TGT`, `I2Cn_SCL_TGT`) | `translators` notes say "target-side pull-ups DNP", but `i2c_port()` places no pull-up footprints at all, and README lists "target pull-up jumpers" as open. A bare target without its own pull-ups gets no bus. | ANALYZER PR-001 x3, `deterministic`/topology. The finding is real for the "no footprint" part; its "missing pull-up" severity is overstated because pull-ups are intentionally optional (the MCU side has R51-R54 4k7). Its pairing of `I2C0_SDA_TGT` with `I2C0_SCL_MCU` is an analyzer bug. | In `i2c_port()` add four DNP parts to VTREF_IO, e.g. `R("R87","4k7 DNP","VTREF_IO","I2C0_SDA_TGT")` ... `R("R90",...)`, and give the `R()` helper a `dnp` argument (the `Part` dataclass already has `dnp`). Next free refs: R87+, C68+. |
| 3 | Medium (release gate) | BOM | MPN coverage 24/65 unique parts. All R/C values, LEDs D2-D5, J3, J10 have no MPN. J1, L1, U4, Y1 carry `"(candidate)"` text inside the MPN field, which breaks automated distributor lookup. | ANALYZER SS-001, `deterministic`/bom, severity `error` ("not pre-fab ready"). Consistent with AGENTS.md: BOM is not procurement-ready. | Pass `mpn=` through `R()`/`C()` (they already accept it) via a value->MPN table in design.py. Move `(candidate)` into `fields={"Status":"candidate"}` for J1 (USB4105-GF-A-120), L1 (NR3015N4R7A), U4 (APS6404L-3SQR-SN), Y1 (OT201612MJBA4SL). |
| 4 | Medium (process) | whole design | No `datasheets/` folder, so every pin-level and regulator check is consistency only. U1, U3, U14, U15, U16, U17, U8/U9, D1, D6-D10, J1, J6 were not checked against vendor PDFs by the tool. | ANALYZER DS-002 (warning), `trust_summary.datasheet_backed = 0`. | Sync datasheets for the 20 listed refs before sch0.2 sign-off. The project research notes claim many were verified by hand; the tool could not confirm that. |
| 5 | Low | J1 / VBUS_RAW, CC1/CC2 | No cap or TVS at the connector side of F1 (D11 and C1 sit after the PTC). CC1/CC2 have no ESD part (EP-AUD "partial"). | ANALYZER UC-001/UC-002 (warning, deterministic) and EP-AUD J1 (info). The PTC-then-TVS order is a legitimate design, so only the CC lines and a small connector-side cap are real gaps. | Optional: add `C("C68","100n 50V","VBUS_RAW",fp=C0603)` in `power_in`. For CC, add a TVS rated for the worst VBUS-short level (a 5.5 V array would be destroyed by a 20 V cable short) or document the accepted risk. |
| 6 | Low | 5V_OUT / 3V3_OUT at J10 pins 21/23 | User-facing supply pins have no ESD/TVS. EP-AUD counts J10 as "full" because it only looks at signal nets. | MANUAL; ANALYZER EP-AUD J10 (info) gives no warning. | Add a small unidirectional TVS per output in `aux_out` (5.0 V and 3.6 V standoff), next to the connector. |
| 7 | Low | VTREF_ADC (R42/R43/R44/C47) | 470k/470k divider plus 1k gives about 235k source impedance into the ESP32 ADC. Fine for a slow DC level, poor accuracy and settling (about 23 ms with C47). | MANUAL. The 470k value is chosen deliberately to limit backfeed (~3 uA, `gating` notes). | Keep, but add a note that firmware must average and wait; or add a buffer if VTREF accuracy matters. |
| 8 | Info | D3/D4/D5 LEDs | Cathodes go straight to iCE40 RGB pins with no series R. Safe only if the bitstream uses the RGB LED driver primitive with a set current; as plain I/O it would exceed IO limits. | MANUAL; documented in `fpga` notes. ANALYZER LA-AUD wrongly reports "resistor_limited via R24" (FP-8). | Add a firmware/bitstream requirement note to the `fpga` group notes. |
| 9 | Info | J10 | 4.5 signal pins per ground pin. | ANALYZER CG-AUD, deterministic, advisory. | Acceptable for a low-speed HIL header; if SPI above ~20 MHz is expected on J10, interleave GND in `DIRECT`. |

Checked and found consistent (the analyzer did not flag them, and I confirmed against project notes in
`research/`): PCA9306 on 3.3 V targets uses the documented VREF1 = VREF2 switch mode
(`target-interface-spec.md` lines ~220-226), TPS22917 CT capacitor to VIN is the documented choice
(`fpga-support-parts.md`), ESP32-S3-WROOM-1 pin map avoids the octal-PSRAM GPIO35-37 (module pins 28-30 are NC)
and the strap pins, TLV7011 comparator polarity gives VTREF_BAD high below ~1.5 V, reset/boot/CHIP_EN RC and
pull-ups are present, no unconnected gate inputs on U18-U20, unused translator channels are tied to GND.

## 3. Analyzer false positives and why

| ID | Analyzer finding | Why it is not a design problem |
|----|------------------|--------------------------------|
| FP-1 | PP-001 on `U3.1/22/24/33`, `U3.5`, `U4.8`, `U22.8`, `Y1.4` (nets `FPGA_3V3`, `FPGA_1V2`) | `FPGA_3V3` is fed by load switch U17 (TPS22917) and `FPGA_1V2` by LDO U5. The 2-hop search does not treat a load-switch or regulator output as a rail source. This is the intended sequencing path. |
| FP-2 | PP-001 on `U6.2, U7.2, U8.2, U9.2, U10.2, U11.13, U13.13` (net `VTREF_IO`) | `VTREF_IO` is VTREF through the 10R R41 and is supplied only by the target. The translator B side is deliberately unpowered when no target is attached (Ioff isolation). PWR_FLAG #FLG6/#FLG7 declare it on purpose. |
| FP-3 | PP-001 on `U8.7`, `U9.7` (`I2Cn_EN_NODE`) | VREF2/EN is driven from the gated NOR output via 200k, per the PCA9306 datasheet circuit. |
| FP-4 | PU-001 x2: `U8.EN`, `U9.EN` "missing pull-up" | These nodes want a pull-DOWN (R48/R50 2.2M) so the port is off by default. |
| FP-5 | RS-001: `OLED_VCC`, `VBUS_RAW` "no declared source" | `OLED_VCC` is generated by the panel's internal charge pump. `VBUS_RAW` comes from connector J1 (passive pins). An optional PWR_FLAG on `VBUS_RAW` would silence it; ERC does not require it. |
| FP-6 | VM-001: `AUX5V_EN` 5.0 V / 3.3 V crossing | 3.3 V GPIO into the TPS26600 EN pin with a 10k pull-down. The analyzer assigned the 5 V rail domain to a pin that is only a logic input. Valid only if the EN threshold is below 3.3 V; confirm on the datasheet when it is synced. |
| FP-7 | VD-004 x4: C1, C24, C5 "over-designed", C64 | VBUS can be 24 V (see genuine row 1). C64 (1n 25 V C0G on CT) follows the datasheet note that CT needs a 7 V rating or more. |
| FP-8 | PR-DET U14: feedback divider R45/R46, 500 kHz; U5 "missing output cap" (`DO-DET`); LED D3 "limited by R24"; U15/U16 classified as regulators/LDO | R45/R46 are the comparator reference divider (AP63203 is a fixed 3.3 V part, switching about 1.1 MHz). U5 has C31/C32/C33 on its output (the same PR-DET lists them). R24 is the TPS26600 fault pull-up. U15 (eFuse) and U16 (current-limited load switch) are not LDOs. |
| FP-9 | PP-001 on `U22.8`; MI-DET "connected to processor"; statistics `dnp_parts: 0` | U22 is the DNP 16 MB PSRAM option. The analyzer reads `dnp` as true for U22 (components list) yet still checks its power pin and counts DNP parts as zero. Same FPGA_3V3 path as FP-1. |
| FP-10 | ERC `pin_to_pin` warnings x5 (U7, U10 unused channel pins tied to GND) | Intentional: unused translator inputs are tied to GND (documented in README status). |
| FP-11 | ERC `pin_to_pin` error U17 QOD to VOUT | Intentional per datasheet: QOD tied to VOUT gives the internal discharge (README status). |
| FP-12 | PS-001 x2 "PG status unknown" for U14/U5 | No PG pin is used in this design; AP63203WU and TLV75712P have no power-good output needed here. |
| FP-13 | EP-AUD J6 "none", EP-AUD J3 "partial" | J6 is an on-board FPC to the OLED panel (no external exposure). The J3 "unprotected" nets are `__unnamed_N` (unused or GND pins), not signals. |
| FP-14 | PWR_FLAGs (#FLG1-#FLG9) | Placed on VBUS, GND, +3V3, VTREF, VTREF_IO and the EN nodes so ERC does not flag power-input pins as undriven. Intentional; FLG6-FLG9 only mean "externally powered or gated", not "regulated". |
| FP-15 | CERT-001, WL-001, LC-007, DO-DET I2C bus listings | Informational only. |

## 4. Key counts for sch0.2 triage

- Real issues: 0 blockers, 4 medium (C1 rating, target I2C pull-up footprints, MPN coverage, datasheet sync),
  3 low, 2 info.
- Of the 22 analyzer "errors": 18 are false positives (17 PP-001, 1 VM-001), 3 PR-001 are partly valid (row 2),
  and 1 is real (SS-001, MPN coverage).
