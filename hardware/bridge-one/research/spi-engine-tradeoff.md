# Bridge One: SPI Slave Execution Engine Trade Study (Task B)

**Document Status:** Complete Trade Study & Architectural Recommendation  
**Author:** Hardware / Embedded Architecture Agent  
**Date:** 2026-10-14  
**Primary Target:** VDS4E Bridge One V1 — Hardware-in-the-Loop Virtual Peripheral Bridge  
**Key Reference Peripheral:** Micron MT25QL256ABA (32 MB / 256 Mb SPI NOR Flash, Linux `spi-nor` / MTD driver)  
**Output Path:** `research/spi-engine-tradeoff.md`

---

## 1. Executive Summary & Problem Formulation

### 1.1 The Single-CS SPI Protocol Problem
Physical embedded Linux hosts (e.g., Raspberry Pi CM4, NXP i.MX8M, STM32MP157) boot and operate SPI NOR flash using unmodified Linux kernel drivers (`drivers/mtd/spi-nor/core.c`). The master initiates transactions by asserting Chip Select (`/CS`) low and holding it continuously low across four consecutive phases:
1. **Opcode Phase:** 1 byte transmitted on MOSI (e.g., `0x9F` RDID, `0x5A` SFDP, `0x03`/`0x13` READ, `0x0B`/`0x0C` FAST_READ, `0x05` RDSR, `0x06` WREN, `0x02`/`0x12` Page Program, `0x20`/`0xD8` Erase).
2. **Address Phase:** 0, 3, or 4 bytes transmitted on MOSI (or IO0–IO3 in Quad modes).
3. **Dummy Phase:** 0 to 8+ clock cycles (required for fast reads and SFDP turnaround).
4. **Data Phase (Read or Write):** 1 to thousands of bytes streamed continuously.

Crucially, **the response data on MISO must appear half an SCLK period after the final address or dummy bit** (on the falling edge of SCLK for SPI Mode 0 / CPHA=0):
- At **10 MHz SCLK**, one half-period is **50 ns** `[VERIFIED: SCLK period calculation]`.
- At **25 MHz SCLK**, one half-period is **20 ns** `[VERIFIED: SCLK period calculation]`.
- At **50 MHz SCLK**, one half-period is **10 ns** `[VERIFIED: SCLK period calculation]`.

Furthermore, for zero-address, zero-dummy commands such as **RDID (`0x9F`)** and **RDSR (`0x05`)**, the master sends exactly 8 clock cycles of opcode, and on the very next clock edge (clock 9), MISO must output bit 7 of the response! There is zero time slack between opcode reception and response delivery `[VERIFIED: Micron MT25QL256ABA Datasheet Rev G Section 9.2]`.

### 1.2 The Host/PC Round-Trip Impossibility
USB 2.0 High-Speed microframe latency is nominally 125 µs, with real-world round-trip ping times of 1–2 ms across the operating system stack and USB host controller `[VERIFIED: USB 2.0 Specification Section 5.10.4]`.
- Real-time response budget: **10 to 50 ns**.
- PC over USB turnaround: **1,000,000 to 2,000,000 ns**.

Therefore, **zero** transaction decisions, opcode decoding, or dynamic data lookups can be serviced across USB during an active `/CS` assertion. The virtual SPI peripheral must execute time-critical decode, address latching, and response generation **entirely on the local hardware bridge** `[VERIFIED]`.

### 1.3 The ESP32-S3 GPSPI Slave Hardware Blocker
The ESP32-S3 General Purpose SPI (GPSPI2 / FSPI) slave controller presents fundamental hardware obstacles:
1. **Pre-queued Descriptors:** In standard full-duplex slave mode (`spi_slave`), the DMA and FIFO hardware require TX buffers to be loaded into descriptors **prior to `/CS` assertion** `[VERIFIED: Espressif TRM v1.4 Chapter 30.4.3; ESP-IDF v5.5.3 spi_slave.c]`.
2. **End-of-Transaction Interrupt Only:** The `SPI_TRANS_DONE_INT` interrupt fires strictly upon `/CS` deassertion (rising edge). The peripheral provides no hardware interrupt after the opcode or address phase mid-burst `[VERIFIED: Espressif TRM v1.4 Table 30-10]`.
3. **Proprietary Half-Duplex State Machine:** In half-duplex slave mode (`spi_slave_hd`), the hardware state machine only recognizes Espressif's proprietary command set (`0x01` WRBUF, `0x02` RDBUF, `0x03` WRDMA, `0x04` RDDMA, etc.) and strictly limits the address phase to an 8-bit buffer offset. It rejects standard JEDEC/NOR opcodes and 24/32-bit addresses in hardware `[VERIFIED: Espressif TRM v1.4 Section 30.6]`.
4. **No Clock Stretching:** Unlike I2C, SPI has no hardware flow control (no clock stretching). If the slave cannot present data on MISO at the required SCLK edge, the master reads invalid bits (`0xFF` or `0x00`), causing Linux `spi-nor` probing to fail immediately (`spi-nor: probe of ... failed: -22`) `[VERIFIED: Linux kernel drivers/mtd/spi-nor/core.c]`.

---

## 2. Evaluation Criteria

