#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$ROOT_DIR/src/bmsx_cpp"
BUILD_DIR="$ROOT_DIR/build"
LOCAL_CORES_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/retroarch/cores"
CORE_NAME="bmsx_libretro.so"
ROM_PATH="${1:-$ROOT_DIR/dist/2025.debug.rom}"

sudo apt-get update
sudo apt-get install -y cmake build-essential zlib1g-dev retroarch

cmake -S "$CPP_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DBMSX_BUILD_LIBRETRO=ON
cmake --build "$BUILD_DIR" --config Release

mkdir -p "$LOCAL_CORES_DIR"
cp "$BUILD_DIR/$CORE_NAME" "$LOCAL_CORES_DIR/$CORE_NAME"

retroarch -L "$LOCAL_CORES_DIR/$CORE_NAME" "$ROM_PATH"
