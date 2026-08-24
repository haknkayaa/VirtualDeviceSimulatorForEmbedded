CC ?= cc
AR ?= ar
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic -Werror
CPPFLAGS ?= -Iinclude

BUILD_DIR := build
LIBRARY := $(BUILD_DIR)/libvds4e_adapter_bridge.a

.PHONY: all clean

all: $(LIBRARY)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/adapter_bridge.o: src/adapter_bridge.c include/vds4e/adapter_bridge.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c src/adapter_bridge.c -o $@

$(LIBRARY): $(BUILD_DIR)/adapter_bridge.o
	$(AR) rcs $@ $^

clean:
	rm -rf $(BUILD_DIR)
