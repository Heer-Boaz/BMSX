#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ROOT="$ROOT_DIR/.snesmini/rootfs"
RUNTIME_ROOT_NEW="$ROOT_DIR/.snesmini/rootfs.new"

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <extracted-rootfs|rootfs.tar>" >&2
	exit 1
fi

SOURCE="$(realpath "$1")"
mkdir -p "$ROOT_DIR/.snesmini"
exec 9>"$ROOT_DIR/.snesmini/runtime-root.lock"
flock 9
rm -rf "$RUNTIME_ROOT_NEW"
mkdir -p "$RUNTIME_ROOT_NEW"
trap 'rm -rf "$RUNTIME_ROOT_NEW"' EXIT

TAR_EXCLUDES=(
	--exclude='./dev/*'
	--exclude='./proc/*'
	--exclude='./run/*'
	--exclude='./sys/*'
	--exclude='dev/*'
	--exclude='proc/*'
	--exclude='run/*'
	--exclude='sys/*'
)

if [ -d "$SOURCE" ]; then
	tar -C "$SOURCE" "${TAR_EXCLUDES[@]}" -cf - . \
		| tar -C "$RUNTIME_ROOT_NEW" --no-same-owner -xf -
else
	tar -C "$RUNTIME_ROOT_NEW" --no-same-owner "${TAR_EXCLUDES[@]}" -xf "$SOURCE"
fi

LOADER="$RUNTIME_ROOT_NEW/lib/ld-linux-armhf.so.3"
LIBC="$RUNTIME_ROOT_NEW/lib/arm-linux-gnueabihf/libc.so.6"
test -e "$LOADER"
test -e "$LIBC"
readelf -h "$LOADER" | grep -q 'Machine:.*ARM'
readelf -h "$LIBC" | grep -q 'Machine:.*ARM'

python3 "$ROOT_DIR/scripts/snesmini/runtime_manifest.py" write "$RUNTIME_ROOT_NEW"

rm -rf "$RUNTIME_ROOT"
mv "$RUNTIME_ROOT_NEW" "$RUNTIME_ROOT"
trap - EXIT

echo "SNES Mini runtime root imported: $RUNTIME_ROOT"
