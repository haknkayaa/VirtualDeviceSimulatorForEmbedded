# Bridge One sourcing review — architect revision A

Date: 2026-10-14. This is a reviewed candidate BOM, not a procurement-ready
production BOM. Exact listing, inventory, electrical acceptance and footprint
acceptance are separate decisions.

Antigravity collected candidates. The architect independently matched supplier
Product metadata against exact MPNs, recorded timestamp/URL/response hash and
inventory declarations in `evidence/supplier-evidence.json`, checked selected
manufacturer datasheets and corrected circuit/quantity errors in `bom.csv`.
Unknown supplier references were removed rather than presented as verified URLs.

## Accepted documentary evidence

| Part | Intended role | Supplier evidence | Design acceptance |
| --- | --- | --- | --- |
| ESP32-S3-WROOM-1-N8R8 | Fixed MCU/core U1 | Ozdisan 1060517 exact listing; visible stock 0 | Fixed choice; procurement blocked |
| L-KLS1-5416-L1-01-R | USB-C/core J1 | Ozdisan 1564461 exact listing, reported in-stock | Manufacturer drawing found; footprint pending |
| LD1117AS33TR | 3.3 V/core U2 | Ozdisan 535478 exact listing, reported in-stock | Draft only; thermal/dropout/capacitor review pending |
| USBLC6-2SC6 | USB ESD/core U3 | Exact stock unresolved | Electrical draft; no procurement-ready claim |
| SN74AVC4T245PWR | SPI and UART translators | Ozdisan 433526 exact listing, reported in-stock | Proposed 3 chips: 2 SPI plus 1 UART |
| SN74AXC4T774RSVR | Four GPIO channels | Ozdisan 626987 exact listing, reported in-stock | Four DIR pins, one common OE; exact footprint pending |
| PCA9306DCTR | Two I2C ports | Ozdisan 738498 exact listing, reported in-stock | Bias/enable/equal-rail isolation circuit pending |
| PCA9306DCUR | Alternative I2C package | Ozdisan 527329 exact listing, reported in-stock | Qty 0; different footprint |
| RC0603FR-075K1L | Two CC pulldowns | Ozdisan 427375 exact listing, stock 0 | Alternate exact source pending |

Other passive/button/header candidates remain unverified by exact supplier SKU.
Their final quantities and footprints follow the accepted circuit. No negative
claim about all Robotistan or Direnc.net inventory is inferred from search misses.
No purchase, backorder or supplier communication has been performed.

## Circuit corrections

- N8R8 is 8 MB Quad flash and 8 MB Octal PSRAM. Exposed module pads 28/29/30 are
  unavailable for user IO; unexposed GPIO33/34 are not connector pins.
- SN74LVC2T45 has a shared DIR and cannot provide opposite UART TX/RX directions
  simultaneously. SN74LVC1T45 alone lacks the required controllable isolation.
- A 2+2-bank AVC4T245 cannot provide 3 incoming SPI signals and independently
  gated outgoing MISO in one chip. A dedicated MISO bank must not share OE with
  UART TX, or CS deassertion would disable UART. UART has its own proposed chip.
- DIR/OE control thresholds reference VCCA, so MCU 3.3 V is on A and target
  VTREF on B. Hardware pullups/isolation remain mandatory during MCU reset.
- AXC4T774 supplies independent DIR pins, with one common OE. Per-channel OE
  behavior must not be promised. It is not pin-compatible with AVC4T245.
- PCA9306 DCTR and DCUR use different packages. Both nominal target voltages and
  equal-rail operation need a reviewed bias/control circuit; no automatic layout
  substitution and no plain pulldown ratio asserted to be qualified.
- VTREF is supplied by the target, not bridge target-power output. Optional
  1.8 V bench supply is qty 0 in V1 and must prevent backfeed if later added.

## Electrical gates

LD1117A is rated 1 A. At a hypothetical continuous 500 mA load and 5 V input,
idealized dissipation is (5−3.3)×0.5 = 0.85 W, plus quiescent loss. This is a
calculation, not a measured temperature rise or a proven safe compact layout.
Use the actual PCB thermal environment and worst-case dropout/current budget.
The manufacturer calls for minimum 10 uF output capacitance; verify effective
capacitance under bias and the exact capacitor/stability behavior. A generic
0.1–1.0 ohm ESR window was not found in the reviewed LD1117A datasheet and is
not a released design requirement.

ESD candidates are not accepted from standoff voltage alone. Review residual
clamp voltage against protected-pin limits, power sequencing, PCB return path and
signal loading. No total capacitance or qualified SPI clock is inferred before
layout and measurement. PESD5V0U1UT is a sourced USB alternative; the current core
uses USBLC6-2SC6, so a substitution requires schematic and pinout review.

## Sources

- [MCU listing](https://www.ozdisan.com/p/wifi-modulleri-652/espressif-systems-esp32-s3-wroom-1-n8r8-1060517)
- [USB-C listing](https://www.ozdisan.com/p/usb-konnektorler-357/kls-electronic-l-kls1-5416-l1-01-r-1564461)
- [USB-C manufacturer drawing](https://img.klsele.com/admin/product_upload/20240806141040L-KLS1-5416-LX-XX-R.pdf)
- [AVC4T245 datasheet](https://www.ti.com/lit/ds/symlink/sn74avc4t245.pdf)
- [AXC4T774 datasheet](https://www.ti.com/lit/ds/symlink/sn74axc4t774.pdf)
- [PCA9306 datasheet](https://www.ti.com/lit/ds/symlink/pca9306.pdf)
- [LD1117A datasheet](https://www.st.com/resource/en/datasheet/ld1117a.pdf)
- [USBLC6 datasheet](https://www.st.com/resource/en/datasheet/usblc6-2.pdf)

The CSV retains exact manufacturer part and supplier evidence where verified.
It deliberately contains unresolved/TBD rows; it is not a bill of materials to
send directly to assembly. No final target-interface schematic exists yet.
