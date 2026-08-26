# Generic UART responder

This deterministic example recognizes two byte sequences:

- `PING\r\n` → `PONG\r\n`
- `AT\r` → `OK\r\n`

The runtime treats UART as a byte stream, so a request may arrive in several
PTY reads or several complete requests may arrive together. Declared request
sequences must therefore be unique and must not be prefixes of one another.

The declared baud rate and 8N1 framing document the intended client setup.
The PTY adapter exposes termios but does not model bit timing or electrical
framing errors.
