#!/usr/bin/env bash
# Real Linux ABI end-to-end test for ADR 0011 (generic I2C register device):
#
#   control-plane sample-ready write -> STATUS.DRDY -> signal router -> GPIO runtime
#   -> gpio-sim -> /dev/gpiochipN -> gpiomon -> i2cget/i2ctransfer read of
#   /dev/i2c-N -> read-clear -> DRDY falls
#
# generic-i2c-register has no timers, so the sample-ready event is the same register
# write that the Web UI and scenarios perform. Everything the application does uses
# unmodified distribution tools (i2cdetect, i2cget, i2ctransfer, gpiomon, gpioget).
# Needs root, gpio-sim and cuse modules, configfs, libgpiod tools, i2c-tools, curl.
set -u
E2E_NAME=i2c-gpio
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

I2C_BUS="${I2C_BUS:-90}"
ADDR=0x48
API="http://127.0.0.1:$CONTROL_PORT/api/v1"

start_server i2c-sensor-drdy "  - from: i2c-sensor-drdy.drdy
    to: generic-gpio-bank-32.GPIO16"
wait_for 100 curl -sf "$API/health" > /dev/null || { echo "FAIL control API"; curl -sv "$API/health" 2>&1 | tail -8; ip -br addr; exit 1; }
start_gpio_sim

"$BIN_I2C_CUSE" --name "i2c-$I2C_BUS" --binding "$ADDR=i2c-sensor-drdy" --socket "$SOCKET" \
  > "$WORK/i2c.out" 2> "$WORK/i2c.err" &
PIDS+=($!)
wait_for 100 test -c "/dev/i2c-$I2C_BUS" || { echo "FAIL no /dev/i2c-$I2C_BUS"; cat "$WORK/i2c.err"; exit 1; }
gpiodetect
sleep 0.3

sample_ready() { # the sensor finished a conversion
  curl -sf -X POST -H 'content-type: application/json' -d '{"value":1}' \
    "$API/devices/i2c-sensor-drdy/registers/1" > /dev/null
}

echo; echo "=== bus sanity ==="
i2cdetect -y "$I2C_BUS" | sed 's/^/    /'
check "device answers at $ADDR" "$(i2cdetect -y "$I2C_BUS" | grep -c ' 48 ')" 1
check "DEVICE_ID over i2cget" "$(i2cget -y "$I2C_BUS" $ADDR 0x00)" 0x42

echo; echo "=== cycle 1: sample ready -> DRDY rising -> i2cget STATUS -> falling ==="
check "DRDY low at idle" "$(gpioget "$CHIP" 16)" 0
edge_monitor rising rise1; RISE=$MON_PID
sample_ready || { echo "FAIL control-plane write"; FAIL=1; }
if await_exit "$RISE"; then echo "gpiomon: $(cat "$WORK/rise1.out")"; else echo "FAIL no rising edge within 5 s"; FAIL=1; fi
check "DRDY high after the edge" "$(gpioget "$CHIP" 16)" 1
sleep 0.4
check "DRDY stays high until STATUS is read" "$(gpioget "$CHIP" 16)" 1

edge_monitor falling fall1; FALL=$MON_PID
check "i2cget STATUS returns the pre-clear value" "$(i2cget -y "$I2C_BUS" $ADDR 0x01)" 0x01
if await_exit "$FALL"; then echo "gpiomon: $(cat "$WORK/fall1.out")"; else echo "FAIL no falling edge within 5 s"; FAIL=1; fi
check "DRDY low after read-clear" "$(gpioget "$CHIP" 16)" 0
check "STATUS cleared on the bus" "$(i2cget -y "$I2C_BUS" $ADDR 0x01)" 0x00

echo; echo "=== cycle 2: re-arm, cleared by an i2ctransfer combined read ==="
edge_monitor rising rise2; RISE=$MON_PID
sample_ready
if await_exit "$RISE"; then echo "PASS  second rising edge: $(cat "$WORK/rise2.out")"; else echo "FAIL no second edge"; FAIL=1; fi
check "DRDY high in cycle 2" "$(gpioget "$CHIP" 16)" 1
check "i2ctransfer write-then-read of STATUS" "$(i2ctransfer -y "$I2C_BUS" w1@$ADDR 0x01 r1)" 0x01
sleep 0.4
check "DRDY low after i2ctransfer read" "$(gpioget "$CHIP" 16)" 0

echo; echo "=== negative: reads without a new sample must not raise DRDY ==="
i2cget -y "$I2C_BUS" $ADDR 0x01 > /dev/null; sleep 0.3
check "DRDY still low" "$(gpioget "$CHIP" 16)" 0
check "SAMPLE register unaffected by read-clear" "$(i2cget -y "$I2C_BUS" $ADDR 0x02)" 0x5a

finish
