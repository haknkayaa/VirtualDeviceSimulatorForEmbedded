# Bridge One: verified pinouts and small logic/comparator parts

Method: TI datasheets downloaded from `https://www.ti.com/lit/gpn/<partnumber>` (current revision) and read as text
(pdftotext). VERIFIED = read in the datasheet table/section named. ASSUMPTION = not checked against a primary source.
Pin numbers are the physical package pin numbers.

## 1. SN74AVC4T245 (SCES576I, Feb 2025) - Table 4-1 "Pin Functions"

Datasheet: https://www.ti.com/lit/gpn/sn74avc4t245. The table has one column for "D, DGV, PW, RGY" and one for "RSV".
The column order was cross-checked against Figure 4-1 (PW top view: 1 VCCA, 2 1DIR, 3 2DIR, 4 1A1 ... 15 1OE, 16 VCCB), so
the "first number" column is PW and the "second number" column is RSV. VERIFIED.

This part is TWO 2-bit sections: 1DIR/1OE control 1A1,1A2<->1B1,1B2; 2DIR/2OE control 2A1,2A2<->2B1,2B2.
(It is NOT four independent DIRs; use SN74AXC4T774 for per-bit DIR.)

| Name | RSV pin (UQFN-16) | PW pin (TSSOP-16) | Ref. supply |
|------|----|----|----|
| VCCA | 3  | 1  | - |
| VCCB | 2  | 16 | - |
| GND  | 10, 11 | 8, 9 | - |
| 1DIR | 4  | 2  | VCCA |
| 2DIR | 5  | 3  | VCCA |
| 1OE (active low, shown 1 /OE) | 1 | 15 | VCCA |
| 2OE (active low, shown 2 /OE) | 16 | 14 | VCCA |
| 1A1 | 6  | 4  | VCCA |
| 1A2 | 7  | 5  | VCCA |
| 2A1 | 8  | 6  | VCCA |
| 2A2 | 9  | 7  | VCCA |
| 1B1 | 15 | 13 | VCCB |
| 1B2 | 14 | 12 | VCCB |
| 2B1 | 13 | 11 | VCCB |
| 2B2 | 12 | 10 | VCCB |

RSV pin order, 1..16: 1 1OE, 2 VCCB, 3 VCCA, 4 1DIR, 5 2DIR, 6 1A1, 7 1A2, 8 2A1, 9 2A2, 10 GND, 11 GND, 12 2B2, 13 2B1, 14 1B2, 15 1B1, 16 2OE.
Note: two GND pins (10, 11) on RSV, both must be grounded. Orderable RSV part: 74AVC4T245RSVR-NT (marking ZWU), also SN74AVC4T245RSVRG4
(package option addendum). RSV body 2.6 x 1.8 mm. VERIFIED.

Behaviour (Section 7.4 Table 7-1 Function Table, each 2-bit section) VERIFIED:

| OE | DIR | Result |
|----|-----|--------|
| L | L | B -> A (A enabled as output, B Hi-Z) |
| L | H | A -> B (B enabled as output, A Hi-Z) |
| H | X | Isolation, both ports Hi-Z |

- DIR high = A -> B; OE active low. Confirmed.
- DIR and OE are referenced to VCCA (pin table).
- VCCA/VCCB: 1.2 V to 3.6 V each, either order (Table 4-1). Abs max 4.6 V.
- Ioff / partial power-down (Section 7.3.3; Section 5.5 Ioff row): fully specified; Ioff circuitry disables the I/O outputs when
  either supply is 0 V so no backflow. Spec: A or B port VI/VO = 0 to 3.6 V with the *other* supply at 0 V (VCCA=0 with VCCB 0-3.6 V, and
  VCCA 0-3.6 V with VCCB=0): Ioff typ +-0.1 uA, max +-5 uA over -40..85 C. VERIFIED.
- Caveat (ASSUMPTION, general TI behaviour, not stated in the sections I read): with VCCA = 0 V the control inputs (DIR/OE) are unpowered
  so do not rely on OE for isolation; Ioff is what keeps the pins high-Z. Pull OE high via a resistor to VCCA only if VCCA is sourced.
  Do not leave DIR/OE floating.
- Package marking RSV operating range -40 to 85 C.

## 2. SN74AXC4T774 (SCES898C, rev. May 2022 / copyright 2024) - Table 4-1

Datasheet: https://www.ti.com/lit/gpn/sn74axc4t774. Your RSV table is CORRECT. VERIFIED.

