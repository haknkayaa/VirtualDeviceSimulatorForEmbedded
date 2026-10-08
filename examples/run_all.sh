#!/usr/bin/env bash

# VDS4E - Build and run all example applications
#
# Usage:
#   ./examples/run_all.sh              # Build and run available examples
#   ./examples/run_all.sh --build-only # Only compile without executing
#   ./examples/run_all.sh --clean      # Clean compiled binaries

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPI_TOOL="$SCRIPT_DIR/micron-mt25ql256-embedded/mt25ql256_tool"
I2C_TOOL="$SCRIPT_DIR/atmel-at24c256-embedded/at24c256_tool"
UART_TOOL="$SCRIPT_DIR/generic-uart-embedded/uart_ping"
GPIO_TOOL="$SCRIPT_DIR/generic-gpio-embedded/gpio_tool"

# Terminal colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

BUILD_ONLY=false
CLEAN=false

for arg in "$@"; do
  case "$arg" in
    -b|--build-only)
      BUILD_ONLY=true
      ;;
    -c|--clean)
      CLEAN=true
      ;;
    -h|--help)
      echo -e "${BOLD}Usage:${NC} $0 [options]"
      echo
      echo "Options:"
      echo "  -b, --build-only   Build example binaries only, do not run"
      echo "  -c, --clean        Clean compiled binaries"
      echo "  -h, --help         Show this help message"
      echo
      echo "Examples:"
      echo "  $0                 Build all examples and test active device nodes"
      echo "  $0 --build-only    Compile C tools only"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option:${NC} $arg" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

if [ "$CLEAN" = true ]; then
  echo -e "${CYAN}=== Cleaning build artifacts ===${NC}"
  make -C "$SCRIPT_DIR/micron-mt25ql256-embedded" clean || true
  make -C "$SCRIPT_DIR/atmel-at24c256-embedded" clean || true
  make -C "$SCRIPT_DIR/generic-uart-embedded" clean || true
  make -C "$SCRIPT_DIR/generic-gpio-embedded" clean || true
  echo -e "${GREEN}Clean complete.${NC}"
  exit 0
fi

# ==============================================================================
# 1. BUILD
# ==============================================================================
echo -e "${CYAN}${BOLD}=== 1. Building Example Applications ===${NC}"

echo -n "[1/4] Building Micron MT25QL256 SPI Flash tool... "
if make -C "$SCRIPT_DIR/micron-mt25ql256-embedded" >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC} ($SPI_TOOL)"
else
  echo -e "${RED}FAILED${NC}"
  make -C "$SCRIPT_DIR/micron-mt25ql256-embedded"
  exit 1
fi

echo -n "[2/4] Building Atmel AT24C256 I2C EEPROM tool...   "
if make -C "$SCRIPT_DIR/atmel-at24c256-embedded" >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC} ($I2C_TOOL)"
else
  echo -e "${RED}FAILED${NC}"
  make -C "$SCRIPT_DIR/atmel-at24c256-embedded"
  exit 1
fi

echo -n "[3/4] Building Generic UART Ping tool...           "
if make -C "$SCRIPT_DIR/generic-uart-embedded" >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC} ($UART_TOOL)"
else
  echo -e "${RED}FAILED${NC}"
  make -C "$SCRIPT_DIR/generic-uart-embedded"
  exit 1
fi

echo -n "[4/4] Building Generic GPIO (libgpiod) tool...     "
if make -C "$SCRIPT_DIR/generic-gpio-embedded" >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC} ($GPIO_TOOL)"
else
  echo -e "${RED}FAILED${NC}"
  make -C "$SCRIPT_DIR/generic-gpio-embedded"
  exit 1
fi

echo -e "${GREEN}${BOLD}All examples built successfully!${NC}\n"

if [ "$BUILD_ONLY" = true ]; then
  exit 0
fi

# ==============================================================================
# 2. RUN & VALIDATION
# ==============================================================================
echo -e "${CYAN}${BOLD}=== 2. Device Nodes & Validation ===${NC}"

