# UART PTY adapter

`vds4e-uart-pty` creates a normal pseudoterminal slave (for example
`/dev/pts/7`) and forwards bytes from its master side to the VDS4E UART data
plane. Applications open the reported slave path and use ordinary
`open(2)`, `read(2)`, `write(2)`, and termios calls.

PTYs preserve the Linux TTY userspace API but do not emulate electrical UART
timing, modem-control pins, parity errors, breaks, or a hardware UART driver.
