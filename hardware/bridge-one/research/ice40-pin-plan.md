# Bridge One revision F — iCE40UP5K-SG48 pin plan

Date: 2026-10-14. Placement-only proposal; no schematic or bench qualification. Read first: `AGENTS.md`, README “Revision F placement”, `docs/architecture.md`, `docs/pi-header-pinout.md`, `cad/preview/placement.json`.

**Decision:** the requested interface fits, with **one spare ordinary I/O plus two spare RGB open-drain I/Os**. Use pin 35 for the oscillator/PLL reference and pin 37 for target SPI SCK. Power sequencing and hardware isolation remain schematic-release gates.

Evidence labels: **VERIFIED** = primary source read and pin/document fact checked; **DOCUMENTED-BUT-UNMEASURED** = manufacturer-specified behavior, not measured on Bridge One; **ASSUMPTION** = proposed assignment/design choice. No validated hardware capability is claimed.

## Primary sources read

- **[P] VERIFIED:** [Lattice iCE40UP5K pinout workbook](https://www.latticesemi.com/view_document?document_id=51971), revision 1.1, internal update June 19, 2017; SG48 column. This revision corrects RGB0/RGB2 pin swapping: **39 = RGB0, 41 = RGB2**.
- **[D] VERIFIED:** [FPGA-DS-02008-2.4, UltraPlus family datasheet](https://www.latticesemi.com/view_document?document_id=51968), February 2025; §§4.2–4.6, table 4.24, §§5.1–5.2.
- **[C] VERIFIED:** [FPGA-TN-02001-3.5, Programming and Configuration](https://www.latticesemi.com/view_document?document_id=46502), August 2026; §13, figures 13.1–13.3, appendix A. The product-page link resolves to 3.5 even where its listing still says 3.4.
- **[H] VERIFIED:** [FPGA-TN-02006-2.4, Hardware Checklist](https://www.latticesemi.com/view_document?document_id=47779), September 2025; tables 2.1–2.2, §§2.2–2.3, table 3.1.
- **[L] VERIFIED:** [FPGA-TN-02052-1.4, sysCLOCK PLL guide](https://www.latticesemi.com/view_document?document_id=47778), April 2022; §2, §5.1. Pin 35 is the GPLL-associated input; reserving it for the oscillator avoids the input restriction when a PLL is instantiated.

No sourcing was undertaken: supplier URL/observed stock = **not checked**, observation date 2026-10-14; no availability or procurement-readiness claim.

## Full package table and proposed schematic nets

**VERIFIED [P, D, L]:** pins/names/banks/types/special functions below. **ASSUMPTION:** all proposed nets and user directions. `I/O` means ordinary programmable I/O; DPIO indicates differential-comparator pairing, not a mandatory differential application. RGB pins are open-drain only. Directions are relative to the FPGA; target nets are on the **3.3 V bridge side** of translators. “—” in special-function column means no additional function listed in [P], not that the pin lacks programmable functions.

| Pin | Lattice name | Bank | Type | Special function | Proposed schematic net / direction |
| ---: | --- | --- | --- | --- | --- |
| 1 | VCCIO_2 | 2 | Power | Bank 2 supply | FPGA_3V3 |
| 2 | IOB_6a | 2 | I/O | — | GPIO_DIR4 / out |
| 3 | IOB_9b | 2 | I/O (DPIO) | — | GPIO_DIR5 / out |
| 4 | IOB_8a | 2 | I/O (DPIO) | — | GPIO_DIR6 / out |
| 5 | VCC | — | Power | Core | FPGA_1V2 |
| 6 | IOB_13b | 1 | I/O (DPIO) | — | T_MOSI / in |
| 7 | CDONE | 1 | Config | Dedicated configuration status | FPGA_CDONE / to S3 |
| 8 | creset_b | 1 | Config | Dedicated active-low reset | FPGA_CRESET_B / from S3 |
| 9 | IOB_16a | 1 | I/O | — | T_CS0 / in |
| 10 | IOB_18a | 1 | I/O | — | T_CS1 / in |
| 11 | IOB_20a | 1 | I/O | — | T_MISO / out |
| 12 | IOB_22a | 1 | I/O (DPIO) | — | T_MISO_OE_N / out |
| 13 | IOB_24a | 1 | I/O (DPIO) | — | FPGA_IRQ / out |
| 14 | IOB_32a_SPI_SO | 1 | I/O + config | SPI_SO | S3_FPGA_MISO / out |
| 15 | IOB_34a_SPI_SCK | 1 | I/O + config | SPI_SCK | S3_FPGA_SCK / in |
| 16 | IOB_35b_SPI_SS | 1 | I/O + config | SPI_SS | S3_FPGA_CS_N / in |
| 17 | IOB_33b_SPI_SI | 1 | I/O + config | SPI_SI | S3_FPGA_MOSI / in |
| 18 | IOB_31b | 1 | I/O | — | PSRAM_CS_N / out |
| 19 | IOB_29b | 1 | I/O | — | PSRAM_IO0 / bidirectional |
| 20 | IOB_25b_G3 | 1 | I/O (DPIO) | GBIN G3 | SPARE_IO / test pad |
| 21 | IOB_23b | 1 | I/O (DPIO) | — | PSRAM_IO1 / bidirectional |
| 22 | SPI_Vccio1 | 1 | Power | SPI/bank 1 supply (SPI_VCCIO1 in [D]) | FPGA_3V3 |
| 23 | IOT_37a | 0 | I/O (DPIO) | I3C-capable | GPIO_DATA0 / bidirectional |
| 24 | VPP_2V5 | — | Power | Configuration/oscillator/RGB support | FPGA_3V3 |
| 25 | IOT_36b | 0 | I/O (DPIO) | I3C-capable | GPIO_DATA1 / bidirectional |
| 26 | IOT_39a | 0 | I/O (DPIO) | — | GPIO_DATA2 / bidirectional |
| 27 | IOT_38b | 0 | I/O (DPIO) | — | GPIO_DATA3 / bidirectional |
| 28 | IOT_41a | 0 | I/O | — | GPIO_DATA4 / bidirectional |
| 29 | VCCPLL | — | Power | PLL analog supply | FPGA_1V2_PLL / filtered |
| 30 | VCC | — | Power | Core | FPGA_1V2 |
| 31 | IOT_42b | 0 | I/O (DPIO) | — | GPIO_DATA5 / bidirectional |
| 32 | IOT_43a | 0 | I/O (DPIO) | — | GPIO_DATA6 / bidirectional |
| 33 | VCCIO_0 | 0 | Power | Bank 0 supply | FPGA_3V3 |
| 34 | IOT_44b | 0 | I/O (DPIO) | — | GPIO_DATA7 / bidirectional |
| 35 | IOT_46b_G0 | 0 | I/O (DPIO) | GBIN G0; GPLL reference [L] | CLK_12M / in |
| 36 | IOT_48b | 0 | I/O (DPIO) | — | GPIO_DIR0 / out |
| 37 | IOT_45a_G1 | 0 | I/O (DPIO) | GBIN G1 | T_SCK / in |
| 38 | IOT_50b | 0 | I/O (DPIO) | — | GPIO_DIR1 / out |
| 39 | RGB0 | 0 | I/O / LED | Open-drain current sink | FPGA_STATUS_LED / sink |
| 40 | RGB1 | 0 | I/O / LED | Open-drain current sink | SPARE_OD1 / test pad |
| 41 | RGB2 | 0 | I/O / LED | Open-drain current sink | SPARE_OD2 / test pad |
| 42 | IOT_51a | 0 | I/O (DPIO) | — | GPIO_DIR2 / out |
| 43 | IOT_49a | 0 | I/O (DPIO) | — | GPIO_DIR3 / out |
| 44 | IOB_3b_G6 | 2 | I/O (DPIO) | GBIN G6 | PSRAM_SCK / out |
| 45 | IOB_5b | 2 | I/O (DPIO) | — | GPIO_DIR7 / out |
| 46 | IOB_0a | 2 | I/O | — | GPIO_OE_N / out |
| 47 | IOB_2a | 2 | I/O (DPIO) | — | PSRAM_IO2 / bidirectional |
| 48 | IOB_4a | 2 | I/O (DPIO) | — | PSRAM_IO3 / bidirectional |
| EP (additional paddle) | GND | — | Ground | Mandatory ground paddle | GND plane, thermal/ground vias |

**VERIFIED [P, D]:** SG48 exposes G0/G1/G3/G6, not all family global-input sites. CDONE on SG48 is dedicated; do not copy the WLCSP30 CDONE/G4 sharing. The exposed paddle is additional to the 48 perimeter pins; CAD may number it 49, but its electrical function is GND.

## Configuration from S3, without configuration flash

**DOCUMENTED-BUT-UNMEASURED [D §§5.1.2–5.1.3; C §13; H table 3.1]:** S3 is SPI master, FPGA is configuration slave. Wire S3 MOSI → pin 17 (SI), S3 MISO ← pin 14 (SO), SCK → pin 15, CS → pin 16, reset → pin 8, status ← pin 7. SO is not needed to load CRAM, but wire it for the subsequent user data link. No configuration flash is needed in this mode; do not program NVCM.

| Signal | Documented termination / constraint | Proposed implementation (ASSUMPTION) |
| --- | --- | --- |
| CRESET_B | No internal pull-up; drive externally or 10 kΩ pull-up to SPI_VCCIO1 [D] | 10 kΩ to FPGA_3V3 plus S3 reset control; keep low until supplies valid |
| CDONE | External pull-up; [H, C] maximum R = 1 / (2 × configuration frequency × trace capacitance) | Start with 2.2 kΩ to FPGA_3V3, verify RC bound; e.g. 10 MHz/10 pF gives Rmax 5 kΩ |
| SPI_SS | Low at CRESET_B release selects slave; optional 10 kΩ pull-down [C, H] | Fit 10 kΩ pull-down; S3 actively drives high for idle after startup |
| SPI_SCK | 10 kΩ pull-up recommended [H] | Fit 10 kΩ to FPGA_3V3 |
| SPI_SI / SPI_SO | No external pull required [H] | Direct S3 link; SO input on S3 throughout configuration |

**DOCUMENTED-BUT-UNMEASURED [D table 4.24; C figures 13.2–13.3, appendix A]:**

1. With all rails valid, hold CRESET_B low **≥200 ns**, SPI_SS low; initialize SPI_SCK high as in the configuration flow.
2. Release CRESET_B while SS remains low; wait **≥1,200 µs** for configuration-memory clearing.
3. Raise SS, send **8 dummy clocks**, lower SS, then stream the complete bitstream without interruption, MSB first. Change SI on falling edges; FPGA samples rising edges. Do not use cold/warm boot bitstream options for this path.
4. Use configuration clock **1–25 MHz**; high/low pulse width **≥20 ns**, SI setup/hold **≥12 ns**. Proposed starting rate: **10 MHz (ASSUMPTION)**; verify S3 clock continuity and waveform timing.
5. Raise SS at image end and supply up to **100 clocks** for CDONE to rise; treat low CDONE as failure. After CDONE high, provide **at least 49 additional SCK cycles** before using the SPI pins as application I/O. A passive elapsed-time delay does not replace these clocks.
6. Keep target outputs isolated through startup and initial profile/state installation. Reconfiguration restarts this process with CRESET_B low.

**DOCUMENTED-BUT-UNMEASURED [D, C]:** pins 14–17 can be recovered as user I/O. **ASSUMPTION:** implement a normal fabric SPI slave on these same wires for the S3 data link, with MISO high-impedance while deselected. Configuration completion does not automatically create this link or prove hardened-SPI pin routing; select/implement user logic explicitly. Keep configuration dummy clocks deselected so they are not interpreted as application commands. Pin 15 is not GBIN; constrain the chosen fabric implementation and its achievable clock rate separately. Generic versioned execution/cache protocol remains an architectural requirement from `docs/architecture.md`, not a capability established by this pin plan.

## Power, sequencing and decoupling

**ASSUMPTION backed by [D, H]:** use a sequenced **FPGA_3V3** branch for banks 0/1/2 (pins 33/22/1) and VPP_2V5 (24); no FPGA bank connects to VTREF. S3/translators operate on the bridge 3.3 V side; their power/isolation sequencing needs separate review.

**DOCUMENTED-BUT-UNMEASURED [D table 4.2; H table 2.1]:** core pins 5/30 and PLL pin 29 require **1.2 V, operating range 1.14–1.26 V**. VPP is required even without NVCM use; do not leave pin 24 floating or ground it. Because the status LED uses RGB, the reduced 1.8 V VPP exception is inapplicable: VPP must be **≥2.30 V**, with operating maximum **3.46 V**. A 3.3 V connection is valid for this CRAM-loading plan, but not for NVCM programming (maximum 3.00 V). I/O 3.3 V rails must remain within the datasheet operating limit, 3.46 V.

**DOCUMENTED-BUT-UNMEASURED [D §§4.3–4.6, figures 4.1–4.2; H §2.3]:** VCC/VCCPLL first; each must reach **≥0.5 V** before applying SPI_VCCIO1. VPP follows SPI supply unless tied as permitted by [D] figure 4.2; VCCIO0/2 may follow core/PLL. Same-voltage banks and VPP may share the second-stage rail. Ramp monotonically within **0.6–10 V/ms**. All rails must be valid before releasing reset. No power-down order is specified; partial-rail restart must meet startup sequencing again.

**ASSUMPTION / release blocker:** AP63203 3.3 V feeding a 1.2 V LDO does not by itself establish core-first sequencing if the I/O pins see that same upstream 3.3 V immediately. Reserve a controlled switch/sequencer for FPGA_3V3 after the core and filtered PLL cross 0.5 V. Hold reset until full operating voltages are reached. Check that S3/translator signals do not drive an unpowered FPGA; review the selected isolation components before capture. Reset alone must not be claimed to fix an out-of-order rail ramp.

**DOCUMENTED-BUT-UNMEASURED [H table 2.2, figure 2.1; D §5.2]:** decouple every supply pin with **100 nF** locally and provide **4.7 µF per rail group** (core, bank supplies, VPP); use **100 Ω + 4.7 µF + 100 nF** for VCCPLL, connected to core through the resistor. Retain the PLL filter even if PLL is unused. SG48 has no dedicated GNDPLL pin: return PLL capacitors to board GND. Ground the paddle; no perimeter pin supplies ground. The five placement-preview capacitors C10–C14 are not a complete decoupling specification for seven supply pins plus rail bulk/filtering.

**ASSUMPTION:** place LED anode on 3.3 V and cathode on RGB0; select current in the RGB driver and review the actual LED rating. The proposed RGB status function differs from placement D4’s “FPGA CDONE” label: use the RGB-controlled status LED in this plan, and keep CDONE as a logic status net rather than loading it directly with an LED.

## Count and feasibility

**VERIFIED [P, D §5.2], arithmetic for the ASSUMPTION assignment above:**

| Resource | Available | Assigned | Remaining |
| --- | ---: | ---: | ---: |
| Bank 0 ordinary I/O | 14 | 14 (8 data + 4 DIR + two clocks) | 0 |
| Bank 1 ordinary I/O | 14 | 13 (4 S3 SPI + IRQ + 5 target SPI + 3 PSRAM) | 1 (pin 20/G3) |
| Bank 2 ordinary I/O | 8 | 8 (4 DIR + OE + 3 PSRAM) | 0 |
| RGB open-drain I/O, bank 0 | 3 | 1 status LED | 2 (40, 41) |
| Dedicated configuration pins | 2 | 2 | 0 |

Ordinary I/O demand = **4 + 1 + 6 + 17 + 6 + 1 = 35 of 36**. RGB LED consumes a separate one of three sinks; 36 of 39 user-capable pins are assigned overall. CRESET_B and CDONE are dedicated and do not consume the 36 ordinary I/Os. No requested net is omitted. Both translator GPIO enables share GPIO_OE_N as requested; independent per-chip enables would consume the last spare. PSRAM spans banks 1/2, which is electrically compatible with the common supply [D]; routing/skew and memory performance remain unmeasured.

## Independent review tooling

Antigravity CLI and its normal sandbox option were checked; `agy mcp list` reported KiCad enabled. A headless, read-only task requested an actual MCP call and an independent pin-budget review, with no file-write authority. It produced no findings within approximately 304 seconds and was interrupted (status ERROR). MCP connectivity and independent review therefore remain **unverified**; no CAD mutation was attempted. The pinout and document conclusions above were independently read directly from Lattice sources by the report author.

## Recommendation

Adopt the table as the **provisional schematic-capture pin allocation**, retaining pin 20/G3 and RGB1/2 as test pads. Use the reused four-wire configuration/data link, oscillator on GPLL pin 35, target SCK on G1 pin 37, and VPP at 3.3 V. Add the sequenced FPGA power branch, full decoupling and hardware-default output isolation before schematic review. This is a pin-feasibility result, not a SPI-NOR timing qualification or fabrication release.

## Open questions / bench tests

- Select the exact 3.3 V PSRAM and oscillator variants; confirm capacity, timing, power states and load. The placement candidates do not establish those properties.
- Scope core, filtered PLL, FPGA_3V3, reset, CS, SCK and CDONE across cold start/brownout/reconfiguration; verify ramp/order, the 1,200 µs wait and ≥49 post-CDONE clocks. Check pull-up RC with measured CDONE capacitance.
- Verify FPGA pin 35 PLL and pin 37 global-buffer mapping in the chosen implementation tool; synthesize/place/route the generic bus engine with this allocation and inspect timing, clock-domain crossings and PSRAM bandwidth. No synthesis was run for this report.
- Prove same-CS command/address-dependent target SPI response, translator delay, CS-gated MISO enable/disable, simultaneous-CS policy and reset/disconnect isolation. Pin fit alone does not establish MT25QL256/Linux spi-nor compatibility.
- Review physical OE polarity and DIR mapping against the selected TI translator datasheets in the interface task; default OE high externally, change DIR only while isolated, and ensure host/profile readiness gates output enable. These are proposed safety requirements, not verified translator wiring in this task.
- Reconcile the architecture’s older S3-SPI/four-GPIO description with the revision F FPGA/eight-GPIO design during architect review; no other document was edited here.
