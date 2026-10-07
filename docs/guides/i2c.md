# I2C: `/dev/i2c-N`

See [device-node permissions](spi.md#device-node-permissions) for when `sudo` is required.

The [I²C CUSE adapter](../../adapters/i2c-cuse/README.md) creates a real
`/dev/i2c-N` bus and maps unique slave addresses to runtime device IDs.

In **Adapters**, create I²C bus `0`, attach `generic-i2c-register` at slave
address `80` (`0x50`), and load the adapter:

```shell
$ stat -c '%F %n' /dev/i2c-0
character special file /dev/i2c-0

$ i2cdetect -y 0
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
...
50: 50 -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
...