| RSV pin | Name | PW pin |
|----|----|----|
| 1 | A1 | 3 |
| 2 | A2 | 4 |
| 3 | A3 | 5 |
| 4 | A4 | 6 |
| 5 | DIR3 | 7 |
| 6 | DIR4 | 8 |
| 7 | OE | 9 |
| 8 | GND | 10 |
| 9 | B4 | 11 |
| 10 | B3 | 12 |
| 11 | B2 | 13 |
| 12 | B1 | 14 |
| 13 | VCCB | 15 |
| 14 | VCCA | 16 |
| 15 | DIR1 | 1 |
| 16 | DIR2 | 2 |

- Each bit has its own DIR (DIR1..DIR4, port n = An/Bn). DIR and OE are referenced to VCCA. Single OE (active low) for all four.
- Function table 7-1 (each transceiver) VERIFIED: OE=L, DIR=L: B -> A (A output, B input); OE=L, DIR=H: A -> B; OE=H: both Hi-Z (isolation).
  So DIR high = A -> B, same as AVC4T245.
- VCCA, VCCB each 0.65 to 3.6 V (pin table). Abs max 4.2 V. Footnote: inputs should not be floating. Input circuits of the data I/Os are
  always active.
- Ioff (Section 7.3.3 / Electrical Characteristics): A port VI/VO 0-3.6 V with VCCA=0 V, B port VI/VO 0-3.6 V with VCCB=0 V:
  +-4 uA typical-column / +-8 uA over the wider temperature column. VERIFIED.
- Data-rate: 310 Mbps at 1.8 -> 3.3 V (Section 7.3.2). VERIFIED.
- Packages: PW (TSSOP-16), BQB (WQFN-16 3.5x2.5), RSV (UQFN-16 2.6x1.8). Table lists BQB column identical to PW numbering.

## 3. ESD and I2C parts

### TPD2E2U06 (SLLSEG9C) DRL = "SOT (5)" 1.60 x 1.20 mm (the SOT-5X3 family) - Pin Functions table VERIFIED
URL https://www.ti.com/lit/gpn/tpd2e2u06

| DRL pin | Name | Note |
|----|----|----|
| 1 | NC | not connected; may be left floating, grounded, or tied to VCC |
| 2 | NC | same |
| 3 | IO1 | ESD-protected channel |
| 4 | GND | |
| 5 | IO2 | ESD-protected channel |

(DCK/SC70-6 variant: 1 IO1, 2 IO2, 3 GND - different part package, not used.) It is a plain 2-line clamp (not flow-through).

### TPD4E05U06DQA (SLVSBO7O, Aug 2024) USON-10 - Table 4-2 VERIFIED
URL https://www.ti.com/lit/gpn/tpd4e05u06

| Pin | Name | Role |
|----|----|----|
| 1 | D1+ | protected line |
| 2 | D1- | protected line |
| 3 | GND | ground |
| 4 | D2+ | protected line |
| 5 | D2- | protected line |
| 6 | NC | straight-through routing pad (float or ground) |
| 7 | NC | same |
| 8 | GND | ground |
| 9 | NC | same |
| 10 | NC | same |

- The four protected lines are pins 1, 2, 4, 5; GND are pins 3 and 8 (connect both).
- Flow-through: VERIFIED. Figure 4-3 (DQA top view) puts D1+ (1) opposite NC (10), D1- (2) opposite NC (9), D2+ (4) opposite NC (7),
  D2- (5) opposite NC (6), GND at 3 and 8. Table 4-2 says the NC pins are "Used for optional straight-through routing", Features list "Easy
  straight-through routing packages", Section 6.3.9 "Easy Flow-Through Routing". The NC pads are not connected inside the die: the PCB trace
  must pass from pin 1 to pin 10 (etc.) on copper, with the protected pad tapped off it. Pads are 0.5 mm pitch in two rows of five.
- Package: USON-10 (DQA), 2.5 x 1.0 mm, 0.5 mm pitch.

### PCA9306DCU (SCPS113O, Sep 2023) VSSOP-8 - Table 5-1 VERIFIED
URL https://www.ti.com/lit/gpn/pca9306. The DCT, DCU and DQE columns share one number, so DCU = DCT.

| Pin | Name | Type |
|----|----|----|
| 1 | GND | ground |
| 2 | VREF1 | low-voltage-side reference supply |
| 3 | SCL1 | I/O low-voltage side |
| 4 | SDA1 | I/O low-voltage side |
| 5 | SDA2 | I/O high-voltage side |
| 6 | SCL2 | I/O high-voltage side |
| 7 | VREF2 | high-voltage-side reference supply |
| 8 | EN | switch enable (active high) |

Your table is CORRECT.

## 4. Gates and comparator

