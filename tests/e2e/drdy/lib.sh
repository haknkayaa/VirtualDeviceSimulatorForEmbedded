# Shared helpers for the signal-topology end-to-end tests. Source, do not execute.
# shellcheck shell=bash

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
BIN_SERVER="${BIN_SERVER:-vds-server}"
BIN_GPIO_SIM="${BIN_GPIO_SIM:-vds4e-gpio-sim}"
BIN_SPI_CUSE="${BIN_SPI_CUSE:-vds4e-spi-cuse}"
BIN_I2C_CUSE="${BIN_I2C_CUSE:-vds4e-i2c-cuse}"
SPIDEV_TEST="${SPIDEV_TEST:-spidev_test}"
CONTROL_PORT="${CONTROL_PORT:-18080}"

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
wait_for() { # <tries of 100 ms> <test command...>
  local tries=$1; shift
  for _ in $(seq "$tries"); do "$@" && return 0; sleep 0.1; done
  return 1
}
await_exit() { # wait up to 5 s for a background pid to exit, else kill it
  local pid=$1
  for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  kill "$pid" 2>/dev/null
  return 1
}

# start_server <sensor-package-dir-name> <topology-yaml-body>
start_server() {
  cat > "$WORK/topology.yaml" <<YAML
schema_version: 1
connections:
$2
YAML
  cat > "$WORK/server.yaml" <<YAML
schema_version: 1
server: { control_address: '127.0.0.1:$CONTROL_PORT' }
data_plane: { unix_socket: $SOCKET }
observability: { log_level: debug }
event_store: { enabled: false }
topology: $WORK/topology.yaml
device_packages:
  - $REPO/device-models/examples/$1
  - $REPO/device-models/examples/generic-gpio-bank
YAML
  "$BIN_SERVER" --config "$WORK/server.yaml" > "$WORK/server.log" 2>&1 &
  PIDS+=($!)
  wait_for 100 test -S "$SOCKET" || { echo "FAIL server socket"; cat "$WORK/server.log"; exit 1; }
}

# start_gpio_sim -> sets CHIP
start_gpio_sim() {
  "$BIN_GPIO_SIM" --name vds4e-e2e-gpio --label "VDS4E E2E GPIO" --lines 32 \
    --device-id generic-gpio-bank-32 --socket "$SOCKET" > "$WORK/gpio.out" 2> "$WORK/gpio.err" &
  PIDS+=($!)
  wait_for 100 test -s "$WORK/gpio.out"
  CHIP=$(head -1 "$WORK/gpio.out")
  [ -c "$CHIP" ] || { echo "FAIL no gpiochip ($CHIP)"; cat "$WORK/gpio.err"; exit 1; }
  echo "### gpio-sim controller: $CHIP"
}

# edge_monitor <rising|falling> <name>: background gpiomon on line 16, sets MON_PID
edge_monitor() {
  gpiomon --num-events=1 "--$1-edge" --format='%e line=%o' "$CHIP" 16 > "$WORK/$2.out" 2>&1 &
  MON_PID=$!
  sleep 0.5
}

# Prints the server-side transaction/edge timeline and the verdict.
finish() {
  echo; echo "### server-side signal_changed events (UTC, publishing device)"
  grep '"event":"signal_changed"' "$WORK/server.log" \
    | grep -o '"timestamp":"[^"]*"\|"device_id":"[^"]*"' | paste - - | sed 's/^/  /'
  echo "### server-side GPIO edges seen by the runtime"
  grep "GPIO edge detected" "$WORK/server.log" | grep -o '"timestamp":"[^"]*"\|"edges":"[^"]*"' | paste - - | sed 's/^/  /'
  grep -Ei '"level":"(WARN|ERROR)"|panic' "$WORK/server.log" | head -5
  echo "### RESULT $E2E_NAME: $([ "$FAIL" = 0 ] && echo ALL_PASS || echo FAILURES)"
  exit "$FAIL"
}
