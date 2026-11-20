#!/usr/bin/env bash
set -euo pipefail

readonly -a source_loader=(--import tsx --import ./tests/helpers/test_setup.ts)

case "${1-}" in
	selected)
		shift
		if [[ $# == 0 ]]; then
			echo 'Usage: npm test -- [node test options] <test files>; use npm run test:lua for all four areas.' >&2
			exit 2
		fi
		# Build workers inherit the loader config but operate in their workspace.
		TSX_TSCONFIG_PATH="$PWD/tsconfig.base.json" exec node "${source_loader[@]}" \
			--test --test-concurrency=1 "$@"
		;;
	all|headless)
		files=(tests/{machine,toolchain,hosts,studio}/*.test.ts)
		if [[ $1 == headless ]]; then files+=(tests/rompacker/*.ts); fi
		;;
	rompacker) files=(tests/rompacker/*.ts) ;;
	browser-platform) files=(tests/platform/browser_*.test.ts) ;;
	machine|toolchain|hosts|studio) files=(tests/"$1"/*.test.ts) ;;
	*) echo 'Expected a Node test area: all, headless, machine, toolchain, hosts, studio, rompacker or browser-platform' >&2; exit 2 ;;
esac
if [[ $# != 1 ]]; then
	echo 'For selected files or test-name patterns, use npm test -- <node options> <test files>.' >&2
	exit 2
fi

readonly shards=8
mkdir -p .bmsx
# Keep Node's native dependencies in scope and compiled tests out of dist.
reports=$(mktemp -d "$PWD/.bmsx/test-node.XXXXXX")
readonly reports
pids=()
labels=()
trap 'rm -rf -- "$reports"' EXIT

interrupt() {
	trap '' INT TERM
	local pid
	for pid in $(jobs -pr); do kill -TERM "$pid" 2>/dev/null || :; done
	wait
	exit "$1"
}
trap 'interrupt 130' INT
trap 'interrupt 143' TERM

start_lane() {
	local slot=${#pids[@]}
	labels+=("$1")
	shift
	node --enable-source-maps "$@" >"$reports/$slot.tap" 2>&1 &
	pids+=("$!")
}

start_shards() {
	local label=$1 count=$2 index
	shift 2
	for ((index = 1; index <= count; index++)); do
		start_lane "$label $index/$count" --test --max-old-space-size=768 --experimental-test-isolation=none \
			"--test-shard=$index/$count" "$@"
	done
}

if [[ $1 == browser-platform ]]; then
	export TSX_TSCONFIG_PATH="$PWD/tsconfig.base.json"
	accelerated=tests/platform/browser_gpu.test.ts
	keyboard=tests/platform/browser_onscreen_keyboard.test.ts
	shared=("$keyboard")
	for file in "${files[@]}"; do
		case $file in
			"$accelerated"|"$keyboard") ;;
			*) shared+=("$file") ;;
		esac
	done
	# Keep SwiftShader tests serial on their own GPU process. Only input,
	# layout and ordinary paint share a worker and browser processes.
	start_lane 'Browser GPU' "${source_loader[@]}" --test --test-concurrency=1 "$accelerated"
	start_lane 'Browser platform' "${source_loader[@]}" scripts/test_browser_platform.mjs "${shared[@]}"
else
	readonly compiled="$reports/js"
	node scripts/build_node_tests.mjs "$compiled" "${files[@]}"

	case $1 in
		all|headless)
			# Each shared worker loads its common compiler and runtime modules
			# once. Keep independent process lifetimes for host and packer
			# integration, within the existing eight non-Studio worker slots.
			isolated=("$compiled"/tests/hosts/*.test.mjs)
			label='Hosts'
			if [[ $1 == headless ]]; then
				isolated+=("$compiled"/tests/rompacker/*.mjs)
				label='Hosts and ROM packer'
			fi
			start_lane "$label" --test --test-concurrency=2 "${isolated[@]}"
			start_shards 'Machine and toolchain' 6 "$compiled"/tests/{machine,toolchain}/*.test.mjs
			;;
		machine|toolchain)
			start_shards "$1" "$shards" "$compiled"/tests/"$1"/*.test.mjs
			;;
		studio) ;;
		*)
			start_lane "$1" --test --test-concurrency=16 "$compiled"/tests/"$1"/*.mjs
			;;
	esac
	if [[ $1 == all || $1 == headless || $1 == studio ]]; then
		start_shards 'Studio' "$shards" "$compiled"/tests/studio/*.test.mjs
	fi
fi

status=0
for slot in "${!pids[@]}"; do
	if wait "${pids[slot]}"; then
		printf '\n=== %s ===\n' "${labels[slot]}"
	else
		result=$?
		printf '\n=== %s (exit %d) ===\n' "${labels[slot]}" "$result"
		status=$result
	fi
	cat "$reports/$slot.tap"
done
exit "$status"
