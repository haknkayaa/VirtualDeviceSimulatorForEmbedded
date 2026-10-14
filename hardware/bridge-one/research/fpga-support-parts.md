# FPGA support parts: pinout and datasheet verification

Scope: FPGA I/O-rail sequencing load switch, 12 MHz oscillator, QSPI PSRAM, and
the TLV7011 comparator symbol. Claims are tagged **VERIFIED** (datasheet URL and
table or section) or **ASSUMPTION**. All datasheets were downloaded and read on
2026-10-14. Image-only pages (the YXC datasheet and the APS6404L package
drawing) were rendered and read visually. KiCad data comes from
`/usr/share/kicad` and `cad/schematic/tools/symbol_pins.py`.

## 1. FPGA_3V3 sequencing load switch

Requirement (from `ice40-pin-plan.md`, "Power, sequencing and decoupling"): the
core, FPGA_1V2, must be above 0.5 V before SPI_VCCIO1 is applied. VCCIO must
ramp at 0.6 to 10 V/ms. The load switch goes from +3V3 to FPGA_3V3, and its
ON/EN pin is driven directly from FPGA_1V2 (1.14 to 1.26 V).

### Candidate comparison

| Part | Package | ON/EN VIH min, VIN = 3.3 V | VIL max | Output discharge | Rise-time control | Imax | Verdict |
|---|---|---|---|---|---|---|---|
| **TPS22917DBV** | SOT-23-6 (DBV) | **1.0 V** (VIN 1 to 5.5 V); typical threshold about 0.6 V | 0.35 V | Yes: QOD pin, internal >= 150 ohm or external R | Yes: CT pin, capacitor to VIN | 2 A | **Selected** |
| TPS22918DBV | SOT-23-6 (DBV) | 1.0 V (VIN 1 to 5.5 V) | 0.5 V | Yes: QOD pin, internal about 25 ohm at 3.3 V | Yes: CT pin | 2 A | Acceptable alternative (N-FET, IQ about 8 uA, no ON pulldown) |
| TPS22916 | WCSP-4 (YFP) only | 1.0 V | 0.35 V | Yes on B/C/BL/CL versions | Fixed per version | 2 A | Rejected: no SOT-23 package, 0.78 mm WCSP |
| TPS22919 | SC-70-6 (DCK) only | 1.0 V | 0.35 V | Yes: QOD pin | Fixed slow turn-on | 1.5 A | Rejected: SC-70 not SOT-23. VIN min 1.6 V is acceptable |
| Diodes AP22802 | SOT-25 (SOT-23-5) | **1.5 V** | 0.5 V | Yes, 90 ohm | Fixed, 1.0 to 3.5 ms | current-limited USB switch | Rejected: VIH 1.5 V cannot be met from a 1.2 V rail. Also "Not recommended for new design, use AP22811" |

Sources:
- TPS22917: https://www.ti.com/lit/ds/symlink/tps22917.pdf (SLVSDW8B, Dec 2021).
  Pin Functions is Table 6-1. Recommended Operating Conditions is §7.3
  (VIN 1 to 5.5 V, VIH 1 to 5.5 V, VIL 0 to 0.35 V). Switching Characteristics
  is §7.6. ON threshold is Figure 7-5.
- TPS22918: https://www.ti.com/lit/ds/symlink/tps22918.pdf (SLVSD76C).
  Pin table is §5, Recommended Operating Conditions is §6.3, Electrical
  Characteristics is §6.5 (VHYS 107 mV).
- TPS22916: https://www.ti.com/lit/ds/symlink/tps22916.pdf (SLVSDO5F).
  Table 5-1 lists YFP A1/A2/B1/B2 only.
- TPS22919: https://www.ti.com/lit/ds/symlink/tps22919.pdf (SLVSEN5B).
  DCK 6-pin SC-70.
- AP22802: https://www.diodes.com/assets/Datasheets/AP22802.pdf. The EN VIH
  table (VIH 1.5 V min) and the NRND banner are on the first page.

**VERIFIED**: VIH min is 1.0 V for the TPS22917, TPS22918, TPS22916 and
TPS22919 (the TPS22919 table lists no VIN condition for VIH). Worst-case
margin from FPGA_1V2 min 1.14 V is 0.14 V. The typical ON threshold is 0.55 to
0.675 V across VIN (TPS22917 Figure 7-5).

