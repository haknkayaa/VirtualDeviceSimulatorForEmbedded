# Bridge One: Technical Research & Feasibility Review

**Target:** ESP32-S3-WROOM-1-N8R8 (8 MB Octal PSRAM, 8 MB Quad Flash)  
**Firmware:** ESP-IDF v5.5.3 (I2C Slave v2 driver) | **Host:** Native USB-C (GPIO19 D-, GPIO20 D+)  
**Target I/O:** Selectable 1.8 V / 3.3 V via isolated translators | **Authority:** PC (local cache/execution)  
**Path:** `hardware/bridge-one/research/technical-review.md`

---

## 1. Primary Sources

1. **Espressif ESP32-S3-WROOM-1 Datasheet**, Version 1.8 (2026): [PDF Link](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf)
2. **Espressif ESP32-S3 Technical Reference Manual (TRM)**: [PDF Link](https://www.espressif.com/sites/default/files/documentation/esp32-s3_technical_reference_manual_en.pdf). Section numbering must be checked against the downloaded revision before implementation.
3. **Espressif ESP32-S3 Series Chip Datasheet**: [PDF Link](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf).
4. **Texas Instruments PCA9306 Datasheet**, Rev. O (2023): [PDF Link](https://www.ti.com/lit/ds/symlink/pca9306.pdf)
5. **Texas Instruments SN74AXC4T245 / SN74AXC8T245 Datasheets**, Rev. B / Rev. C: [4T245](https://www.ti.com/lit/ds/symlink/sn74axc4t245.pdf) | [8T245](https://www.ti.com/lit/ds/symlink/sn74axc8t245.pdf)
6. **ESP-IDF v5.5.3 I2C guide**: [Official guide](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/i2c.html). Older issue reports are not evidence of current driver behavior without reproduction.

---

## 2. N8R8 Module Hardware Constraints & Strapping

- **Octal PSRAM Reserved Pins (Pads 28, 29, 30 / IO35, IO36, IO37):**  
  Tied internally to Octal PSRAM (`SPIIO6`/DQ6, `SPIIO7`/DQ7, `SPIDQS`/DQS).  
  *Evidence (Datasheet v1.8 Table 3-1 Note b):*  
  > *"pins IO35, IO36, and IO37 are connected to the Octal SPI PSRAM and are not available for other uses."*  
  **Design Rule:** Pads 28, 29, and 30 must remain completely unconnected (NC) on the PCB layout.
- **Strapping Pins (TRM Chapter 8 / Datasheet v1.8 Table 4-1):**
  - **GPIO0 (Pad 27):** High for normal SPI boot; low enters Joint Download Boot. External 10 kΩ pull-up + boot switch.
  - **GPIO46 (Pad 16):** Must be low at reset for Joint Download Boot (default internal weak pull-down).
  - **GPIO45 (Pad 26):** Default internal pull-down selects 3.3 V `VDD_SPI`. Keep low at reset unless eFuse overrides are set.
- **Native USB:** Dedicated to GPIO19 (`USB_D-`) and GPIO20 (`USB_D+`).

---

## 3. I2C Multi-Address & Slave Behavior

- **Single Address Per Controller:**  
  *TRM Section 27.8 Register 27.13 (`I2C_SLAVE_ADDR_REG`):* Bitfield `I2C_SLAVE_ADDR[14:0]` stores a single address; no address mask register exists. ESP-IDF `i2c_slave_config_t` accepts a single `slave_addr`.
- **Two-Controller Shared Bus Plausibility:**  
  Internal GPIO Matrix routes only one peripheral output per pin (`GPIO_FUNCx_OUT_SEL`). Tying I2C0 (`SDA0`/`SCL0`) and I2C1 (`SDA1`/`SCL1`) externally on the PCB as open-drain lines is an electrically plausible candidate for two simultaneous addresses, but is unmeasured and requires bench validation for unaddressed controller passivity.
- **Repeated START & Empty FIFO Handling:**  
  In ESP-IDF v5.5.3 (`CONFIG_I2C_ENABLE_SLAVE_DRIVER_VERSION_2`), slave events are signaled via `on_request` and `on_receive`. Correct first-byte delivery after a repeated START and FIFO-empty behavior require measurement on the selected driver. A PC/USB round trip cannot be assumed to satisfy target deadlines; time-critical state and execution remain local by design.

---

## 4. SPI2 (FSPI) Slave Same-CS Limitations

- **Stock ESP-IDF Driver Blocker:**  
  The stock ESP-IDF `spi_slave` driver relies on prequeued descriptors loaded before CS assertion and signals transfer completion (`SPI_TRANS_DONE_INT`) only after CS deasserts (TRM Table 30.10-2).
- **Half-Duplex Hardware Restriction:**  
  Half-duplex slave mode (`spi_slave_hd`) uses its own predefined command framing. A numeric opcode overlap with a NOR command does not give that command NOR semantics. It is not established as a transparent decoder for existing peripheral drivers.
- **Conclusion:**  
  Stock ESP-IDF drivers do not establish generic same-CS opcode/address decoding for unmodified target drivers. Local caching alone does not resolve same-CS decoding without clock pauses. This remains a V1 release blocker. Role reversal in V2 (ESP32-S3 as SPI master) is natively supported in hardware.

---

## 5. Level Translation & Direction Control

- **Open-Drain I2C (TI PCA9306 Rev. O):**  
  Bidirectional pass-FET translator. `EN` requires a validated bias/control network (per TI datasheet recommendation: $V_{\text{REF2}}$ tied via 200 kΩ and EN driven via clamped control), rather than an unvalidated plain pull-down.
- **Push-Pull Paths (TI SN74AXC4T245 / SN74AXC8T245):**  
  Dual-rail (0.65 V–3.6 V) direction-controlled transceivers. Direction controls are split between inbound (SCLK, MOSI, CS, RX, CTS) and outbound (MISO, TX, RTS, DRDY). External 10 kΩ pull-ups on `/OE` ensure high-impedance state at power-up. Target 1.8 V maximum clock ratings must be determined by bench measurement.

---

## 6. Provisional Pin Allocation

This independent alternative predates the architect's allocation and is not the
design pin map. Use [pin-allocation.md](../docs/pin-allocation.md) for CAD. In
particular, the architect reserves GPIO1 for VTREF sensing and GPIO6/7 for I2C1.

| Pad | Net | Function | Direction (V1) | Constraints / Notes |
| :---: | :---: | :---: | :---: | :--- |
| **3** | `EN` | Chip Enable | Input | 10 kΩ pull-up, 1 µF to GND, reset switch |
| **4, 5** | `GPIO4, 5` | `I2C1_SDA, SCL` | Open-Drain | Secondary I2C controller (tied to I2C0 on PCB) |
| **6, 8** | `GPIO6, 15` | `SPI_DIR_IN, OUT`| Output | Transceiver direction controls (Inbound / Outbound) |
| **7, 12** | `GPIO7, 8` | `UART1_RTS, CTS` | Out / In | Target flow control (GPIO Matrix) |
| **9** | `GPIO16` | `SPI_OE_N` | Output | Active-low output enable (10 kΩ pull-up to 3.3 V) |
| **10, 11**| `GPIO17, 18`| `UART1_TX, RX` | Out / In | Target UART data (IO MUX Function 2) |
| **13, 14**| `GPIO19, 20`| `USB_D-, D+` | I/O | Native USB-C interface |
| **16** | `GPIO46` | `BOOT_STRAP1` | Strapping | Default weak pull-down; must be low for joint download |
| **18–21**| `GPIO10–13` | `FSPI_CS, D, CLK, Q`| In / In / In / Out | Native FSPI IO MUX Function 4 (CS0, MOSI, SCLK, MISO) |
| **23–25**| `GPIO21, 47, 48`| `DRDY, GPIO1, 2`| Out / I/O / I/O | Virtual interrupt / target general-purpose I/O |
| **26** | `GPIO45` | `VDD_SPI_STRAP` | Strapping | Keep low at reset (default internal pull-down) |
| **27** | `GPIO0` | `BOOT0` | Strapping / In | 10 kΩ pull-up to 3.3 V, boot tactile switch to GND |
| **28–30**| `GPIO35–37` | **RESERVED** | **NC** | **DO NOT CONNECT (Octal PSRAM internal bonding)** |
| **31** | `GPIO38` | `I2C_EN_CTRL` | Output | PCA9306 enable control (via validated bias network) |
| **32–35**| `GPIO39–42` | `OE_N, DIR` | Output | UART & GPIO transceiver enable and direction controls |
| **36, 37**| `GPIO44, 43` | `U0RXD, U0TXD` | In / Out | Dedicated debug UART console header |
| **38, 39**| `GPIO2, 1` | `I2C0_SCL, SDA` | Open-Drain | Primary I2C controller |

---

## 7. Bench Validation Plan (Required Prior to Schematic Sign-Off)

1. **Dual I2C Controller Electrical Isolation:** Measure bus behavior on an oscilloscope with I2C0 and I2C1 pins tied in parallel to confirm unaddressed controller passivity during transactions.
2. **I2C Clock-Stretch Release Timing:** Characterize SCL stretch-to-data-valid latency under ESP-IDF v5.5.3 slave v2 against embedded Linux master timeouts.
3. **SPI Transceiver Latency & Waveform Integrity:** Measure propagation delay and rise/fall times through SN74AXC4T245 at 1.8 V target I/O across frequency steps to determine maximum reliable clock rate.
4. **PCA9306 Enable Network Verification:** Validate enable/disable sequencing and pull-up resistor combinations (1.8 V vs 3.3 V rails) during cold target power-up.
