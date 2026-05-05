#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Gebruik direct het gebouwde core bestand in dist, geen rare copy of build folder referenties meer
CORE_PATH="$ROOT_DIR/dist/bmsx_libretro.so"

# Zoek naar retroarch lokaal of op het systeem
if [[ -f "$ROOT_DIR/tools/retroarch-gles2/retroarch" ]]; then
	RETROARCH_BIN="$ROOT_DIR/tools/retroarch-gles2/retroarch"
elif command -v retroarch >/dev/null 2>&1; then
	RETROARCH_BIN="$(command -v retroarch)"
else
	echo "Error: RetroArch executable not found!" >&2
	echo "Please install retroarch or provide it in tools/retroarch-gles2/" >&2
	exit 1
fi

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

export LIBRETRO_SYSTEM_DIRECTORY="${LIBRETRO_SYSTEM_DIRECTORY:-$ROOT_DIR/dist}"

# Run retroarch directly using the local core, no copying needed!
gdb --batch --return-child-result -ex "set debuginfod enabled off" -ex "set pagination off" -ex "run" --args "$RETROARCH_BIN" --appendconfig="$LOCAL_CFG" -L "$CORE_PATH" ${ROM_PATH:+"$ROM_PATH"}