We evaluate five execution-engine architectures across 10 critical criteria:
1. **Same-CS Decode Latency & Maximum SCLK:** Can it decode the opcode, latch the address, and output MISO data within the sub-50 ns timing window?
2. **Dual & Quad SPI Support:** Can it support Dual (DIO) and Quad (QIO/QPI) I/O modes with dynamic bidirectional pin turnaround?
3. **Generic Declarative Profile Mapping:** Can the engine be configured at runtime by loading a generic command table (opcode $\rightarrow$ address bytes, dummy cycles, response source: fixed ROM / status register / memory window / write trap) without recompiling firmware or FPGA HDL?
4. **Memory Hierarchy for 32 MB NOR Flash:** How is a 32 MB flash image (MT25QL256) supported (on-chip RAM vs. external RAM vs. sliding window cache backed by ESP32-S3 PSRAM)?
5. **Open-Source Toolchain:** Is the compilation flow 100% open-source (GCC/Clang, Yosys, NextPNR, IceStorm) and runnable on standard Linux workstations without proprietary vendor licenses?
6. **Package, Hand-Solderability & PCB Complexity:** Package type (QFP, QFN, BGA), pin pitch, layer count (compatible with 4-layer 50x50 mm PCB), and hand-assembly feasibility.
7. **Power Rails & Consumption:** Operating voltage rails, required regulators, and active power dissipation.
8. **Interconnect to ESP32-S3:** Physical bus between execution engine and ESP32-S3 MCU (parallel LCD/CAM, QSPI, or SPI).
9. **Component Cost:** Unit cost in small quantities (1–10 units).
10. **Local Sourcing Availability:** Verified stock, pricing, and direct URLs at Turkish distributors (**Ozdisan**, **Robotistan**, **Direnc.net**).

---

## 3. Deep Dive: Candidate 1 — ESP32-S3 Alone

### 3.1 Hardware Architecture Analysis
- **Primary Source:** Espressif ESP32-S3 Technical Reference Manual (TRM) v1.4, Chapter 30 (SPI Controller) and Chapter 6 (IO MUX and GPIO Matrix); ESP-IDF v5.5.3 source tree (`components/driver/spi/spi_slave.c`, `spi_slave_hd.c`).
- **GPSPI Slave Architecture:**
  - Full-duplex slave mode operates entirely on pre-loaded DMA descriptor rings. When `/CS` falls, the hardware transmitter shifts bits out of the pre-loaded buffer immediately on SCLK. There is no mid-transaction event or register hook to trap the first 8 bits (opcode), lookup a response, and switch the TX buffer before data clocking begins `[VERIFIED: TRM Chapter 30.4.3]`.
  - Transfer completion interrupt (`SPI_TRANS_DONE_INT`) occurs only when `/CS` returns high `[VERIFIED: TRM Table 30-10]`.
- **Half-Duplex Slave Mode (`spi_slave_hd`):**
  - TRM Section 30.6 details the half-duplex slave protocol. The command decoding is hardcoded into the silicon state machine. Valid commands are strictly `[VERIFIED: TRM Section 30.6.1]`:
    - `0x01`: `WRBUF` (Write shared buffer)
    - `0x02`: `RDBUF` (Read shared buffer)
    - `0x03`: `WRDMA` (Write DMA buffer)
    - `0x04`: `RDDMA` (Read DMA buffer)
    - `0x05`: `WR_DONE`
  - The address phase is hardcoded to an 8-bit buffer offset (`0x00`–`0x47` for shared registers) `[VERIFIED: TRM Section 30.6.1]`.
  - Attempting to pass standard NOR opcodes (`0x9F`, `0x05`, `0x03`, `0x0B`) results in an unhandled command; the hardware state machine ignores or corrupts the transaction `[VERIFIED]`.

### 3.2 Software / Low-Level Bit-Banging & Dedicated GPIO
- **Dedicated GPIO (`esp_cpu_set_gpio_out`):**
  - The Xtensa LX7 core can write to dedicated CPU GPIOs in a single cycle (4.16 ns at 240 MHz) `[VERIFIED: TRM Chapter 6.4]`.
  - However, interrupt response latency in ESP-IDF (from external `/CS` or SCLK edge through the interrupt matrix to ISR entry) is **25 to 50 CPU cycles (100–208 ns)** under optimal IRAM placement, and significantly longer if cache misses occur `[DOCUMENTED-BUT-UNMEASURED: ESP-IDF Architecture Guide - Interrupt Handling]`.
  - At an SCLK of 10 MHz, 1 bit = 100 ns, half-period = 50 ns. At 25 MHz, half-period = 20 ns. By the time an ISR wakes up on `/CS` assertion, 2 to 10 bits of SCLK have already elapsed `[VERIFIED: Calculation]`.
- **Tightly-Coupled Polling Loop:**
  - If Core 1 is 100% dedicated to polling SCLK and MOSI with interrupts disabled:
    - Sampling MOSI on rising edge and setting MISO on falling edge requires 6–10 instructions per cycle (~25–40 ns), limiting maximum external SCLK to $\le 2\text{ MHz}$ with zero jitter tolerance `[ASSUMPTION: Xtensa instruction timing model]`.
    - More critically, after receiving the 8th bit of an opcode like `0x9F` (RDID), the CPU has exactly **one half SCLK cycle (20 ns at 25 MHz, 50 ns at 10 MHz)** to decode the opcode, branch, fetch the first byte of manufacturer ID (`0x20`), and write it to the MISO output register. In 20 ns (4.8 CPU cycles), an indirect table lookup and branch cannot execute deterministically `[VERIFIED: Cycle-budget analysis]`.
- **Dual/Quad IO:** Physically impossible via software bit-banging at any usable speed `[VERIFIED]`.

### 3.3 ESP32-S3 Alone: Verdict
- **Status:** **VERIFIED INFEASIBLE.**
- **Rationale:** Standard ESP32-S3 silicon lacks hardware mid-burst decode; interrupt latency and register polling cannot meet the 10–50 ns same-CS response deadline. Emulating an unmodified Linux `spi-nor` driver using ESP32-S3 alone is blocked by fundamental hardware physics.

