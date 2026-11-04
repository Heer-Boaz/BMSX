#!/usr/bin/env bash
set -euo pipefail

# Keep the process, environment, cwd, stdio and signal/exit semantics of the
# requested command. systemd-run --scope applies cgroup limits before exec.
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
	echo 'BMSX tests require Linux/WSL with systemd and cgroup v2 memory control; refusing an unbounded run.' >&2
	exit 1
fi

# A nested test command shares the existing budget, rather than asking the user
# manager for a sibling scope with a fresh allowance. Inspect the kernel state,
# not an environment flag that could survive outside the bounded process tree.
cgroup=''
while IFS=: read -r hierarchy controllers path; do
	if [[ $hierarchy == 0 ]]; then
		cgroup="/sys/fs/cgroup$path"
		break
	fi
done < /proc/self/cgroup
while [[ $cgroup != /sys/fs/cgroup && -n $cgroup ]]; do
	if [[ -r $cgroup/memory.max && -r $cgroup/memory.swap.max && -r $cgroup/memory.oom.group ]]; then
		read -r memory_max < "$cgroup/memory.max"
		read -r swap_max < "$cgroup/memory.swap.max"
		read -r oom_group < "$cgroup/memory.oom.group"
		if [[ $memory_max != max && $swap_max == 0 && $oom_group == 1 ]] && (( memory_max <= 1073741824 )); then
			exec "$@"
		fi
	fi
	cgroup=${cgroup%/*}
done

# Verify the installed limit before executing any test code. An unavailable
# user manager/controller or unsupported systemd option must fail closed.
if $in_scope; then
	echo 'BMSX test memory limits were not installed; refusing an unbounded run.' >&2
	exit 1
fi
exec systemd-run --user --scope --collect --quiet --expand-environment=no \
	--property=MemoryMax=1G --property=MemorySwapMax=0 --property=OOMPolicy=kill \
	-- "$BASH" "${BASH_SOURCE[0]}" --in-scope "$@"
