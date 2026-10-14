# Bridge One target interface specification (I2C, UART, GPIO) - revision A draft

Date: 2026-10-14. Scope: target-side circuits for I2C (2 ports), UART (1 port) and
GPIO (4 channels). SPI is out of scope (pending an engine decision); only
connector pins are reserved. This is a schematic-ready proposal, not a released
schematic. No bench measurement was made.

Evidence tags used on every claim:

- **VERIFIED** - datasheet read in this session (document and section given).
- **DOC-UNMEAS** - documented behavior, not measured on hardware.
- **ASSUMPTION** - engineering judgement or not read from a datasheet.

Datasheets actually read (downloaded from the BOM links, 2026-10-14):
[PCA9306 SCPS113O](https://www.ti.com/lit/ds/symlink/pca9306.pdf),
[SN74AVC4T245 SCES576I](https://www.ti.com/lit/ds/symlink/sn74avc4t245.pdf),
[SN74AXC4T774 SCES898C](https://www.ti.com/lit/ds/symlink/sn74axc4t774.pdf),
[PESD5V0U1UT](https://assets.nexperia.com/documents/data-sheet/PESD5V0U1UT.pdf).
NOT read (site blocked a script download or timed out): ESDA6V1SC6 (ST),
PESD3V3L4UW (Nexperia), USBLC6-2SC6, ESP32-S3 TRM. All figures for those parts
are ASSUMPTION and those parts are NOT accepted (section 5).

## 0. Global rules and shared control nets

Rails: `+3V3_MCU` (MCU side, VCCA of every translator), `VTREF` (target input,
VCCB / VREF1; never driven by the bridge).

| Rule | Tag |
| --- | --- |
| VCCA = +3V3_MCU, VCCB = VTREF on AVC4T245 and AXC4T774; DIR/OE are referenced to VCCA, so 3.3 V MCU logic works at any VTREF | VERIFIED (AVC 7.1, AXC pin table) |
| VCCB 1.2-3.6 V (AVC) / 0.65-3.6 V (AXC) recommended; abs max 4.6 V (AVC), 4.2 V (AXC). Accept VTREF 1.65-3.6 V; firmware flags >3.6 V (3.3 V +10% = 3.63 V marginally exceeds the recommended maximum) | VERIFIED (5.1/5.3 tables) |
| Data inputs stay active even when isolated (OE high); undriven inputs must be tied to a level | VERIFIED (AVC Table 7-1 note; AXC Table 7-1 note 2) |
| OE must be pulled up to VCCA during power up/down so outputs stay Hi-Z | VERIFIED (AVC and AXC section 3) |

### 0.1 Hardware isolation network (global wins, reset default = isolated)

New hardware signal (no MCU pin): `VTREF_BAD` = comparator output, high when VTREF
is invalid (section 5.2). If the comparator is DNP, solder jumper SJ_VBAD ties it
low; protection then relies on Ioff/VCC isolation only.

Gates, all powered from +3V3_MCU with 100 nF each. Candidate parts, none in the
BOM, ratings ASSUMPTION (read TI datasheets before adding): SN74LVC2G32 (dual OR2),
SN74LVC1G02 (NOR2).

| Gate | Function | Output net | Consumers |
| --- | --- | --- | --- |
| G1a (OR2) | `PORT_OE_N` OR `VTREF_BAD` | `PORT_GATE_N` (high = all target ports isolated) | G1b, G2, GPIO OE |
| G1b (OR2) | `UART_OE_N` OR `PORT_GATE_N` | `UART_OE_HW_N` | U_UART 1OE and 2OE |
| G2 (NOR2) | NOR(`I2C_ISOLATE`, `PORT_GATE_N`) | `I2C_EN_DRV` | EN networks of both PCA9306 |
| none | `GPIO_OE_HW_N` = `PORT_GATE_N` | | U_GPIO OE |

Control pulls (10 k from BOM line RC0603FR-0710KL; the external pull must beat the
S3 internal weak pull, assumed ~45 k, ASSUMPTION; costs 0.33 mA only while a pin
is driven against it):

| Net | Pull | Default meaning |
| --- | --- | --- |
| PORT_OE_N | 10 k to +3V3_MCU | high = isolated |
| UART_OE_N | 10 k to +3V3_MCU | high = isolated |
| I2C_ISOLATE | 10 k to +3V3_MCU | high = isolated |
| GPIO_DIR0..3 | 10 k to GND | low = B->A (target drives, MCU pin is input) |
| UART_OE_HW_N, GPIO_OE_HW_N | 100 k to +3V3_MCU at the translator pin | OE follows the rail while the gate rail ramps (datasheet pull-up requirement) |

Why GPIO DIR defaults low: with DIR high the B output is driven from the A input,
a floating/high-Z MCU pin; the AXC has 71 k internal pull-downs on data I/Os
(VERIFIED AXC 7.3.9), so it would drive the target pin LOW (e.g. asserting a target
reset). The consequence is DOC-UNMEAS.

## 1. Per-port circuits and pin-by-pin netlists

### 1.1 I2C ports (U_I2C0, U_I2C1: PCA9306DCTR, SM8)

Pins VERIFIED (PCA9306 Table 5-1): 1 GND, 2 VREF1, 3 SCL1, 4 SDA1, 5 SDA2, 6 SCL2,
7 VREF2, 8 EN. Target = side 1 (low-voltage side, VREF1 = VTREF); MCU = side 2.

```text
 target                                                   MCU
 I2C0_SDA_TGT --[TVS]--+-- SDA1 (4)   SDA2 (5) --+-- I2C0_SDA_MCU (GPIO4)
 I2C0_SCL_TGT --[TVS]--+-- SCL1 (3)   SCL2 (6) --+-- I2C0_SCL_MCU (GPIO5)
 VTREF -[10R]-+-- VREF1 (2)           VREF2 (7) --+-- I2C0_EN_NODE
  (100 nF)    GND (1)                 EN (8) -----+       |
 pullups to VTREF (jumpers)    I2C_EN_DRV -[200k]-+       +-[2.2M]-GND, 10 nF GND
```

| Pin | Name | Net |
| --- | --- | --- |
| 1 | GND | GND |
| 2 | VREF1 | `VTREF_IO` (VTREF after 10 R, 100 nF at pin) |
| 3 | SCL1 | `I2C0_SCL_TGT` (I2C1: `I2C1_SCL_TGT`) |
| 4 | SDA1 | `I2C0_SDA_TGT` |
| 5 | SDA2 | `I2C0_SDA_MCU` GPIO4 (I2C1: `I2C1_SDA_MCU` GPIO6) |
| 6 | SCL2 | `I2C0_SCL_MCU` GPIO5 (I2C1: `I2C1_SCL_MCU` GPIO7) |
| 7 | VREF2 | `I2C0_EN_NODE` |
| 8 | EN | `I2C0_EN_NODE` |

EN/VREF2 node: `I2C_EN_DRV` -> R_EN 200 k -> node; R_PD 2.2 M to GND; C_EN 10 nF to
GND. Reasons: 200 k is the datasheet value and VREF2 must have an external resistor
to its supply (VERIFIED 8.1.2); here the "supply" is the gated output so a disabled
port also removes the bias path. R_PD holds EN low if the gate is unpowered; when
enabled the node is 3.3 x 2.2/2.4 = 3.0 V (EN = 3 V is a tabulated condition, RON
4.7 Ω typ, VERIFIED 6.5). The 2 ms RC is ASSUMPTION.

### 1.2 UART port (U_UART: SN74AVC4T245PWR, TSSOP-16)

Pins VERIFIED (AVC pin table, PW): 1 VCCA, 2 1DIR, 3 2DIR, 4 1A1, 5 1A2, 6 2A1,
7 2A2, 8 GND, 9 GND, 10 2B2, 11 2B1, 12 1B2, 13 1B1, 14 2OE, 15 1OE, 16 VCCB.
Each 2-bit bank has its own DIR and OE. Bank 1 = bridge->target, bank 2 =
target->bridge. `UART_TX_MCU`/`UART_RX_MCU` are bridge TX/RX per pin-allocation.

| Pin | Name | Net |
| --- | --- | --- |
| 1 | VCCA | +3V3_MCU, 100 nF |
| 2 | 1DIR | `UART_DIR1` = +3V3_MCU via 10 k (fixed A->B) |
| 3 | 2DIR | `UART_DIR2` = GND via 10 k (fixed B->A) |
| 4 | 1A1 | `UART_TX_MCU` (GPIO17) |
| 5 | 1A2 | GND via 10 k (unused input must be tied) |
| 6 | 2A1 | `UART_RX_MCU` (GPIO18) |
| 7 | 2A2 | NC (unused output) |
| 8, 9 | GND | GND |
| 10 | 2B2 | GND via 10 k (unused input tied) |
| 11 | 2B1 | `UART_RXD_RAW` (from target TX); 100 k to VTREF_IO keeps idle high if target absent; then 33 R + TVS to `UART_RXD_TGT` |
| 12 | 1B2 | NC (output, driven low) |
| 13 | 1B1 | 33 R series to `UART_TXD_TGT` (to target RX), then TVS |
| 14 | 2OE | `UART_OE_HW_N` |
| 15 | 1OE | `UART_OE_HW_N` |
| 16 | VCCB | `VTREF_IO`, 100 nF |

33 R values: ASSUMPTION (damp ringing, limit ESD residual current). DIR is fixed
because UART is full duplex with fixed directions in V1 and V2.

### 1.3 GPIO block (U_GPIO: SN74AXC4T774RSVR, UQFN-16 RSV)

Pins VERIFIED (AXC Table 4-1, RSV column; PW numbering differs, do not mix):

| Pin | Name | Net |
| --- | --- | --- |
| 1 | A1 | `TARGET_GPIO0_MCU` (GPIO15) |
| 2 | A2 | `TARGET_GPIO1_MCU` (GPIO2) |
| 3 | A3 | `TARGET_GPIO2_MCU` (GPIO8) |
| 4 | A4 | `TARGET_GPIO3_MCU` (GPIO9) |
| 5 | DIR3 | `GPIO_DIR2` (GPIO41) |
| 6 | DIR4 | `GPIO_DIR3` (GPIO42) |
| 7 | OE | `GPIO_OE_HW_N` |
| 8 | GND | GND |
| 9 | B4 | `TARGET_GPIO3_RAW` |
| 10 | B3 | `TARGET_GPIO2_RAW` |
| 11 | B2 | `TARGET_GPIO1_RAW` |
| 12 | B1 | `TARGET_GPIO0_RAW` |
| 13 | VCCB | `VTREF_IO`, 100 nF |
| 14 | VCCA | +3V3_MCU, 100 nF |
| 15 | DIR1 | `GPIO_DIR0` (GPIO39) |
| 16 | DIR2 | `GPIO_DIR1` (GPIO40) |

Each B line: 33 R series then TVS/connector (`TARGET_GPIOn_TGT`). No external pull
on the B side by default. DIR high = A->B (bridge drives target), low = B->A.
Common OE only: per-channel isolation is not possible (VERIFIED). RSV footprint
geometry remains UNVERIFIED.

## 2. Truth tables

### 2.1 Function tables (VERIFIED: AVC Table 7-1, AXC Table 7-1, PCA9306 section 3)

AVC per 2-bit bank / AXC per channel: OE=L,DIR=L -> B->A; OE=L,DIR=H -> A->B;
OE=H -> both ports Hi-Z (isolation). PCA9306: EN high = switch on; EN low = Hi-Z
between ports ("lockup-free isolation").

After gating (H = high):

| PORT_OE_N | VTREF_BAD | I2C_ISOLATE | UART_OE_N | PORT_GATE_N | UART_OE_HW_N | GPIO_OE_HW_N | I2C_EN_DRV | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H | x | x | x | H | H | H | L | all isolated (global wins) |
| x | H | x | x | H | H | H | L | all isolated |
| L | L | H | H | L | H | L | L | GPIO active; UART and I2C isolated |
| L | L | L | L | L | L | L | H | all active |
| L | L | L | H | L | H | L | H | I2C and GPIO active, UART off |

### 2.2 Reset / boot of the ESP32-S3

| Phase | MCU pins | Translator state | Tag |
| --- | --- | --- | --- |
| 3V3 ramp (<~1 V) | undefined | OE pulled to the rail by 100 k so OE tracks VCCA; AXC isolates below 100 mV on either VCC; AVC "if either VCC at GND" | VERIFIED pull-up need; ramp DOC-UNMEAS |
| EN low / ROM boot | GPIOs high-Z mostly; GPIO0 weak up, GPIO45/46 weak down, GPIO3 floating | 10 k pulls define PORT_OE_N, UART_OE_N, I2C_ISOLATE high, DIR low -> isolated | ASSUMPTION (S3 reset states not read from TRM) |
| GPIO39-42 (DIR) | JTAG-capable pins, may have weak pulls | external 10 k to GND defines DIR=L; OE is high anyway | ASSUMPTION |
| Firmware not armed | PORT_OE_N high | isolated | design |
| Armed | VTREF read OK, DIR set while isolated, PORT_OE_N low | active | design |

No control net uses a strap pin (GPIO0/3/45/46), checked against
docs/pin-allocation.md. Rule: change `GPIO_DIR*` only while `PORT_GATE_N` = H (the
whole bridge is isolated, since OE is common; Issue 2).

### 2.3 VTREF absent (target off, USB powered)

| IC | Behavior | Tag |
| --- | --- | --- |
| AVC4T245 | VCCB = 0: both ports Hi-Z; Ioff +/-5 uA max (85 C); ICCA spec'd for VCCB = 0 | VERIFIED (section 3, 5.5) |
| AXC4T774 | either VCC < 100 mV: all I/O Hi-Z; Ioff +/-4 uA (25 C), +/-8 uA (125 C) | VERIFIED (7.3.3, 7.3.4, 5.5) |
| 0.1-1.2 V ramp | AVC minimum VCC is 1.2 V; isolation only guaranteed at ground, so VTREF_BAD forces OE high below ~1.5 V; gap if comparator DNP | VERIFIED limits, ASSUMPTION comparator |
| PCA9306 | EN gated low. If EN were high with VREF1 = 0, the bias FET charges VREF1 up to VCC2 - Vth ~ 2.7 V via 200 k and powers the target rail (8.1.7); hence EN MUST be gated | VERIFIED (8.1.7); effect DOC-UNMEAS |

### 2.4 USB unplugged, target powered (+3V3_MCU = 0 V)

| Path | Analysis | Tag |
| --- | --- | --- |
| AVC (VCCA = 0, VCCB = VTREF) | isolated; ICCB <= 8 uA; Ioff +/-5 uA per pin | VERIFIED (5.5) |
| AXC (VCCA = 0) | isolated; ICCB 10 uA typ / 18 uA max; data pins +/-4/8 uA | VERIFIED (5.5) |
| PCA9306 | VREF1 = VTREF, EN node held low by R_PD: switch off; Cio(off) 4-6 pF; IIH <= 5 uA at 5 V, EN = 0. No internal path from I/O to VREF2 is shown in the datasheet | VERIFIED 6.5; absence of path DOC-UNMEAS |
| VTREF_ADC divider into GPIO1 | NOT covered by any translator: the S3 pad clamp can feed the unpowered +3V3 rail. 100k/100k at 3.3 V gives roughly 20 uA; 470k/470k gives roughly 3 uA. Add 4.7 k bleed 3V3_MCU to GND so a leaked rail stays below 100 mV | ASSUMPTION (pad diode behavior) |
| OE/DIR pull-ups | rail at 0 V, no source | n/a |
| ESD arrays | line-to-GND only | ASSUMPTION (parts unread) |
| LD1117A reverse current from a backfed 3V3 | not reviewed | ASSUMPTION |

After the divider fix no identified path powers +3V3_MCU from VTREF beyond uA
leakage. Bench test required: USB unplugged, VTREF 1.8 V and 3.3 V, measure
+3V3_MCU (< 100 mV expected).

## 3. PCA9306 enable/bias, pullups, target pullup options

### 3.1 Does 3.3 V MCU + 3.3 V VTREF work?

Datasheet VERIFIED: translation mode needs VREF2 >= VREF1 + 0.6 V (note to 6.3;
8.1.5 "VCC2 >= Vref1 + 0.7 V"); VREF1 recommended 1.2 V to VREF2 - 0.6 V.

- VTREF 1.8 V, MCU 3.3 V: 3.3 >= 2.4, translation mode, OK.
- VTREF 3.3 V, MCU 3.3 V: translation mode NOT satisfied (needs 3.9 V). The
  datasheet permits the switch configuration VREF1 = VREF2 with EN driven from a
  GPIO (8.1.5, Figure 8-5). Circuit 1.1 is valid in both cases because EN and VREF2
  share the node driven from +3V3_MCU through 200 k. Works but is a different
  mode (symmetric delays, VERIFIED 8.1.5).
- A plain "200 k to 3.3 V" bias (BOM note, Figure 8-1) cannot be switched off and
  backfeeds VTREF (2.3), so the gated version above is the fix.
- VTREF 3.3-3.6 V: EN about 3.0 V; still on, RON rises; qualify at 3.6 V (DOC-UNMEAS).
- VTREF 1.8 V: bias current into VTREF ~ (3.0 - 0.6 - 1.8)/200 k ~ 3 uA (ASSUMPTION
  estimate); the target rail must be able to sink it (8.1.7 warns about LDOs).
  Document: VTREF must have > 10 uA load. A bridge-side bleed is not recommended.
- Low-level margin at 1.8 V target: VIL = 0.3-0.35 x 1.8 V = 0.54-0.63 V against MCU
  VOL plus RON; verify on the bench. ASSUMPTION.
- Both ports share one `I2C_ISOLATE` (Issue 1).

### 3.2 Pullup values

Rules from the I2C-bus spec, not re-read here (ASSUMPTION): Rmin = (Vdd - 0.4)/3 mA =
967 Ω at 3.3 V, 467 Ω at 1.8 V; tr = 0.8473 R C with tr max 1000 ns (100 kHz) and
300 ns (400 kHz). Datasheet: capacitive loads on both sides sum below 400 pF
(VERIFIED 8.1). Estimate (ASSUMPTION): MCU side 25 pF, target side 150 pF, so
175 pF combined.

| Mode | Rmax (parallel of all pullups) | Rmin | Choice |
| --- | --- | --- | --- |
| 100 kHz | 6.7 k | 967 Ω (3.3 V), 467 Ω (1.8 V) | MCU 4.7 k; target 4.7 k or target-board pullup |
| 400 kHz | 2.0 k (3.5 k at 100 pF) | same | MCU 2.35 k (two 4.7 k), target 2.2 k or target-board pullup |

Per line (SDA and SCL), solder jumpers (SJ):

| Ref | Value | Rail | Default |
| --- | --- | --- | --- |
| R_MCU_A | 4.7 k | +3V3_MCU | fitted |
| R_MCU_B | 4.7 k via SJ_MCU_FAST | +3V3_MCU | open (close for 400 kHz) |
| R_TGT_A | 4.7 k via SJ | VTREF | open |
| R_TGT_B | 2.2 k via SJ | VTREF | open |

Target side defaults open because real boards usually have pullups (a Raspberry Pi
has ~1.8 k to 3.3 V on I2C1, ASSUMPTION, not verified here); extra parallel
bridge pullups would exceed 3 mA. Check the parallel Rmin before closing a jumper.
GPIO-switched target pullups (P-channel switch from VTREF) are a V1.1 option and
need an extra MCU pin; none is free (Issue 1). 400 kHz may be unreachable because of
translator delay (VERIFIED 8.1); qualify 100 kHz first per docs/validation.md.

## 4. Global isolation

`PORT_OE_N` and `VTREF_BAD` form `PORT_GATE_N` in G1a. Every port enable is OR'd
(UART) or NOR'd (I2C EN) with `PORT_GATE_N`, and GPIO OE equals it. A disabled
global enable therefore overrides all port requests in combinational logic with no
firmware dependence. Reset defaults: all control nets pulled high (isolated),
`I2C_EN_DRV` low, EN node held low by R_PD. If +3V3_MCU is absent the translators
self-isolate (VCCA = 0) and R_PD holds PCA9306 EN low.
`PORT_OE_N` thus also gates I2C although pin-allocation calls it a push-pull
isolate (Issue 6).

## 5. ESD, VTREF protection and divider

### 5.1 Line protection

ICs are rated -0.5 V to 4.6 V (AVC) / 4.2 V (AXC) on I/O (VERIFIED) and +/-50 mA
clamp current (VERIFIED). IEC-style events need a low-clamp TVS plus series R.
Acceptance rule: (Vclamp - VCCB - 0.5 V)/Rseries <= 50 mA at the stated IPP.

| Lines | BOM candidate | Capacitance / clamp | Verdict |
| --- | --- | --- | --- |
| I2C SDA/SCL | PESD3V3L4UW (BOM: 19 pF) | datasheet NOT read | NOT accepted: 19 pF per line is large against the 400 pF budget and a 150 pF target, no series R is possible on I2C. Need <= 5 pF/line, VRWM >= 3.6 V, low clamp |
| UART, GPIO | ESDA6V1SC6 (BOM: 4-line) | NOT read; 6 V-class breakdown by part name, clamp assumed ~10 V at 1 A | NOT accepted at 1.8 V: (10 - 1.8 - 0.5)/33 R ~ 230 mA > 50 mA. Need 3.3 V-class low-clamp array and >= 100 R series, or bench ESD test |
| single line alt. | PESD5V0U1UT | Cd 0.6 pF typ / 1.5 max, VRWM 5 V, IRM 1 uA max, VCL 12 V at 1 A (VERIFIED datasheet) | 12 V at 1 A still too high for a 4.6 V-max pin (~105 mA with 100 R); BOM says 2.0 pF (mismatch) |
| VTREF | none selected | VRWM >= 3.6 V and clamp well below 4.6 V (VCCB abs max) | open; 5 V-class parts do not protect VCCB |

Leakage at VTREF = 1.8 V is not the issue (TVS standoff 3.3-5 V; PESD5V0U1UT 1 uA max
at 5 V VERIFIED); the clamp voltage is.

### 5.2 VTREF sensing and comparator

```text
VTREF -[10R]-> VTREF_IO (all VCCB/VREF1, 100 nF each + 1 uF bulk)
VTREF -[470k]-+-[470k]- GND         node = VTREF/2
              +-[1k]-+- GPIO1 (VTREF_ADC, ADC1) ; 100 nF to GND at the pin
```

Node = 0.90 V at 1.8 V, 1.65 V at 3.3 V, 1.8 V at 3.6 V; inside the S3 ADC range
with ~11-12 dB attenuation (about 0-3.1 V, ASSUMPTION, IDF doc not re-read). No
extra clamp needed (node cannot exceed 1.8 V; a 3.6 V TVS on VTREF upstream). 470 k
keeps unpowered-MCU backfeed to about 3 uA (2.4); settle time ~ 235 k x 100 nF = 23 ms,
wait > 100 ms before sampling. Resistors 1%; 470 k parts are not in the BOM.

Comparator (not in BOM, ASSUMPTION): compare `VTREF_ADC` against
`VREF_LOW` = +3V3_MCU x 30 k/130 k ~ 0.76 V (VTREF ~ 1.5 V) with ~20 mV hysteresis.
Power it from +3V3_MCU, not VTREF: a supervisor powered from VTREF reports wrongly
below its minimum VDD. Output `VTREF_BAD` high when VTREF is below ~1.5 V (inverting
polarity or an inverter). Over-voltage (> 3.6 V) is firmware-only via ADC.

## 6. Target connector proposal

Constraints: adjacent grounds, VTREF per group, SPI pins reserved, never output
power. Signals on odd pins, GND on even pins (each signal faces ground in an IDC
ribbon). Names are target-facing nets; UART named from the bridge like a USB-UART
dongle (bridge TXD goes to the target RX).

| Pins | Net | Group |
| --- | --- | --- |
| 1/2 | VTREF, GND | I2C |
| 3/4 | I2C0_SDA_TGT, GND | I2C |
| 5/6 | I2C0_SCL_TGT, GND | I2C |
| 7/8 | I2C1_SDA_TGT, GND | I2C |
| 9/10 | I2C1_SCL_TGT, GND | I2C |
| 11/12 | VTREF, GND | SPI |
| 13/14 | SPI_CS (reserved), GND | SPI |
| 15/16 | SPI_SCLK (reserved), GND | SPI |
| 17/18 | SPI_MOSI (reserved), GND | SPI |
| 19/20 | SPI_MISO (reserved), GND | SPI |
| 21/22 | VTREF, GND | UART |
| 23/24 | UART_TXD_TGT (bridge TX -> target RX), GND | UART |
| 25/26 | UART_RXD_TGT (target TX -> bridge RX), GND | UART |
| 27/28 | UART_RTS (RSVD, NC), GND | UART |
| 29/30 | UART_CTS (RSVD, NC), GND | UART |
| 31/32 | VTREF, GND | GPIO |
| 33/34 | TARGET_GPIO0_TGT, GND | GPIO |
| 35/36 | TARGET_GPIO1_TGT, GND | GPIO |
| 37/38 | TARGET_GPIO2_TGT, GND | GPIO |
| 39/40 | TARGET_GPIO3_TGT, GND | GPIO |

Exactly 20 signal slots (4 VTREF + 16). All VTREF pins are one net.

Pitch trade-off (ASSUMPTION unless noted): a 2 x 20 at 2.54 mm is 50.8 mm long and
exceeds the 50 x 50 mm starting envelope; at 1.27 mm it is 25.4 mm but needs adapters
for Dupont/analyzer leads. Recommendation: 2.54 mm as two 2 x 10 headers
(J_TGT_A pins 1-20: I2C + SPI; J_TGT_B pins 21-40: UART + GPIO), each 25.4 mm,
reconciling the BOM's 2 x 10 part (qty 2) with per-group VTREF and adjacent grounds.

Compatibility: do not copy the Raspberry Pi 40-pin layout (it has 3V3/5V supply pins
and ID_SD/ID_SC). Use a passive adapter cable: Pi pins 1/17 (3V3) -> VTREF, 3/5 ->
I2C0, 8/10 -> UART, 19/21/23/24 -> SPI (reserved), grounds 6/9/14; Pi 5 V pins stay
unconnected. Signal/ground-alternating rows match typical 0.1" logic-analyzer leads
(probe pinout not read, ASSUMPTION). Provide test pads on both sides of every
translator, on VTREF_ADC, EN nodes and PORT_GATE_N.

## Issues found in the current design docs

1. One `I2C_ISOLATE` serves two I2C ports although pin-allocation asks for
   independently controlled paths. No spare S3 pin exists (straps, PSRAM, USB, UART0
   used). Decide: shared enable (this spec) or expander/another function dropped.
2. No `GPIO_OE_N`: the AXC4T774 has ONE common OE (VERIFIED) and only `PORT_OE_N` is
   allocated, so a GPIO DIR change requires isolating every push-pull port.
3. PCA9306 "200 k bias" is incomplete: VERIFIED (8.1.2, 8.1.7) the bias path charges
   VREF1 to about VCC2 - Vth and powers the target rail when VTREF is absent,
   breaking "never power the target". EN must be gated by enable and VTREF valid. With
   3.3 V MCU and 3.3 V VTREF translation mode is out of spec (needs VREF2 >= VREF1
   + 0.6 V); only switch mode is valid (8.1.5).
4. AXC4T774 has integrated 71 k pull-downs on all data I/Os (VERIFIED 7.3.9); the
   datasheet says external pull-ups must be <= 7 k. A target GPIO with a weak
   pull-up (e.g. ~50 k internal on a Pi) or an open-drain/IRQ line reads below VIH.
   Docs never mention this. Options: restrict supported lines, stiff target pull-ups,
   or a translator without pull-downs (e.g. four single-bit parts; not verified).
5. UART bank mapping is undefined in the docs: AVC4T245 shares DIR per 2-bit bank
   and unused pins must be tied (VERIFIED); this spec fixes DIR1 = H, DIR2 = L.
6. `PORT_OE_N` is described as a push-pull isolate, but "global wins over every port"
   plus the PCA9306 backfeed require it to gate I2C EN too. Update the text.
7. BOM has one 2 x 10 target header (M20-9991045); architecture needs separate
   groups with adjacent grounds and VTREF on each, which needs 40 pins or two headers.
8. BOM says PESD5V0U1UT is "2.0 pF"; the Nexperia datasheet (read) states 0.6 pF typ,
   1.5 pF max, and VCL 12 V at 1 A, unsuitable for a 4.6 V-max pin on target I/O.
9. No VTREF divider, series resistors, VTREF TVS, comparator or gate ICs in docs or BOM;
   new lines needed (470 k, 33 R, 10 R, 2.2 M, 200 k, 100 k, 1 k, comparator, OR2, NOR2).
   The BOM lists 4.7 k and 10 k only for passives.
10. The 3 x AVC4T245 BOM quantity assumes 2 for SPI, which is pending.

## Open questions

1. Is a single shared I2C enable acceptable, or add an I/O expander?
2. Add `GPIO_OE_N`, or accept whole-bridge isolation for DIR changes?
3. GPIO translator choice given the 71 k pull-downs: which target pull-ups must V1 support?
4. Accept VTREF window 1.65-3.6 V and the added comparator and gate ICs?
5. ESD: read ESDA6V1SC6 and PESD3V3L4UW datasheets (blocked here) and choose a
   3.3 V-class low-clamp array; is board-level IEC 61000-4-2 immunity a V1 goal?
6. ESP32-S3 TRM not read: reset pulls of GPIO39-42, GPIO47/48 supply with octal PSRAM,
   GPIO1 pad clamp behavior.
7. Connector decision (two 2 x 10 at 2.54 mm vs one 2 x 20) and final SPI pin order.
8. Bench items for DOC-UNMEAS claims: 3V3 rail leak with USB unplugged, PCA9306 at
   3.3/3.3 V and 3.6 V, 400 kHz rise time with real targets, EN RC enable delay.
