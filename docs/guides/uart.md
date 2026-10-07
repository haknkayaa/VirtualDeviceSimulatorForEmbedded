# UART: `/dev/pts/N`

The [UART PTY adapter](../../adapters/uart-pty/README.md) creates an unprivileged
standard TTY endpoint. Create a UART adapter in the Web UI, attach
`generic-uart-responder`, and load it. Use the reported PTY slave path rather
than assuming its numeric suffix:

```shell
stty -F /dev/pts/7 115200 raw -echo
build/examples/uart_ping /dev/pts/7
# PONG
```

The PTY is an unprivileged standard TTY endpoint. Its baud/framing settings are
accepted through termios for application compatibility, but the first UART
runtime models a deterministic byte stream rather than physical bit timing.
