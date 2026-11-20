#!/usr/bin/env bash
set -euo pipefail

case "${1-}" in
	selected)
		shift
		if [[ $# == 0 ]]; then
			echo 'Usage: npm test -- [node test options] <test files>; use npm run test:lua for all four areas.' >&2
			exit 2
		fi
		exec node --import tsx --test --test-concurrency=1 "$@"
		;;
	all|studio) ;;
	*) echo 'Expected a Node test area: all or studio' >&2; exit 2 ;;
esac
if [[ $# != 1 ]]; then
	echo 'For selected files or test-name patterns, use npm test -- <node options> <test files>.' >&2
	exit 2
fi

readonly shards=8
reports=$(mktemp -d)
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
	tsx --tsconfig tsconfig.base.json --test --import ./tests/helpers/test_setup.ts "$@" >"$reports/$slot.tap" 2>&1 &
	pids+=("$!")
}

if [[ $1 == all ]]; then
	# The machine/toolchain tests keep file isolation; they do not retain their
	# program and media graphs in the Studio worker processes.
	start_lane 'Machine, toolchain and hosts' --test-concurrency=8 tests/{machine,toolchain,hosts}/*.test.ts
fi
for ((index = 1; index <= shards; index++)); do
	start_lane "Studio $index/$shards" --max-old-space-size=768 --experimental-test-isolation=none \
		"--test-shard=$index/$shards" tests/studio/*.test.ts
done

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
