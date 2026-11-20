#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 3 ]]; then
	echo 'Usage: npm run test:suite -- <native-release-build> <native-debug-build> <interpreter-build>' >&2
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
stage 'Browser, Studio integration and deployment' node scripts/test_platform.mjs
stage 'Headless Studio authoring' npm run test:ide-authoring
stage 'Headless Studio Hot Resume' npm run test:hot-resume
stage 'Native renderer parity' npm run test:render-parity
exit "$status"
