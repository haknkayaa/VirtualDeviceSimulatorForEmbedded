# Bridge One pin allocation (revision F)

2026-10-14. Architect allocation for schematic capture; not yet bench-proven.
Revision A (S3-only SPI slave) is archived in `history/2026-10-14-pin-allocation-revA.md`.

## Function split

| Function | Owner | Why |
| --- | --- | --- |
| USB device, PC protocol, control plane | ESP32-S3 | Native USB serial/JTAG + application USB |
| Target I2C0 / I2C1 (virtual slaves) | ESP32-S3 hardware I2C | Clock stretching and pointer delivery are in the S3 controller (research/i2c-slave-feasibility.md) |
| Target UART | ESP32-S3 UART1 | Buffered byte stream; latency-tolerant |
| Target SPI (virtual flash/sensors) | iCE40UP5K | Same-CS opcode/address decode needs a hardware engine (research/spi-engine-tradeoff.md) |
| Target GPIO bank (8 ch, per-pin direction) | iCE40UP5K | Edge timestamps and per-pin DIR without spending S3 pins |
| Flash-image backing store | QSPI PSRAM on the FPGA | Pending research/spi-backing-memory.md |
| Status OLED | ESP32-S3 software I2C master | Both hardware I2C controllers serve the target |
| LINK / VTREF / FPGA LEDs | iCE40 RGB current-sink pins | Saves S3 GPIOs; PWR LED is hard-wired |

## ESP32-S3-WROOM-1-N8R8

GPIO numbers are not module pad numbers. Straps GPIO3/45/46 stay unconnected;
GPIO35/36/37 belong to the octal PSRAM; GPIO26-32 are not exposed.

| GPIO | Net | Direction (S3) | Notes |
| --- | --- | --- | --- |
| 0 | BOOT_N | in | BOOT button to GND, 10k pull-up; strap |
| 1 | VTREF_ADC | analog in | ADC1_CH0, divided and clamped VTREF |
| 2 | OLED_RES_N | out | OLED reset, 10k pull-down holds reset until firmware |
| 4 | I2C0_SDA_MCU | open-drain | I2C0 slave, to PCA9306 U8 |
| 5 | I2C0_SCL_MCU | open-drain | I2C0 slave (clock stretching) |
| 6 | I2C1_SDA_MCU | open-drain | I2C1 slave, to PCA9306 U9 |
| 7 | I2C1_SCL_MCU | open-drain | I2C1 slave |
| 8 | OLED_SDA | open-drain | Software I2C master, 4.7k to 3V3 |
| 9 | OLED_SCL | open-drain | Software I2C master, 4.7k to 3V3 |
| 10 | FPGA_SS_N | out | SPI2 native CS: FPGA config SPI_SS, then data link CS |
| 11 | FPGA_MOSI | out | SPI2 native MOSI -> FPGA SPI_SI |
| 12 | FPGA_SCK | out | SPI2 native SCK -> FPGA SPI_SCK |
| 13 | FPGA_MISO | in | SPI2 native MISO <- FPGA SPI_SO |
| 14 | FPGA_CRESET_N | out | 10k pull-down keeps the FPGA in reset until firmware |
| 15 | FPGA_CDONE | in | 10k pull-up per Lattice checklist (confirm in research/ice40-pin-plan.md) |
| 16 | FPGA_IRQ | in | FPGA event/FIFO interrupt |
| 17 | UART_TX_MCU | out | UART1 TX -> translator U10 |
| 18 | UART_RX_MCU | in | UART1 RX <- translator U10 |
| 19 | USB_DN | — | Native USB D- |
| 20 | USB_DP | — | Native USB D+ |
| 21 | PORT_OE_N | out | Global target isolate; 10k pull-up = isolated by default |
| 38 | UART_OE_N | out | UART translator OE; 10k pull-up |
| 39 | I2C0_OFF | out | I2C0 isolate request; 10k pull-up = isolated (NOR gate with PORT_GATE_N) |
| 40 | I2C1_OFF | out | I2C1 isolate request; 10k pull-up = isolated |
| 41 | AUX5V_EN | out | 5V_OUT switch enable; pull-down = off |
| 42 | AUX3V3_EN | out | 3V3_OUT switch enable; pull-down = off |
| 43 | DEBUG_TX | out | UART0, bottom test pad |
| 44 | DEBUG_RX | in | UART0, bottom test pad |
| 47 | SPARE0 | — | Test pad (future: aux fault flags) |
| 48 | SPARE1 | — | Test pad |
| EN | CHIP_EN | in | RESET button, 10k pull-up + 1 uF |

GPIO39-42 are the JTAG pins; Bridge One debugs over the built-in USB-JTAG, so
they are free for general use. They must not be driven high by external
circuitry during boot.

## iCE40UP5K-SG48 (pending research/ice40-pin-plan.md)

Interface list the FPGA must provide; pin numbers are assigned from the task G
report. All IO banks run at 3.3 V (MCU side of the translators).

| Group | Signals |
| --- | --- |
| S3 link / config | SPI_SS, SPI_SCK, SPI_SI, SPI_SO, CRESET_B, CDONE, FPGA_IRQ |
| Target SPI | T_SCK, T_MOSI, T_CS0, T_CS1 (in); T_MISO, T_MISO_OE_N (out); SPI_DIR_IN, SPI_DIR_OUT |
| Target GPIO | GPIO0-7 data; GPIO_DIR0-7; GPIO_OE_N |
| PSRAM | PSRAM_CS_N, PSRAM_SCK, PSRAM_IO0-3 |
| Clock / LEDs | CLK12M; RGB0 LINK, RGB1 VTREF, RGB2 FPGA |

## Hardware gating rules (from research/target-interface-spec.md)

- PORT_OE_N high (default) isolates every push-pull translator and disables
  both PCA9306 enables, whatever the per-port signals say.
- A VTREF-valid comparator also gates every enable, so translators stay
  isolated when the target is unpowered even if firmware misbehaves.
- PCA9306 EN is driven through 200k from a gate output (not a fixed bias), with
  2.2M to GND, so an unpowered target is never back-powered through EN/VREF.
- T_MISO_OE_N is asserted only while a target CS is low (FPGA logic plus the
  translator OE default-high pull-up).
- Direction pins change only while the relevant OE is inactive.
