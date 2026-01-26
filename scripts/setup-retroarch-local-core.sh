#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$ROOT_DIR/src/bmsx_cpp"
LOCAL_CFG="$ROOT_DIR/scripts/retroarch.local.cfg"
BUILD_TYPE="Release"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--debug)
			BUILD_TYPE="Debug"
			shift
			;;
		--release)
			BUILD_TYPE="Release"
			shift
			;;
		*)
			break
			;;
	esac
done

BUILD_DIR="$ROOT_DIR/build-${BUILD_TYPE,,}"
ROM_PATH="${1:-$ROOT_DIR/dist/2025.debug.rom}"

run_linux() {
	local cores_dir="${XDG_CONFIG_HOME:-$HOME/.config}/retroarch/cores"
	local core_name="bmsx_libretro.so"
	local retroarch_dir="$ROOT_DIR/tools/retroarch-gles2"
	local retroarch_bin="$retroarch_dir/retroarch"

	sudo apt-get update
	sudo apt-get install -y \
		cmake \
		build-essential \
		git \
		pkg-config \
		zlib1g-dev \
		libegl1-mesa-dev \
		libgles2-mesa-dev \
		libsdl2-dev \
		libx11-dev \
		libx11-xcb-dev \
		libxext-dev \
		libxrandr-dev \
		libxi-dev \
		libxinerama-dev \
		libxss-dev \
		libxcursor-dev \
		libasound2-dev \
		libpulse-dev

	cmake -S "$CPP_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE="$BUILD_TYPE" -DBMSX_BUILD_LIBRETRO=ON
	cmake --build "$BUILD_DIR" --config "$BUILD_TYPE"

	if [[ -d "$retroarch_dir" ]]; then
		(
			cd "$retroarch_dir"
			git fetch --depth 1 origin master
			git reset --hard FETCH_HEAD
		)
	else
		git clone --depth 1 https://github.com/libretro/RetroArch.git "$retroarch_dir"
	fi
	(
		cd "$retroarch_dir"
		./configure --enable-opengles --enable-opengles3 --enable-egl --disable-opengl
		make -j"$(nproc)"
	)

	mkdir -p "$cores_dir"
	cp "$BUILD_DIR/$core_name" "$cores_dir/$core_name"

	"$retroarch_bin" --appendconfig="$LOCAL_CFG" -L "$cores_dir/$core_name" "$ROM_PATH"
}

run_linux
