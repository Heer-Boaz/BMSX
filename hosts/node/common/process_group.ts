import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** POSIX group ID from a detached spawn, not an arbitrary child's PID. */
export function killProcessGroup(group: number): boolean {
	try { process.kill(-group, 'SIGKILL'); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		throw error;
	}
}

/**
 * Node can reap its direct child, but not grandchildren orphaned by that child.
 * A delivered signal is not an exit barrier. Observe the group until no member
 * can execute or write; zombies have exited and only await their parent's reap.
 * This runs only during teardown, never while a session is working.
 */
export async function waitForProcessGroupExit(group: number): Promise<void> {
	for (;;) {
		const { stdout } = await execute('ps', ['-A', '-o', 'pgid=,stat=']);
		const alive = stdout.split('\n').some(line => {
			const fields = line.trim().split(/\s+/);
			return Number(fields[0]) === group && fields[1][0] !== 'Z' && fields[1][0] !== 'X';
		});
		if (!alive) return;
		await setTimeout(10);
	}
}
