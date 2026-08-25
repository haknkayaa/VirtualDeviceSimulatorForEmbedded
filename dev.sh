#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/apps/vds-web"
WEB_PORT="${VDS_WEB_PORT:-4174}"
CONTROL_PORT=8080
SPI_CUSE_BUILD_DIR="$ROOT_DIR/build/adapters/spi-cuse"
SPI_CUSE_EXECUTABLE="$SPI_CUSE_BUILD_DIR/vds4e-spi-cuse"
I2C_CUSE_BUILD_DIR="$ROOT_DIR/build/adapters/i2c-cuse"
I2C_CUSE_EXECUTABLE="$I2C_CUSE_BUILD_DIR/vds4e-i2c-cuse"
LOCK_FILE="${TMPDIR:-/tmp}/vds4e-dev-${UID}.lock"
SERVER_PID=""
WEB_PID=""
SERVER_OWN_PROCESS_GROUP=false

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another VDS4E development workspace is already running." >&2
  echo "Stop its dev.sh terminal with Ctrl+C before starting a new one." >&2
  exit 1
fi

port_is_open() {
  (exec 8<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

wait_for_control_api() {
  echo "Waiting for the Control API to become ready..."

  while ! port_is_open "$CONTROL_PORT"; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      set +e
      wait "$SERVER_PID"
      local status=$?
      set -e

      echo "vds-server stopped before the Control API became ready (status $status)." >&2
      if [[ $status -eq 0 ]]; then
        return 1
      fi
      return "$status"
    fi
    sleep 0.1
  done
}

if port_is_open "$WEB_PORT"; then
  echo "Web port $WEB_PORT is already in use." >&2
  echo "Stop the existing process or choose VDS_WEB_PORT=<port>." >&2
  exit 1
fi

if port_is_open "$CONTROL_PORT"; then
  echo "Control API port $CONTROL_PORT is already in use." >&2
  echo "Stop the existing vds-server before starting dev.sh." >&2
  exit 1
fi

cleanup() {
  trap - EXIT
  if [[ -n "$WEB_PID" ]]; then
    kill -TERM -- "-$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    if [[ "$SERVER_OWN_PROCESS_GROUP" == true ]]; then
      kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
    else
      kill -TERM "$SERVER_PID" 2>/dev/null || true
    fi
  fi
  wait "$WEB_PID" "$SERVER_PID" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  echo "Web dependencies are missing; installing them once..."
  npm --prefix "$WEB_DIR" install
fi

cd "$ROOT_DIR"

echo "Configuring and building the SPI CUSE adapter..."
cmake \
  -S "$ROOT_DIR/adapters/spi-cuse" \
  -B "$SPI_CUSE_BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Debug
cmake --build "$SPI_CUSE_BUILD_DIR" --parallel

echo "Configuring and building the I2C CUSE adapter..."
cmake \
  -S "$ROOT_DIR/adapters/i2c-cuse" \
  -B "$I2C_CUSE_BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Debug
cmake --build "$I2C_CUSE_BUILD_DIR" --parallel

if [[ "${VDS4E_ADAPTER_AUTH:-pkexec}" == "sudo" ]]; then
  # sudo's default credential cache is terminal-scoped. Keep the server in
  # this terminal session so adapter helpers can use the one authorization
  # acquired by run.sh, while still running the server itself unprivileged.
  cargo build -p vds-server
  env \
    VDS4E_SPI_CUSE_EXECUTABLE="$SPI_CUSE_EXECUTABLE" \
    VDS4E_I2C_CUSE_EXECUTABLE="$I2C_CUSE_EXECUTABLE" \
    "$ROOT_DIR/build/rust/debug/vds-server" --config config/vds-server.yaml &
  SERVER_PID=$!
else
  setsid env \
    VDS4E_SPI_CUSE_EXECUTABLE="$SPI_CUSE_EXECUTABLE" \
    VDS4E_I2C_CUSE_EXECUTABLE="$I2C_CUSE_EXECUTABLE" \
    cargo run -p vds-server -- --config config/vds-server.yaml &
  SERVER_PID=$!
  SERVER_OWN_PROCESS_GROUP=true
fi

wait_for_control_api

setsid npm --prefix "$WEB_DIR" run dev -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort &
WEB_PID=$!

echo
echo "VDS4E development workspace is starting:"
echo "  Web UI:      http://127.0.0.1:$WEB_PORT"
echo "  Control API: http://127.0.0.1:$CONTROL_PORT/api/v1/health"
echo "  Data plane:  /tmp/vds4e.sock"
echo
echo "Keep this terminal open. Press Ctrl+C to stop both processes."
echo

set +e
wait -n "$SERVER_PID" "$WEB_PID"
STATUS=$?
set -e

if [[ $STATUS -ne 130 ]]; then
  echo "A development process stopped (status $STATUS); shutting down the workspace."
fi

exit "$STATUS"
