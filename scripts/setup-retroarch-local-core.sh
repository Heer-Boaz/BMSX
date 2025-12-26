#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$ROOT_DIR/src/bmsx_cpp"
BUILD_DIR="$ROOT_DIR/build"
LOCAL_CORES_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/retroarch/cores"
CORE_NAME="bmsx_libretro.so"
RETROARCH_DIR="$ROOT_DIR/tools/retroarch-gles2"
RETROARCH_BIN="$RETROARCH_DIR/retroarch"
LOCAL_CFG="$ROOT_DIR/scripts/retroarch.local.cfg"
ROM_PATH="${1:-$ROOT_DIR/dist/2025.debug.rom}"

sudo apt-get update
sudo apt-get install -y \
  cmake \
  build-essential \
  git \
  pkg-config \
  zlib1g-dev \
  libegl1-mesa-dev \
  libgles2-mesa-dev \
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

cmake -S "$CPP_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DBMSX_BUILD_LIBRETRO=ON
cmake --build "$BUILD_DIR" --config Release

git clone --depth 1 https://github.com/libretro/RetroArch.git "$RETROARCH_DIR"
(
  cd "$RETROARCH_DIR"
  ./configure --enable-opengles --enable-opengles3 --enable-egl --disable-opengl
  make -j"$(nproc)"
)

mkdir -p "$LOCAL_CORES_DIR"
cp "$BUILD_DIR/$CORE_NAME" "$LOCAL_CORES_DIR/$CORE_NAME"

"$RETROARCH_BIN" --appendconfig="$LOCAL_CFG" -L "$LOCAL_CORES_DIR/$CORE_NAME" "$ROM_PATH"
