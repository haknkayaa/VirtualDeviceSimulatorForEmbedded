CC ?= cc
CFLAGS ?= -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 -D_POSIX_C_SOURCE=200809L
LDFLAGS ?=
LDLIBS ?= -lgpiod

.PHONY: all clean

all: gpio_tool

gpio_tool: gpio_tool.c
	$(CC) $(CFLAGS) $(LDFLAGS) $< -o $@ $(LDLIBS)

clean:
	rm -f gpio_tool