### Pick: TPS22917DBV (active-high; not the "L" variant)

Reasons, all **VERIFIED** from the TPS22917 datasheet unless marked:
- VIH 1.0 V min and VIL 0.35 V max, so FPGA_1V2 at 1.14 V or more is a valid
  high. The datasheet's own "ON >= VIH" leakage is 10 nA max.
- Smart ON pulldown. RPD is 750 kohm typical while VON <= VIL. ON is held low
  until FPGA_1V2 is deliberately driven high, which is the sequencing behaviour
  wanted. The ON pin must not float, and this pulldown covers the case before
  the LDO is up.
- Quick output discharge (QOD pin). Tie QOD to VOUT to use the internal
  resistance of 150 ohm or more. This makes FPGA_3V3 decay when the core rail
  drops, which helps partial-rail restart.
- Adjustable rise time via CT (capacitor from CT to VIN, rated >= 7 V).
- Reverse current blocking.
- IQ 0.5 uA typical when on, 2 A max continuous. This is far above the 100 mA
  needed.
- A KiCad symbol exists, its pin order matches the datasheet, and the stock
  footprint matches.

Rise time. The datasheet table (§7.6, SRON) gives, at VIN = 3.6 V,
1900 (mV/us) x pF divided by CT, and 1100 (mV/us) x pF at 1.8 V.
- With CT open, the slew is 44 mV/us at 3.6 V. That is 44 V/ms, **above** the
  iCE40 10 V/ms limit. A CT capacitor is therefore **required**.
- **ASSUMPTION (derived)**: CT = 1 nF gives about 1.7 to 1.9 mV/us, about
  1.7 to 1.9 V/ms at 3.3 V. This is inside the 0.6 to 10 V/ms window with
  roughly 3x margin on the slow side. Turn-on time to 90 % is about
  3.8 us/pF x 1000 pF = 3.8 ms. Use a 1 nF C0G or X7R capacitor rated 25 V or
  more. Confirm on the bench, because SRON is the fastest slope and is
  specified with CL = 1 uF and RL = 10 ohm.
- The iCE40 0.6 to 10 V/ms figure is taken from `ice40-pin-plan.md`, not
  re-verified here.

#### TPS22917DBV pin table (SOT-23-6, top view; the KiCad symbol matches)

| Pin | Name | Function (Table 6-1) | Bridge One net |
|---|---|---|---|
| 1 | VIN | Switch input, place ceramic bypass capacitor | +3V3 |
| 2 | GND | Ground | GND |
| 3 | ON | Active-high control, do not leave floating | FPGA_1V2 |
| 4 | CT | Slew-rate control, capacitor to VIN. Open means fastest | 1 nF to +3V3 |
| 5 | QOD | Quick output discharge. Tie to VOUT for the internal resistor, or add an external R, or leave open to disable | FPGA_3V3 |
| 6 | VOUT | Switch output | FPGA_3V3 |

- Symbol: `Power_Management:TPS22917DBV`. Pins are 1 VIN, 2 GND, 3 ON, 4 CT,
  5 QOD, 6 VOUT. They match the datasheet. The symbol footprint property is
  `Package_TO_SOT_SMD:SOT-23-6`. **VERIFIED** with `symbol_pins.py`.
- Footprint: `Package_TO_SOT_SMD:SOT-23-6` (DBV). The `TSOT-23-6` variant is
  not needed.
- The symbol library also has `TPS22917LDBV` (active low). Do not use it.
- `AP22804AW5` exists in KiCad but is not an AP22802 equivalent for this job.
- Other symbols present: `TPS22919DCK`, `TPS22929D`, `TPS22993`. There is
  no KiCad symbol for TPS22918. If the TPS22918 is chosen instead, reuse
  `TPS22917DBV` as a pin-compatible proxy. Pins 1 to 6 are identical
  (VIN, GND, ON, CT, QOD, VOUT), but its CT capacitor goes to **GND**, not
  VIN (TPS22918 §8.3.3, **VERIFIED**).
- Behaviour to watch: the 750 kohm pulldown disconnects once ON >= VIH. The
  FPGA_1V2 LDO output sees only about 10 nA of load from the ON pin.
