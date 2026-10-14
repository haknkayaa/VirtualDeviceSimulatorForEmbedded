# Bridge One auxiliary outputs: 5V_OUT and 3V3_OUT switch selection (J10 pins 21/23)

Date: 2026-10-14. Nothing here was measured on hardware. Tags: **[V]** VERIFIED (manufacturer datasheet PDF downloaded and read this session, text extracted with pdftotext), **[D]** DOCUMENTED-BUT-UNMEASURED (secondary/summary source, or datasheet not read), **[A]** ASSUMPTION or calculation.
Input facts (from `power-input-universal.md`): VBUS after PTC + SMAJ24A sees 5 V normally, up to 24 V steady (non-compliant source), clamp ~38.9 V at 10 A. 3V3 is the AP63203 buck rail (2 A class, inductor ~1 A, board load <=225 mA).

## 1. 5V_OUT: candidate screening (hard filter = abs max IN must exceed ~39 V clamp, or the part needs its own clamp)
| Part | Datasheet fact | Verdict |
|---|---|---|
| TI TPD1S514 | OVP up to 30 V DC at VBUS_CON, **abs max 30 V**; WCSP-12 1.29x1.99 mm; no current limit (3.5 A abs); OVP is a clamp/switch for 5/9/12 V buses [V] (SLVSCF6F, p.5) | Reject: abs max < 39 V clamp, no ILIM, WCSP too fine for this board. |
| TI TPS25947 | Rec. VIN 2.7-23 V, **abs max 28 V**, 5.5 A class, adjustable OVLO 0.5-1.5 V pin [V] (SLVSFC9C) | Reject: 28 V < clamp; ILM min 549 ohm means limit far above 0.5 A. |
| TI TPS2595x | **Abs max IN 20 V**, FLT pin [V] (7.1 table) | Reject: cannot see 24 V. |
| TI TPS26600 (TPS2660 family) | **Abs max IN 62 V (70 V 10 ms)**, op. 4.2-60 V; adjustable OVP (1.19 V rising / 1.10 V falling pin thresholds, 1.17-1.225 V), adjustable UVLO (same thresholds), ILIM by resistor 0.1-2.23 A, back-to-back FETs with true reverse-current blocking (reverse comparator -10 mV typ, forward +96 mV), 150 mohm, FLT open-drain, MODE pin, IMON; TPS26600 = auto-retry, TPS26601 = latch, TPS26602 = fixed 38 V clamp instead of OVP cut-off [V] (SLVSDG2G) | **Best fit.** |
| ON NCP360/NCP361, Richtek RT9718, Diodes AP22814/AP22652, Toshiba TCKE8xx | Datasheets NOT read. From memory these are 5.5-6 V-class or <=28 V parts (NCP36x abs max ~20 V; AP22xxx 5.5-6 V) [A] | Not evaluated; reject on the assumption they cannot see 39 V. Verify only if TPS26600 is unobtainable. |
Other ideas not read: LTC4365-class OVP controller + external FETs (no ILIM), TPS25940-class (not read) [A].