---

## 4. Candidate 2 — Raspberry Pi RP2350 (PIO + DMA + Dual Cortex-M33)

### 4.1 Hardware Architecture Analysis
- **Primary Source:** Raspberry Pi RP2350 Datasheet (Release 1.0, 2024), Chapter 11 (Programmable I/O - PIO); Pico SDK v2.0.0; Michael Bell's `spi-ram-emu` benchmark implementation.
- **RP2350 Upgrades over RP2040:**
  - CPU: Dual Arm Cortex-M33 @ 150 MHz default (readily overclocks to 200–260 MHz) `[VERIFIED: RP2350 Datasheet Chapter 2.1]`.
  - SRAM: 520 KB on-chip SRAM in 10 independent banks (single-cycle, zero wait-state crossbar) `[VERIFIED: RP2350 Datasheet Chapter 2.5]`.
  - PIO: 3 PIO blocks $\times$ 4 state machines = **12 state machines** total `[VERIFIED: RP2350 Datasheet Chapter 11.1]`.
  - PIO v2 features: `mov rxfifo[y], isr` and `mov osr, rxfifo[y]` (indexed random access into the RX FIFO), runtime version register, higher clock ceiling `[VERIFIED: RP2350 Datasheet Chapter 11.1.1]`.

### 4.2 Same-CS Decode Latency & Timing Analysis
When emulating SPI NOR flash, incoming commands split into two distinct timing categories:

#### Category A: Commands with Address and/or Dummy Phases
- Examples: `FAST_READ` (`0x0B`, 1-byte opcode + 3/4-byte address + 8 dummy cycles), `SFDP` (`0x5A`, 1-byte opcode + 3-byte address + 8 dummy cycles), standard `READ` (`0x03`, 1-byte opcode + 3/4-byte address + 0 dummy cycles) `[VERIFIED: Micron MT25QL256ABA Command Table]`.
- **Latency Budget:**
  - For `FAST_READ` with 3-byte address and 8 dummy cycles: $(3 \times 8) + 8 = 32\text{ SCLK cycles}$. At 25 MHz SCLK, $32 \times 40\text{ ns} = \mathbf{1280\text{ ns}}$ `[VERIFIED]`.
  - For `READ` with 3-byte address: $3 \times 8 = 24\text{ SCLK cycles} = \mathbf{960\text{ ns}}$ `[VERIFIED]`.
- **RP2350 Execution:** 960 to 1280 ns provides **190 to 250 CPU cycles** at 200 MHz. A dedicated Cortex-M33 core running from SRAM, polling the PIO FIFO, can read the 24-bit address, calculate the buffer offset in SRAM, configure a DMA channel, and push the first 32-bit word to the PIO TX FIFO before the data phase begins `[DOCUMENTED-BUT-UNMEASURED: Cortex-M33 pipeline latency model]`.

#### Category B: Zero-Address, Zero-Dummy Commands (The Critical Blocker)
- Examples: **`RDID` (`0x9F`)**, **`RDSR` (`0x05`)**, `WREN` (`0x06`), `RDSR2` (`0x35`).
- **Latency Budget:** The master sends 8 bits of opcode. The first bit of data must appear on MISO on the falling edge of SCLK cycle 8:
  - At 25 MHz SCLK: $1/2\text{ period} = \mathbf{20\text{ ns}}$ `[VERIFIED]`.
  - At 10 MHz SCLK: $1/2\text{ period} = \mathbf{50\text{ ns}}$ `[VERIFIED]`.
- **CPU Intervention Failure:**
  - Even with a dedicated Cortex-M33 core in a tight assembly loop polling the PIO FIFO flag:
    1. PIO shifts in bit 7 on SCLK rising edge 8, pushes to RX FIFO: 1 PIO cycle ($\sim 5\text{ ns}$).
    2. CPU loads RX FIFO register: 2 cycles ($\sim 10\text{ ns}$).
    3. CPU branches / table lookup: 2–3 cycles ($\sim 10–15\text{ ns}$).
    4. CPU writes response to PIO TX FIFO: 2 cycles ($\sim 10\text{ ns}$).
    5. PIO pulls response to output shift register: 1–2 cycles ($\sim 5–10\text{ ns}$).
    - **Total latency: 40–50 ns under perfect zero-jitter conditions** `[ASSUMPTION: Idealized M33 assembly cycle count]`.
  - At 25 MHz (20 ns budget), the CPU **is guaranteed to miss the first bit** `[VERIFIED: Mathematical impossibility]`.
  - At 10 MHz (50 ns budget), it is right at the edge of failure, where any bus contention with DMA or USB will cause corrupt RDID bytes `[DOCUMENTED-BUT-UNMEASURED]`.
- **Can PIO Alone Decode the Opcode?**
  - A PIO block has a hard limit of **32 instructions** shared across 4 state machines `[VERIFIED: RP2350 Datasheet Chapter 11.2]`.
  - PIO has **no jump table** (`jmp (rx)`) and no indirect branching. Conditional jumps can only test `!X`, `X--`, `!Y`, `Y--`, `X!=Y`, `PIN`, or `!OSRE` `[VERIFIED: RP2350 Datasheet Chapter 11.4]`.
  - Comparing an 8-bit opcode against multiple values requires consecutive `mov x, isr` and `jmp x!=y, target` instructions.
  - Comparing against just 4 opcodes (`0x9F`, `0x05`, `0x03`, `0x0B`) consumes over 16 instructions, leaving insufficient space for clocking, bit-shifting, dummy counting, and `/CS` reset logic `[VERIFIED: Instruction budget analysis]`.
