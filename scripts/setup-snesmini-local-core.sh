#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SYSROOT_REL=".snesmini/sysroot"
SYSROOT_DIR=""
SYSROOT_REL=""
MODE="build"
BUILD_TYPE="${SNESMINI_BUILD_TYPE:-Debug}"
MAKE_TARGET="${BMSX_SNESMINI_MAKE_TARGET:-libretro-snesmini-debug-inner}"

while [ $# -gt 0 ]; do
	case "$1" in
		--sysroot-only)
			MODE="sysroot"
			shift
			;;
		--build)
			MODE="build"
			shift
			;;
		--sysroot-dir)
			SYSROOT_DIR="${2:-}"
			shift 2
			;;
		-*)
			echo "Unknown option: $1" >&2
			exit 1
			;;
		*)
			if [ -z "$SYSROOT_DIR" ]; then
				SYSROOT_DIR="$1"
				shift
			else
				echo "Unexpected argument: $1" >&2
				exit 1
			fi
			;;
	esac
done

if [ -z "$SYSROOT_DIR" ]; then
	SYSROOT_REL="$DEFAULT_SYSROOT_REL"
	SYSROOT_DIR="${ROOT_DIR}/${SYSROOT_REL}"
elif [[ "$SYSROOT_DIR" = /* ]]; then
	if [[ "$SYSROOT_DIR" == "$ROOT_DIR"* ]]; then
		SYSROOT_REL="${SYSROOT_DIR#${ROOT_DIR}/}"
	else
		echo "Sysroot must be under the repo: $SYSROOT_DIR" >&2
		exit 1
	fi
else
	SYSROOT_REL="$SYSROOT_DIR"
	SYSROOT_DIR="${ROOT_DIR}/${SYSROOT_REL}"
fi

is_root() {
	[ "$(id -u)" -eq 0 ]
}

ensure_command() {
	local command="$1"
	shift
	if ! command -v "$command" >/dev/null 2>&1; then
		if ! command -v apt-get >/dev/null 2>&1; then
			echo "apt-get is required to install $command." >&2
			exit 1
		fi
		apt-get update
		apt-get install -y "$@"
	fi
}

ensure_sysroot() {
	local sysroot="$1"
	local need_packages=false

	ensure_command debootstrap debootstrap
	ensure_command qemu-arm-static qemu-user-static binfmt-support
	ensure_command arm-linux-gnueabihf-g++ gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf binutils-arm-linux-gnueabihf

	local distro="jessie"
	local mirror="http://archive.debian.org/debian/"
	local include_pkgs="libc6-dev,libstdc++6,libstdc++-4.9-dev,zlib1g-dev,libegl1-mesa-dev,libgles2-mesa-dev"

	mkdir -p "$sysroot"

	if [ ! -f "$sysroot/usr/include/zlib.h" ]; then
		need_packages=true
	fi
	if [ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libstdc++.so.6" ] && \
		[ ! -f "$sysroot/lib/arm-linux-gnueabihf/libstdc++.so.6" ]; then
		need_packages=true
	fi

	if [ ! -d "$sysroot/debootstrap" ] && [ ! -f "$sysroot/etc/debian_version" ]; then
		debootstrap --arch=armhf --variant=minbase --foreign --no-check-gpg \
			--include="$include_pkgs" \
			"$distro" "$sysroot" "$mirror"
		need_packages=true
	fi

	if [ -x "$sysroot/debootstrap/debootstrap" ]; then
		cp /usr/bin/qemu-arm-static "$sysroot/usr/bin/"
		chroot "$sysroot" /debootstrap/debootstrap --second-stage
		rm -f "$sysroot/usr/bin/qemu-arm-static"
		need_packages=true
	fi

	if [ "$need_packages" = true ]; then
		echo "Ensuring sysroot packages..." >&2
		cat > "$sysroot/etc/apt/sources.list" <<EOF
deb http://archive.debian.org/debian/ jessie main
EOF
		cat > "$sysroot/etc/apt/apt.conf.d/99no-check-valid-until" <<EOF
Acquire::Check-Valid-Until "false";
EOF
		cp /usr/bin/qemu-arm-static "$sysroot/usr/bin/"
		chroot "$sysroot" /bin/bash -c "apt-get update && apt-get install -y $include_pkgs"
		rm -f "$sysroot/usr/bin/qemu-arm-static"
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/libz.so.1" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		local libz_link="$sysroot/usr/lib/arm-linux-gnueabihf/libz.so"
		if [ -L "$libz_link" ]; then
			local link_target
			link_target="$(readlink "$libz_link")"
			if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/libz.so.1" ]; then
				rm -f "$libz_link"
				ln -s ../../../lib/arm-linux-gnueabihf/libz.so.1 "$libz_link"
			fi
		elif [ ! -e "$libz_link" ]; then
			ln -s ../../../lib/arm-linux-gnueabihf/libz.so.1 "$libz_link"
		fi
	fi

	if [ -f "$sysroot/usr/lib/arm-linux-gnueabihf/libGLESv2.so.2" ] && \
		[ ! -e "$sysroot/usr/lib/arm-linux-gnueabihf/libGLESv2.so" ]; then
		ln -s libGLESv2.so.2 "$sysroot/usr/lib/arm-linux-gnueabihf/libGLESv2.so"
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/libm.so.6" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		if [ -L "$sysroot/usr/lib/arm-linux-gnueabihf/libm.so" ] || \
			[ ! -e "$sysroot/usr/lib/arm-linux-gnueabihf/libm.so" ]; then
			rm -f "$sysroot/usr/lib/arm-linux-gnueabihf/libm.so"
			cat > "$sysroot/usr/lib/arm-linux-gnueabihf/libm.so" <<'EOF'
/* GNU ld script */
OUTPUT_FORMAT(elf32-littlearm)
GROUP ( /lib/arm-linux-gnueabihf/libm.so.6 )
EOF
		fi
	fi

	if [ -f "$sysroot/usr/lib/arm-linux-gnueabihf/libstdc++.so.6" ] && \
		[ ! -e "$sysroot/usr/lib/arm-linux-gnueabihf/libstdc++.so" ]; then
		ln -s libstdc++.so.6 "$sysroot/usr/lib/arm-linux-gnueabihf/libstdc++.so"
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/libgcc_s.so.1" ] && \
		[ ! -e "$sysroot/usr/lib/arm-linux-gnueabihf/libgcc_s.so" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		ln -s ../../../lib/arm-linux-gnueabihf/libgcc_s.so.1 "$sysroot/usr/lib/arm-linux-gnueabihf/libgcc_s.so"
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/libdl.so.2" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		local libdl_link="$sysroot/usr/lib/arm-linux-gnueabihf/libdl.so"
		if [ -L "$libdl_link" ]; then
			local link_target
			link_target="$(readlink "$libdl_link")"
			if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/libdl.so.2" ]; then
				rm -f "$libdl_link"
				ln -s ../../../lib/arm-linux-gnueabihf/libdl.so.2 "$libdl_link"
			fi
		elif [ ! -e "$libdl_link" ]; then
			ln -s ../../../lib/arm-linux-gnueabihf/libdl.so.2 "$libdl_link"
		fi
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/librt.so.1" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		local librt_link="$sysroot/usr/lib/arm-linux-gnueabihf/librt.so"
		if [ -L "$librt_link" ]; then
			local link_target
			link_target="$(readlink "$librt_link")"
			if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/librt.so.1" ]; then
				rm -f "$librt_link"
				ln -s ../../../lib/arm-linux-gnueabihf/librt.so.1 "$librt_link"
			fi
		elif [ ! -e "$librt_link" ]; then
			ln -s ../../../lib/arm-linux-gnueabihf/librt.so.1 "$librt_link"
		fi
	fi

	touch "$sysroot/.snesmini-ready"
	echo "SNES Mini sysroot created at: $sysroot"
}

require_ready_sysroot() {
	local sysroot="$1"
	local missing=()

	if [ ! -d "$sysroot" ]; then
		echo "Sysroot directory not found: $sysroot" >&2
		exit 1
	fi

	if [ ! -f "$sysroot/usr/include/zlib.h" ]; then
		missing+=("zlib headers")
	fi
	if [ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libstdc++.so.6" ] && \
		[ ! -f "$sysroot/lib/arm-linux-gnueabihf/libstdc++.so.6" ]; then
		missing+=("libstdc++")
	fi
	if [ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libGLESv2.so" ] && \
		[ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libGLESv2.so.2" ] && \
		[ ! -f "$sysroot/lib/arm-linux-gnueabihf/libGLESv2.so.2" ]; then
		missing+=("libGLESv2")
	fi
	if [ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libEGL.so" ] && \
		[ ! -f "$sysroot/usr/lib/arm-linux-gnueabihf/libEGL.so.1" ] && \
		[ ! -f "$sysroot/lib/arm-linux-gnueabihf/libEGL.so.1" ]; then
		missing+=("libEGL")
	fi

	if [ "${#missing[@]}" -gt 0 ]; then
		echo "Sysroot not ready at: $sysroot" >&2
		echo "Missing: ${missing[*]}" >&2
		echo "Continuing anyway (fake sysroot mode)." >&2
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/libdl.so.2" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		local libdl_link="$sysroot/usr/lib/arm-linux-gnueabihf/libdl.so"
		if [ -L "$libdl_link" ]; then
			local link_target
			link_target="$(readlink "$libdl_link")"
			if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/libdl.so.2" ]; then
				rm -f "$libdl_link"
				ln -s ../../../lib/arm-linux-gnueabihf/libdl.so.2 "$libdl_link"
			fi
		elif [ ! -e "$libdl_link" ]; then
			ln -s ../../../lib/arm-linux-gnueabihf/libdl.so.2 "$libdl_link"
		fi
	fi

	if [ -f "$sysroot/lib/arm-linux-gnueabihf/librt.so.1" ]; then
		mkdir -p "$sysroot/usr/lib/arm-linux-gnueabihf"
		local librt_link="$sysroot/usr/lib/arm-linux-gnueabihf/librt.so"
		if [ -L "$librt_link" ]; then
			local link_target
			link_target="$(readlink "$librt_link")"
			if [ "$link_target" != "../../../lib/arm-linux-gnueabihf/librt.so.1" ]; then
				rm -f "$librt_link"
				ln -s ../../../lib/arm-linux-gnueabihf/librt.so.1 "$librt_link"
			fi
		elif [ ! -e "$librt_link" ]; then
			ln -s ../../../lib/arm-linux-gnueabihf/librt.so.1 "$librt_link"
		fi
	fi
}

if [ "${BMSX_SNESMINI_IN_ROOTFS:-}" = "1" ]; then
	require_ready_sysroot "$SYSROOT_DIR"
	if [ "$MODE" = "build" ]; then
		rm -rf "$ROOT_DIR/build-snesmini"
		make -C "$ROOT_DIR" \
			SNESMINI_SYSROOT="$SYSROOT_DIR" \
			SNESMINI_BUILD_TYPE="$BUILD_TYPE" \
			"$MAKE_TARGET"
	fi
	exit 0
fi

require_ready_sysroot "$SYSROOT_DIR"
if [ "$MODE" = "build" ]; then
	TOOLCHAIN_PREFIX="${SNESMINI_TOOLCHAIN_PREFIX:-arm-linux-gnueabihf}"
	DEFAULT_BUILD_DIR="$ROOT_DIR/build-snesmini"
	FALLBACK_BUILD_DIR="$ROOT_DIR/build-snesmini-user"
	BUILD_DIR="$DEFAULT_BUILD_DIR"
	if [ -e "$BUILD_DIR" ] && [ ! -w "$BUILD_DIR" ]; then
		BUILD_DIR="$FALLBACK_BUILD_DIR"
	fi
	if [ -e "$BUILD_DIR" ] && [ -w "$BUILD_DIR" ]; then
		rm -rf "$BUILD_DIR"
	fi
	rm -f "$ROOT_DIR/dist/bmsx_libretro.so"
	make -C "$ROOT_DIR" \
		SNESMINI_SYSROOT="$SYSROOT_DIR" \
		SNESMINI_BUILD_TYPE="$BUILD_TYPE" \
		SNESMINI_TOOLCHAIN_PREFIX="$TOOLCHAIN_PREFIX" \
		SNESMINI_BUILD_DIR="$BUILD_DIR" \
		"$MAKE_TARGET"
	BUILT_SO="$ROOT_DIR/dist/bmsx_libretro.so"
	if [ -f "$BUILT_SO" ] && readelf --dyn-syms "$BUILT_SO" | grep -q "__libc_single_threaded"; then
		echo "ERROR: __libc_single_threaded present in output. Toolchain headers are too new." >&2
		echo "Compiler: $(arm-linux-gnueabihf-g++ --version | head -n 1)" >&2
		exit 2
	fi
fi
exit 0

ensure_command debootstrap debootstrap

BUILD_ROOTFS_DIR="${ROOT_DIR}/.snesmini/build-rootfs-bullseye"
DISTRO="bullseye"
MIRROR="http://deb.debian.org/debian"
APT_MIRROR="http://archive.debian.org/debian"
BUILD_PACKAGES=(
	ca-certificates
	debootstrap
	cmake
	make
	pkg-config
	git
	gcc-arm-linux-gnueabihf
	g++-arm-linux-gnueabihf
	binutils-arm-linux-gnueabihf
	qemu-user-static
	binfmt-support
)

mkdir -p "$BUILD_ROOTFS_DIR"
if [ ! -f "$BUILD_ROOTFS_DIR/.build-rootfs-ready" ]; then
	debootstrap --variant=minbase --arch=amd64 --no-check-gpg \
		"$DISTRO" "$BUILD_ROOTFS_DIR" "$MIRROR"
	touch "$BUILD_ROOTFS_DIR/.build-rootfs-ready"
fi

cat > "$BUILD_ROOTFS_DIR/etc/apt/sources.list" <<EOF
deb $MIRROR $DISTRO main
EOF
cat > "$BUILD_ROOTFS_DIR/etc/apt/apt.conf.d/99no-check-valid-until" <<EOF
Acquire::Check-Valid-Until "false";
EOF
cp -L /etc/resolv.conf "$BUILD_ROOTFS_DIR/etc/resolv.conf"

mkdir -p "$BUILD_ROOTFS_DIR/dev/pts" "$BUILD_ROOTFS_DIR/proc" "$BUILD_ROOTFS_DIR/sys" "$BUILD_ROOTFS_DIR/src"

cleanup_mounts() {
	if mountpoint -q "$BUILD_ROOTFS_DIR/src"; then umount "$BUILD_ROOTFS_DIR/src"; fi
	if mountpoint -q "$BUILD_ROOTFS_DIR/dev/pts"; then umount "$BUILD_ROOTFS_DIR/dev/pts"; fi
	if mountpoint -q "$BUILD_ROOTFS_DIR/dev"; then umount "$BUILD_ROOTFS_DIR/dev"; fi
	if mountpoint -q "$BUILD_ROOTFS_DIR/proc"; then umount "$BUILD_ROOTFS_DIR/proc"; fi
	if mountpoint -q "$BUILD_ROOTFS_DIR/sys"; then umount "$BUILD_ROOTFS_DIR/sys"; fi
}
trap cleanup_mounts EXIT

mount --bind /dev "$BUILD_ROOTFS_DIR/dev"
mount --bind /dev/pts "$BUILD_ROOTFS_DIR/dev/pts"
mount -t proc proc "$BUILD_ROOTFS_DIR/proc"
mount -t sysfs sys "$BUILD_ROOTFS_DIR/sys"
mount --bind "$ROOT_DIR" "$BUILD_ROOTFS_DIR/src"

chroot "$BUILD_ROOTFS_DIR" /bin/bash -lc "apt-get update && apt-get install -y ${BUILD_PACKAGES[*]}"

MODE_FLAG=""
if [ "$MODE" = "sysroot" ]; then
	MODE_FLAG="--sysroot-only"
fi

SYSROOT_IN_ROOTFS="/src/${SYSROOT_REL}"
chroot "$BUILD_ROOTFS_DIR" /bin/bash -lc \
	"cd /src && BMSX_SNESMINI_IN_ROOTFS=1 BMSX_SNESMINI_MAKE_TARGET=\"$MAKE_TARGET\" SNESMINI_BUILD_TYPE=\"$BUILD_TYPE\" ./scripts/setup-snesmini-local-core.sh $MODE_FLAG \"$SYSROOT_IN_ROOTFS\""
