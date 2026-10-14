# Bridge One release gates and validation plan

Revision A, 2026-10-14. Documentary review and planned measurements are separate.
No target-board or logic-analyzer measurements have been made in this session.

## Capability matrix

| Requirement | Documentary status | Physical qualification needed | Release decision |
| --- | --- | --- | --- |
| ESP32-S3 two I2C controllers | Supported by Espressif | Concurrent operation in selected IDF build | Provision both controller pin pairs |
| Multiple arbitrary addresses on one controller | Not established by standard slave API | Address-match register and driver proof | Do not advertise |
| Two distinct addresses, two controllers, one physical bus | Proposed wiring option | No false ACK, independent state, stretched clocks, repeated START | DNP shared-bus links only |
| I2C register-pointer write then repeated-START read | API callbacks alone are insufficient evidence | First read byte must use latest pointer without STOP | Gate for register/EEPROM profiles |
| SPI full-duplex prequeued response | Documented driver behavior | Burst spacing, CS framing, lengths and underrun | Characterization endpoint only |
| SPI arbitrary opcode/address response within one CS assertion | No general solution established in standard driver | Different opcodes/addresses back-to-back with no new target handshake | Block full peripheral-emulation claim |
| UART full duplex and GPIO levels | Hardware resources available | Latency, buffering, safe reset/isolation | Conditional draft provision |
| 1.8 V and 3.3 V target electrical compatibility | Depends on selected translators | Power sequencing, loading, inactive target, bus levels | No direct S3-to-target wiring |
| PC-authoritative local cache | New architecture required | Ordered journal, side effects, offline and reconciliation tests | Protocol/firmware ADR required |

ESP-IDF 5.5.3 is the research baseline, not a firmware version silently selected
for production. Record exact IDF tag, compiler, CPU clock, configuration and
firmware hash with every measurement; requalify if these change.

## I2C qualification

Use a physical target/controller and logic analyzer on both sides of the level
translator. Begin at 100 kHz, then qualify 400 kHz separately at each VTREF.

1. Test all selected and neighboring addresses. Only configured addresses ACK;
   no general-call/broadcast behavior unless explicitly included in the profile.
2. If the two-controller shared-bus assembly is evaluated, configure different
   addresses, interleave requests, and ensure neither controller affects the
   other device's pointer, FIFO, ACK or stretching state.
3. Send pointer writes followed by repeated START and immediate read, without
   STOP or an extra driver delay. Test multi-byte pointers and first-byte return
   ordering against the device profile, not against prefilled happy-path data.
4. Test partial writes, address-only probes, final read NACK, short reads, FIFO
   boundaries, abort/restart and recovery after SDA held low.
5. Measure worst-case SCL stretching under USB traffic and concurrent UART/GPIO
   activity; compare against the *actual target controller's* stretch timeout.
6. Exercise write side effects and read-clear twice before the PC round trip,
   then verify ordered reconciliation and the bytes already observed by target.

Passing a distribution tool against a physical controller can provide evidence,
but this is different from Linux CUSE host-adapter ABI conformance. No existing
host-adapter tests are part of this hardware design pass.

## SPI qualification

Do not equate Espressif's peripheral SCLK ceiling with a qualified Bridge One
clock or a command decoder's latency budget. Start low and sweep only after
functional transactions work. Record setup/hold margin including translators,
protection capacitance, connector/cable and target sampling behavior.

1. Use an unchanged real peripheral driver transaction: opcode, address and
   optional dummy bytes followed by the data clocks under continuous CS.
2. Alternate two commands that require different responses, and two register
   addresses, without telling firmware in advance which will arrive. An always
   prefilled ID response is not evidence of general decoding.
3. Test CPOL/CPHA modes independently, one-byte/non-word-aligned transfers,
   short CS pulses, immediate back-to-back CS assertions and long bursts.
4. Test DMA and non-DMA paths separately. No padding requirement may be imposed
   on a production peripheral protocol just to satisfy DMA buffers.
5. Observe MISO after CS deassertion and during reset, offline and missing VTREF.
   Confirm no contention when a second real peripheral shares the bus.
6. Introduce USB/CPU load and profile updates at idle boundaries. Record underrun
   detection and failed-run behavior, not just average transaction throughput.

If same-CS decoding fails, choose explicitly between a narrower supported device
profile, a qualified custom local execution path, or an added deterministic bus
engine. Do not silently switch V1 to V2 or require simulator APIs in target code.

## Electrical and CAD gates

- Exact supplier variants, manufacturer datasheets and footprints checked.
- USB connector pad geometry and duplicated-contact wiring checked.
- Power budget before and after enumeration, regulator transient/thermal margin,
  VBUS inrush and power-off/backfeed behavior checked.
- VTREF nominal range, tolerance, power sequencing and open-drain pullups checked.
- Every translator DIR/OE truth table, reset pull and CS-dependent MISO enable
  reviewed. Unused CMOS inputs have defined levels.
- Schematic netlist independently compared to the pin/BOM manifest; ERC findings
  reviewed. File parsing or MCP component counts are not sufficient for release.
- Four-layer PCB stack, antenna keepout, return paths, differential USB routing,
  connector ESD placement and final DRC reviewed after layout exists.

Fabrication outputs and purchase orders are out of scope until these gates close.
