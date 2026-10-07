#!/usr/bin/env bash
# Real Linux ABI end-to-end test for ADR 0011 (SPI sensor):
#
#   sensor model -> delayed DRDY -> signal router -> GPIO runtime -> gpio-sim
#   -> /dev/gpiochipN -> gpiomon -> SPI read (spidev_test) -> read-clear -> DRDY falls
#
# Needs root, the gpio-sim and cuse kernel modules, configfs, libgpiod tools and an
# upstream spidev_test. Run it directly on such a host or use run-qemu.sh.
set -u
E2E_NAME=spi-gpio
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

start_server spi-sensor-drdy "  - from: spi-sensor-drdy.drdy
    to: generic-gpio-bank-32.GPIO16"
start_gpio_sim

"$BIN_SPI_CUSE" --name spidev0.0 --device-id spi-sensor-drdy --socket "$SOCKET" \
  > "$WORK/spi.out" 2> "$WORK/spi.err" &
PIDS+=($!)
wait_for 100 test -c /dev/spidev0.0 || { echo "FAIL no /dev/spidev0.0"; cat "$WORK/spi.err"; exit 1; }
gpiodetect
sleep 0.3

echo; echo "=== cycle 1: conversion -> DRDY rising edge -> read-clear -> falling edge ==="
check "DRDY low at idle" "$(gpioget "$CHIP" 16)" 0

gpiomon --num-events=1 --rising-edge --format='%e line=%o' "$CHIP" 16 > "$WORK/rise1.out" 2>&1 &
RISE=$!; sleep 0.5
T0=$(now)
"$SPIDEV_TEST" -D /dev/spidev0.0 -p '\x10' > "$WORK/start1.out" 2>&1 || { echo "FAIL spidev_test START"; cat "$WORK/start1.out"; FAIL=1; }
if await_exit "$RISE"; then
  echo "gpiomon: $(cat "$WORK/rise1.out")  (~$(ms "$T0" "$(now)") ms incl. spidev_test start-up)"
else echo "FAIL no rising edge within 5 s"; FAIL=1; fi
check "DRDY high after the edge" "$(gpioget "$CHIP" 16)" 1
sleep 0.4
check "DRDY stays high until the sample is read" "$(gpioget "$CHIP" 16)" 1

gpiomon --num-events=1 --falling-edge --format='%e line=%o' "$CHIP" 16 > "$WORK/fall1.out" 2>&1 &
FALL=$!; sleep 0.5
"$SPIDEV_TEST" -D /dev/spidev0.0 -v -p '\x20\x00\x00\x00\x00' > "$WORK/read1.out" 2>&1 || { echo "FAIL spidev_test READ"; FAIL=1; }
sed 's/^/    /' "$WORK/read1.out" | grep -E "TX|RX"
if await_exit "$FALL"; then echo "gpiomon: $(cat "$WORK/fall1.out")"; else echo "FAIL no falling edge within 5 s"; FAIL=1; fi
check "DRDY low after read-clear" "$(gpioget "$CHIP" 16)" 0
if grep -q "RX | 00 80 00 12 34" "$WORK/read1.out"; then echo "PASS  sample bytes 80 00 12 34"; else echo "FAIL sample bytes"; FAIL=1; fi

echo; echo "=== cycle 2: the signal re-arms ==="
gpiomon --num-events=1 --rising-edge --format='%e line=%o' "$CHIP" 16 > "$WORK/rise2.out" 2>&1 &
RISE=$!; sleep 0.3
"$SPIDEV_TEST" -D /dev/spidev0.0 -p '\x10' > /dev/null 2>&1
if await_exit "$RISE"; then echo "PASS  second rising edge: $(cat "$WORK/rise2.out")"; else echo "FAIL no second edge"; FAIL=1; fi
check "DRDY high in cycle 2" "$(gpioget "$CHIP" 16)" 1

echo; echo "=== negative: a read without a new sample must not raise DRDY ==="
"$SPIDEV_TEST" -D /dev/spidev0.0 -p '\x20\x00\x00\x00\x00' > /dev/null 2>&1; sleep 0.3
check "DRDY low after the read" "$(gpioget "$CHIP" 16)" 0
"$SPIDEV_TEST" -D /dev/spidev0.0 -p '\x20\x00\x00\x00\x00' > /dev/null 2>&1; sleep 0.3
check "DRDY still low after a second read" "$(gpioget "$CHIP" 16)" 0

finish
