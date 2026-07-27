# Generic I2C Register Device

Attach this device to an I2C adapter at address `0x50`, load the adapter, then
use the host distribution's unmodified tools:

```shell
i2cdetect -y 0
i2cget -y 0 0x50 0x00 b
i2cset -y 0 0x50 0x01 0x7f b
i2ctransfer -y 0 w1@0x50 0x00 r4
```
