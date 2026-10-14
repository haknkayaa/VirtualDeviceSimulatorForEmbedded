# ESP32-S3 I2C slave feasibility — Task A

2026-10-14 • ESP-IDF **v5.5.3**, slave v2 • ESP32-S3-WROOM-1-N8R8

**Decision — ASSUMPTION:** PC-supplied first-byte responses are plausible on a qualified stretching-capable master; **complete AT24C256 emulation with no local model cache is not established by stock slave v2**. Read-address stretching and pointer delivery have source support. Timeout behavior, address NACK/busy timing, long reads and actual-byte accounting remain blockers. [D][T][E]

Labels: **VERIFIED** means inspected primary-source fact, not a measured capability; **DOCUMENTED-BUT-UNMEASURED** means documented electrical/runtime behavior awaiting bench proof; **ASSUMPTION** means inference or proposed engineering choice. No firmware, hardware or ABI tests were run. Required local design/handoff files were read; only this output file was written.

## Primary sources inspected

- [D] [IDF v5.5.3 slave-v2 implementation](https://github.com/espressif/esp-idf/blob/v5.5.3/components/esp_driver_i2c/i2c_slave_v2.c), especially lines 65–214, 303–334, 355–422.
- [H] [IDF v5.5.3 slave API](https://github.com/espressif/esp-idf/blob/v5.5.3/components/esp_driver_i2c/include/driver/i2c_slave.h), v2 branch; [callback event types](https://github.com/espressif/esp-idf/blob/v5.5.3/components/esp_driver_i2c/include/driver/i2c_types.h); [HAL initialization](https://github.com/espressif/esp-idf/blob/v5.5.3/components/hal/i2c_hal.c#L14-L24).
- [L] [S3 low-level HAL](https://github.com/espressif/esp-idf/blob/v5.5.3/components/hal/esp32s3/include/hal/i2c_ll.h), stretch helpers, timeout helpers/constants and interrupt masks.
- [R] [S3 register definitions](https://github.com/espressif/esp-idf/blob/v5.5.3/components/soc/esp32s3/register/soc/i2c_reg.h); [S3 capabilities](https://github.com/espressif/esp-idf/blob/v5.5.3/components/soc/esp32s3/include/soc/soc_caps.h).
- [T] [ESP32-S3 TRM v1.8](https://www.espressif.com/sites/default/files/documentation/esp32-s3_technical_reference_manual_en.pdf), §§27.4.3, 27.4.5, 27.4.8, 27.4.12; register descriptions 27.12, 27.13, 27.18 and FSM timeout registers. Printed pages 989, 992–993, 995 and 1026. PDF fetched and extracted in memory.
- [E] [Microchip/Atmel AT24C128C/AT24C256C datasheet DS20006270B](https://ww1.microchip.com/downloads/en/DeviceDoc/AT24C128C-AT24C256C-Data-Sheet-DS20006270B.pdf), §§7.1–7.4, 8.1–8.3. **ASSUMPTION:** the C variant is the protocol reference here; freeze the exact original AT24C256 revision separately before claiming variant-exact fidelity.
- [P] [Raspberry Pi BCM2711 peripherals manual](https://datasheets.raspberrypi.com/bcm2711/bcm2711-peripherals.pdf), §3.1 and CLKT register, printed pages 24, 29.
- [K] Linux **v6.12** illustrative baseline, not a claim about every Yocto kernel: [BCM2835/2711 adapter](https://kernel.googlesource.com/pub/scm/linux/kernel/git/torvalds/linux/+/refs/tags/v6.12/drivers/i2c/busses/i2c-bcm2835.c), [I2C core](https://github.com/torvalds/linux/blob/v6.12/drivers/i2c/i2c-core-base.c#L1536-L1538), [i2c-dev timeout ioctl](https://github.com/torvalds/linux/blob/v6.12/drivers/i2c/i2c-dev.c#L490-L497), [at24 driver](https://github.com/torvalds/linux/blob/v6.12/drivers/misc/eeprom/at24.c).

## 1. READ stretching and duration

**DOCUMENTED-BUT-UNMEASURED:** Yes, S3 hardware can hold SCL low when its address matches with R/W=1, before read data. It also stretches on TX-empty, RX-full, and controlled byte ACK. Firmware releases stretching using `I2C_SLAVE_SCL_STRETCH_CLR`. [T §27.4.3]

| Register / field | VERIFIED role from tagged source/TRM |
| --- | --- |
| `I2C_SCL_STRETCH_CONF_REG`, offset `0x84` | `STRETCH_PROTECT_NUM[9:0]`, `SLAVE_SCL_STRETCH_EN[10]`, `SLAVE_SCL_STRETCH_CLR[11]`, byte ACK control/level `[12]/[13]`. [R][T] |
| `I2C_SR_REG`, `0x08` | `STRETCH_CAUSE[15:14]`: 0 read-address match, 1 TX-empty, 2 RX-full. [R][L] |
| `I2C_TO_REG`, `0x0c` | `TIME_OUT_VALUE[4:0]`, separate enable `[5]`; exponent-based SCL timeout. [R][T] |
| `I2C_SCL_ST_TIME_OUT_REG`, `0x78`; `I2C_SCL_MAIN_ST_TIME_OUT_REG`, `0x7c` | Separate FSM timeout exponents; both reset to 16. [R][T] |

**VERIFIED:** `i2c_new_slave_device()` enables stretching and sets protection to `I2C_LL_STRETCH_PROTECT_TIME = 0x3ff`. On read-address stretch, the ISR calls `on_request` and leaves the stretch asserted; later `i2c_slave_write()` queues/fills data and clears it. Both callbacks execute in ISR context. The API has **no public slave stretch-duration setting**; `i2c_slave_write(timeout_ms)` is a software wait budget, not an SCL deadline. [D][H][L]

**ASSUMPTION:** Use an ISR-safe queue notification, return from the callback, obtain the PC response in a task, then call `i2c_slave_write()`. Do not perform a blocking 1–3 ms USB exchange inside the ISR. This is a proposed use of the documented deferred write path, not a tested USB-latency guarantee. [D][H]

**VERIFIED / maximum-duration limitation:** `STRETCH_PROTECT_NUM` is described as release timing protection, normally larger than SDA setup time. Its 10-bit width is **not evidence of a 1023-cycle maximum PC wait**. TRM §27.4.8 separately states that the two FSM timers are always enabled, use `2^n / f_I2C_SCLK`, and permit **n ≤ 22**. The tagged register comments instead suggest a boundary around 23; use the stricter TRM limit pending Espressif clarification. The optional SCL timer uses `2^TIME_OUT_VALUE / f_I2C_SCLK`, with a 5-bit field; driver initialization sets its value to 31 but does not explicitly enable it. [T][R][D][L]

**ASSUMPTION, numerical illustration:** At an actual internal I2C clock of 40 MHz, FSM reset n=16 corresponds to **1.6384 ms**; n=22 corresponds to **104.8576 ms**. These are internal-clock calculations, not 100/400 kHz wire-clock calculations. Whether FSM timers continue counting during intentional slave stretch is not explicitly resolved by the cited sections. Consequently **no unconditional maximum usable stretch duration, or stock-driver 3 ms guarantee, can be certified**. Read back clocks/timers and measure; the master and software transaction deadlines may expire sooner. [T][R]

**VERIFIED:** On TX-empty, `i2c_slave_handle_stretch_event()` tries the TX ring and **unconditionally clears stretch**, including when that ring is empty. Thus stock v2 does not safely wait for another PC response at a mid-read underrun. `on_request` is an empty event structure, and supplies no intended read length. [D][H]

## 2. Pointer write → repeated START → first read byte

**VERIFIED:** In the S3-enabled read-address stretch branch, the driver drains pending RX FIFO bytes into its ring, assembles the receive event, invokes **`on_receive` first**, resets the RX count, then invokes **`on_request`**. The branch does not require STOP and does not clear stretch. A two-byte EEPROM pointer below the 16-byte RX watermark can therefore be delivered at this read-address event; `SLV_COMPLETE` also delivers pending RX data. [D lines 111–204][R capabilities]

**DOCUMENTED-BUT-UNMEASURED:** This provides the required documentary ordering for EEPROM random read: pointer bytes are available to firmware before it releases SCL for the first data byte. Microchip specifies a dummy pointer write with two word-address bytes, repeated START, then addressed read. [D][T §27.4.3][E §8.2]

**ASSUMPTION:** Preserve ordering across the task/USB protocol: copy callback data before its driver-owned buffer is reused, send the pointer operation before the read request, and release only after the PC processes both. Test stale TX FIFO/ring data and final master NACK. A callback-order proof alone does not prove correct sequential-read pointer advancement or bytes actually consumed. [D][H][E §§8.1–8.3]

## 3. Address NACK / write-cycle ACK polling

**VERIFIED:** AT24C256C starts its write cycle at STOP and does not ACK its device address while busy; its specified write-cycle maximum is 5 ms. Stretching a READ response does not implement this address-level behavior. [E §§7.1, 7.3–7.4, AC table]

**VERIFIED:** Slave v2 exposes no `address_nack`, busy gate, or address callback. Hardware has `SLAVE_BYTE_ACK_CTL_EN` and `SLAVE_BYTE_ACK_LVL`, documented for software-controlled ACK bits; the TRM passage does not explicitly establish address-ACK suppression. Stock v2 neither configures these controls nor implements that handshake. Therefore **on-demand own-address NACK is not established in stock v2**; byte ACK controls are a custom-driver research path, not proof of address NACK. [H][D][T §27.4.3][R]

**ASSUMPTION — workarounds and risks:** [D][R][T §27.4.5][E §7.3]

- Temporarily change the address to a reserved, unused parking value, synchronize configuration, then restore at an idle boundary. Risks: next poll can precede the register update; accidental ACK at the parking address; changed state mid-address. Public API does not provide runtime address switching.
- Disable/isolate this slave's SDA/SCL path while busy. Risks: firmware reacting to STOP may miss the very next poll; restoring mid-transaction can corrupt the bus. Shared isolation must not remove another virtual slave.
- Investigate controlled ACK in a custom generic adapter, proving specifically the **ninth address clock**, not merely payload-byte NACK. Busy decisions must be installed before that clock. A PC-only decision after STOP incurs the USB round trip before suppression, leaving a false-ready window.

**ASSUMPTION:** Accurate immediate busy gating needs a preauthorized local transport policy or deterministic electrical gate, with explicit authority/timing contract. If “no local semantics” excludes even that policy, faithful busy emulation is currently blocked. Always-ACK or delay-until-ready behavior can be a separately labeled functional approximation, not AT24C256 ACK-polling fidelity. [E][D][T]

## 4. Addresses, shared bus, general call

**VERIFIED:** S3 has **two controllers**, each with one configured 7- or 10-bit slave address and a 32-byte FIFO. `SLAVE_ADDR_REG` has one address field, not arbitrary address comparators. TRM “double addressing” means device address followed by memory address in non-FIFO mode, not two selectable slave addresses. [R][H][T §27.4.12]

**ASSUMPTION:** Two controllers with distinct addresses and separate open-drain pin pairs may share the physical SDA/SCL bus, providing two addressed endpoints. This follows the open-drain initialization, but simultaneous shared-bus behavior is unmeasured. Keep the existing separate-port baseline and conditional links; test that an unmatched controller never ACKs or stretches. [H HAL init][R][T]

**DOCUMENTED-BUT-UNMEASURED:** General call is supported for **0x00 with R/W=0**, independent of configured address, via `CTR.ADDR_BROADCASTING_EN`; v2 exposes `flags.broadcast_en` and rejects broadcast with 10-bit addressing. This is not arbitrary multi-address matching. Keep disabled for EEPROM profiles unless explicitly modeled. [T §27.4.12][D][H][R]

## 5. Master compatibility and Linux deadlines

**VERIFIED:** BCM283x stretching is a known vendor-documented problem. Linux v6.12 attaches `I2C_AQ_NO_CLK_STRETCH` to `brcm,bcm2835-i2c`. **BCM2711 is different:** the vendor manual says it fixes the bug; v6.12's `brcm,bcm2711-i2c` entry does not attach that quirk. Do not categorically blacklist Raspberry Pi 4 or infer qualification from its board name. [P §3.1][K adapter lines 397–404, 514–518]

**VERIFIED:** BCM2711 CLKT is a 16-bit SCL-clock count with reset 64; zero disables it. Reset 64 would be 0.64 ms at 100 kHz or 0.16 ms at 400 kHz. However, Linux v6.12 explicitly writes **CLKT=0**, then waits for completion using `adap->timeout`. [P CLKT][K adapter lines 365–373, 479–484]

**VERIFIED:** Linux core supplies **1 second** (`HZ`) when an adapter has not set a timeout. `I2C_TIMEOUT` sets it in **10 ms units**; neither is a universal hardware stretch allowance. The v6.12 `at24` driver separately defaults its retry window to **25 ms** and I/O limit to **128 bytes**. These budgets are distinct from slave timers. [K core][K i2c-dev][K at24]

**ASSUMPTION:** Qualify each actual controller, device-tree compatible, Yocto kernel/driver and bus speed. A larger Linux timeout cannot repair BCM283x sampling behavior or an earlier hardware deadline. i.MX/STM32MP variants remain unqualified by this report. [P][K][T]

## Recommendation

**ASSUMPTION:** Proceed with a narrow PC-authoritative feasibility prototype, **not a full AT24C256 compatibility claim**. Target stretching-capable masters and bounded reads whose response can be supplied completely before underrun. Ordinary low-rate register sensors and read-only EEPROM-like profiles are plausible candidates when added latency is acceptable; devices needing exact busy/address-NACK timing, unrestricted sequential reads or strict per-byte timing remain conditional. [D][T][E][K]

**ASSUMPTION:** Transient PC-response TX buffers are transport staging, not a local authoritative model cache. Full AT24C256 fidelity additionally needs generic, qualified busy gating, actual-byte/pointer accounting and safe long-read refill. Keep device semantics in VDS4E; any local execution policy requires architecture review. [D][H][E]

## Open questions / bench tests

1. **DOCUMENTED-BUT-UNMEASURED:** Capture read-address SCL stretch, callback timestamps and first byte after an immediate two-byte pointer/repeated START. Inject 1, 2, 3 and 10 ms task delays; inspect FSM timeout raw bits, clock/divider and timer registers. Do FSM timers count during intentional stretch? Resolve TRM n≤22 versus register-comment boundary. [D][T][R]
2. **DOCUMENTED-BUT-UNMEASURED:** Test read sizes 1, 31, 32, 33 and 128, empty TX ring, final NACK, abort, next read and stale FIFO. Source inspection also finds `i2c_slave_write()` initially writes zero directly when `len >= free_fifo_len`; verify that subsequent TX-interrupt refill cannot race stretch release. [D lines 355–418][K at24]
3. **DOCUMENTED-BUT-UNMEASURED:** Determine whether byte-ACK controls suppress address ACK. Capture rapid address-only polling immediately after STOP and after PC processing; quantify false ACK windows for address parking/isolation, plus busy expiry timing. [T][R][E]
4. **DOCUMENTED-BUT-UNMEASURED:** Test two controllers on shared wires, neighboring addresses, general call disabled/enabled, translator propagation and recovery after reset/USB disconnect. [D][R][T]
5. **DOCUMENTED-BUT-UNMEASURED:** Repeat on BCM283x and BCM2711 separately, then the selected i.MX/STM32MP controller, at 100/400 kHz. Record the deployed kernel's adapter timeout and hardware timeout registers. Use unchanged target tools/at24 driver as hardware-path qualification, with no simulator-specific target protocol. [P][K][E]
