#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$ROOT_DIR/src/bmsx_cpp"
LOCAL_CFG="$ROOT_DIR/scripts/retroarch.local.cfg"

# Default build type; user can pass --debug or --release
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

BUILD_DIR="$ROOT_DIR/build"
ROM_PATH="${1:-$ROOT_DIR/dist/2025.debug.rom}"

run_linux() {
	# Install dependencies and configure the CMake build (Ninja + ccache)
	# NOTE: this script no longer performs builds, copies cores, or launches RetroArch.

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
		libpulse-dev \
		ninja-build \
		ccache
	# Ensure ccache has a reasonable cache size for repeated builds
	ccache -M 10G || true

	# Configure with Ninja and enable ccache as the compiler launcher by default
	cmake -S "$CPP_DIR" -B "$BUILD_DIR" -G Ninja \
		-DCMAKE_C_COMPILER_LAUNCHER=ccache \
		-DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
		-DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
		-DBMSX_BUILD_LIBRETRO=ON

	echo "Dependencies installed and CMake configured with Ninja and ccache in: $BUILD_DIR"
	echo "This script will NOT build cores, copy cores, or launch RetroArch. Use your dedicated build scripts to build and run cores/hosts."
}

run_linux