### 4a. SN74LVC2G32 (dual OR, SCES201N) and SN74LVC2G02 (dual NOR, document number not recorded)
URLs https://www.ti.com/lit/gpn/sn74lvc2g32, https://www.ti.com/lit/gpn/sn74lvc2g02. Pin Functions VERIFIED. DCU = VSSOP-8 2.30 x 2.00 mm
(DCT = SSOP-8 2.95 x 2.80). Both parts use the same pinout.

| Pin | SN74LVC2G32 (OR) | SN74LVC2G02 (NOR) |
|----|----|----|
| 1 | 1A | 1A |
| 2 | 1B | 1B |
| 3 | 2Y | 2Y |
| 4 | GND | GND |
| 5 | 2A | 2A |
| 6 | 2B | 2B |
| 7 | 1Y | 1Y |
| 8 | VCC | VCC |

(Gate 1 outputs on pin 7, gate 2 outputs on pin 3. Datasheet pin table of the OR lists 1Y=7, 2Y=3; same for NOR. VERIFIED.)

- Operating VCC 1.65 to 5.5 V (data retention 1.5 V). Abs max VCC 6.5 V (LVC2G02). 3.3 V is a specified condition: VIH min 2 V at 3 to 3.6 V
  (LVC2G32), tpd max 3.8 ns (G32) / 4.9 ns (G02) at 3.3 V, +-24 mA drive at 3.3 V. VERIFIED.
