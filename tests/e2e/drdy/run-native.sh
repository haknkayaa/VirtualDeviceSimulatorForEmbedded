#!/usr/bin/env bash
# Runs the signal E2E scripts directly on this host. Requires root, a kernel with the
# gpio-sim and cuse modules plus configfs, libgpiod tools, i2c-tools and curl.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export WORK="${WORK:-$REPO/build/e2e-drdy-native}"

[ "$(id -u)" = 0 ] || { echo "run as root (CUSE and configfs need it)" >&2; exit 2; }
"$REPO/tests/e2e/drdy/build-binaries.sh"
modprobe gpio-sim
modprobe cuse
mountpoint -q /sys/kernel/config || mount -t configfs configfs /sys/kernel/config

export PATH="$WORK/bin:$PATH"
status=0
for test in spi-gpio i2c-gpio; do
  echo "################ $test"
  REPO="$REPO" bash "$REPO/tests/e2e/drdy/$test.sh" || status=1
done
exit "$status"