- Open item: the TPS22917 ON threshold is VIN-independent, but FPGA_3V3
  startup also needs PLL-rail (VCCPLL, 0.5 V) confirmation. That is covered by
  the existing release gate in `ice40-pin-plan.md` and is not changed here.

## 2. 12 MHz oscillator: YXC OT201612MJBA4SL (LCSC C669076)

Datasheet used: the LCSC-linked PDF
https://storage.googleapis.com/graviton-electric-symbols/document_assets/lcsc/2407310922_YXC-Crystal-Oscillators-OT201612MJBA4SL_C669076.pdf
(LCSC attachment 2407310922). The PDF is image-only, titled "YSO110TR Wide
Voltage", and covers the 2.0x1.6 package. Pages 1 to 3 were read visually.
The part number OT201612MJBA4SL does not appear in its text, so the mapping
of the OT part to the YSO110TR datasheet is **ASSUMPTION** (it is the datasheet
LCSC attaches to C669076).

LCSC/JLCPCB listing: 12 MHz, CMOS, 1.8 V to 3.3 V, +-10 ppm initial, +-20 ppm
stability, 4 mA, SMD2016-4P, -40 to +85 C (https://jlcpcb.com/partdetail/YXC-OT201612MJBA4SL/C669076,
**VERIFIED** as a listing, not a datasheet).

### Key specifications (YSO110TR page 1, **VERIFIED**)

| Item | Value |
|---|---|
| Supply VDD | 1.8 V to 3.3 V (no tolerance stated; +3V3 is at the top of the range) |
| Output | CMOS, 15 pF load |
| Voh / Vol | 90 % VDD min / 10 % VDD max |
| Duty cycle | 45 to 55 % |
| Start-up time | 3 ms max |
| Rise/fall time | 4 ns max |
| Current | 4 mA max (1 to 40 MHz, 2016 package, 1.8 to 3.3 V) |
| Tri-state | Enable = **High Voltage or Floating**, 70 % VDD min. Disable = Low or GND, 30 % VDD max |
| Note (page 3) | 0.01 to 0.1 uF between VDD and GND is required |

### Pin table (page 2, "Pin Dimension" and "Pin Assignments", **VERIFIED**)

| Pin | Function | Net |
|---|---|---|
| 1 | Tri-state (EN) | tie to +3V3 or leave open |
| 2 | GND | GND |
| 3 | OUTPUT | to iCE40 GPLL input (pin 35) |
| 4 | VDD | FPGA_3V3 or +3V3, with 0.1 uF |

- Pin 1 is enable and is active high. The datasheet says "High Voltage **or
  Floating**" enables the output, which implies an internal pull-up. The
  datasheet never uses the words "internal pull-up", so that wording is
  **ASSUMPTION**. For robustness, tie pin 1 to VDD with a direct trace or
  0 ohm. Do not rely on floating.
- **ASSUMPTION**: power the oscillator from the same rail as the FPGA bank
  that receives its clock, or add series damping. If it runs from +3V3 while
  FPGA_3V3 is still off, its 3.3 V output would drive an unpowered iCE40
  input. For that reason, power the oscillator from FPGA_3V3. This is a design
  decision, not a datasheet claim.
- Bottom-view and top-view drawings (page 2, 2.0*1.6 row): top view shows #4
  top-left, #3 top-right, #1 bottom-left, #2 bottom-right. The pin 1 pad is
  chamfered on the bottom view.

### KiCad comparison

Symbol `Oscillator:ASE-xxxMHz` (from `symbol_pins.py`): 1 EN, 2 GND, 3 OUT,
4 Vdd. **VERIFIED: it matches the YXC pin table exactly.**

Footprint `Oscillator:Oscillator_SMD_SiT_PQFN-4Pin_2.0x1.6mm` (read from the
`.kicad_mod`; KiCad y is down):

| Pad | Position (mm) | Top-view location |
|---|---|---|
| 1 | (-0.75, +0.6) | bottom-left |
| 2 | (+0.75, +0.6) | bottom-right |
| 3 | (+0.75, -0.6) | top-right |
| 4 | (-0.75, -0.6) | top-left |

