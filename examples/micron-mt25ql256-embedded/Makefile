CC ?= gcc
CFLAGS ?= -O2 -g -Wall -Wextra -Wpedantic -std=c11

all: mt25ql256_tool

mt25ql256_tool: mt25ql256_tool.c
	$(CC) $(CFLAGS) $< -o $@

clean:
	rm -f mt25ql256_tool