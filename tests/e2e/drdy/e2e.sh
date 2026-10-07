#!/usr/bin/env bash
# Real Linux ABI end-to-end test for ADR 0011:
#
#   sensor model -> delayed DRDY -> signal router -> GPIO runtime -> gpio-sim
#   -> /dev/gpiochipN -> gpiomon -> SPI read (spidev_test) -> read-clear -> DRDY falls
#
# Needs root, the gpio-sim and cuse kernel modules, configfs, libgpiod tools and an
# upstream spidev_test. Run it directly on such a host or use run-qemu.sh.
set -u

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
BIN_SERVER="${BIN_SERVER:-vds-server}"
BIN_GPIO_SIM="${BIN_GPIO_SIM:-vds4e-gpio-sim}"
BIN_SPI_CUSE="${BIN_SPI_CUSE:-vds4e-spi-cuse}"
SPIDEV_TEST="${SPIDEV_TEST:-spidev_test}"
WORK="$(mktemp -d)"
export HOME="$WORK/home"
mkdir -p "$HOME"
SOCKET="$WORK/vds4e.sock"
PIDS=()
FAIL=0

cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

now() { date +%s.%N; }
ms() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", (b - a) * 1000 }'; }
check() {
  if [ "$2" = "$3" ]; then echo "PASS  $1 (got '$2')"; else echo "FAIL  $1 (expected '$3', got '$2')"; FAIL=1; fi
}
wait_for() { # <seconds*10> <test command...>
  local tries=$1; shift
  for _ in $(seq "$tries"); do "$@" && return 0; sleep 0.1; done
  return 1
}
await_exit() { # wait up to 5 s for a background pid to exit
  local pid=$1
  for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  kill "$pid" 2>/dev/null
  return 1
}

cat > "$WORK/server.yaml" <<YAML
schema_version: 1
server: { control_address: '127.0.0.1:0' }
data_plane: { unix_socket: $SOCKET }
observability: { log_level: debug }
event_store: { enabled: false }
topology: $WORK/topology.yaml
device_packages:
  - $REPO/device-models/examples/spi-sensor-drdy
  - $REPO/device-models/examples/generic-gpio-bank
YAML
cat > "$WORK/topology.yaml" <<YAML
schema_version: 1
connections:
  - from: spi-sensor-drdy.drdy
    to: generic-gpio-bank-32.GPIO16
YAML

"$BIN_SERVER" --config "$WORK/server.yaml" > "$WORK/server.log" 2>&1 &
PIDS+=($!)
wait_for 100 test -S "$SOCKET" || { echo "FAIL server socket"; cat "$WORK/server.log"; exit 1; }

"$BIN_GPIO_SIM" --name vds4e-e2e-gpio --label "VDS4E E2E GPIO" --lines 32 \
  --device-id generic-gpio-bank-32 --socket "$SOCKET" > "$WORK/gpio.out" 2> "$WORK/gpio.err" &
PIDS+=($!)
wait_for 100 test -s "$WORK/gpio.out"
CHIP=$(head -1 "$WORK/gpio.out")
[ -c "$CHIP" ] || { echo "FAIL no gpiochip ($CHIP)"; cat "$WORK/gpio.err"; exit 1; }
echo "### gpio-sim controller: $CHIP"

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

echo; echo "### server-side timeline"
grep "transaction completed" "$WORK/server.log" | grep spi-sensor \
  | grep -o '"timestamp":"[^"]*"\|"request":"[^"]*"' | paste - - | sed 's/^/  spi: /'
grep "GPIO edge detected" "$WORK/server.log" | grep -o '"timestamp":"[^"]*"\|"edges":"[^"]*"' | paste - - | sed 's/^/  gpio: /'
grep -Ei '"level":"(WARN|ERROR)"|panic' "$WORK/server.log" | head -5
echo "### RESULT: $([ "$FAIL" = 0 ] && echo ALL_PASS || echo FAILURES)"
exit "$FAIL"
