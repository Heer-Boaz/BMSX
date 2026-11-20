#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
	echo 'Usage: test_packaged_hosts.sh <release-build> <debug-build>' >&2
	exit 2
fi
readonly -a renderer=(--debug --core "$1/libretro_bmsx.so" --host "$2/bmsx_libretro_host")

# test:headless already produced the Debug BIOS, Node tooling and renderhwtest.
# The platform phase has prepared hot_resume_test for the standalone browser.
npm run build:toolchain:cart -- cartridge_data_conformance --debug
npm run build:toolchain:cart -- bare_metal_cart --debug

status=0
stage() {
	local name=$1
	shift
	printf '\n=== %s ===\n' "$name"
	"$@" || status=$?
}
stage 'Headless Studio authoring' node --test tests/ide/user_io_authoring.mjs
stage 'Headless Studio Hot Resume' node dist/host_headless_tooling.debug.js --system-rom dist/system/bmsx-bios.debug.rom 	--slot1 dist/cartridge_data_conformance.debug.rom --ide-test tests/ide/hot_resume_entry_edit.idetest.js hot_resume_test
stage 'Native renderer parity (monitor)' node scripts/render/pixel_parity.mjs renderhwtest "${renderer[@]}"
stage 'Native renderer parity (GX)' node scripts/render/pixel_parity.mjs bare_metal_cart "${renderer[@]}" 	--timeline tests/carts/bare_metal_cart/parity.json
exit "$status"
