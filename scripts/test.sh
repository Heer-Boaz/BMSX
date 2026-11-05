#!/usr/bin/env bash
set -euo pipefail

# Reuse an installed kernel budget or install one before executing test code.
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
	if [[ -r $cgroup/memory.max && -r $cgroup/memory.swap.max && -r $cgroup/memory.oom.group ]]; then
		read -r memory_max < "$cgroup/memory.max"
		read -r swap_max < "$cgroup/memory.swap.max"
		read -r oom_group < "$cgroup/memory.oom.group"
		if [[ $memory_max != max && $swap_max == 0 && $oom_group == 1 ]] && (( memory_max <= 1073741824 )); then
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
	exec python3 "$(dirname "${BASH_SOURCE[0]}")/test_cgroup.py" "$BASH" "${BASH_SOURCE[0]}" "$@"
fi

# The user manager is one cgroup owner, not a prerequisite of a prebounded
# container or an explicitly delegated direct cgroup.
if [[ -z ${XDG_RUNTIME_DIR-} && -z ${DBUS_SESSION_BUS_ADDRESS-} ]]; then
	echo 'No test cgroup budget or systemd user session is available. Supply BMSX_TEST_CGROUP_PARENT with writable memory-controller delegation, or have the host install 1 GiB / zero swap / group OOM before starting this process. Refusing an unbounded run.' >&2
	exit 1
fi
exec systemd-run --user --scope --collect --quiet --expand-environment=no \
	--property=MemoryMax=1G --property=MemorySwapMax=0 --property=OOMPolicy=kill \
	-- "$BASH" "${BASH_SOURCE[0]}" --in-scope "$@"