### TPS26600PWPR details [V unless tagged]
- OVP: factory 32.6 V only when OVP pin grounded; with divider rising 1.19 V, falling 1.10 V. Divider 100 k (top) / 24.9 k (bottom), 1%: rising trip = 1.19 x 124.9/24.9 = **5.97 V nominal**, ~5.8-6.2 V with 1.17-1.225 V and 1% parts; falling trip ~5.5 V nominal (min ~5.4 V). USB max 5.25 V stays below the lowest rising trip; hysteresis recovers between 5.4 and 5.6 V. Calculated [A]; thresholds [V]. Divider current ~48 uA.
- UVLO: divider 100 k / 37.4 k gives rising ~4.37 V, falling ~4.04 V [A, calc]; internal POR 3.9-4.1 V [V], so output simply stays off below ~4.4 V VBUS. Operating min 4.2 V [V].
- Current limit: I = 12 k / RILIM (data points 12 k = 1.0 A +/-5%, 8 k = 1.5 A, 5.36 k = 2.23 A, 120 k = 0.1 A +/-15%) [V]. **RILIM = 24.0 k (E96 24.3 k) for ~0.5 A**; accuracy at 0.5 A is not specified (interpolating, ~+/-8-10%) [A]. Short-circuit limit tracks the same RILIM [V]. MODE open = circuit breaker with auto-retry (TPS26600) [V].
- Reverse blocking: IN-OUT back-to-back FETs, blocks when OUT > IN by ~10 mV; a user device with its own 5 V cannot back-feed VBUS [V]. Bench-verify with VBUS absent and with 6-24 V on VBUS.
- Enable: SHDN has an internal source (V(SHDN) 2.7 V typ at 0.1 uA, shutdown below 0.55-0.94 V) so a **floating SHDN = ON** [V]. Add 10 k pull-down SHDN-GND plus ESP32 GPIO push-pull drive (pin rated 4 V) for default OFF; confirm the pull-down actually wins on the bench [A]. Iq 20 uA off / 300 uA on [V].
- Power budget catch [A]: 0.5 A out + up to ~0.4 A board draw at 5 V exceeds a 0.5 A-hold PTC and a USB 0.5 A default budget. Either limit 5V_OUT to ~0.3 A (RILIM 39 k) or size PTC/USB budget for it; decision needed.
- Package: HTSSOP-16 exposed pad, 5.0x4.4 mm, RthetaJA 38.6 C/W [V]. KiCad: `Package_SO:HTSSOP-16-1EP_4.4x5mm_P0.65mm_EP3.4x5mm` (exists; EP size/pin match to the TI PWP drawing not compared [A]).
- Sourcing: LCSC C544399 TPS26600PWPR, **stock 6,312** (page fetched 2026-10-14, $1.55 at 1 pc) <https://www.lcsc.com/product-detail/C544399.html>. Ozdisan: **no listing found** (web search restricted to ozdisan.com, 2026-10-14) -> stock unknown. Robotistan/Direnc.net not checked. DigiKey page reported out of stock via search summary [D].

## 2. 3V3_OUT: candidates (rail <=5.5 V, so TI/Diodes small switches are fine)
| Part | Fact | Verdict |
|---|---|---|
| TI TPS2553DBVR | 2.5-6.5 V (abs 7 V), adjustable ILIM 75 mA-1.7 A, +/-6% only at 1.7 A, SOT-23-6, 2 us short response, constant-current limit with FAULT (open-drain), EN active-high (no internal pull, +/-0.5 uA), reverse-voltage comparator (VOUT-VIN trip 95/135/190 mV, turn-off 3-7 ms), reverse leakage 0.01 uA typ / 1 uA max with VIN=0 V, UVLO 2.35-2.45 V, IIN off 0.1 uA [V] (SLVS841F) | **Pick.** |
| TI TPS22919 | 1.6-5.5 V, 1.5 A, no adjustable limit; short protection ISC 3 A typ (detect VIN-VOUT 0.3-0.46 V) [V] | Reject: a 3 A short pulse on a 2 A buck/1 A inductor browns out the rail. |
| TPS2051/TPS2065, AP2331, AP22802, MIC2005, SiP32431 | Datasheets not read. TPS2051/MIC2005 class: fixed limit ~0.5-1 A, not 300 mA [A]. AP2331/SiP32431 are plain load switches without ILIM [A] | Not selected. |
- ILIM math from the datasheet equations IOS nom = 23950/R^0.977, min = 25230/R^1.016, max = 22980/R^0.94 (mA, kohm): **RILIM = 88.7 k (E96, 1%)** gives ~300 mA nominal, **~265 mA min, ~340 mA max** (resistor tolerance excluded) [V equations, A application]. Design the accessory spec as 250 mA guaranteed. 1.0 W dissipates in the switch in a hard short (3.3 V x 0.3 A): expect thermal cycling, not damage [A].
- Brown-out safety: short adds <=0.34 A to the 225 mA board load = ~0.57 A, well inside the buck (limit ~2.8 A) [A, uses power-input note]. Add >=22 uF on OUT only if the user load is capacitive; soft start tr 1.1-1.5 ms is built in [V]. Keep IN decoupled (>=0.1 uF [V], 1-10 uF recommended).
- Reverse behavior: if the user's rail exceeds 3V3 by >~190 mV the comparator opens the switch within ~7 ms and asserts FAULT [V]; while on, a rail within +-100 mV of ours can still share current, so label "output only" [A].
- Enable: EN active-high, input floats undefined -> 100 k pull-down, ESP32 GPIO enables after boot (default OFF) [A, since IEN is only +/-0.5 uA].
- Package/footprint: SOT-23-6 DBV 2.9x1.6 mm [V]; KiCad `Package_TO_SOT_SMD:SOT-23-6` (exists). Pinout IN1 GND2 EN3 FAULT4 ILIM5 OUT6 [V].
- Sourcing: Ozdisan TPS2553DBVR **stock 340** (MPQ 3000, $0.60 at 1 pc; page fetched 2026-10-14; a search summary showed 427 so stock moves) <https://www.ozdisan.com/en/p/power-switches-283/texas-tps2553dbvr-607422>. LCSC: not found in the jlcsearch query or the lcsc search page (unknown, not confirmed absent).

