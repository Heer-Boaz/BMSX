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

if ! is_root; then
	if command -v sudo >/dev/null 2>&1; then
		exec sudo \
			BMSX_SNESMINI_MAKE_TARGET="$MAKE_TARGET" \
			SNESMINI_BUILD_TYPE="$BUILD_TYPE" \
			BMSX_SNESMINI_USE_DOCKER="${BMSX_SNESMINI_USE_DOCKER:-1}" \
			BMSX_SNESMINI_DOCKER_IMAGE="${BMSX_SNESMINI_DOCKER_IMAGE:-debian:bullseye}" \
			"$0" "$SYSROOT_DIR"
	fi
	echo "This command requires sudo to build via the SNES Mini docker toolchain." >&2
	echo "Run: sudo $0 $SYSROOT_DIR" >&2
	exit 1
fi

ensure_command docker docker.io

if [ "${BMSX_SNESMINI_USE_DOCKER:-1}" = "1" ]; then
	DOCKER_IMAGE="${BMSX_SNESMINI_DOCKER_IMAGE:-debian:bullseye}"
	MODE_FLAG=""
	if [ "$MODE" = "sysroot" ]; then
		MODE_FLAG="--sysroot-only"
	fi
	SYSROOT_IN_CONTAINER="/src/${SYSROOT_REL}"
	docker run --rm -t \
		-v "$ROOT_DIR":/src \
		-w /src \
		"$DOCKER_IMAGE" \
		/bin/bash -lc "apt-get update && apt-get install -y \
			ca-certificates debootstrap cmake make pkg-config git \
			gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf binutils-arm-linux-gnueabihf \
			qemu-user-static binfmt-support && \
			BMSX_SNESMINI_IN_ROOTFS=1 BMSX_SNESMINI_MAKE_TARGET=\"$MAKE_TARGET\" \
			SNESMINI_BUILD_TYPE=\"$BUILD_TYPE\" ./scripts/setup-snesmini-local-core.sh $MODE_FLAG \"$SYSROOT_IN_CONTAINER\""
	exit 0
fi

echo "Docker build is required. Set BMSX_SNESMINI_USE_DOCKER=1." >&2
exit 1
