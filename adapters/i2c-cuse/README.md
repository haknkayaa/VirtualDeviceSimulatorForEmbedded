# Linux I2C CUSE adapter

`vds4e-i2c-cuse` creates `/dev/i2c-N` and implements the Linux `i2c-dev`
userspace ABI. One daemon represents one bus and maps slave addresses to VDS4E
device IDs.

The source is separated into process orchestration (`main.c`), configuration
validation (`options.c`), Linux CUSE/ioctl handling (`runtime.c`), and
data-plane transaction routing (`transaction.c`).

Supported ioctl families:

- `I2C_FUNCS`, `I2C_SLAVE`, `I2C_SLAVE_FORCE`, `I2C_TENBIT`
- `I2C_RDWR` combined transfers
- SMBus quick, byte, byte-data, word-data, and I2C-block operations

The acceptance clients are the unmodified distribution commands
`i2cdetect`, `i2cget`, `i2cset`, and `i2ctransfer`.
