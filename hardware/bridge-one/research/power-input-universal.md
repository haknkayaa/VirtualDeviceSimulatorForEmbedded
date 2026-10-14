# Bridge One universal USB-C power input (design note)

Date: 2026-10-14. Supersedes the 5 V-only LDO (TLV75733P) + TPS2553 assumption in `power-budget.md`. Nothing here was measured on hardware.
Tags: **[V]** VERIFIED (primary datasheet read this session), **[D]** DOCUMENTED-BUT-UNMEASURED (secondary source or not re-read), **[A]** ASSUMPTION.
Requirement (user, 2026-10-14): safe and running from 5 V, PD chargers (5 V, board is a non-PD Rd sink), and non-compliant 9-24 V on VBUS. Load 100 mA typ / 225 mA worst on +3V3, 500 mA design margin.
Chain: VBUS -> PTC -> TVS -> buck (fixed 3.3 V) -> +3V3.

## 1. Buck: Diodes AP63203WU-7
Source: <https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf> (DS41326 Rev 3-2, Nov 2024).
- Recommended VIN 3.8-32 V; abs max VIN 35 V DC, 40 V for 400 ms; SW -1 to VIN+0.3 V. [V] (Abs. Max table, p.4)
- Fixed 3.3 V, VFB 3.27-3.33 V; 1.1 MHz fixed with +/-6% spread spectrum; PWM/PFM; tON min 80 ns; soft-start 4 ms typ; peak limit 2.5-3.1 A (typ 2.8). [V]
- UVLO rising 3.30-3.70 V (typ 3.5), hysteresis 440 mV. Rds(on) 125/68 mOhm. [V]
- Minimum input for 3.3 V at 500 mA: drop = 0.5 A x (0.125 + ~0.1 inductor DCR) = ~0.11 V, so ~3.4 V theoretical. [A] (calculated; the datasheet gives no dropout figure, only "acts as an LDO" at ~100% duty). Worst USB case: 4.75 V - PTC (<=1 Ohm max x 0.4 A = 0.4 V) - 0.1 V connector/cable = ~4.25 V. That leaves ~0.8 V above the 3.5 V UVLO/regulation need. [A]
- Recommended parts (Table 2, 3.3 V): L 3.9 uH, C1 (VIN) 10 uF, C2 (VOUT) 2 x 22 uF, C3 (BST) 100 nF. Inductor 2.2-10 uH, DC rating >=35% above max load, DCR <100 mOhm, larger L helps light-load efficiency. Ceramic input cap >10 uF "sufficient". [V]
- Ripple: dIL = 3.3 x (1 - 3.3/24) / (4.7 uH x 1.1 MHz) = 0.55 A pk-pk at 24 V in, so peak = 0.5 + 0.28 = ~0.8 A at full 500 mA. Inductor Isat must be >= ~1 A for the load; >= 3.1 A to survive the current limit in a short. [A] (calculated)
- Light load: PFM, IQ 22 uA typ (VIN 12 V, no load); up to 80% efficiency at 1 mA and 88% at 5 mA. [V] The 2.5 mA USB-suspend limit is dominated by the rest of the board, not the buck; firmware light-sleep is still needed. [A]
- EMI/ESP32-S3: fixed 1.1 MHz fundamental with spread spectrum and a ringing-free SW edge scheme. [V] 1.1 MHz is far below 2.4 GHz, but SW-node harmonics and PFM bursts can couple into the antenna keep-out and the USB D+/D-. Layout rules apply (tight Cin loop, keep the inductor away from the module antenna end). Not measured. [A]
- Lifecycle: Ozdisan lists it Active (MPQ 3000). A search summary claimed LCSC marks it NRND; I could not confirm that. Check the Diodes product page before release. [A]

