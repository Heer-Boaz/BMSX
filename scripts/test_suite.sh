#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 ]]; then
	echo 'Usage: npm run test:suite -- <native-release-build> <native-debug-build> <interpreter-build>' >&2
	exit 2
fi
if ! grep -qx 'BMSX_BUILD_LIBRETRO:BOOL=ON' "$1/CMakeCache.txt" ||
	! grep -qx 'BMSX_ENABLE_GLES2:BOOL=ON' "$1/CMakeCache.txt"; then
	echo 'test:suite needs a completed Release core with libretro and GLES2 enabled.' >&2
	exit 2
fi
if ! grep -qx 'BMSX_BUILD_LIBRETRO_HOST:BOOL=ON' "$2/CMakeCache.txt" ||
	! grep -qx 'BMSX_BUILD_EGL_TESTS:BOOL=ON' "$2/CMakeCache.txt"; then
	echo 'test:suite needs a completed Debug build with BMSX_BUILD_LIBRETRO_HOST and BMSX_BUILD_EGL_TESTS enabled.' >&2
	exit 2
fi

status=0
stage() {
	local name=$1
	shift
	printf '\n=== %s ===\n' "$name"
	"$@" || status=$?
}

# These stages share one cgroup. Studio shards and Chromium cannot reserve
# their ordinary worker pools at the same time within that budget.
stage 'Headless, CTest and conformance' node scripts/test_headless.mjs "$@"
stage 'Browser, Studio integration, deployment and packaged hosts' node scripts/test_platform.mjs suite "$1" "$2"
exit "$status"
