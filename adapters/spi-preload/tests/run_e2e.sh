#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
    echo "usage: $0 LIBRARY NATIVE_EXAMPLE ERROR_PROBE SUCCESS_PROBE VDS_SERVER" >&2
    exit 2
fi

library=$1
example=$2
error_probe=$3
success_probe=$4
server=$5
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
temporary=$(mktemp -d)
socket="$temporary/vds4e.sock"
config="$temporary/vds4e.yaml"

cleanup() {
    if [ -n "${server_pid:-}" ]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$temporary"
}
trap cleanup EXIT INT TERM

cat >"$config" <<EOF
schema_version: 1
server:
  control_address: 127.0.0.1:0
data_plane:
  unix_socket: $socket
observability:
  log_level: warn
device_models:
  - $root/device-models/examples/spi-flash.yaml
EOF

"$server" --config "$config" >"$temporary/server.log" 2>&1 &
server_pid=$!
attempt=0
while [ ! -S "$socket" ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 500 ]; then
        cat "$temporary/server.log" >&2
        exit 1
    fi
    sleep 0.02
done

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.0=spi-flash-0" \
VDS4E_SOCKET="$socket" \
"$example"

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.1=missing-device" \
VDS4E_SOCKET="$socket" \
"$error_probe" /dev/spidev0.1 19

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.0=spi-flash-0" \
VDS4E_SOCKET="$socket" \
"$success_probe" /dev/spidev0.0 null-rx

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.0=spi-flash-0" \
VDS4E_SOCKET="$socket" \
"$success_probe" /dev/spidev0.0 concurrent

kill "$server_pid"
wait "$server_pid" || true
server_pid=
rm -f "$socket"
sed '0,/opcode: 0x9F/s//opcode: 0x00/' \
    "$root/device-models/examples/spi-flash.yaml" >"$temporary/zero-model.yaml"
sed "s|$root/device-models/examples/spi-flash.yaml|$temporary/zero-model.yaml|" \
    "$config" >"$temporary/zero-config.yaml"
"$server" --config "$temporary/zero-config.yaml" \
    >"$temporary/zero-server.log" 2>&1 &
server_pid=$!
attempt=0
while [ ! -S "$socket" ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 500 ]; then
        cat "$temporary/zero-server.log" >&2
        exit 1
    fi
    sleep 0.02
done

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.0=spi-flash-0" \
VDS4E_SOCKET="$socket" \
"$success_probe" /dev/spidev0.0 null-tx

kill "$server_pid"
wait "$server_pid" || true
server_pid=
rm -f "$socket"
sed '0,/enabled: false/s//enabled: true/' \
    "$root/device-models/examples/spi-flash.yaml" >"$temporary/timeout-model.yaml"
sed "s|$root/device-models/examples/spi-flash.yaml|$temporary/timeout-model.yaml|" \
    "$config" >"$temporary/timeout-config.yaml"
"$server" --config "$temporary/timeout-config.yaml" \
    >"$temporary/timeout-server.log" 2>&1 &
server_pid=$!
attempt=0
while [ ! -S "$socket" ]; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 500 ]; then
        cat "$temporary/timeout-server.log" >&2
        exit 1
    fi
    sleep 0.02
done

LD_PRELOAD="$library" \
VDS4E_SPI_MAP="/dev/spidev0.0=spi-flash-0" \
VDS4E_SOCKET="$socket" \
"$error_probe" /dev/spidev0.0 110
