#!/usr/bin/env bash
set -euo pipefail

case "${1-}" in
	selected)
		shift
		if [[ $# == 0 ]]; then
			echo 'Usage: npm test -- [node test options] <test files>; use npm run test:lua for all four areas.' >&2
			exit 2
		fi
		TSX_TSCONFIG_PATH=tsconfig.base.json exec node --import tsx --import ./tests/helpers/test_setup.ts \
			--test --test-concurrency=1 "$@"
		;;
	all) files=(tests/{machine,toolchain,hosts,studio}/*.test.ts) ;;
	rompacker) files=(tests/rompacker/*.ts) ;;
	machine|toolchain|hosts|studio) files=(tests/"$1"/*.test.ts) ;;
	*) echo 'Expected a Node test area: all, machine, toolchain, hosts, studio or rompacker' >&2; exit 2 ;;
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
	node --enable-source-maps --test "$@" >"$reports/$slot.tap" 2>&1 &
	pids+=("$!")
}

readonly compiled="$reports/js"
node scripts/build_node_tests.mjs "$compiled" "${files[@]}"

if [[ $1 == all ]]; then
	# The machine/toolchain tests keep file isolation; they do not retain their
	# program and media graphs in the Studio worker processes.
	start_lane 'Machine, toolchain and hosts' --test-concurrency=8 "$compiled"/tests/{machine,toolchain,hosts}/*.test.mjs
elif [[ $1 != studio ]]; then
	start_lane "$1" --test-concurrency=16 "$compiled"/tests/"$1"/*.mjs
fi
if [[ $1 == all || $1 == studio ]]; then
	for ((index = 1; index <= shards; index++)); do
		start_lane "Studio $index/$shards" --max-old-space-size=768 --experimental-test-isolation=none \
			"--test-shard=$index/$shards" "$compiled"/tests/studio/*.test.mjs
	done
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