Pads are 0.9 x 0.8 mm.

- **Pad numbering matches the YXC top view** (#1 bottom-left, counter-clockwise
  to #4 top-left). **VERIFIED.**
- Land pattern does **not** match the YXC recommendation: YXC (page 2) gives
  0.775 mm wide x 0.675 mm high pads, 0.5 mm horizontal gap and 0.3 mm
  vertical gap (outer 2.05 x 1.65 mm, pitch about 1.275 x 0.975 mm). KiCad's
  footprint is derived from the SiTime SiT8008 drawing (pitch 1.5 x 1.2 mm,
  outer about 2.4 x 2.0 mm, 0.6 mm and 0.4 mm gaps). The pads extend about
  0.17 mm beyond the body on each side. It is electrically equivalent for
  reflow and numbering, but it is not the YXC land pattern.
- Better stock footprint: **none**. There is no other 2.0x1.6 mm oscillator
  footprint in `Oscillator.pretty`. The only other 4-pin ASE footprints are
  3.2x2.5 mm. `Crystal:Crystal_SMD_2016-4Pin_2.0x1.6mm` and the other 2.0x1.6
  `Crystal_*` footprints are **passive crystals** (a different part type and pin
  meaning). Do not use them.
- Recommendation: use the SiT footprint as an interim, or create a project
  footprint from the YXC land pattern. Either way, set the schematic symbol
  footprint field explicitly, because the `ASE-xxxMHz` symbol defaults to
  `Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm`, which is the **wrong size**
  (3.2x2.5 mm). Description in the symbol is "3.3V CMOS SMD Crystal Clock
  Oscillator, Abracon" and its datasheet link is the Abracon ASV PDF.

## 3. APS6404L-3SQR-SN (8 MB QSPI PSRAM)

Datasheet: https://www.apmemory.com/cn/downloadFiles/032411212009597427
(AP Memory, Rev. 2.7, 5 Jan 2024; an older Rev. 2.3 copy is at
https://www.pjrc.com/store/APS6404L_3SQR.pdf). Package Information is §3.1,
Signal Table is §6, Package Outline is §4.1, DC Characteristics is Table 9,
AC Characteristics is Table 10.

- Supply: **VDD 2.7 to 3.6 V**, single supply (Table 9). **VERIFIED**: 3.3 V
  nominal is inside the range.
- Absolute maximum VDD is 4.0 V, and pin voltage is -0.4 V to VDD + 0.4 V.
- Logic levels: VIH min is VDD - 0.4 V and VIL max is 0.4 V. At VDD = 3.3 V
  that is 2.9 V and 0.4 V, so the iCE40 at 3.3 V LVCMOS meets them.
- Decoupling: 1 uF low-ESR ceramic recommended, optional 0.1 uF (§16.4).
- Power-up: 150 us with CLK low and CE# high, tracking VDD within 200 mV
  (§8).
- Ordering (page 7): `-SN` means SOP-8, Tc = -40 to +85 C, **standard grade**.

### Pin table (§3.1 Top view and §6; **VERIFIED**)

| Pin | Name | SPI function | QPI function |
|---|---|---|---|
| 1 | CE# | chip select, active low | same |
| 2 | SO/SIO1 | serial out | IO1 |
| 3 | SIO2 | not used | IO2 |
| 4 | VSS | ground | ground |
| 5 | SI/SIO0 | serial in | IO0 |
| 6 | SCLK | clock | clock |
| 7 | SIO3 | not used | IO3 |
| 8 | VDD | supply | supply |

### KiCad match (**VERIFIED**)

- Symbol `Memory_RAM:APS6404L-3SQRx-SN` (from `symbol_pins.py`): 1 ~{CE},
  2 SO/SIO1, 3 SIO2, 4 VSS, 5 SI/SIO0, 6 SCLK, 7 SIO3, 8 VDD. This matches
  the datasheet pin for pin. The symbol description says "2.7-3.6V supply,
  SOIC-8 (SOP-8)".
- Symbol footprint property: `Package_SO:SOIC-8_3.9x4.9mm_P1.27mm`. The AP
  Memory SOP-8L(150) drawing (§4.1, JEDEC MS-012 AA) gives body D = 4.90 mm
  nominal, E1 = 3.90 mm, E = 6.00 mm overall, pitch 1.27 mm. This matches the
  KiCad footprint. Pad numbering is the standard SOIC counter-clockwise.
- Note the KiCad symbol's datasheet link points at Rev. 2.3 on Mouser.

### Timing limits that matter (Table 10 and page 1; **VERIFIED**)

| Item | Value |
|---|---|
| Max clock, 3.3 V +-10 % | **109 MHz** (tCLK 9.17 ns), only for 32-byte wrapped burst |
| Max clock, 3.0 V +-10 % | 133 MHz, wrapped burst |
| Linear burst | **84 MHz** max (tCLK 11.9 ns) |
| Slow read 'h03 (SPI) | 33 MHz |
| Fast Read 'h0B | 66 MHz in QPI mode; 133/84 MHz in SPI |
| Fast Quad Read 'hEB and Quad Write 'h38 | 133/84 MHz |
| tCPH (CE# high between bursts) | 18 ns min |
| **tCEM (CE# low pulse width)** | **8 us max** for the standard grade (**3 us** for the extended grade -SQRX) |
| tCSP / tCHD | 2.5 ns / 3.0 ns |

tCEM constraint: CE# must not stay low longer than **8 us** in the -SN
(standard grade) part. The device is self-refreshed, and holding CE# low
longer blocks internal refresh. Every burst must therefore be terminated and
CE# raised within 8 us. At the planned slow FPGA-side clocks this is small:
at 12 MHz, 8 us is about 96 clock cycles, which is 96 bits in SPI mode or 384
bits in QPI mode. The command, address and wait cycles count toward the same
8 us. The FPGA memory controller must split long linear bursts and insert at
least tCPH = 18 ns between them. This constraint also bounds how much data
can be moved per CE# assertion at any frequency, so size cache or burst
lengths accordingly.

## 4. TLV7011DBV against KiCad `Comparator:TLV7031DBV`

Datasheets:
- TLV7011: https://www.ti.com/lit/ds/symlink/tlv7011.pdf (SLVSDM5F). Pin
  Functions table.
- TLV7031: https://www.ti.com/lit/ds/symlink/tlv7031.pdf. Table 4-1.

| Pin | TLV7011 (DBV/DCK SOT-23-5) | TLV7031 (DBV SOT-23-5) | KiCad TLV7031DBV |
|---|---|---|---|
| 1 | OUT | OUT | out |
| 2 | VEE | V- | V- |
| 3 | IN+ | IN+ | + |
| 4 | IN- | IN- | - |
| 5 | VCC | V+ | V+ |

**VERIFIED**: the five pins are in identical positions, so the KiCad symbol
`Comparator:TLV7031DBV` (footprint `Package_TO_SOT_SMD:SOT-23-5`) can be used
as a pin-compatible symbol for the TLV7011DBV. TLV7011 is push-pull, 1.6 to
5.5 V supply, 5 uA, 260 ns. TLV7031 is push-pull, 1.6 to 6.5 V, 315 to 335 nA,
3 us. **The electrical performance is different.** The TLV7031 symbol shows
the wrong supply maximum and speed, so set the value field to `TLV7011DBV` (or
the MPN actually purchased) and keep the TI TLV7011 datasheet link in the
symbol's datasheet field. Do not use the TLV7041 symbol (open-drain, north-west
pinout).

## Summary of decisions

| Part | Decision | Open item |
|---|---|---|
| Sequencing switch | TPS22917DBV, SOT-23-6, ON to FPGA_1V2, QOD to VOUT, CT = 1 nF to VIN | Bench-check the rise slope (0.6 to 10 V/ms) |
| 12 MHz oscillator | YXC OT201612MJBA4SL. Symbol `ASE-xxxMHz` is correct | Override the footprint (default is 3.2x2.5). The SiT 2.0x1.6 footprint has the right numbering but oversize pads. Tie pin 1 high. Datasheet is image-only and unnamed (YSO110TR) |
| PSRAM | APS6404L-3SQR-SN, symbol and footprint verified | Controller must respect tCEM 8 us and tCPH 18 ns |
| Comparator | TLV7011DBV with the TLV7031DBV symbol as pin proxy | Fix the value and datasheet fields |
