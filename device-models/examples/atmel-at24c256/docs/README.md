# Atmel AT24C256

Datasheet-derived model for the AT24C256 256-Kbit (32,768-byte) two-wire
serial EEPROM. It implements two-byte word addressing, 64-byte page writes,
page-local write rollover, current/random/sequential reads, capacity rollover,
write protection, and the 5 ms maximum self-timed write cycle with ACK polling.

Attach the package to an I²C adapter at an address from `0x50` through `0x53`.
With address pins A1=A0=0:

```shell
i2ctransfer -y 0 w2@0x50 0x00 0x10 r4
i2ctransfer -y 0 w3@0x50 0x00 0x10 0x5a
until i2cdetect -y 0 0x50 0x50 | grep -q '50'; do :; done
i2ctransfer -y 0 w2@0x50 0x00 0x10 r1
```

Source: Atmel `doc0670.pdf`, document 0670T-SEEPR-3/07, revision T.

For an Embedded Linux C application using `/dev/i2c-N` directly, see
`examples/atmel-at24c256-embedded/at24c256_tool.c`.
