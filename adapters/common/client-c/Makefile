CC ?= cc
AR ?= ar
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic -Werror
CPPFLAGS ?= -Iinclude

BUILD_DIR := build
LIBRARY := $(BUILD_DIR)/libvds4e.a

.PHONY: all clean

all: $(LIBRARY)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/client.o: src/client.c include/vds4e/client.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c src/client.c -o $@

$(LIBRARY): $(BUILD_DIR)/client.o
	$(AR) rcs $@ $^

clean:
	rm -rf $(BUILD_DIR)