run_with_privilege_check() {
  local target_dev="$1"
  shift

  if [ -r "$target_dev" ] && [ -w "$target_dev" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

# --- SPI TEST ---
echo -e "\n${BOLD}[SPI] Micron MT25QL256 Test${NC}"
SPI_DEV="/dev/spidev0.0"
if [ -e "$SPI_DEV" ]; then
  echo -e "Device node found: ${GREEN}$SPI_DEV${NC}"
  echo -e "Command: ${CYAN}$SPI_TOOL -d $SPI_DEV id${NC}"
  echo "----------------------------------------"
  if run_with_privilege_check "$SPI_DEV" "$SPI_TOOL" -d "$SPI_DEV" id; then
    echo "----------------------------------------"
    echo -e "${GREEN}SPI Test Passed!${NC}"
  else
    echo "----------------------------------------"
    echo -e "${YELLOW}Note: If the SPI device failed to read, ensure 'micron-mt25ql256aba8esf-0sit' is attached to $SPI_DEV in the simulator.${NC}"
  fi
else
  echo -e "${YELLOW}Skipped: $SPI_DEV not found.${NC}"
  echo "To enable the SPI adapter, load it via Web UI (http://127.0.0.1:4174)."
fi

# --- I2C TEST ---
echo -e "\n${BOLD}[I2C] Atmel AT24C256 EEPROM Test${NC}"
I2C_DEV="/dev/i2c-0"
if [ -e "$I2C_DEV" ]; then
  echo -e "Device node found: ${GREEN}$I2C_DEV${NC}"
  echo -e "Command: ${CYAN}$I2C_TOOL -d $I2C_DEV -a 0x50 info${NC}"
  echo "----------------------------------------"
  if run_with_privilege_check "$I2C_DEV" "$I2C_TOOL" -d "$I2C_DEV" -a 0x50 info; then
    echo "----------------------------------------"
    echo -e "${GREEN}I2C Test Passed!${NC}"
  else
    echo "----------------------------------------"
    echo -e "${YELLOW}Note: If the I2C device failed to read, ensure 'atmel-at24c256' is attached to $I2C_DEV in the simulator.${NC}"
  fi
else
  echo -e "${YELLOW}Skipped: $I2C_DEV not found.${NC}"
  echo "To enable the I2C adapter, load it via Web UI."
fi

# --- GPIO TEST ---
echo -e "\n${BOLD}[GPIO] Generic 32-line GPIO Bank Test${NC}"
GPIO_DEV=""
for chip in /dev/gpiochip*; do
  if [ -c "$chip" ]; then
    GPIO_DEV="$chip"
    break
  fi
done

if [ -n "$GPIO_DEV" ] && [ -e "$GPIO_DEV" ]; then
  echo -e "Device node found: ${GREEN}$GPIO_DEV${NC}"
  echo -e "Command: ${CYAN}$GPIO_TOOL -c $GPIO_DEV info${NC}"
  echo "----------------------------------------"
  if run_with_privilege_check "$GPIO_DEV" "$GPIO_TOOL" -c "$GPIO_DEV" info; then
    echo "----------------------------------------"
    echo -e "Reading device output line (Line 16): ${CYAN}$GPIO_TOOL -c $GPIO_DEV get 16${NC}"
    run_with_privilege_check "$GPIO_DEV" "$GPIO_TOOL" -c "$GPIO_DEV" get 16 || true
    echo "----------------------------------------"
    echo -e "${GREEN}GPIO Test Passed!${NC}"
  else
    echo "----------------------------------------"
    echo -e "${YELLOW}Note: Failed to access GPIO controller or insufficient permissions.${NC}"
  fi
else
  echo -e "${YELLOW}Skipped: /dev/gpiochip* not found.${NC}"
  echo "To enable the GPIO adapter, create and load it via Web UI."
fi

# --- UART TEST ---
echo -e "\n${BOLD}[UART] PTY Ping/Pong Test${NC}"
UART_DEV=""
if [ -d "/dev/pts" ]; then
  for pts in /dev/pts/[0-9]*; do
    if [ -e "$pts" ] && [ -w "$pts" ]; then
      UART_DEV="$pts"
      break
    fi
  done
fi

if [ -n "$UART_DEV" ] && [ -e "$UART_DEV" ]; then
  echo -e "Candidate PTY found: ${GREEN}$UART_DEV${NC}"
  echo -e "Command: ${CYAN}$UART_TOOL $UART_DEV${NC}"
  echo "----------------------------------------"
  if "$UART_TOOL" "$UART_DEV" 2>/dev/null; then
    echo -e "\n----------------------------------------"
    echo -e "${GREEN}UART Test Passed!${NC}"
  else
    echo -e "${YELLOW}Skipped: $UART_DEV did not match responder or did not reply.${NC}"
  fi
else
  echo -e "${YELLOW}Skipped: No active UART PTY slave found.${NC}"
  echo "To run the UART test manually: $UART_TOOL /dev/pts/N"
fi

echo
echo -e "${CYAN}=== Done ===${NC}"
