# Generic SPI Device

This package provides a general-purpose Linux `spidev` test endpoint. It has no
flash memory, JEDEC identity, erase/program lifecycle, or vendor-specific
registers.

The Commands tab exposes package-defined RX–TX shortcuts:

- `PING`: TX `A0`, receive `DE AD BE EF`
- `TX_ONLY`: transmit a known payload without RX data
- `FULL_DUPLEX_TEST`: transmit a payload and receive four deterministic bytes
- `RX_PATTERN_8`: receive an eight-byte test pattern

Attach the device to an SPI CUSE adapter to expose it as `/dev/spidevX.Y`.
