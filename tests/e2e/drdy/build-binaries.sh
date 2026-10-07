#!/usr/bin/env bash
# Builds everything the signal E2E scripts execute into $WORK/bin:
# vds-server, the CUSE and gpio-sim adapters, and the upstream spidev_test.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="${WORK:?set WORK to the build directory}"
SPIDEV_URL="https://raw.githubusercontent.com/torvalds/linux/v6.8/tools/spi/spidev_test.c"
mkdir -p "$WORK/bin"

cargo build --release --locked -p vds-server --manifest-path "$REPO/Cargo.toml"
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps --manifest-path "$REPO/Cargo.toml" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
cp "$TARGET_DIR/release/vds-server" "$WORK/bin/"

for adapter in spi-cuse i2c-cuse gpio-sim; do
  cmake -S "$REPO/adapters/$adapter" -B "$WORK/build-$adapter" -DCMAKE_BUILD_TYPE=Release > /dev/null
  cmake --build "$WORK/build-$adapter" --parallel > /dev/null
  cp "$WORK/build-$adapter/vds4e-$adapter" "$WORK/bin/"
done

[ -f "$WORK/spidev_test.c" ] || curl -fsSL -o "$WORK/spidev_test.c" "$SPIDEV_URL"
gcc -O2 -o "$WORK/bin/spidev_test" "$WORK/spidev_test.c"
echo "binaries in $WORK/bin"
