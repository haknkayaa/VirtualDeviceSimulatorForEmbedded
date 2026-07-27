CC ?= cc
CFLAGS ?= -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11

.PHONY: all clean

all: at24c256_tool

at24c256_tool: at24c256_tool.c
	$(CC) $(CFLAGS) $< -o $@

clean:
	rm -f at24c256_tool
