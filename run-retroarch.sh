#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_KIND="${BMSX_LIBRETRO_BUILD:-release}"
CORE_SRC="$ROOT_DIR/build-${BUILD_KIND}/bmsx_libretro.so"
RETROARCH_BIN="$ROOT_DIR/tools/retroarch-gles2/retroarch"
CORES_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/retroarch/cores"
CORE_DST="$CORES_DIR/bmsx_libretro.so"
ROM_ARG="${1:-}"
ROM_PATH=""
if [[ -n "$ROM_ARG" ]]; then
	case "$ROM_ARG" in
		*.rom | *.bmsx) ;;
		*)
			echo "Please pass the full ROM filename (including .rom/.bmsx): $ROM_ARG" >&2
			echo "Example: $(basename "$0") 2025.debug.rom" >&2
			exit 1
			;;
	esac
	if [[ "$ROM_ARG" == */* ]]; then
		ROM_PATH="$ROM_ARG"
	else
		ROM_PATH="$ROOT_DIR/dist/$ROM_ARG"
	fi
	if [[ ! -f "$ROM_PATH" ]]; then
		echo "ROM not found: $ROM_PATH" >&2
		echo "Usage: $(basename "$0") <romfile>  (e.g. 2025.debug.rom)" >&2
		echo "Build with: npm run build:libretro:debug <rompack-folder-name>  (e.g. 2025)" >&2
		echo "Available in dist:" >&2
		ls -1 "$ROOT_DIR"/dist/*.rom "$ROOT_DIR"/dist/*.bmsx 2>/dev/null || true
		exit 1
	fi
fi
LOCAL_CFG="$ROOT_DIR/scripts/retroarch.local.cfg"

mkdir -p "$CORES_DIR"
cp "$CORE_SRC" "$CORE_DST"

export LIBRETRO_SYSTEM_DIRECTORY="${LIBRETRO_SYSTEM_DIRECTORY:-$ROOT_DIR/dist}"

gdb --batch -ex "set debuginfod enabled off" -ex "set pagination off" -ex "run" -ex "bt" --args "$RETROARCH_BIN" --appendconfig="$LOCAL_CFG" -L "$CORE_DST" ${ROM_PATH:+"$ROM_PATH"}