- Ioff: "Ioff supports partial-power-down mode operation" and live insertion; spec VI or VO = 5.5 V, VCC = 0 -> +-10 uA (-40..85 and -40..125 columns). VERIFIED.
- Inputs 5.5 V tolerant (so a 3.3 V part can be driven from a 5 V input with VCC = 3.3 V). VERIFIED (feature list "Can be used as a down translator
  ... from a maximum of 5.5 V").
- Gate truth: OR Y = A+B, NOR Y = not(A+B). ASSUMPTION only for naming; standard.

### 4b. Comparators (push-pull, 3.3 V)
Candidates, all read:

| Part | Doc | SOT-23-5 / SC70-5 pin table | Supply | VCM range | Hysteresis | Output | Speed / Iq |
|----|----|----|----|----|----|----|----|
| TLV7011 (single, push-pull; TLV7021 is open-drain) | SLVSDM5F | pin 1 OUT, 2 VEE, 3 IN+, 4 IN-, 5 VCC (DBV and DCK identical) | 1.6 to 6.5 V | VS 2.5-5 V: VEE to VCC+0.1 V; VS 1.8-2.5 V: VEE+0.1 V to VCC+0.1 V | internal, typ 4.2 mV (min 1.2, max 14) | push-pull, VOH 4.8 V at 5 V/3 mA | 260 ns, 5 uA |
| TLV7031 (single, push-pull, 335 nA) | TLV703x datasheet (2024 copyright) | SOT-23/SC70: 1 OUT, 2 V-, 3 IN+, 4 IN-, 5 V+ | 1.6 to 6.5 V | VEE to VCC+0.1 V | internal, typ 7 mV (2..17) | push-pull | 3 us, 335 nA |
| TLV3691 (nano power, SC70-5/DCK) | SBOS694A | pin 1 IN+, 2 GND, 3 IN-, 4 OUT, 5 VCC | 0.9 to 6.5 V | (V-) - 0.1 V to (V+) + 0.1 V | 17 mV fixed internal | push-pull | 75 nA, slow |

All VERIFIED (URLs https://www.ti.com/lit/gpn/tlv7011, /tlv7031, /tlv3691; pin tables 4/"Pin Functions", VCM and VHYS rows in
Electrical Characteristics).

**Recommendation: TLV7011 (DBV or DCK).** At 3.3 V all three cover an input of 0.7 to 1.8 V because VCM is VEE (0 V) to VCC+0.1 V
(for TLV7011 VS 2.5 to 5 V: full rail; the VEE+0.1 V caveat applies only below 2.5 V supply). Internal hysteresis exists on all three, so
no external positive feedback is needed for a clean threshold on slow signals; if you need more, add external resistors (TLV3691
Section 8.1.2 describes external hysteresis; same technique applies). TLV7011 is fast enough (260 ns) for a bridge-level "line busy" detect;
TLV7031 / TLV3691 are too slow if you care about microsecond edges. Output is push-pull so there is no pull-up. Open drain would instead
be TLV7021. VERIFIED, selection is my judgement.

## 5. KiCad 10 symbols and footprints

Listed with `python3 cad/schematic/tools/symbol_pins.py Lib:Symbol` and `ls /usr/share/kicad/footprints/*.pretty`.

| Part | Symbol (lib:name) | Pin numbering of symbol | Footprint |
|----|----|----|----|
| SN74AVC4T245RSV | `Logic_LevelTranslator:SN74AVC4T245PW` (PW numbering; NO RSV symbol) | PW numbering. 1 VCCA, 2 1DIR, 3 2DIR, 4 1A1, 5 1A2, 6 2A1, 7 2A2, 8 GND, 9 GND, 10 2B2, 11 2B1, 12 1B2, 13 1B1, 14 2~OE, 15 1~OE, 16 VCCB. Pins match datasheet PW column. | `Package_DFN_QFN:UQFN-16_1.8x2.6mm_P0.4mm` for RSV |
| SN74AXC4T774RSV | NONE (no symbol, custom needed). Closest: none; generic 4-bit single DIR has no per-bit DIR | custom, use RSV table in section 2 | `Package_DFN_QFN:UQFN-16_1.8x2.6mm_P0.4mm` |
| TPD2E2U06DRL | `Power_Protection:TPD2E2U06DRL` (pins 3,4,5 have empty names; 1,2 are NC) | 1 NC, 2 NC, 3 IO1, 4 GND, 5 IO2 (matches datasheet; pins are passive) | `Package_TO_SOT_SMD:SOT-553` (the library symbol's own footprint field) |
| TPD4E05U06DQA | `Power_Protection:TPD4E05U06DQA` | 1 D1+, 2 D1-, 3 GND, 4 D2+, 5 D2-, 6 NC, 7 NC, 8 GND, 9 NC, 10 NC (matches Table 4-2 exactly) | `Package_SON:USON-10_2.5x1.0mm_P0.5mm` |
| PCA9306DCU | `Interface:PCA9306DC` (also `Interface:PCA9306`) | 1 GND, 2 VREF1, 3 SCL1, 4 SDA1, 5 SDA2, 6 SCL2, 7 VREF2, 8 EN (matches) | `Package_SO:VSSOP-8_2.3x2mm_P0.5mm` |
| SN74LVC2G32DCU | `74xGxx:74LVC2G32` (pins unnamed: 1 A,2 B,3 Y,4 GND,5,6 inputs,7 Y,8 VCC) | pins 1,2 in gate 1; 3 out gate 2; 5,6 in gate 2; 7 out gate 1 (matches) | `Package_SO:VSSOP-8_2.3x2mm_P0.5mm` (symbol filter `SSOP* VSSOP*`) |
| SN74LVC2G02DCU | `74xGxx:74LVC2G02` | same as above | `Package_SO:VSSOP-8_2.3x2mm_P0.5mm` |
| TLV7011 | NONE named TLV7011 or TLV7021 (the only TLV70xx in Comparator is TLV7031DBV). Use `Comparator:TLV7031DBV` with pin numbers identical to TLV7011 SOT-23-5, or a custom symbol | symbol: 1 OUT, 2 V-, 3 +, 4 -, 5 V+ (same as TLV7011 DBV/DCK) | `Package_TO_SOT_SMD:SOT-23-5` (DBV) or `Package_TO_SOT_SMD:SOT-353_SC-70-5` (DCK) |
| TLV3691 | NONE (not in Comparator.kicad_sym). Custom needed (differs from TLV7011: IN+ is pin 1, GND pin 2) | custom | `Package_TO_SOT_SMD:SOT-353_SC-70-5` |

Footprint notes:
- `UQFN-16_1.8x2.6mm_P0.4mm` is a generic KiCad footprint (descr cites TI qfnd836). Its pads number 1..16 counter-clockwise from pin 1
  with 4 per side (pin 1 at left, pin 9 right, pin 16 top). The TI RSV mechanical drawing in the datasheet is 4224640 (16 pads, 2.6 x 1.8 body).
  ASSUMPTION: the pad numbering and pad sizes match TI's RSV (pin numbers match through the pin-1 corner + CCW convention). Overlay-check before
  fabricating.
- The KiCad symbol `SN74AVC4T245PW` in its footprint field points at TSSOP-16, so the RSV footprint must be assigned manually
  in the schematic (override the Footprint field). The pin NUMBERS in the symbol are PW numbers, so for the RSV package you cannot use the symbol's pin
  numbers with an RSV footprint directly. Options: (a) create a custom symbol `SN74AVC4T245RSV` with the RSV table in section 1, (b) use a
  per-pin renumbering when generating the schematic. Recommend (a). ASSUMPTION: no RSV-numbered variant exists in /usr/share/kicad (searched
  for names containing "AVC4T245").
- SOT-553 used by TPD2E2U06DRL is the KiCad name for the 5-lead SOT with 0.5 mm pitch; TPD2E2U06DRL's own footprint filter is `SOT?553*`.
  ASSUMPTION: matches TI DRL mechanical (1.6 x 1.2 mm); I did not compare land patterns.