### Alternatives (same method, datasheets read)
| Part | VIN rec / abs max | Why not |
|---|---|---|
| TI TPS62932 (adj., SOT583-8) <https://www.ti.com/lit/ds/symlink/tps62933.pdf> | 3.8-30 V / **32 V**, no 400 ms rating; IQ 12 uA (PFM); FSS +/-6%; fsw selectable 200 kHz-2.2 MHz [V] | Abs max is below the SMAJ24A clamp (38.9 V), so it needs a lower-clamp TVS or series R. Adjustable (extra divider). Not found at Ozdisan. |
| TI LMR51420 (adj., SOT-23-6) <https://www.ti.com/lit/ds/symlink/lmr51420.pdf> | 4.5-36 V / 38 V; IQ 40 uA typ, 65 max (PFM) [V] | UVLO rising max 4.5 V and min VIN 4.5 V: a sagging 4.25-4.6 V USB input may not start. Ozdisan page stock 0 (package text inconsistent: "8-SOIC"). |
| TI TPS54202 | not read | Not evaluated (no datasheet read). |

**Pick: AP63203WU-7.** It is the only candidate with fixed 3.3 V, a 35 V/40 V abs max above the TVS clamp, and a start threshold clear of USB sag.

## 2. TVS (DO-214AC / SMA, 400 W 10/1000 us)
Source: AOS SMAJ datasheet table <https://www.aosmd.com/sites/default/files/res/datasheets/SMAJ78A.pdf>; the Vishay/Littelfuse distributor listings agree. [V] for AOS values.
| Part | VRWM | VBR min-max | VC @ Ipp | vs buck 35 V DC / 40 V (400 ms) |
|---|---|---|---|---|
| SMAJ22A | 22 V | 24.4-26.9 V | 35.5 V @ 11.3 A | OK, but standoff < 24 V (24 V source sits between VRWM and VBR: leakage, heating) |
| **SMAJ24A** | 24 V | 26.7-29.5 V | 38.9 V @ 10.3 A | 1.1 V under the 40 V transient limit; **above 35 V DC** |
| SMAJ26A | 26 V | 28.9-31.9 V | 42.1 V @ 9.5 A | **Exceeds 40 V**; reject |
- Choose SMAJ24A. Honest margin: effective dynamic resistance ~0.9 Ohm ((38.9-29.5)/10.3 A, calculated). Clamp is ~33 V at 3 A and ~36 V at 7 A; the 38.9 V point needs a 10 A surge. It exceeds the 35 V DC rating but stays under the 40 V/400 ms transient rating for microsecond-millisecond events. A 24 V steady source leaves no VRWM headroom (a 25 V source is still below VBR min 26.7 V, so only leakage rises). [A]
- Surge current estimate: hot-plug ringing on a 24 V source can reach ~2 x 24 V = 48 V open; with ~1.3 Ohm PTC + cable the TVS would see roughly (48-33)/1.3 = ~11 A peak for microseconds. [A] (worst-case bound, no cable L measured). Bench test it.
- Sustained overvoltage above VBR (>~27 V) makes the TVS conduct until the PTC trips; the TVS may fail short, which is the safe failure. [A]
- SOD-123FL (SMF24A) would be smaller but I read no datasheet for it. Not recommended until a VC at Ipp is verified.
- Ozdisan: STM SMAJ24A-TR <https://www.ozdisan.com/p/TVS-Diodes-386/stm-smaj24a-tr-653139> stock 3,095 (page 2026-10-14). HOTTECH SMAJ24A-HT <https://www.ozdisan.com/en/p/tvs-diodes-386/hottech-smaj24a-ht-512680> stock 85. ST datasheet not read (ST site unreachable); AOS numbers stand in. [V for AOS]

## 3. Overcurrent, inrush, input capacitor
- PTC must be rated >= 30 V at fault current. Listings seen on Ozdisan (hold/V from listing text only; datasheets not read):
  - Bel Fuse 0ZCG0050AF2C, 1812, 500 mA hold / 1 A trip / 30 V, Rmax ~1 Ohm: <https://www.ozdisan.com/en/p/ptc-resettable-fuses-845/bel-fuse-0zcg0050af2c-476999> stock **0**.
  - Bourns MF-MSMF075/24-2, 1812, 750 mA, **24 V**: <https://www.ozdisan.com/en/p/ptc-resettable-fuses-845/bourns-mf-msmf075-24-2-521686> stock 1,195. Fails the >=30 V rule; marginal at exactly 24 V.
  - Littelfuse 1812L020PR 200 mA 30 V stock 13,309: too small (needs >=0.4 A).
