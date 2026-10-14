# Bridge One rev F: LCSC / JLCPCB availability check

Observed 2026-10-14. Not procurement authorization. Stock changes hourly.

Method (all live queries this session):
- Stock, price, Basic/Extended: JLCPCB parts API (`componentLibraryType` base=Basic, expand=Extended; `stockCount`; price ladder at qty 10). **VERIFIED** per row.
- LCSC numbers for MPNs: found via web search of lcsc.com/jlcpcb.com pages, then re-checked by querying the C-number in the JLCPCB API (MPN, package, stock matched).
- The jlcsearch.tscircuit.com MPN search returned unrelated parts for every MPN tried, so it was NOT used.
- LCSC's own endpoint (wmsc) disagreed with JLCPCB on some stock (ESP32 C2913201: 0 vs 5120; USB4105-GF-A: 0 in both). Where they differ, the JLCPCB figure is shown and the conflict noted. Re-check before ordering.
- Package match: LCSC package string vs KiCad footprint name only. No land-pattern/datasheet drawing comparison was done, so all footprint matches are **ASSUMPTION** unless stated.
- Datasheets were NOT opened this session. Drop-in alternatives are therefore parametric/package matches from the LCSC listing, not datasheet-verified.

## Table (E = Extended, B = Basic)

| Ref | Part (MPN) | LCSC | Stock (JLC) | $ @10 | Class | Package vs KiCad footprint | Notes |
|---|---|---|---|---|---|---|---|
| U1 | ESP32-S3-WROOM-1-N8R8 | C2913201 | 5120 (LCSC page: 0) | 4.40 | E | SMD 25.5x18 = RF_Module ESP32-S3-WROOM-1 | Stock conflict. Ozdisan shows 0 (bom.csv). Active, Espressif. |
| U3 | iCE40UP5K-SG48I (LCSC lists no "TR" suffix) | C2678152 | 682 | 9.38 | E | QFN-48-EP 7x7 = QFN-48-1EP_7x7 P0.5 | Low stock. TR suffix is packaging only (ASSUMPTION). |
| U14 | AP63203WU-7 | C780769 | 7112 | 1.06 | E | TSOT-23-6 = TSOT-23-6 | Also Diodes lists AP63203QWU-7 (automotive, C5248536), a different part. |
| D11 | SMAJ24A (Littelfuse) | C148222 | 17342 | 0.164 | E | DO-214AC (SMA) = D_SMA | Alt: GOODWORK SMAJ24A C908774, stock 175680 (leakage 5 uA vs 1 uA per search snippet). |
| D1 | TPD2E2U06DRLR | C1972959 | 6001 | 0.324 | E | SOT-553-5 = SOT-553 | OK. |
| U8,U9 | PCA9306DCUR | C33196 | 11098 | 0.610 | E | VSSOP-8 = VSSOP-8_2.3x2mm P0.5 | OK. bom.csv still carries DCTR (qty 2); placement uses DCU. |
| U6,U7,U10 | SN74AVC4T245RSVR | C133244 | 48465 | 0.321 | E | UQFN-16 1.8x2.6 = UQFN-16_1.8x2.6 P0.4 | OK. |
| U11,U13 | SN74AXC4T774RSVR | C1849454 | 4707 | 0.839 | E | UQFN-16 1.8x2.6 = same | OK. |
| D6-D10 | TPD4E05U06DQAR | C138714 | 94130 | 0.082 | E | USON-10 1x2.5 = USON-10_2.5x1.0 P0.5 | OK. Several clones carry the same MPN as DFN2510-10 (e.g. C2972498); not checked. |
| U5 | TLV75712PDBVR | C1509296 | 5125 | 0.278 | E | SOT-23-5 = SOT-23-5 | OK. |
| U12 | SN74LVC1G08DBVR | C7666 | 73239 | 0.045 | E | SOT-23-5 = SOT-23-5 | OK. |
| J6 | FH12-30S-0.5SH(55) | C506793 | 3355 | 0.574 | E | SMD P0.5 30P = Hirose_FH12-30S-0.5SH | OK. Not FH12S (C3169607). |
| J1 | USB4105-GF-A (GCT) | C3020560 | 0 | 1.08 | E | listed "12P" | **Out of stock.** LCSC attr says 12P while the footprint is 16P; do not order without reading the GCT drawing. |
| J1 alt | USB4105-GF-A-120 | C5184243 | 2022 | 0.72 | E | listed "16P" | In stock. Suffix meaning and footprint identity with -A are **ASSUMPTION**. KLS L-KLS1-5416-L1-01-R: no JLC/LCSC listing found (searched). |
| SW1,SW2 | EVQP7A01P | C79167 | 5314 | 0.196 | E | SMD 3.6x3.5 = SW_SPST_EVQP7A | OK. |
| U4 | APS6404L-3SQR-SN (ASSUMED exact variant) | C5333729 | 4336 | 3.49 | E | SOP-8 = SOIC-8_3.9x4.9 | 3.3 V part (2.7-3.3 V). ZR variant is USON-8 (C3040877), not same footprint. |
| L1 | NR3015T4R7M (Taiyo Yuden) | C87172 | 0 | 0.071 | E | SMD 3x3 = L_Taiyo-Yuden_NR-30xx | **Out of stock.** CEC NR3015-4R7M C5176503 also 0. Alt: Coilank NR3015N4R7A C47327025, stock 1361, 1.09 A Isat, 123 mohm, ±30% (ASSUMED 3x3x1.5; Isat vs AP63203 ripple/peak not checked). |
| Y1 | 12 MHz 2016 osc (ASSUMED) YXC OT201612MJBA4SL | C669076 | 4000 | 0.54 | E | SMD2016-4P = SiT PQFN-4 2.0x1.6 | 1.8-3.3 V CMOS. Pad pattern and pinout compatibility with the SiT footprint **ASSUMPTION**. No SiTime 12 MHz 2016 part found in stock. |
| F1 | PTC 0.5 A 30 V 1812 (ASSUMED) BSMD1812-050-30V | C883141 | 61804 | 0.057 | E | 1812 = Fuse_1812 | Hold 0.5 A, 1.4 ohm max listed. |
| C1 | 10u 35V 1206 (ASSUMED) GMK316BJ106KL-T | C92797 | 26186 | 0.190 | E | 1206 = C_1206 | X5R. DC bias derating at 24 V not checked. |
| C2,C3 | 22u 0805 (ASSUMED) CL21A226MAQNNNE | C45783 | 3398290 | 0.237 | B | 0805 = C_0805 | 25 V X5R. |
| C5, 0603 100n 50V | CC0603KRX7R9BB104 | C14663 | 51.5M | 0.014 | B | 0603 | OK. |
| C4,C10-C13.. | 100n 0402 16V CL05B104KO5NNNC | C1525 | 22.98M | 0.0046 | B | 0402 | OK. |
| C20,C21 | 1u 0402 CL05A105KA5NQNC | C52923 | 7.63M | 0.0079 | B | 0402 | OK. |
| C22 | 2u2 0402 CL05A225MQ5NSNC | C12530 | 4.58M | 0.0054 | B | 0402 | 6.3 V rating. |
| R1,R2 | 5k1 0402 0402WGF5101TCE | C25905 | 5.36M | 0.0024 | B | 0402 | OK. |
| R20 | 910k 0402 0402WGF9103TCE | C25800 | 7937 | 0.0018 | E | 0402 | Only extended 910k found; no Basic 910k. |
| D2-D5 | LED 0603 (color ASSUMED red) KT-0603R | C2286 | 7.9M | 0.0076 | B | 0603 | Basic green not found in stock (C72043 stock 0). |
| U15 | 5V_OUT OVP switch (candidate) | none chosen | n/a | n/a | n/a | SOT-23-6 | Not a concrete MPN; TPS2553DBVR C55266 (stock 54620, E) is a current-limit switch, NOT OVP. **ASSUMPTION** it is a placeholder only. |
| U16 | 3V3_OUT limit switch (candidate) | none chosen | n/a | n/a | n/a | SOT-23-5 | Needs an MPN. TPS22918 is SOT-23-6, not a drop-in. |
| J3 | 2x20 2.54 header | C25503140 (HanElectricity 2541WV-2x20P) | 4010 | 0.138 | E | THT | THT; footprint and 6 mm/3 mm height are **ASSUMPTION**. |
| J10 | 2x12 2.54 header | C53202169 (LXWCONN 254PM-2x12P-V) | 1761 | 0.128 | E | THT | Same caveats. |
| DS1, H1-H4 | OLED module, mounting holes | n/a | n/a | n/a | n/a | n/a | Not LCSC assembly items. |