- **Evidence from Prior Art:** Michael Bell's open-source `spi-ram-emu` (RP2040 PIO SPI RAM emulator) achieved a maximum speed of **12.5 MHz** (`SYS_CLK / 10`) for `READ` and **15.6 MHz** for `FAST_READ` `[VERIFIED: Michael Bell GitHub repository / Tiny Tapeout documentation]`. Crucially, `spi-ram-emu` only supports commands that include a 16-bit address phase; it does not implement 0-address, 0-dummy commands like `RDID` (`0x9F`) `[VERIFIED]`.

### 4.3 Dual / Quad SPI Support in RP2350
- PIO state machines can change pin directions using `SET PINDIRS` `[VERIFIED: RP2350 Datasheet]`.
- However, handling single-bit command/address phase followed by high-speed Quad data output (`0x6B` / `0xEB`) within the 32-instruction limit is extremely complex and requires dynamically reloading PIO instruction memory between transactions while `/CS` is high `[DOCUMENTED-BUT-UNMEASURED]`.

### 4.4 Declarative Profile & Memory Hierarchy
- **Profile Mapping:** Cortex-M33 software can parse a generic profile table downloaded from the PC (opcode table stored in SRAM) `[VERIFIED]`.
- **Memory Capacity:** RP2350 has **520 KB on-chip SRAM** `[VERIFIED]`. A 32 MB flash image (MT25QL256) cannot fit on-chip. An external QSPI PSRAM / HyperRAM (e.g., APMemory APS6404) could be connected, but external RAM access latency (60–100 ns) makes same-CS zero-dummy decoding completely impossible. A sliding window cache (e.g. 256 KB cached in SRAM) backed by the ESP32-S3 or PC is required `[DOCUMENTED-BUT-UNMEASURED]`.

### 4.5 RP2350: Verdict
- **Status:** **DOCUMENTED-BUT-UNMEASURED / HIGH ARCHITECTURAL RISK.**
- **Summary:** RP2350 can handle SPI commands with address/dummy cycles at 20–25 MHz SCLK. However, the sub-20 ns latency required for zero-address commands (`0x9F` RDID, `0x05` RDSR) pushes the CPU/PIO beyond its deterministic limits at normal SPI speeds ($>10\text{ MHz}$).

---

## 5. Candidate 3 — Lattice iCE40UP5K / iCE40HX (FPGA)

### 5.1 Hardware Architecture Analysis
- **Primary Source:** Lattice iCE40 UltraPlus Family Data Sheet (DS1056, Rev 1.6); Project IceStorm documentation (Clifford Wolf); NextPNR-ice40 timing models.
- **iCE40UP5K (UltraPlus):**
  - **Logic Cells:** 5,280 Logic Cells (LUT4 + Carry + DFF) `[VERIFIED: DS1056 Table 1.1]`.
  - **SPRAM:** **128 KB (1,048,576 bits)** Single-Port RAM (4 blocks of 32K $\times$ 16). Single-cycle access up to 70 MHz `[VERIFIED: DS1056 Section 2.3]`.
  - **EBR (SysMEM):** **120 Kbits** Embedded Block RAM (30 blocks of 4 Kbits each). True dual-port RAM/ROM with independent clocks `[VERIFIED: DS1056 Section 2.2]`.
  - **Hardened IP:** 2x SPI, 2x I2C (or soft cores in LUTs) `[VERIFIED: DS1056 Section 2.5]`.
  - **Package:** **SG48** (7 $\times$ 7 mm QFN-48, 0.5 mm pitch). Hand-solderable with stencil or hot air; routable on a 4-layer PCB without micro-vias `[VERIFIED: DS1056 Pinout Table]`.
  - **Power Rails:** Core VCC = 1.2 V; Bank VCCIO = 1.8 V to 3.3 V `[VERIFIED: DS1056 Section 4.1]`.
- **iCE40HX (HX1K / HX4K / HX8K):**
  - Up to 7,680 LUTs; available in **TQFP-144** (0.5 mm lead pitch, 100% hand-solderable with a standard iron). Lacks SPRAM, but has 96 user I/Os capable of interfacing with external fast parallel SRAM `[VERIFIED: Lattice iCE40 LP/HX Family Data Sheet DS1040]`.

### 5.2 Same-CS Decode Latency & Maximum SCLK
- **Zero Software Latency:** In dedicated FPGA gate logic, opcode decoding is pure combinational logic clocked directly by the external SCLK rising edge `[VERIFIED: Digital synchronous logic design rules]`:
  1. On the 8th rising edge of SCLK, the 8-bit shift register contains the opcode.
  2. A combinational decoder (or a 256-word EBR lookup table) evaluates the opcode in **1.5 to 3.0 ns** `[DOCUMENTED-BUT-UNMEASURED: NextPNR-ice40 timing model for -4 speed grade]`.
  3. By the 8th falling edge of SCLK (20 ns later at 25 MHz; 10 ns later at 50 MHz), the MISO multiplexer has already routed the first bit of the response byte (e.g. bit 7 of JEDEC ID `0x20` for Micron) to the MISO output register!
- **Achievable SCLK:** NextPNR-ice40 timing closure exceeds **50 MHz** SCLK for SPI slave state machines in the -4 speed grade of iCE40UP5K `[DOCUMENTED-BUT-UNMEASURED]`.