- Buck input current at 3.3 V x 0.5 A is ~0.37-0.40 A at 4.75 V, so a 0.5 A-hold part runs close to hold when warm (hold derates with temperature, typical 30-40% at 60 C [A]). A 0.75 A-hold, >=30 V part would be better; I found none in stock at Ozdisan. [A]
- A PTC is slow against a 24 V event; the TVS and the buck's 40 V rating carry the first milliseconds. The PTC sees TVS fault current and trips.
- Inrush: USB allows a 10 uF attach capacitance limit [D: task statement; spec not re-read]. Cin = one 10 uF part only (DC-bias derates it well below 10 uF at 5 V), with the 22 uF x2 Cout behind the buck 4 ms soft-start [V]. So the attach load is within the limit.
- MLCC DC bias: no vendor curve read. Typical 1206 X7R 10 uF: 25 V part keeps maybe 50-70% at 5 V and 20-35% at 20 V; 35 V parts do better. [A] Use >=35 V (>=25 V only if stock forces) and still keep 100 nF 0603/50 V at the VIN pin. Check Murata SimSurfing/Samsung SAT before release. Ozdisan: Samsung CL31B106KLK6PJE (35 V) stock 0; Murata GRM31CR71E106KA12L (25 V) stock 4: <https://www.ozdisan.com/en/p/smt-smd-and-mlcc-capacitors-184/murata-grm31cr71e106ka12l-737435>. TDK C3216X7R1H106K160AC (50 V) page showed stock 9 per search (not re-opened).
- Cout: Samsung CL21A226KOQNNNE 22 uF 16 V X5R 0805, stock 2,969: <https://www.ozdisan.com/en/p/smt-smd-and-mlcc-capacitors-184/samsung-cl21a226koqnnne-399002> (16 V rating keeps more capacitance at 3.3 V than a 6.3 V part).

## 4. USB data ESD without a VBUS reference
- USBLC6-2SC6 (SOT-23-6) has VBUS on pin 5 and rail clamps. Distributor parametrics show VRWM 5.25 V and VBR max ~6 V (Future Electronics listing). [D] I could not download the ST datasheet (st.com times out), so pin-5 abs max is not read. Because its VBUS diode is a ~5 V TVS, it must not be tied to a 20-24 V net; if tied to +3V3 it only references the clamp rail. Not recommended on VBUS; any other use is optional. [A]
- **TI TPD2E2U06DRL**: 2 channels (IO1 pin 3, IO2 pin 5, GND pin 4, pins 1-2 NC; no supply pin), SOT 5-pin 1.6 x 1.2 mm; CL 1.5 pF typ / 1.9 pF max at 2.5 V; VRWM 5.5 V; breakdown >=6.5 V; IEC 61000-4-2 +/-25 kV contact; 5.5 A Ipp 8/20 us; leakage 10 nA max. [V] <https://www.ti.com/lit/ds/symlink/tpd2e2u06.pdf>. Ozdisan: no listing found by search -> **stock unknown**.
- Ozdisan fallback seen: Nexperia PESD5V0S1BA,115 (SOD-323, single line) <https://www.ozdisan.com/en/p/tvs-diodes-386/nexperia-pesd5v0s1ba-115-488980> stock 14,676; capacitance not read (I recall ~150 pF, [A]), which is too high for a data line. Do not use without reading the datasheet.

## 5. USB Type-C / PD behaviour
- Source default without PD is 5 V only (default 56 kOhm Rp, 1.5 A 22 kOhm, 3 A 10 kOhm), sink presents Rd 5.1 kOhm. [D] Espressif <https://docs.espressif.com/projects/esp-iot-solution/en/latest/usb/usb_overview/usb_typec_hardware_guide.html>, TI SLYY228. I did not read the USB-IF spec text, so "vSafe5V only" is NOT VERIFIED from the spec.
- EPR levels (28/36/48 V, PD 3.1) require PD negotiation and EPR cables. [D] (same secondary sources). A compliant source cannot put >5 V on a non-PD Rd sink; the 9-24 V case is therefore only non-compliant sources or fault conditions. 24 V design limit covers 20 V PD but not an EPR source; 48 V is out of scope (buck abs max 35 V). [A]

