CC ?= cc
AR ?= ar
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic -Werror
CPPFLAGS ?= -I.

BUILD_DIR ?= build
LIBRARY := $(BUILD_DIR)/libvds4e_adapter_bridge.a
SOURCES := adapter_bridge.c bridge_codec.c bridge_io.c spi_bridge.c \
	i2c_bridge.c gpio_bridge.c uart_bridge.c
OBJECTS := $(SOURCES:%.c=$(BUILD_DIR)/%.o)

.PHONY: all clean

all: $(LIBRARY)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/%.o: %.c adapter_bridge.h adapter_bridge_internal.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(LIBRARY): $(OBJECTS)
	$(AR) rcs $@ $^

clean:
	rm -rf $(BUILD_DIR)
