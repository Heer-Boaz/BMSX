#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_SRC="$ROOT_DIR/build/bmsx_libretro.so"
RETROARCH_BIN="$ROOT_DIR/tools/retroarch-gles2/retroarch"
CORES_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/retroarch/cores"
CORE_DST="$CORES_DIR/bmsx_libretro.so"
ROM_PATH="$1"
LOCAL_CFG="$ROOT_DIR/scripts/retroarch.local.cfg"

mkdir -p "$CORES_DIR"
cp "$CORE_SRC" "$CORE_DST"
gdb --batch -ex "set pagination off" -ex "run" -ex "bt" --args "$RETROARCH_BIN" --appendconfig="$LOCAL_CFG" -L "$CORE_DST" "$ROM_PATH"
