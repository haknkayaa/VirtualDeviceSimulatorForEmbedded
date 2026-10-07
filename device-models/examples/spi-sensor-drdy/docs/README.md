# SPI sensor with DRDY output

Example for cross-device signal wiring (ADR 0011). `START_CONVERSION` (0x10)
begins a 1 ms virtual-time conversion; when it completes the `SAMPLE` register
(0x20, four bytes) holds a result and bit 31 is set. Reading `SAMPLE` clears
bit 31 (`read_clear`).

The public output port `drdy` follows bit 31. Wire it to a GPIO line in
`topology.yaml`, for example `spi-sensor-drdy.drdy -> generic-gpio-bank-32.GPIO16`.
