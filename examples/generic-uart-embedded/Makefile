CC ?= cc
CFLAGS ?= -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 -D_DEFAULT_SOURCE

.PHONY: all clean

all: uart_ping

uart_ping: uart_ping.c
	$(CC) $(CFLAGS) $< -o $@

clean:
	rm -f uart_ping