## (1) Out of stock / extended-only, with alternatives
- Out of stock (JLC): L1 NR3015T4R7M and CEC equivalent (both 0); USB4105-GF-A (0). Suggested: Coilank NR3015N4R7A (C47327025) and USB4105-GF-A-120 (C5184243). Both are **ASSUMPTION** pending the vendor drawings. The inductor swap needs an Isat check against the AP63203 datasheet.
- ESP32-S3-WROOM-1-N8R8: JLC says 5120, LCSC page says 0. Treat as unconfirmed.
- Nearly every IC/connector is Extended because JLC has no Basic equivalent; none has a Basic same-footprint substitute that was identified. Only R/C/LED are Basic.
- 910k (R20): Extended. A Basic substitute would change the divider, so it needs a circuit decision.
- U15/U16 have no MPN, so availability is unknown.
- iCE40UP5K: 682 in stock, single source, thin margin for a volume build.

## (2) Estimated extended-part fee count
Unique Extended lines on SMT: U1, U3, U14, L1, F1, D11, C1, D1, R20, D6-D10 (1 line), U4, U5, Y1, U12, J6, U8/U9 (1), AVC4T245 (1), AXC4T774 (1), SW (1), J1, U15, U16 = **22** (20 if U15/U16 turn out Basic, which is unlikely). Plus 2 THT headers (J3, J10) if JLCPCB assembles them, **24** maximum. At the commonly quoted $3 per unique Extended part this is about $66 to $72 (**ASSUMPTION**; the fee level was not checked this session). Basic lines: 7.

## (3) Single-sided assembly
- By part type, the bottom side holds 8 of the 22 Extended lines (F1, D11, C1, D1, R20, D6-D10, U15, U16), so moving them would not reduce the Extended fee count. Savings would come only from the process: JLCPCB's economic assembly is, as I recall, single-sided and a second side adds setup/stencil cost (**ASSUMPTION**, not verified here).
- Moving 26 parts to the top is likely to hurt the compact 76x50 layout (the USB-C input protection chain and ESD arrays sit there). Single-sided is probably worth it only if a layout pass shows no area penalty. Recommendation: keep two-sided for the prototype and get an actual JLCPCB quote for both variants before deciding.
