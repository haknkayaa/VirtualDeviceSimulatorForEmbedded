# Bridge One provisional pin allocation

Revision A, 2026-10-14. This is an architect allocation for review, not a released
schematic or proof of concurrent peripheral operation. Module pad numbers below
refer to ESP32-S3-WROOM-1; GPIO numbers are not pad numbers.

| GPIO / signal | Module pad | Net / function | V1 role | V2 reservation |
| --- | --- | --- | --- | --- |
| GPIO4 | 4 | I2C0_SDA_MCU | Open-drain slave data | Master SDA |
| GPIO5 | 5 | I2C0_SCL_MCU | Slave clock / stretching | Master SCL |
| GPIO6 | 6 | I2C1_SDA_MCU | Second controller, separate port | Second bus or expansion |
| GPIO7 | 7 | I2C1_SCL_MCU | Second controller, separate port | Second bus or expansion |
| GPIO10 | 18 | SPI_CS_MCU | SPI2 CS0 input | CS output |
| GPIO11 | 19 | SPI_MOSI_MCU | SPI2 native MOSI input | MOSI output |
| GPIO12 | 20 | SPI_SCLK_MCU | SPI2 native SCLK input | SCLK output |
| GPIO13 | 21 | SPI_MISO_MCU | SPI2 native MISO output | MISO input |
| GPIO17 | 10 | UART_TX_MCU | Bridge TX output | Bridge TX output |
| GPIO18 | 11 | UART_RX_MCU | Bridge RX input | Bridge RX input |
| GPIO15 | 8 | TARGET_GPIO0_MCU | Profile-selected input/output | Same |
| GPIO2 | 38 | TARGET_GPIO1_MCU | Profile-selected input/output | Same |
| GPIO8 | 12 | TARGET_GPIO2_MCU | Profile-selected input/output | Same |
| GPIO9 | 17 | TARGET_GPIO3_MCU | Profile-selected input/output | Same |
| GPIO14 | 22 | PORT_OE_N | Global push-pull isolate, pull high | Isolate before role changes |
| GPIO47 | 24 | SPI_DIR_MAIN | Three target-to-MCU channels | Reverse when detached |
| GPIO16 | 9 | SPI_DIR_MISO | Opposite SPI data direction | Reverse when detached |
| GPIO21 | 23 | I2C_ISOLATE | Disable open-drain path, default isolated | Same |
| GPIO38 | 31 | UART_OE_N | UART port isolation, pull high | Same |
| GPIO39 | 32 | GPIO_DIR0 | Target GPIO0 translator direction | Same |
| GPIO40 | 33 | GPIO_DIR1 | Target GPIO1 translator direction | Same |
| GPIO41 | 34 | GPIO_DIR2 | Target GPIO2 translator direction | Same |
| GPIO42 | 35 | GPIO_DIR3 | Target GPIO3 translator direction | Same |
| GPIO48 | 25 | SPI_MISO_OE_N | Firmware inhibit plus hardware CS gating | Role-dependent gating |
| GPIO1 | 39 | VTREF_ADC | Divided target reference, ADC1 | Same |
| GPIO19 | 13 | USB_D_MINUS | Native USB device D− | Same |
| GPIO20 | 14 | USB_D_PLUS | Native USB device D+ | Same |
| GPIO43 | 37 | DEBUG_TX | UART0 recovery header TX | Same |
| GPIO44 | 36 | DEBUG_RX | UART0 recovery header RX | Same |
| GPIO0 | 27 | BOOT_N | Dedicated strap/button, no target load | Same |
| EN | 3 | CHIP_EN | Reset/button and reset RC | Same |
| 3V3 | 2 | +3V3_MCU | Regulated MCU supply | Same |
| GND | 1,40,41 | GND | Ground including exposed pad | Same |

GPIO3 (pad15), GPIO45 (pad26), GPIO46 (pad16) are boot straps and reserved.
GPIO35/36/37 (pads28/29/30) are not available for user IO on the R8 octal-PSRAM
variant; do not attach external signals. Unexposed flash/PSRAM pins are not spare
GPIOs. GPIO46 is input-only; it is deliberately unused.

Two-address shared I2C is a proposed assembly option, not baseline support:
provide DNP links joining the *target sides* of the two I2C ports, preserving
separate controller pins and independently controlled translation paths. Populate
only after concurrent controllers, distinct addresses, ACK behavior, stretching
and repeated-START state isolation pass measurement. Never short GPIO input
matrix routing blindly to create two independent peripheral inputs on one pin.

The SPI pin choice preserves native SPI2 IO_MUX. It does not solve dynamic
command decoding or establish a board-level maximum clock. Target cable,
translator, ESD loading and target sampling setup time all enter the timing
budget. Select no advertised SCLK until measurements are recorded.

Global isolation and per-port enables must combine in hardware; a disabled global
enable wins over every port request. DIR changes only while the relevant port is
isolated. Pin voltage sensing informs firmware, but hardware power-off isolation
must work independently of ADC sampling and firmware startup.

## Sources

- [Module datasheet and pin table](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf)
- [GPIO restrictions](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/gpio.html)
- [SPI2 native IO_MUX](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32s3/api-reference/peripherals/spi_slave.html)

Final pin ownership depends on the selected translator bank layout and MISO
gating circuit. The schematic must use this map or document a reviewed revision.