## 3. Flags, protection, labels
- **FAULT/FLT to ESP32?** Not worth two GPIOs. TPS2660 FLT and TPS2553 FAULT are open-drain (60 V / 7 V rated) [V]; if one spare GPIO exists, wire-OR both to it with a 100 k pull-up to +3V3 (firmware disambiguates by toggling enables), mounted via 0 ohm option. Otherwise leave FLT/FAULT to a red LED each (3V3 via 1 k) and skip IMON [A]. Enables are required (2 GPIOs, or an expander) because default-OFF is a stated requirement.
- **Header TVS/ESD:** 5V_OUT: unidirectional 5 V TVS to GND at the pin (e.g. SMF5.0A SOD-123FL) plus 10 uF 16 V + 100 nF at OUT (TPS2660 needs OUT >=0.1 uF [V]). 3V3_OUT: 3.3 V TVS (SMF3.3A-class) and 10 uF. Both are [A]: datasheets not read, stock not checked; choose VRWM >= rail so leakage does not load it. TPS2553 claims 15 kV IEC with external capacitance [V]. Keep GND pins 22/24 adjacent.
- **Labels (silkscreen near J10 and in README):** `5V_OUT 0.5A MAX, OFF >6V VBUS`, `3V3_OUT 0.3A MAX`, `OUT ONLY - DO NOT BACKFEED`, and note that 5V_OUT can be absent when a 9-24 V source is attached; add a green LED on 5V_OUT/3V3_OUT (after the switch) so the user sees the real state.

## Recommendation
| Function | MPN | Footprint | Supporting passives |
|---|---|---|---|
| 5V_OUT switch | TI **TPS26600PWPR** | `Package_SO:HTSSOP-16-1EP_4.4x5mm_P0.65mm_EP3.4x5mm` | OVP divider 100 k / 24.9 k 1%; UVLO divider 100 k / 37.4 k 1%; RILIM 24.3 k 1% (0.3 A option: 39 k); SHDN 10 k pull-down; MODE open; dVdT open or 10 nF; IN 1 uF + 0.1 uF (25 V+); OUT 10 uF 16 V + 0.1 uF; FLT 100 k pull-up (optional); 5 V TVS at pin |
| 3V3_OUT switch | TI **TPS2553DBVR** | `Package_TO_SOT_SMD:SOT-23-6` | RILIM 88.7 k 1%; EN 100 k pull-down; IN 1 uF; OUT 10 uF; FAULT 100 k pull-up (optional); 3.3 V TVS at pin |
Resistors/caps: `Resistor_SMD:R_0402_1005Metric` or 0603, `Capacitor_SMD:C_0603_1608Metric` / `C_0805_2012Metric`. Source TPS2553 at Ozdisan (340); TPS26600 only confirmed at LCSC C544399 (6,312) as fallback supplier.

## Open questions / bench tests
1. Confirm Ozdisan/Robotistan/Direnc availability of TPS26600PWPR (or accept LCSC) before schematic release; no purchase implied.
2. Sweep VBUS 0-24 V (and 28 V pulses): 5V_OUT must be 0 V from the OVP rising trip (~5.8-6.2 V) up; scope OUT during a 24 V hot-plug, IN-pin peak with TVS clamping.
3. Measure actual current limit at 0.5 A setting (spec gives no accuracy at 0.5 A) and short-circuit retry period/thermal behavior; check SHDN pull-down defaults OFF at power-up before GPIO is configured.
4. Backfeed: user 5 V on 5V_OUT with VBUS absent, with 5 V VBUS, and with 9-24 V VBUS; user 3.3 V on 3V3_OUT in all states.
5. 3V3_OUT hard short while ESP32 runs Wi-Fi: 3V3 droop/ripple, brown-out reset, buck inductor current.
6. Decide 5V_OUT budget vs PTC hold (0.5 A) and USB 500 mA default (section 1); choose 0.3 A or a larger PTC.
7. Read TVS datasheets (SMF5.0A/SMF3.3A), confirm TPS26600 EP/footprint vs TI PWP drawing, and decide whether a shared FAULT GPIO exists in the pin allocation.
8. Decide whether OVP "hiccup/auto-retry" (TPS26600) or latch (TPS26601, stock not checked) is wanted after a short.