## 6. Ozdisan availability (pages fetched 2026-10-14; stock = value on page)
| Part | URL | Stock |
|---|---|---|
| AP63203WU-7 | <https://www.ozdisan.com/en/p/dc-dc-switching-voltage-regulators-275/diodes-ap63203wu-7-736699> | **0** |
| SMAJ24A-TR | see section 2 | 3,095 |
| NR3015-4R7M (Core Master, 4.7 uH 3x3 mm) | <https://www.ozdisan.com/en/p/fixed-inductors-468/core-master-nr3015-4r7m-650649> | 1,482 |
| NR6028-4R7M (Core Master, 6x6 mm, 3.33 A listed) | <https://www.ozdisan.com/en/p/fixed-inductors-468/core-master-nr6028-4r7m-529360> | 148 |
| Coilcraft XGL3530-472MEC | <https://www.ozdisan.com/en/p/fixed-inductors-468/coilcraft-xgl3530-472mec-1042670> | 0 |
| 0ZCG0050AF2C | section 3 | 0 |
| TPS62932, TPD2E2U06, TPS54202 | none found | unknown |
LCSC shows AP63203WU-7 in stock 2,232 (<https://www.lcsc.com/product-detail/C780769.html>), a fallback supplier only. Inductor Isat/DCR for NR3015-4R7M not read; the Ozdisan description only gives a ~1 A rating.

## Recommendation
| Item | MPN | KiCad footprint |
|---|---|---|
| Buck | Diodes AP63203WU-7 | `Package_TO_SOT_SMD:TSOT-23-6` |
| Inductor | 4.7 uH, Isat >= 1 A (>= 3 A if possible), DCR < 100 mOhm; Core Master NR3015-4R7M (verify Isat), or NR6028-4R7M for headroom | `Inductor_SMD:L_Taiyo-Yuden_NR-30xx` (or `L_Taiyo-Yuden_NR-60xx`; verify land pattern against the vendor drawing) |
| TVS | SMAJ24A (STM SMAJ24A-TR), SMA, unidirectional, VBUS to GND | `Diode_SMD:D_SMA` |
| PTC | >=30 V, >=0.5 A hold, 1812: Bel 0ZCG0050AF2C (stock 0; look for 0.75 A hold >=30 V) | `Fuse:Fuse_1812_4532Metric` |
| Data ESD | TI TPD2E2U06DRL on D+/D- at the connector | `Package_TO_SOT_SMD:SOT-553` (assumed match for the 5-pin 1.6x1.2 mm part; check TI drawing) |
| Cin | 10 uF >=35 V X7R 1206 + 100 nF 50 V X7R 0603 at VIN pin | `Capacitor_SMD:C_1206_3216Metric`, `C_0603_1608Metric` |
| Cout | 2 x 22 uF 16 V X5R 0805 (CL21A226KOQNNNE) | `Capacitor_SMD:C_0805_2012Metric` |
| CBST | 100 nF 25 V X7R 0603 | `Capacitor_SMD:C_0603_1608Metric` |
Remove TLV75733P and TPS2553. Keep the 5.1 kOhm Rd on both CC pins. The USBLC6 VBUS pin is not used.

## Open questions / bench tests
1. Hot-plug a 20 V and a 24 V supply through 1-2 m of cable; scope VIN at the buck pins (peak must stay below 35 V, ideally < 32 V) and TVS current.
2. Inductor Isat/DCR for the chosen part and its short-circuit behaviour (peak limit 2.8 A typ). Read the datasheet.
3. 24 V steady-state: TVS leakage/temperature, buck and PTC temperature at 225 mA and 500 mA.
4. Hold-current margin of a 0.5 A PTC at 50-60 C inside the enclosure; find a >=30 V 0.75 A-hold part in stock.
5. MLCC DC-bias capacitance at 5 V and 24 V for the actual Cin; confirm the attach inrush (10 uF) with a scope.
6. Conducted/radiated emissions near the antenna and USB: 1.1 MHz harmonics, PFM burst noise on D+/D-.
7. Read the USB-IF Type-C 2.x / PD 3.1 text to promote section 5 from [D] to [V]; read ST USBLC6 and a TPD2E2U06 footprint drawing.
8. Source stock: AP63203WU-7 is 0 at Ozdisan; decide on LCSC fallback or a different buck. Confirm AP63203 lifecycle status.
