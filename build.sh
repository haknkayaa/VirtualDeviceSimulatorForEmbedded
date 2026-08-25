#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT_DIR/build/.state"
ADAPTER_BUILD_DIR="$ROOT_DIR/build/adapters"
EXAMPLE_BUILD_DIR="$ROOT_DIR/build/examples"

if [[ ! -f "$STATE_DIR/.configured" ]]; then
  echo "The repository has not been configured." >&2
  echo "Run ./configure before ./build.sh." >&2
  exit 1
fi

rm -f "$STATE_DIR/.built"
mkdir -p "$EXAMPLE_BUILD_DIR"

echo "Building Rust workspace..."
cargo build \
  --locked \
  --release \
  --workspace \
  --manifest-path "$ROOT_DIR/Cargo.toml"

echo "Building Web application..."
npm --prefix "$ROOT_DIR/apps/vds-web" run build

echo "Building shared adapter transport..."
make -C "$ROOT_DIR/adapters/bridge" BUILD_DIR="$ROOT_DIR/build/bridge" all

echo "Building SPI CUSE adapter..."
cmake --build "$ADAPTER_BUILD_DIR/spi-cuse" --config Release --parallel

echo "Building I2C CUSE adapter..."
cmake --build "$ADAPTER_BUILD_DIR/i2c-cuse" --config Release --parallel

echo "Building GPIO simulator adapter..."
cmake --build "$ADAPTER_BUILD_DIR/gpio-sim" --config Release --parallel

echo "Building Micron MT25QL256 Embedded Linux tool..."
"${CC:-cc}" \
  -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 \
  "$ROOT_DIR/examples/micron-mt25ql256-embedded/mt25ql256_tool.c" \
  -o "$EXAMPLE_BUILD_DIR/mt25ql256_tool"

echo "Building Atmel AT24C128/256 Embedded Linux tool..."
"${CC:-cc}" \
  -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 \
  "$ROOT_DIR/examples/atmel-at24c256-embedded/at24c256_tool.c" \
  -o "$EXAMPLE_BUILD_DIR/at24c256_tool"

touch "$STATE_DIR/.built"

echo
echo "Build complete."
echo "Next step: ./install"
