#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/apps/vds-web"
WEB_PORT="${VDS_WEB_PORT:-4174}"
CONTROL_PORT=8080
LOCK_FILE="${TMPDIR:-/tmp}/vds4e-dev-${UID}.lock"
SERVER_PID=""
WEB_PID=""

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another VDS4E development workspace is already running." >&2
  echo "Stop its dev.sh terminal with Ctrl+C before starting a new one." >&2
  exit 1
fi

port_is_open() {
  (exec 8<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
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
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
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

setsid cargo run -p vds-server -- --config config/vds-server.yaml &
SERVER_PID=$!

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
