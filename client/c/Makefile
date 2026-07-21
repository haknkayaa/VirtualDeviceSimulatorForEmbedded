CC ?= cc
AR ?= ar
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic -Werror
CPPFLAGS ?= -Iinclude

BUILD_DIR := build
LIBRARY := $(BUILD_DIR)/libvds4e.a
EXAMPLE := $(BUILD_DIR)/read_id

.PHONY: all clean

all: $(EXAMPLE)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/client.o: src/client.c include/vds4e/client.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c src/client.c -o $@

$(LIBRARY): $(BUILD_DIR)/client.o
	$(AR) rcs $@ $^

$(EXAMPLE): ../../examples/c-client/read_id.c $(LIBRARY)
	$(CC) $(CPPFLAGS) $(CFLAGS) $< $(LIBRARY) -o $@

clean:
	rm -rf $(BUILD_DIR)

