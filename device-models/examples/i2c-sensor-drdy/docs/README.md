# I2C sensor with DRDY output

Generic I2C register device used to verify the signal topology over the Linux
`i2c-dev` ABI. `generic-i2c-register` has no timers or state machine, so a sample
becomes ready when the control plane writes `STATUS = 0x01` (the same register
write the Web UI and scenarios perform). The public output port `drdy` follows
`STATUS` bit 0. Reading `STATUS` over I2C returns the value and clears the bit
(`read_clear`), which drops DRDY.

Wire it with `i2c-sensor-drdy.drdy -> generic-gpio-bank-32.GPIO16`.
