#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="build"

if [ "${1:-}" = "--sysroot-only" ]; then
	MODE="sysroot"
	shift
fi
if [ "$#" -ne 0 ]; then
	echo "usage: $0 [--sysroot-only]" >&2
	exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
	echo "Docker is required for the SNES Mini cross-toolchain." >&2
	exit 1
fi
if ! docker info >/dev/null 2>&1; then
	echo "The Docker daemon is not available to the current user." >&2
	exit 1
fi

mkdir -p "$ROOT_DIR/.snesmini" "$ROOT_DIR/dist"

BUILD_TYPE="${SNESMINI_BUILD_TYPE:-Debug}"
SMOKE_FRAMES="${SNESMINI_SMOKE_FRAMES:-16}"
SDK_RECIPE_ID="$(python3 "$ROOT_DIR/scripts/snesmini/sdk_recipe_id.py" "$ROOT_DIR")"
BUILDER_IID_FILE="$(mktemp)"
trap 'rm -f "$BUILDER_IID_FILE"' EXIT

docker build \
	--tag "bmsx-snesmini-builder:$SDK_RECIPE_ID" \
	--iidfile "$BUILDER_IID_FILE" \
	--file "$ROOT_DIR/scripts/snesmini/Dockerfile" \
	"$ROOT_DIR/scripts/snesmini"
BUILDER_IMAGE_ID="$(cat "$BUILDER_IID_FILE")"
rm "$BUILDER_IID_FILE"
trap - EXIT

exec 4>"$ROOT_DIR/.snesmini/sdk-publish.lock"
flock 4
docker run --rm \
	--env BMSX_SNESMINI_BUILDER_IMAGE_ID="$BUILDER_IMAGE_ID" \
	--volume "$ROOT_DIR:/src:ro" \
	--volume "$ROOT_DIR/.snesmini:/src/.snesmini" \
	--tmpfs /src/.snesmini/rootfs:rw,noexec,nosuid,nodev,size=64k \
	--workdir /src \
	"$BUILDER_IMAGE_ID" \
	./scripts/snesmini/bootstrap_sdk_sysroot.sh

if [ "$MODE" = "sysroot" ]; then
	exit 0
fi

exec 5<"$ROOT_DIR/.snesmini"
flock -s 5
flock -u 4
exec 4>&-
TOOLCHAIN_ID="$(python3 "$ROOT_DIR/scripts/snesmini/toolchain_id.py" "$ROOT_DIR")"
case "${BMSX_SNESMINI_WORKFLOW:-core}" in
	core)
		BUILD_TARGET="snesmini-qemu-build-inner"
		AUDIT_TARGET="snesmini-qemu-audit-inner"
		PUBLISH_KIND="core"
		;;
	host)
		BUILD_TARGET="libretro-host-snesmini-build-inner"
		AUDIT_TARGET="libretro-host-snesmini-audit-inner"
		PUBLISH_KIND="host"
		;;
	*)
		echo "Unknown SNES Mini workflow: $BMSX_SNESMINI_WORKFLOW" >&2
		exit 1
		;;
esac

BUILD_ROOT="$ROOT_DIR/.snesmini/build/$TOOLCHAIN_ID"
CCACHE_DIR="$ROOT_DIR/.snesmini/ccache/$TOOLCHAIN_ID"
PUBLISH_BASE="$ROOT_DIR/dist/snesmini"
mkdir -p "$BUILD_ROOT"
mkdir -p "$CCACHE_DIR"
mkdir -p "$PUBLISH_BASE"
exec 7>"$BUILD_ROOT/.$PUBLISH_KIND.lock"
flock 7
exec 6>"$ROOT_DIR/.snesmini/runtime-root.lock"
flock -s 6
STAGING_ROOT="$(mktemp -d "$PUBLISH_BASE/.publish-$PUBLISH_KIND.XXXXXXXX")"
INPUT_ROOT="$(mktemp -d "$PUBLISH_BASE/.inputs-$PUBLISH_KIND.XXXXXXXX")"
trap 'rm -rf "$STAGING_ROOT" "$INPUT_ROOT"' EXIT
RUNTIME_ROOT="$ROOT_DIR/.snesmini/rootfs"
if ! python3 "$ROOT_DIR/scripts/snesmini/runtime_manifest.py" verify "$RUNTIME_ROOT"; then
	echo "Import an exact SNES Mini root filesystem before building:" >&2
	echo "  npm run import:snesmini-rootfs -- /path/to/rootfs" >&2
	exit 1
fi
if [ "$PUBLISH_KIND" = "core" ]; then
	(
		cd "$ROOT_DIR"
		npm run build:bios -- --force --output-dir "$INPUT_ROOT"
		npm run build:game -- bare_metal_cart --force --output-dir "$INPUT_ROOT"
	)
