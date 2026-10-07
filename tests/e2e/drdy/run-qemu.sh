#!/usr/bin/env bash
# Runs e2e.sh inside a QEMU guest booted from a stock distribution kernel. Use it
# when the host kernel lacks gpio-sim/cuse/configfs (cloud sandboxes, containers).
#
# Host requirements: qemu-system-x86, debootstrap, e2fsprogs, gcc, cmake,
# libfuse3-dev, a Rust toolchain, root, and an installed distribution kernel with
# its module packages (Ubuntu: linux-image-generic + linux-modules-extra-<ver>).
# Network access is needed once for debootstrap and the upstream spidev_test.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="${WORK:-$REPO/build/e2e-drdy}"
KVER="${KVER:-$(ls /lib/modules | sort -V | tail -1)}"
SPIDEV_URL="https://raw.githubusercontent.com/torvalds/linux/v6.8/tools/spi/spidev_test.c"
mkdir -p "$WORK"

echo "== build host binaries"
cargo build --release --locked -p vds-server --manifest-path "$REPO/Cargo.toml"
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps --manifest-path "$REPO/Cargo.toml" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
for adapter in spi-cuse gpio-sim; do
  cmake -S "$REPO/adapters/$adapter" -B "$WORK/build-$adapter" -DCMAKE_BUILD_TYPE=Release > /dev/null
  cmake --build "$WORK/build-$adapter" --parallel > /dev/null
done
[ -f "$WORK/spidev_test.c" ] || curl -fsSL -o "$WORK/spidev_test.c" "$SPIDEV_URL"
gcc -O2 -o "$WORK/spidev_test" "$WORK/spidev_test.c"

echo "== root filesystem"
if [ ! -d "$WORK/rootfs" ]; then
  debootstrap --variant=minbase --components=main,universe \
    --include=gpiod,kmod,libfuse3-3,libgcc-s1,procps \
    noble "$WORK/rootfs" http://archive.ubuntu.com/ubuntu
fi
ROOT="$WORK/rootfs"
rm -rf "$ROOT/lib/modules" "$ROOT/vds"
mkdir -p "$ROOT/lib/modules" "$ROOT/vds/repo/device-models/examples" "$ROOT/vds/repo/tests/e2e/drdy"
cp -a "/lib/modules/$KVER" "$ROOT/lib/modules/"
cp "$TARGET_DIR/release/vds-server" "$WORK/build-spi-cuse/vds4e-spi-cuse" \
  "$WORK/build-gpio-sim/vds4e-gpio-sim" "$WORK/spidev_test" "$ROOT/usr/local/bin/"
cp -a "$REPO/device-models/examples/spi-sensor-drdy" \
  "$REPO/device-models/examples/generic-gpio-bank" "$ROOT/vds/repo/device-models/examples/"
cp "$REPO/tests/e2e/drdy/e2e.sh" "$ROOT/vds/repo/tests/e2e/drdy/"
cat > "$ROOT/vds/init.sh" <<'INIT'
#!/bin/bash
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root
mount -t proc proc /proc; mount -t sysfs sys /sys
mountpoint -q /dev || mount -t devtmpfs dev /dev
mkdir -p /dev/pts /tmp; mount -t devpts devpts /dev/pts; mount -t tmpfs tmp /tmp
mount -t configfs configfs /sys/kernel/config
echo "### guest kernel $(uname -r)"
modprobe gpio-sim && modprobe cuse || echo "### MODULE LOAD FAILED"
REPO=/vds/repo bash /vds/repo/tests/e2e/drdy/e2e.sh
echo "### E2E_EXIT=$?"
sync; echo o > /proc/sysrq-trigger; sleep 5
INIT
chmod +x "$ROOT/vds/init.sh"

echo "== image and boot (software emulation if /dev/kvm is missing)"
rm -f "$WORK/root.img"
truncate -s 1500M "$WORK/root.img"
mke2fs -q -t ext4 -d "$ROOT" -L vdsroot "$WORK/root.img"
ACCEL=()
[ -w /dev/kvm ] && ACCEL=(-enable-kvm -cpu host) || ACCEL=(-cpu max)
timeout 900 qemu-system-x86_64 -m 2G -smp 4 "${ACCEL[@]}" -nographic -no-reboot \
  -kernel "/boot/vmlinuz-$KVER" \
  -append "root=/dev/vda rw console=ttyS0 panic=-1 init=/vds/init.sh quiet loglevel=3" \
  -drive "file=$WORK/root.img,format=raw,if=virtio" | tee "$WORK/guest.log"
grep -q "### RESULT: ALL_PASS" "$WORK/guest.log"