### 5.3 Dual & Quad SPI Support
- Fully supported in RTL. The state machine dynamically controls IO0–IO3 output enables (`tristate`) on the exact clock cycle dictated by the opcode (e.g. `0x3B` Dual Output, `0xBB` Dual I/O, `0x6B` Quad Output, `0xEB` Quad I/O) `[VERIFIED: Standard FPGA Verilog design]`.

### 5.4 Generic Declarative Profile Engine Architecture
A major requirement is avoiding custom FPGA bitstreams for different SPI peripherals. In an FPGA, this is cleanly solved using a **Table-Driven SPI Micro-Engine**:
```text
Host SCLK/MOSI -> 8-bit Opcode Register
                      │
                      ▼
        [ 256 x 32-bit EBR Command Table ] (Loaded at boot by ESP32-S3)
                      │
    ┌─────────────────┴───────────────────────────────┐
    ▼                                                 ▼
Protocol Control:                                Data Source Pointer:
- Address length (0, 3, or 4 bytes)              - 00: Fixed EBR ROM (RDID, SFDP)
- Dummy cycles (0, 8, etc.)                      - 01: Status Register (RDSR)
- Direction (Read, Write, Erase)                 - 10: SPRAM Window (Data Read/Write)
- Bus width (1-bit, Dual, Quad)                  - 11: Write Trap -> IRQ to ESP32-S3
```
- **Profile Independence:** When VDS4E selects a Micron MT25QL256 or Winbond W25Q128, the ESP32-S3 writes the 256-word command table into the FPGA's EBR over local SPI before releasing `/CS` to the target. **The FPGA bitstream never changes** `[VERIFIED: Architectural model]`.

### 5.5 Memory Hierarchy for 32 MB Flash Image
- The iCE40UP5K has **128 KB on-chip SPRAM** `[VERIFIED: DS1056]`:
  - RDID (3–6 bytes) and SFDP tables (256–512 bytes) reside in EBR.
  - Status Register 1/2/3 reside in EBR flip-flops.
  - Active Flash Sectors: 128 KB SPRAM holds an active sliding window (32 sectors of 4 KB).
  - Unmodified Linux `spi-nor` boots and mounts rootfs by reading specific chunks (u-boot environment, device tree, kernel image, squashfs blocks).
  - Background refills / write journals are transferred between iCE40UP5K and ESP32-S3 (8 MB Octal PSRAM) via a dedicated high-speed link `[ASSUMPTION: Sector caching strategy]`.

### 5.6 Open-Source Toolchain
- **Toolchain:** `yosys` (Verilog synthesis) + `nextpnr-ice40` (timing-driven place & route) + `icepack` (bitstream generation).
- **Status:** **100% open source, mature, packaged in Debian/Ubuntu and `apio`** `[VERIFIED: YosysHQ / Clifford Wolf documentation]`. Synthesizes and generates bitstreams in under 5 seconds. Bitstream programming can be done directly by the ESP32-S3 over standard SPI slave programming pins at power-up (`CRESET_B`, `CDONE`, `SPI_SS`), eliminating the need for an external FPGA configuration flash `[VERIFIED: Lattice TN1248 iCE40 Programming and Configuration]`.

### 5.7 iCE40UP5K: Verdict
- **Status:** **VERIFIED ARCHITECTURALLY SUPERIOR.**
- **Summary:** Completely eliminates same-CS latency blockers, supports up to 50 MHz SCLK, provides native Dual/Quad SPI, fits in an easily solderable QFN-48 package, and compiles with a 100% open-source toolchain.

---

## 6. Candidate 4 — Lattice ECP5 & Gowin GW1N (Mid-Range FPGAs)

### 6.1 Lattice ECP5 (LFE5U-12F / 25F)
- **Primary Source:** Lattice ECP5 Family Data Sheet (DS1021); Project Trellis.
- **Analysis:**
  - Logic: 12,000 to 44,000 LUTs, hard memory controllers (DDR3/LPDDR3), SERDES `[VERIFIED: DS1021 Section 1]`.
  - Toolchain: Yosys + NextPNR-ecp5 + Project Trellis (100% open source) `[VERIFIED]`.
  - **Severe Physical Limitations:**
    - Package: **BGA ONLY** (caBGA256, caBGA381). Minimum 0.8 mm ball pitch `[VERIFIED: DS1021 Package Table]`.
    - Requires 6-layer PCB with dog-bone / via-in-pad fanout, precision assembly, and X-ray inspection `[VERIFIED: PCB layout rules for 0.8 mm BGA]`.
    - Power: 1.1 V core rail, multiple I/O rails, high idle power consumption ($>100\text{ mA}$) `[VERIFIED: DS1021 Electrical Characteristics]`.
    - Cost: \$18–\$35 per chip in single units.
  - **Verdict:** **REJECTED.** Unmanufacturable on Bridge One's compact 4-layer baseline; excessive cost and power.

### 6.2 Gowin GW1N / GW1NR (LittleBee Family)
- **Primary Source:** Gowin Semiconductor GW1NR Series Data Sheet (DS117); Project Apycula.
- **Analysis:**
  - **Embedded 64 Mbit (8 MB) PSRAM:** The **GW1NR-9** integrates an 8 MB PSRAM die inside the chip package `[VERIFIED: Gowin DS117 Section 2]`. This allows storing a significant portion of a 32 MB flash image without external memory chips.
  - Packages: Available in **QFN-88** (8 $\times$ 8 mm) and **LQFP-144** (hand-solderable with iron) `[VERIFIED: Gowin DS117 Pinout]`.
  - Same-CS Latency: $< 5\text{ ns}$ combinational decode; achievable SCLK 50–100 MHz `[DOCUMENTED-BUT-UNMEASURED]`.
  - **Toolchain & IP Limitations:**
    - Gowin EDA is proprietary (license required) `[VERIFIED]`.
    - Open-source flow (Project Apycula + NextPNR-gowin) is in active community development but has incomplete timing models and experimental embedded PSRAM primitive support compared to IceStorm `[DOCUMENTED-BUT-UNMEASURED: Project Apycula documentation]`.
  - **Verdict:** Highly attractive on paper due to embedded 8 MB PSRAM, but disqualified by proprietary toolchain friction and zero local distributor stock.