fi
docker run --rm \
	--user "$(id -u):$(id -g)" \
	--network=none \
	--env HOME=/tmp \
	--env CCACHE_DIR=/src/.snesmini/ccache \
	--env BMSX_SNESMINI_BUILDER_IMAGE_ID="$BUILDER_IMAGE_ID" \
	--env SNESMINI_BUILD_TYPE="$BUILD_TYPE" \
	--env SNESMINI_SMOKE_FRAMES="$SMOKE_FRAMES" \
	--volume "$ROOT_DIR:/src:ro" \
	--tmpfs /src/.snesmini:rw,noexec,nosuid,nodev,size=64k \
	--volume "$ROOT_DIR/.snesmini/sdk-sysroot:/src/.snesmini/sdk-sysroot:ro" \
	--volume "$BUILD_ROOT:/src/.snesmini/build" \
	--volume "$CCACHE_DIR:/src/.snesmini/ccache" \
	--tmpfs /usr/arm-linux-gnueabihf/include:rw,noexec,nosuid,nodev,size=64k \
	--tmpfs /usr/arm-linux-gnueabihf/lib:rw,noexec,nosuid,nodev,size=64k \
	--tmpfs /usr/include:rw,noexec,nosuid,nodev,size=64k \
	--tmpfs /usr/local/include:rw,noexec,nosuid,nodev,size=64k \
	--workdir /src \
	"$BUILDER_IMAGE_ID" \
	make "$BUILD_TARGET"

docker run --rm \
	--user "$(id -u):$(id -g)" \
	--network=none \
	--env HOME=/tmp \
	--env SNESMINI_PUBLISH_DIR=/out \
	--env SNESMINI_SYSTEM_DIR=/inputs \
	--env SNESMINI_ROM=/inputs/bare_metal_cart.rom \
	--env SNESMINI_BUILD_TYPE="$BUILD_TYPE" \
	--env SNESMINI_SMOKE_FRAMES="$SMOKE_FRAMES" \
	--volume "$ROOT_DIR:/src:ro" \
	--volume "$STAGING_ROOT:/out" \
	--volume "$INPUT_ROOT:/inputs:ro" \
	--tmpfs /src/.snesmini:rw,noexec,nosuid,nodev,size=64k \
	--volume "$RUNTIME_ROOT:/src/.snesmini/rootfs:ro" \
	--volume "$BUILD_ROOT:/src/.snesmini/build:ro" \
	--workdir /src \
	"$BUILDER_IMAGE_ID" \
	make "$AUDIT_TARGET"

{
	printf 'toolchain_id=%s\n' "$TOOLCHAIN_ID"
	printf 'builder_image_id=%s\n' "$BUILDER_IMAGE_ID"
	printf 'build_type=%s\n' "$BUILD_TYPE"
	if [ "$PUBLISH_KIND" = "core" ]; then
		printf 'smoke_frames=%s\n' "$SMOKE_FRAMES"
	fi
	printf 'runtime_manifest_sha256=%s\n' \
		"$(sha256sum "$RUNTIME_ROOT/.bmsx-snesmini-runtime" | cut -d ' ' -f 1)"
	for input in "$INPUT_ROOT"/*; do
		[ -f "$input" ] || continue
		printf 'input_sha256=%s %s\n' \
			"$(sha256sum "$input" | cut -d ' ' -f 1)" \
			"$(basename "$input")"
	done
	for artifact in "$STAGING_ROOT"/*; do
		printf 'artifact_sha256=%s %s\n' \
			"$(sha256sum "$artifact" | cut -d ' ' -f 1)" \
			"$(basename "$artifact")"
	done
} > "$STAGING_ROOT/.acceptance.tmp"
mv "$STAGING_ROOT/.acceptance.tmp" "$STAGING_ROOT/acceptance.txt"

RELEASE_ID="$(sha256sum "$STAGING_ROOT/acceptance.txt" | cut -d ' ' -f 1)"
PUBLISH_ROOT="$PUBLISH_BASE/$PUBLISH_KIND"
RELEASE_ROOT="$PUBLISH_ROOT/releases"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
mkdir -p "$RELEASE_ROOT"
exec 9>"$PUBLISH_ROOT/.publish.lock"
flock 9
if [ -e "$RELEASE_DIR" ]; then
	rm -rf "$STAGING_ROOT"
else
	mv -T "$STAGING_ROOT" "$RELEASE_DIR"
fi
CURRENT_LINK="$PUBLISH_ROOT/.current.$$"
ln -s "releases/$RELEASE_ID" "$CURRENT_LINK"
mv -Tf "$CURRENT_LINK" "$PUBLISH_ROOT/current"
rm -rf "$INPUT_ROOT"
trap - EXIT

echo "SNES Mini $PUBLISH_KIND release accepted: $PUBLISH_ROOT/current"
