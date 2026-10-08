#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT_DIR/build/.state"
ADAPTER_BUILD_DIR="$ROOT_DIR/build/adapters"
EXAMPLE_BUILD_DIR="$ROOT_DIR/build/examples"

configure_adapter() {
  local source_dir="$1"
  local build_dir="$2"
  local cache_file="$build_dir/CMakeCache.txt"
  local directory_info="$build_dir/CMakeFiles/CMakeDirectoryInformation.cmake"
  local cached_source=""
  local cached_binary=""
  local generated_binary=""

  if [[ -f "$cache_file" ]]; then
    cached_source="$(sed -n 's#^CMAKE_HOME_DIRECTORY:INTERNAL=##p' "$cache_file")"
    cached_binary="$(sed -n 's#^CMAKE_CACHEFILE_DIR:INTERNAL=##p' "$cache_file")"
    if [[ -f "$directory_info" ]]; then
      generated_binary="$(sed -n 's#^set(CMAKE_RELATIVE_PATH_TOP_BINARY "\(.*\)")#\1#p' "$directory_info")"
    fi

    if [[ "$cached_source" != "$source_dir" ||
          "$cached_binary" != "$build_dir" ||
          ( -n "$generated_binary" && "$generated_binary" != "$build_dir" ) ]]; then
      echo "Discarding relocated CMake cache: $build_dir"
      cmake -E remove_directory "$build_dir"
    fi
  fi

  cmake -S "$source_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release
}

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
configure_adapter "$ROOT_DIR/adapters/spi-cuse" "$ADAPTER_BUILD_DIR/spi-cuse"
cmake --build "$ADAPTER_BUILD_DIR/spi-cuse" --config Release --parallel

echo "Building I2C CUSE adapter..."
configure_adapter "$ROOT_DIR/adapters/i2c-cuse" "$ADAPTER_BUILD_DIR/i2c-cuse"
cmake --build "$ADAPTER_BUILD_DIR/i2c-cuse" --config Release --parallel

echo "Building GPIO simulator adapter..."
configure_adapter "$ROOT_DIR/adapters/gpio-sim" "$ADAPTER_BUILD_DIR/gpio-sim"
cmake --build "$ADAPTER_BUILD_DIR/gpio-sim" --config Release --parallel

echo "Building UART PTY adapter..."
configure_adapter "$ROOT_DIR/adapters/uart-pty" "$ADAPTER_BUILD_DIR/uart-pty"
cmake --build "$ADAPTER_BUILD_DIR/uart-pty" --config Release --parallel

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

echo "Building generic UART Embedded Linux tool..."
"${CC:-cc}" \
  -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 \
  "$ROOT_DIR/examples/generic-uart-embedded/uart_ping.c" \
  -o "$EXAMPLE_BUILD_DIR/uart_ping"

echo "Building generic GPIO Embedded Linux tool..."
"${CC:-cc}" \
  -O2 -g -Wall -Wextra -Wpedantic -Werror -std=c11 -D_POSIX_C_SOURCE=200809L \
  "$ROOT_DIR/examples/generic-gpio-embedded/gpio_tool.c" \
  -o "$EXAMPLE_BUILD_DIR/gpio_tool" \
  -lgpiod

touch "$STATE_DIR/.built"

echo
echo "Build complete."
echo "Next step: ./install"
