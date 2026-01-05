#!/usr/bin/env bash
set -euo pipefail

SYSROOT_DIR="${1:-}"
if [ -z "$SYSROOT_DIR" ]; then
	echo "Usage: setup-snesmini-local-core.sh <sysroot-dir>" >&2
	exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
	if command -v sudo >/dev/null 2>&1; then
		exec sudo "$0" "$@"
	fi
	echo "This script requires root (sudo not found)." >&2
	exit 1
fi

if ! command -v debootstrap >/dev/null 2>&1; then
	if command -v apt-get >/dev/null 2>&1; then
		echo "Installing debootstrap..." >&2
		apt-get update
		apt-get install -y debootstrap
	else
		echo "debootstrap is required to create the sysroot." >&2
		echo "Install it with: sudo apt-get install -y debootstrap" >&2
		exit 1
	fi
fi

if ! command -v arm-linux-gnueabihf-g++ >/dev/null 2>&1; then
	if command -v apt-get >/dev/null 2>&1; then
		echo "Installing arm-linux-gnueabihf toolchain..." >&2
		apt-get update
		apt-get install -y gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf binutils-arm-linux-gnueabihf
	else
		echo "arm-linux-gnueabihf-g++ is required to build the core." >&2
		echo "Install it with: sudo apt-get install -y gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf binutils-arm-linux-gnueabihf" >&2
		exit 1
	fi
fi

if ! command -v qemu-arm-static >/dev/null 2>&1; then
	if command -v apt-get >/dev/null 2>&1; then
		echo "Installing qemu-user-static..." >&2
		apt-get update
		apt-get install -y qemu-user-static binfmt-support
	else
		echo "qemu-arm-static is required to run debootstrap second stage." >&2
		echo "Install it with: sudo apt-get install -y qemu-user-static binfmt-support" >&2
		exit 1
	fi
fi

DISTRO="jessie"
MIRROR="http://archive.debian.org/debian/"
INCLUDE_PKGS="libc6-dev,libstdc++6,libstdc++-4.9-dev,zlib1g-dev"

mkdir -p "$SYSROOT_DIR"

need_packages=false
if [ ! -f "$SYSROOT_DIR/usr/include/zlib.h" ]; then
	need_packages=true
fi
if [ ! -f "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libstdc++.so.6" ] && [ ! -f "$SYSROOT_DIR/lib/arm-linux-gnueabihf/libstdc++.so.6" ]; then
	need_packages=true
fi

if [ ! -d "$SYSROOT_DIR/debootstrap" ] && [ ! -f "$SYSROOT_DIR/etc/debian_version" ]; then
	debootstrap --arch=armhf --variant=minbase --foreign --no-check-gpg \
		--include="$INCLUDE_PKGS" \
		"$DISTRO" "$SYSROOT_DIR" "$MIRROR"
	need_packages=true
fi

if [ -x "$SYSROOT_DIR/debootstrap/debootstrap" ]; then
	cp /usr/bin/qemu-arm-static "$SYSROOT_DIR/usr/bin/"
	chroot "$SYSROOT_DIR" /debootstrap/debootstrap --second-stage
	rm -f "$SYSROOT_DIR/usr/bin/qemu-arm-static"
	need_packages=true
fi

if [ "$need_packages" = true ]; then
	echo "Ensuring sysroot packages..." >&2
	cat > "$SYSROOT_DIR/etc/apt/sources.list" <<EOF
deb http://archive.debian.org/debian/ jessie main
EOF
	cat > "$SYSROOT_DIR/etc/apt/apt.conf.d/99no-check-valid-until" <<EOF
Acquire::Check-Valid-Until "false";
EOF
	cp /usr/bin/qemu-arm-static "$SYSROOT_DIR/usr/bin/"
	chroot "$SYSROOT_DIR" /bin/bash -c "apt-get update && apt-get install -y $INCLUDE_PKGS"
	rm -f "$SYSROOT_DIR/usr/bin/qemu-arm-static"
fi

if [ -f "$SYSROOT_DIR/lib/arm-linux-gnueabihf/libz.so.1" ]; then
	mkdir -p "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf"
	libz_link="$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libz.so"
	if [ -L "$libz_link" ]; then
		link_target="$(readlink "$libz_link")"
		if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/libz.so.1" ]; then
			rm -f "$libz_link"
			ln -s ../../../lib/arm-linux-gnueabihf/libz.so.1 "$libz_link"
		fi
	elif [ ! -e "$libz_link" ]; then
		ln -s ../../../lib/arm-linux-gnueabihf/libz.so.1 "$libz_link"
	fi
fi

if [ -f "$SYSROOT_DIR/lib/arm-linux-gnueabihf/libm.so.6" ]; then
	mkdir -p "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf"
	if [ -L "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libm.so" ] || [ ! -e "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libm.so" ]; then
		rm -f "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libm.so"
		cat > "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libm.so" <<'EOF'
/* GNU ld script */
OUTPUT_FORMAT(elf32-littlearm)
GROUP ( /lib/arm-linux-gnueabihf/libm.so.6 )
EOF
	fi
fi

if [ -f "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libstdc++.so.6" ] && [ ! -e "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libstdc++.so" ]; then
	ln -s libstdc++.so.6 "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libstdc++.so"
fi

if [ -f "$SYSROOT_DIR/lib/arm-linux-gnueabihf/libgcc_s.so.1" ] && [ ! -e "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libgcc_s.so" ]; then
	mkdir -p "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf"
	ln -s ../../../lib/arm-linux-gnueabihf/libgcc_s.so.1 "$SYSROOT_DIR/usr/lib/arm-linux-gnueabihf/libgcc_s.so"
fi

touch "$SYSROOT_DIR/.snesmini-ready"

echo "SNES Mini sysroot created at: $SYSROOT_DIR"
