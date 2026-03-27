#!/bin/bash
set -euo pipefail

romfile=""
args=()

for arg in "$@"; do
	if [[ -z "$romfile" && "$arg" != -* ]]; then
		romfile=$arg
	else
		args+=("$arg")
	fi
done

if [[ -z "$romfile" ]]; then
	echo 'Usage: ./inspectrom.sh <romname> [--ui] [--list-assets] [--manifest] [--program-asm]' >&2
	exit 1
fi

npx tsx ./scripts/rominspector/rominspector.ts "./dist/$romfile" "${args[@]}"
