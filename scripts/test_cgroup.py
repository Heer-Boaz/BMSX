"""Own a delegated test cgroup; admit no payload before its kernel budget exists."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

FORWARDED_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGQUIT)


def remove_cgroup_tree(directory):
    # Control files are virtual: unlinking them like ordinary files is invalid.
    with os.scandir(directory) as entries:
        for entry in entries:
            if entry.is_dir():
                remove_cgroup_tree(entry.path)
    os.rmdir(directory)


def run():
    child = None
    pending_signal = None

    def forward(signum, _frame):
        nonlocal pending_signal
        pending_signal = signum
        if child is not None:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass  # The payload can exit before its supervisor handles a signal.

    for signum in FORWARDED_SIGNALS:
        signal.signal(signum, forward)

    memory_limit, bash, runner, *command = sys.argv[1:]
    parent = Path(os.environ['BMSX_TEST_CGROUP_PARENT']).resolve(strict=True)
    filesystem = subprocess.check_output(['stat', '-f', '-c', '%t', '--', parent], text=True).strip()
    if filesystem != '63677270':  # CGROUP2_SUPER_MAGIC, not a substitute filesystem.
        raise RuntimeError('BMSX_TEST_CGROUP_PARENT must name a delegated cgroup v2 directory.')

    # The host delegates an empty domain parent. Never relocate other container
    # or session tasks to satisfy the kernel's no-internal-process constraint.
    (parent / 'cgroup.subtree_control').write_text('+memory')
    directory = Path(tempfile.mkdtemp(prefix='bmsx-test-', dir=parent))
    kill_fd = None
    try:
        settings = {'memory.max': memory_limit, 'memory.swap.max': '0', 'memory.oom.group': '1'}
        for name, value in settings.items():
            (directory / name).write_text(value)
        for name, value in settings.items():
            if (directory / name).read_text().strip() != value:
                raise RuntimeError(f'The kernel did not install {name}={value}.')

        # Retain the fork-safe retirement capability before admitting a child.
        # If this open fails, no workload has entered and the empty leaf retires.
        kill_fd = os.open(directory / 'cgroup.kill', os.O_WRONLY)
        if pending_signal is not None:
            result = -pending_signal
        else:
            # Only this child enters the configured leaf. The owner stays outside
            # it so workload OOM cannot prevent cleanup. Re-entry checks actual
            # /proc membership before payload exec. Inherited stdio is untouched;
            # the launch protocol never consumes the payload's stdin.
            child = subprocess.Popen([
                bash, '-ec', 'printf "%s\\n" "$BASHPID" > "$1/cgroup.procs"; shift; exec "$@"',
                'bmsx-test-cgroup', str(directory), bash, runner, '--in-scope', *command,
            ], start_new_session=True)
            if pending_signal is not None:
                forward(pending_signal, None)
            result = child.wait()
            child = None
    finally:
        if kill_fd is not None:
            try:
                os.write(kill_fd, b'1')
            finally:
                os.close(kill_fd)
            if child is not None:
                child.wait()
                child = None
            # cgroup.kill covers descendants and concurrent forks atomically.
            while 'populated 0' not in (directory / 'cgroup.events').read_text().splitlines():
                time.sleep(0.005)
        remove_cgroup_tree(directory)
        for signum in FORWARDED_SIGNALS:
            signal.signal(signum, signal.SIG_DFL)
    return -pending_signal if pending_signal is not None else result


if __name__ == '__main__':
    try:
        result = run()
    except Exception as error:
        print(f'BMSX could not install or retire its delegated test cgroup: {error}', file=sys.stderr)
        sys.exit(1)
    if result < 0:
        signum = -result
        if signum != signal.SIGKILL:
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
    else:
        sys.exit(result)
