#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-}"
ARCH="${ARCH:-$(dpkg --print-architecture)}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist}"
BUILD_ROOT="${BUILD_ROOT:-$ROOT_DIR/build/debian}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>" >&2
  exit 2
fi

if [[ "$ARCH" != "amd64" ]]; then
  echo "Unsupported Debian architecture: $ARCH" >&2
  echo "The release package currently targets amd64 only." >&2
  exit 2
fi

if [[ ! "$VERSION" =~ ^[0-9][0-9A-Za-z.+:~-]*$ ]]; then
  echo "Invalid Debian package version: $VERSION" >&2
  exit 2
fi

if [[ ! -f "$ROOT_DIR/build/.state/.built" ]]; then
  echo "Build outputs are missing. Run ./configure && ./build.sh first." >&2
  exit 1
fi

PACKAGE="vds4e"
PACKAGE_ROOT="$BUILD_ROOT/${PACKAGE}_${VERSION}_${ARCH}"
DEBIAN_DIR="$PACKAGE_ROOT/DEBIAN"
OUTPUT="$OUT_DIR/${PACKAGE}_${VERSION}_${ARCH}.deb"

rm -rf "$PACKAGE_ROOT"
mkdir -p "$DEBIAN_DIR" "$OUT_DIR"

echo "Staging VDS4E filesystem..."
DESTDIR="$PACKAGE_ROOT" PREFIX=/usr "$ROOT_DIR/install"

install -D -m 0644 \
  "$PACKAGE_ROOT/usr/share/vds4e/vds-server.example.yaml" \
  "$PACKAGE_ROOT/etc/vds4e/vds-server.yaml"
install -D -m 0644 "$ROOT_DIR/config/topology.example.yaml" \
  "$PACKAGE_ROOT/usr/share/vds4e/topology.example.yaml"
install -D -m 0644 "$ROOT_DIR/packaging/debian/vds4e.service" \
  "$PACKAGE_ROOT/lib/systemd/system/vds4e.service"

install -D -m 0644 "$ROOT_DIR/README.md" \
  "$PACKAGE_ROOT/usr/share/doc/vds4e/README.md"
install -D -m 0644 "$ROOT_DIR/CHANGELOG.md" \
  "$PACKAGE_ROOT/usr/share/doc/vds4e/CHANGELOG.md"
install -D -m 0644 "$ROOT_DIR/LICENSE" \
  "$PACKAGE_ROOT/usr/share/doc/vds4e/copyright"

printf '%s\n' '/etc/vds4e/vds-server.yaml' > "$DEBIAN_DIR/conffiles"

INSTALLED_SIZE="$(du -sk "$PACKAGE_ROOT/usr" "$PACKAGE_ROOT/etc" "$PACKAGE_ROOT/lib" | awk '{sum += $1} END {print sum}')"
cat > "$DEBIAN_DIR/control" <<EOF
Package: $PACKAGE
Version: $VERSION
Section: devel
Priority: optional
Architecture: $ARCH
Maintainer: VDS4E maintainers <noreply@github.com>
Homepage: https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded
Depends: libc6 (>= 2.35), libgcc-s1, libfuse3-3
Recommends: kmod, gpiod, i2c-tools
Suggests: spi-tools
Installed-Size: $INSTALLED_SIZE
Description: Virtual Device Simulator for Embedded Linux
 VDS4E runs native Embedded Linux applications against virtual SPI, I2C,
 GPIO, and UART devices exposed through normal Linux userspace interfaces.
 The package includes the server, CLI, host adapters, Web UI, schemas,
 bundled device models, and example tools.
EOF

cat > "$DEBIAN_DIR/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
exit 0
EOF

cat > "$DEBIAN_DIR/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl stop vds4e.service >/dev/null 2>&1 || true
  systemctl disable vds4e.service >/dev/null 2>&1 || true
fi
exit 0
EOF

cat > "$DEBIAN_DIR/postrm" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
exit 0
EOF

chmod 0755 "$DEBIAN_DIR/postinst" "$DEBIAN_DIR/prerm" "$DEBIAN_DIR/postrm"

find "$PACKAGE_ROOT/usr" "$PACKAGE_ROOT/etc" "$PACKAGE_ROOT/lib" -type f -print0 \
  | sort -z \
  | xargs -0 md5sum \
  | sed "s#  $PACKAGE_ROOT/#  #" \
  > "$DEBIAN_DIR/md5sums"

chmod 0644 "$DEBIAN_DIR/control" "$DEBIAN_DIR/conffiles" "$DEBIAN_DIR/md5sums"

echo "Building $OUTPUT..."
dpkg-deb --root-owner-group --build "$PACKAGE_ROOT" "$OUTPUT" >/dev/null
sha256sum "$OUTPUT" > "$OUTPUT.sha256"

echo "Built:"
echo "  $OUTPUT"
echo "  $OUTPUT.sha256"
