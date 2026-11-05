#!/usr/bin/env bash
set -euo pipefail

# Reuse an installed kernel budget or install one before executing test code.
readonly memory_limit=8589934592
in_scope=false
if [[ ${1-} == --in-scope ]]; then
	in_scope=true
	shift
fi
if [[ $# == 0 ]]; then
	echo 'Usage: npm run test:exec -- <command> [arguments...]' >&2
	exit 2
fi
if [[ ! -r /sys/fs/cgroup/cgroup.controllers ]]; then
	echo 'BMSX tests require Linux cgroup v2 memory control; refusing an unbounded run.' >&2
	exit 1
fi

# A nested test command shares the existing budget, rather than asking the user
# manager for a sibling scope with a fresh allowance. Inspect the kernel state,
# not an environment flag that could survive outside the bounded process tree.
cgroup=''
while IFS=: read -r hierarchy controllers path; do
	if [[ $hierarchy == 0 ]]; then
		if [[ $path == /.. || $path == /../* ]]; then
			echo 'The current process is outside the visible cgroup namespace; cannot verify a test budget.' >&2
			exit 1
		fi
		cgroup="/sys/fs/cgroup${path%/}"
		break
	fi
done < /proc/self/cgroup
while [[ -n $cgroup ]]; do
	if [[ -r $cgroup/memory.max ]]; then
		read -r memory_max < "$cgroup/memory.max"
		if [[ $memory_max != max ]] && (( memory_max <= memory_limit )); then
			exec "$@"
		fi
	fi
	# The visible mount root can itself be a bounded container cgroup.
	[[ $cgroup == /sys/fs/cgroup ]] && break
	cgroup=${cgroup%/*}
done

# Both installers re-enter here; the kernel, not an environment flag or the
# installer's requested properties, must confirm the shared budget.
if $in_scope; then
	echo 'BMSX test memory limits were not installed; refusing an unbounded run.' >&2
	exit 1
fi

if [[ -n ${BMSX_TEST_CGROUP_PARENT-} ]]; then
	exec python3 "$(dirname "${BASH_SOURCE[0]}")/test_cgroup.py" "$memory_limit" "$BASH" "${BASH_SOURCE[0]}" "$@"
fi

# The user manager is one cgroup owner, not a prerequisite of a prebounded
# container or an explicitly delegated direct cgroup.
if [[ -z ${XDG_RUNTIME_DIR-} && -z ${DBUS_SESSION_BUS_ADDRESS-} ]]; then
	echo 'No cgroup memory cap of at most 8 GiB or systemd user session is available. Supply BMSX_TEST_CGROUP_PARENT with writable memory-controller delegation, or have the host cap this process before starting it. Refusing an unbounded run.' >&2
	exit 1
fi
exec systemd-run --user --scope --collect --quiet --expand-environment=no \
	--property="MemoryMax=$memory_limit" --property=MemorySwapMax=0 --property=OOMPolicy=kill \
	-- "$BASH" "${BASH_SOURCE[0]}" --in-scope "$@"
