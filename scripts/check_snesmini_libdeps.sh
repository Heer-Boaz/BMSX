#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ] || [ -z "$1" ]; then
	echo "usage: $0 <binary> [allowed_dep...]" >&2
	exit 1
fi

lib_file=$1
shift

if [ ! -f "$lib_file" ]; then
	echo "Missing file: $lib_file" >&2
	exit 1
fi

if [ "$#" -eq 0 ]; then
	echo "No allowed dependencies configured." >&2
	exit 1
fi

allowed=$*
forbidden='(^libgcc|^libgc|^libstdc\\+\\+|^libgomp|^libquadmath|^libgfortran)'
unexpected=0
forbidden_hit=0

deps=$(readelf -d "$lib_file" | awk '/NEEDED/ {gsub(/[][]/, "", $5); print $5}')
while IFS= read -r dep; do
	if echo "$dep" | grep -Eq "$forbidden"; then
		echo "[snesmini libcheck] forbidden dependency for SNES mini: ${dep}" >&2
		forbidden_hit=1
		unexpected=1
	fi
	case " ${allowed} " in
		*" ${dep} "*) ;;
		*) 
			echo "[snesmini libcheck] unexpected NEEDED dependency: ${dep}" >&2
			unexpected=1
			;;
	esac
done <<EOF
$deps
EOF

if [ "$unexpected" -ne 0 ]; then
	if [ "$forbidden_hit" -ne 0 ]; then
		echo "[snesmini libcheck] fix library links before packaging this core (strip forbidden runtime deps)." >&2
	else
		echo "[snesmini libcheck] fix library dependencies before packaging this core." >&2
	fi
	exit 1
fi

echo "[snesmini libcheck] dependency check passed for $lib_file"
