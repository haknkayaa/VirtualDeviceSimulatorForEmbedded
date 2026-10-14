# Target header: Raspberry Pi 40-pin compatible

Revision F proposal, 2026-10-14. Placement only; no schematic exists yet.

J3 is an unshrouded 2x20 2.54 mm header whose pin numbers match the Raspberry
Pi GPIO header; pin 1 is marked on silkscreen because the header is not keyed. A standard 40-way ribbon or GPIO extension cable connects a Pi
directly; other targets use jumper wires against the silkscreen labels. All
signals pass through the VTREF-referenced translators and target-side ESD; none
connect directly to the ESP32-S3 or the FPGA.

Directions are from the **target's** point of view (the Pi is the master).

| Pi pin | Pi function (BCM) | Bridge net | Direction | Notes |
| ---: | --- | --- | --- | --- |
| 1 | 3V3 | VTREF | target → bridge | Reference only; never powers the bridge or the target |
| 2, 4 | 5V | NC | — | Not connected: the bridge must not take or supply 5 V |
| 3 | GPIO2 SDA1 | I2C0_SDA | bidirectional | Pi `/dev/i2c-1`; virtual I2C devices |
| 5 | GPIO3 SCL1 | I2C0_SCL | bidirectional | |
| 7 | GPIO4 | GPIO0 | per-pin DIR | |
| 8 | GPIO14 TXD | UART_RX | target → bridge | Pi `serial0` |
| 10 | GPIO15 RXD | UART_TX | bridge → target | |
| 11 | GPIO17 | GPIO1 | per-pin DIR | |
| 12 | GPIO18 | GPIO2 | per-pin DIR | |
| 13 | GPIO27 | GPIO3 | per-pin DIR | |
| 15 | GPIO22 | GPIO4 | per-pin DIR | |
| 16 | GPIO23 | GPIO5 | per-pin DIR | |
| 17 | 3V3 | VTREF | target → bridge | Same net as pin 1 |
| 18 | GPIO24 | GPIO6 | per-pin DIR | |
| 19 | GPIO10 SPI0 MOSI | SPI_MOSI | target → bridge | FPGA SPI engine; Pi `/dev/spidev0.x` |
| 21 | GPIO9 SPI0 MISO | SPI_MISO | bridge → target | Driven only while a CS is asserted |
| 22 | GPIO25 | GPIO7 | per-pin DIR | |
| 23 | GPIO11 SPI0 SCLK | SPI_SCLK | target → bridge | |
| 24 | GPIO8 SPI0 CE0 | SPI_CS0 | target → bridge | |
| 26 | GPIO7 SPI0 CE1 | SPI_CS1 | target → bridge | |
| 27 | GPIO0 ID_SD | I2C1_SDA | bidirectional | HAT ID bus; isolated by default |
| 28 | GPIO1 ID_SC | I2C1_SCL | bidirectional | HAT ID bus; isolated by default |
| 6, 9, 14, 20, 25, 30, 34, 39 | GND | GND | — | |
| 29, 31, 32, 33, 35, 36, 37, 38, 40 | GPIO5/6/12/13/19/16/26/20/21 | NC | — | Reserved; no translator channels left |

## Design notes and open points

- The Pi reads a HAT ID EEPROM on pins 27/28 at boot. Bridge I2C1 must stay
  isolated until firmware is configured, or a virtual device at 0x50 could be
  mistaken for a HAT descriptor. Whether to expose I2C1 there is a review item.
- VTREF on pins 1/17 limits this header to the Pi's 3.3 V I/O when a Pi is
  attached. Other targets supply their own 1.8 V or 3.3 V reference on the same pins.
- The SPI pins need the CS-gated MISO behavior and FPGA execution engine from
  `research/spi-engine-tradeoff.md`; same-CS response timing is still a bench gate.
- The translator channel budget (2 PCA9306DCU, 3 SN74AVC4T245RSV, 2 SN74AXC4T774RSV) follows
  `research/target-interface-spec.md`. That spec's isolation and PCA9306 bias
  findings must be applied before schematic capture.

## J10 direct-plug header (2x12, in front of J3)

Same translated nets as J3, for jumper wires without a Pi cable. Odd pins are
the front row, even pins the back row; names are printed inward between the
rows. Connect only one target at a time: J3 and J10 share nets, so a second
cable adds stubs and possible contention.

| Pins | Function |
| --- | --- |
| 1 / 2 | VREF (target reference input) / GND |
| 3, 4, 5, 6 | SDA0, SCL0, SDA1, SCL1 |
| 7, 8, 9, 10, 11 | CS0, CS1, SCK, MOSI, MISO |
| 12 | GND |
| 13-20 | GPIO0-GPIO7 |
| 21 / 23 | 5V_OUT (VBUS through an OVP switch that opens above ~6 V) / 3V3_OUT (~300 mA current-limited) |
| 22, 24 | GND |

5V_OUT and 3V3_OUT are user accessory supplies. They are never connected to
VREF or to the J3 5 V / 3.3 V pins, so a Raspberry Pi is not back-powered.
Their switch parts are candidates and not yet selected.
