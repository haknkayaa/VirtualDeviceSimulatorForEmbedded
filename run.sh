#!/usr/bin/env bash

# VDS4E development workspace launcher.
#
# Usage:
#   ./run.sh
#   VDS_WEB_PORT=4200 ./run.sh
#   VDS_WEB_HOST=127.0.0.1 ./run.sh  # Restrict access to this machine.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER_AUTH="${VDS4E_ADAPTER_AUTH:-sudo}"

if [[ ! -x "$ROOT_DIR/dev.sh" ]]; then
  echo "Cannot start VDS4E: dev.sh is missing or is not executable." >&2
  exit 1
fi

case "$ADAPTER_AUTH" in
  sudo)
    if ! command -v sudo >/dev/null 2>&1; then
      echo "Cannot start VDS4E with one-time adapter authorization: sudo is unavailable." >&2
      exit 1
    fi
    echo "Authorize VDS4E adapter helpers once for this development session..."
    sudo -v
    sudo modprobe cuse 2>/dev/null || true
    sudo modprobe gpio-sim 2>/dev/null || true
    export VDS4E_ADAPTER_AUTH=sudo
    ;;
  pkexec)
    export VDS4E_ADAPTER_AUTH=pkexec
    ;;
  *)
    echo "Unsupported VDS4E_ADAPTER_AUTH value: $ADAPTER_AUTH (use sudo or pkexec)." >&2
    exit 1
    ;;
esac

exec "$ROOT_DIR/dev.sh" "$@"
