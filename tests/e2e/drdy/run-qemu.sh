#!/usr/bin/env bash
# Runs the signal E2E scripts (spi-gpio.sh, i2c-gpio.sh) inside a QEMU guest booted
# from a stock distribution kernel. Use it when the host kernel lacks
# gpio-sim/cuse/configfs (cloud sandboxes, hosted CI runners, containers).
#
# Host requirements: qemu-system-x86, debootstrap, e2fsprogs, gcc, cmake,
# libfuse3-dev, a Rust toolchain, root, and an installed distribution kernel with
# its module packages (Ubuntu: linux-image-generic + linux-modules-extra-<ver>).
# Network access is needed once for debootstrap and the upstream spidev_test.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="${WORK:-$REPO/build/e2e-drdy}"
# Prefer a distribution kernel: cloud images also carry vendor kernels without gpio-sim.
KVER="${KVER:-$( (ls /lib/modules | grep -E -- '-(generic|virtual)$' || ls /lib/modules) | sort -V | tail -1)}"
mkdir -p "$WORK"
find "/lib/modules/$KVER" -name 'gpio-sim.ko*' | grep -q . \
  || { echo "kernel $KVER has no gpio-sim module (install linux-modules-extra-$KVER)" >&2; exit 2; }

echo "== build host binaries"
WORK="$WORK" "$REPO/tests/e2e/drdy/build-binaries.sh"

echo "== root filesystem"
if [ ! -d "$WORK/rootfs" ]; then
  debootstrap --variant=minbase --components=main,universe \
    --include=gpiod,kmod,libfuse3-3,libgcc-s1,procps,i2c-tools,curl,iproute2 \
    noble "$WORK/rootfs" http://archive.ubuntu.com/ubuntu
fi
ROOT="$WORK/rootfs"
rm -rf "${ROOT:?}/lib/modules" "${ROOT:?}/vds"
mkdir -p "$ROOT/lib/modules" "$ROOT/vds/repo/device-models/examples" "$ROOT/vds/repo/tests/e2e/drdy"
cp -a "/lib/modules/$KVER" "$ROOT/lib/modules/"
cp "$WORK"/bin/* "$ROOT/usr/local/bin/"
cp -a "$REPO/device-models/examples/spi-sensor-drdy" "$REPO/device-models/examples/i2c-sensor-drdy" \
  "$REPO/device-models/examples/generic-gpio-bank" "$ROOT/vds/repo/device-models/examples/"
cp "$REPO"/tests/e2e/drdy/*.sh "$ROOT/vds/repo/tests/e2e/drdy/"
cat > "$ROOT/vds/init.sh" <<'INIT'
#!/bin/bash
export PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root
mount -t proc proc /proc; mount -t sysfs sys /sys
mountpoint -q /dev || mount -t devtmpfs dev /dev
mkdir -p /dev/pts /tmp; mount -t devpts devpts /dev/pts; mount -t tmpfs tmp /tmp
mount -t configfs configfs /sys/kernel/config
ip link set lo up
echo "### guest kernel $(uname -r)"
modprobe gpio-sim && modprobe cuse || echo "### MODULE LOAD FAILED"
for t in spi-gpio i2c-gpio; do
  echo; echo "################ $t"
  REPO=/vds/repo bash "/vds/repo/tests/e2e/drdy/$t.sh"
  echo "### E2E_EXIT $t=$?"
done
sync; echo o > /proc/sysrq-trigger; sleep 5
INIT
chmod +x "$ROOT/vds/init.sh"

echo "== image and boot (software emulation if /dev/kvm is missing)"
rm -f "${WORK:?}/root.img"
truncate -s 1500M "$WORK/root.img"
mke2fs -q -t ext4 -d "$ROOT" -L vdsroot "$WORK/root.img"
ACCEL=()
[ -w /dev/kvm ] && ACCEL=(-enable-kvm -cpu host) || ACCEL=(-cpu max)
timeout 900 qemu-system-x86_64 -m 2G -smp 4 "${ACCEL[@]}" -nographic -no-reboot \
  -kernel "/boot/vmlinuz-$KVER" \
  -append "root=/dev/vda rw console=ttyS0 panic=-1 init=/vds/init.sh quiet loglevel=3" \
  -drive "file=$WORK/root.img,format=raw,if=virtio" | tee "$WORK/guest.log"
grep -q "### RESULT spi-gpio: ALL_PASS" "$WORK/guest.log" \
  && grep -q "### RESULT i2c-gpio: ALL_PASS" "$WORK/guest.log"