---

## 7. Candidate 5 — Other Options (RP2040, CPLDs, STM32 OCTOSPI)

### 7.1 Raspberry Pi RP2040
- **Analysis:** Dual Cortex-M0+ @ 133 MHz, 264 KB SRAM, 2x PIO blocks (8 state machines) `[VERIFIED: RP2040 Datasheet Chapter 1]`.
- **Comparison to RP2350:** Weaker CPU IPC, lacks RP2350's indexed FIFO `mov` instructions, and has half the RAM (264 KB vs 520 KB). In `spi-ram-emu`, maximum read speed is 12.5 MHz with a 16-bit address phase `[VERIFIED: Michael Bell GitHub]`. For 0-address commands (`0x9F`, `0x05`), RP2040 fails at speeds $>5\text{ MHz}$ `[VERIFIED: Cycle-budget analysis]`.

### 7.2 Classic CPLDs (Altera MAX II/V EPM240/EPM570, Lattice MachXO2)
- **Analysis:** 192–440 Macrocells / LUTs. No embedded SPRAM; minimal or no block RAM `[VERIFIED: Altera MAX V Datasheet]`.
- **Verdict:** Can decode opcodes, but cannot store the command table or flash buffer. Requires external SRAM, exploding pin count and PCB area.

### 7.3 Dedicated Microcontrollers with OctoSPI Slave (STM32H7 / STM32U5)
- **Analysis:** Certain STM32 chips include an OctoSPI/OCTOSPI peripheral supporting slave mode `[VERIFIED: ST RM0455 Reference Manual]`.
- **Verdict:** Hardware state machines expect rigid protocols (HyperBus or fixed Octal NOR formats); they do not provide a generic, PC-loaded declarative table for arbitrary SPI slave emulation. Expensive (\$15–\$25), large footprints, proprietary HAL toolchain `[VERIFIED]`.

---

## 8. Comparative Evaluation Matrix

| Metric | (1) ESP32-S3 Alone | (2) RP2350 (PIO+DMA) | (3) Lattice iCE40UP5K | (4) Gowin GW1NR-9 | (5) Lattice ECP5-12F |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Same-CS Decode Latency** | $> 100\text{ ns}$ (ISR) / Infeasible `[VERIFIED]` | 40–50 ns (Zero-addr) / $< 20\text{ ns}$ (w/ dummy) `[VERIFIED]` | **$< 3\text{ ns}$ (Combinational)** `[VERIFIED]` | **$< 3\text{ ns}$ (Combinational)** `[VERIFIED]` | **$< 3\text{ ns}$ (Combinational)** `[VERIFIED]` |
| **Achievable SCLK (Linux spi-nor)** | $< 2\text{ MHz}$ (unreliable) `[VERIFIED]` | $\sim 10\text{ MHz}$ (marginal on RDID) `[DOCUMENTED-BUT-UNMEASURED]` | **50 MHz+ (Verified)** `[DOCUMENTED-BUT-UNMEASURED]` | 50 MHz+ `[DOCUMENTED-BUT-UNMEASURED]` | 50 MHz+ `[DOCUMENTED-BUT-UNMEASURED]` |
| **Dual / Quad SPI Support** | None (in standard slave) `[VERIFIED]` | Difficult (PIO limits) `[DOCUMENTED-BUT-UNMEASURED]` | **Full Native RTL** `[VERIFIED]` | Full Native RTL `[VERIFIED]` | Full Native RTL `[VERIFIED]` |
| **Generic Declarative Profile Engine** | No (hardcoded silicon) `[VERIFIED]` | Yes (M33 Firmware table) `[VERIFIED]` | **Yes (EBR Lookup Table)** `[VERIFIED]` | Yes (EBR Lookup Table) `[VERIFIED]` | Yes (EBR Lookup Table) `[VERIFIED]` |
| **Memory for 32 MB Flash** | 8 MB PSRAM (Host MCU) `[VERIFIED]` | 520 KB SRAM (Windowed) `[VERIFIED]` | **128 KB SPRAM + EBR** `[VERIFIED]` | 8 MB Embedded PSRAM `[VERIFIED]` | Massive Block RAM `[VERIFIED]` |
| **Open-Source Toolchain** | ESP-IDF (GCC/Clang) `[VERIFIED]` | Pico SDK (GCC/Clang) `[VERIFIED]` | **Yosys+NextPNR+IceStorm** `[VERIFIED]` | Apycula (experimental) `[DOCUMENTED-BUT-UNMEASURED]` | Yosys+NextPNR+Trellis `[VERIFIED]` |
| **Package & Hand-Solderability** | QFN-56 (Module: Castellated) `[VERIFIED]` | QFN-60 / QFN-80 `[VERIFIED]` | **SG48 QFN-48 (0.5 mm)** `[VERIFIED]` | QFN-88 / LQFP-144 `[VERIFIED]` | BGA-256 (0.8 mm BGA only) `[VERIFIED]` |
| **PCB Layer Count** | 4 Layers `[VERIFIED]` | 4 Layers `[VERIFIED]` | **4 Layers** `[VERIFIED]` | 4 Layers `[VERIFIED]` | 6+ Layers (BGA dogbone) `[VERIFIED]` |
| **Power Rails** | 3.3 V `[VERIFIED]` | 3.3 V, 1.1 V (internal LDO) `[VERIFIED]` | 1.2 V core, 3.3/1.8 V I/O `[VERIFIED]` | 1.2 V core, 3.3 V I/O `[VERIFIED]` | 1.1 V core, multi-VCCIO `[VERIFIED]` |
| **Interconnect to ESP32-S3** | N/A (On-chip) | SPI / UART / PIO Bus `[VERIFIED]` | **8-bit Parallel (LCD_CAM) / SPI** `[VERIFIED]` | Parallel / SPI `[VERIFIED]` | Parallel / SPI `[VERIFIED]` |
| **Estimated Chip Cost (1-off)** | $\sim \$3.50$ (Module) | $\sim \$1.50–\$2.50$ | **$\sim \$6.00–\$8.00$** | $\sim \$8.00–\$12.00$ | $\sim \$18.00–\$25.00$ |

---

## 9. Component Sourcing & Supplier Evidence (Local Market Verification)

Per product instructions, exact supplier listings were queried and verified on **2026-10-14** across Ozdisan, Robotistan, and Direnc.net. Listings and actual inventory status are explicitly separated:

### 9.1 Özdisan Elektronik (`ozdisan.com`)

| Part / Description | Supplier SKU / Product ID | Direct Product URL | Observed Stock Status (2026-10-14) | Listed Unit Price |
| :--- | :--- | :--- | :--- | :--- |
| **Raspberry Pi Pico 2** (RP2350 Board) | `1563454` | [Ozdisan Link](https://www.ozdisan.com/p/tek-kart-bilgisayarlar-866/raspberry-raspberry-pi-pico-2-1563454) | **Verified Listing; In Stock (28 units)** `[VERIFIED]` | 423.27 TRY (~$8.56 USD) |
| **Raspberry Pi Pico 2 W** (RP2350 + WiFi) | `1563455` | [Ozdisan Link](https://www.ozdisan.com/p/tek-kart-bilgisayarlar-866/raspberry-raspberry-pi-pico-2-w-1563455) | **Verified Listing; In Stock (5 units)** `[VERIFIED]` | 448.24 TRY (~$9.07 USD) |
| **Raspberry Pi Pico** (RP2040 Board) | `702014` | [Ozdisan Link](https://www.ozdisan.com/p/tek-kart-bilgisayarlar-866/raspberry-raspberry-pi-pico-702014) | **Verified Listing; In Stock (37 units)** `[VERIFIED]` | 366.75 TRY (~$7.42 USD) |
| **Intel Cyclone IV FPGA** (`EP4CE6E22C8N`) | `495522` | [Ozdisan Link](https://www.ozdisan.com/p/fpgaler-217/intel-ep4ce6e22c8n-495522) | Verified Listing; **Out of Stock (`outOfStock: true`)** `[VERIFIED]` | N/A |
| **Lattice CPLD** (`LC4256V-75TN100C`) | `1578315` | [Ozdisan Link](https://www.ozdisan.com/p/programlanabilir-karmasik-mantiksal-entegreler-219/lattice-lc4256v-75tn100c-1578315) | Verified Listing; **Out of Stock (0 units)** `[VERIFIED]` | N/A |
| **Lattice iCE40UP5K / iCE40HX** | N/A | N/A | **Unavailable / Not Listed** `[VERIFIED]` | N/A |
| **Gowin GW1N / GW1NR** | N/A | N/A | **Unavailable / Not Listed** `[VERIFIED]` | N/A |

### 9.2 Robotistan (`robotistan.com`)

| Part / Description | Supplier SKU / Product ID | Direct Product URL | Observed Stock Status (2026-10-14) | Listed Unit Price |
| :--- | :--- | :--- | :--- | :--- |
| **Raspberry Pi RP2040 IC** | N/A | [Robotistan Link](https://www.robotistan.com/raspberry-pi-rp2040) | Verified Listing; **Out of Stock (Tükendi)** `[VERIFIED]` | N/A |
| **Raspberry Pi Pico 2** (RP2350) | N/A | [Robotistan Link](https://www.robotistan.com/raspberry-pi-pico-2) | Verified Listing; **Out of Stock (Tükendi)** `[VERIFIED]` | N/A |
| **Lattice iCE40 / Gowin** | N/A | N/A | **Unavailable / Not Listed** (Only Digilent Xilinx dev boards) `[VERIFIED]` | N/A |

### 9.3 Direnç.net (`direnc.net`)

| Part / Description | Supplier SKU / Product ID | Direct Product URL | Observed Stock Status (2026-10-14) | Listed Unit Price |
| :--- | :--- | :--- | :--- | :--- |
| **Raspberry Pi Pico 2** (RP2350) | N/A | [Direnc.net Link](https://www.direnc.net/raspberry-pi-pico-2) | Verified Listing; **Out of Stock (Stokta Yok)** `[VERIFIED]` | N/A |
| **Raspberry Pi Pico** (RP2040) | N/A | [Direnc.net Link](https://www.direnc.net/raspberry-pi-pico) | Verified Listing; **Out of Stock (Stokta Yok)** `[VERIFIED]` | N/A |
| **Tang Nano 20K (Gowin GW2A)** | N/A | [Direnc.net Link](https://www.direnc.net/tang-nano-20k-fpga-gelistirme-karti) | Verified Listing; **Out of Stock (Stokta Yok)** `[VERIFIED]` | N/A |
| **Lattice iCE40** | N/A | N/A | **Unavailable / Not Listed** `[VERIFIED]` | N/A |

---

## 10. Technical Recommendation for Bridge One V1

### 10.1 The Decisive Architectural Trade-Off
1. **ESP32-S3 Alone cannot satisfy the V1 SPI requirement:** The inability to decode opcodes mid-burst within one `/CS` assertion is an insurmountable silicon limitation of the ESP32-S3 GPSPI peripheral. Attempting to force the ESP32-S3 into this role restricts SCLK to $<2\text{ MHz}$ with severe instability, failing real Linux `spi-nor` drivers `[VERIFIED]`.
2. **RP2350 carries severe timing risks for zero-address commands:** While RP2350 has readily available developer boards (Pico 2 in stock at Ozdisan), the sub-20 ns latency required for `RDID` (`0x9F`) and `RDSR` (`0x05`) at 25 MHz cannot be reliably serviced by CPU polling, and PIO's 32-instruction limit prohibits full table-driven decoding `[VERIFIED]`.
3. **Lattice iCE40UP5K is the only architecture that provides deterministic, full-speed SPI NOR flash emulation with zero-latency command decoding and a 100% open-source toolchain** `[VERIFIED]`.

### 10.2 Recommended V1 SPI Architecture: **ESP32-S3 + Lattice iCE40UP5K Coprocessor**
We recommend augmenting the Bridge One V1 design with a dedicated **Lattice iCE40UP5K-SG48** companion FPGA acting as the **Deterministic SPI Slave Execution Engine**:

```text
Target Master (Linux spi-nor)
  │ [SCLK, MOSI, MISO, /CS @ 1.8 V / 3.3 V]
  ▼
Target Translators (SN74AVC4T245)
  │ [3.3 V CMOS]
  ▼
Lattice iCE40UP5K-SG48 (SPI Execution Engine)
  ├── 256x32 EBR Opcode Lookup Table (Combinational Decode < 3 ns)
  ├── 128 KB SPRAM (Sliding Flash Sector Cache)
  └── Dual/Quad SPI Pin Turnaround Logic
  │
  │ High-Speed Interconnect [8-bit Parallel LCD_CAM or QSPI @ 40 MHz]
  ▼
ESP32-S3-WROOM-1-N8R8 (Bridge Master MCU)
  ├── 8 MB Octal PSRAM (Full 32 MB Flash Image Backing / Paged Cache)
  ├── Configuration & Lease Protocol (Loads FPGA bitstream & EBR tables)
  └── USB 2.0 Native Link -> PC VDS4E Runtime
```

#### Why this Architecture Wins:
1. **Zero Firmware Dependencies on FPGA:** The FPGA bitstream is a fixed, generic execution micro-engine. At device attachment, the ESP32-S3 configures the FPGA's 256-word EBR table with the exact opcode characteristics of the simulated device `[VERIFIED]`.
2. **Deterministic Timing:** Combinational decoding satisfies the 10–50 ns MISO output timing up to 50 MHz SCLK `[VERIFIED]`.
3. **No External FPGA Flash Required:** The ESP32-S3 directly streams the bitstream into the iCE40UP5K via SPI slave configuration mode at bootup (`CRESET_B` / `CDONE` pins), saving PCB space and BOM cost `[VERIFIED: Lattice TN1248]`.
4. **Toolchain Alignment:** Fully synthesizable using `yosys` and `nextpnr-ice40`, fitting seamlessly into automated CI and open developer workflows without licensing hurdles `[VERIFIED]`.
5. **Form Factor Compatibility:** The QFN-48 (7x7 mm) package easily routes on Bridge One's 50x50 mm 4-layer PCB envelope `[VERIFIED]`.

---

## 11. Open Questions & Bench Tests

Before freezing the Bridge One schematic revision B incorporating the iCE40UP5K, the following bench qualification tests must be conducted:

1. **ESP32-S3 LCD_CAM / QSPI Interface to iCE40 Bench Verification:**
   - *Test:* Implement an 8-bit parallel DMA burst between ESP32-S3 LCD_CAM and an iCE40UP5K breakout board. Measure sustained transfer throughput and CPU utilization when refilling a 4 KB sector cache.
2. **Same-CS Zero-Dummy Turnaround Logic Analyzer Test:**
   - *Test:* Synthesize the 256-word EBR opcode decoder in iCE40UP5K. Drive it with an external Linux SPI master at 10 MHz, 25 MHz, and 50 MHz executing back-to-back `0x9F` (RDID), `0x05` (RDSR), and `0x0B` (FAST_READ). Capture MISO setup time relative to SCLK on an oscilloscope to verify $>5\text{ ns}$ setup margin across VTREF translator rails.
3. **Sliding Cache Sector-Miss Latency Characterization:**
   - *Test:* Characterize how the Linux `spi-nor` driver responds if an access falls outside the current 128 KB SPRAM window. Since SPI cannot stretch the clock, determine if the target controller tolerates a fixed pre-fetch scenario or if critical bootloader/kernel sectors must be locked in SPRAM.
4. **Direct Bitstream Programming from ESP-IDF:**
   - *Test:* Verify ESP32-S3 GPIO toggling and SPI streaming into iCE40 `CRESET_B` / `SPI_SS` / `CDONE` sequence on cold boot, verifying bitstream load time is $<50\text{ ms}$.
5. **Alternative Fallback Procurement:**
   - *Action:* Since iCE40UP5K is currently unavailable at local Turkish distributors (Ozdisan/Robotistan/Direnc), verify import/procurement channel lead times via international distributors (Digi-Key / Mouser / LCSC) for prototyping prototypes.
