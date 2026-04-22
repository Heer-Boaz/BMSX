import { spawnSync } from 'node:child_process';

export function commandExists(command: string): boolean {
	const result = spawnSync(command, ['--version'], {
		encoding: 'utf8',
		stdio: 'ignore',
		maxBuffer: 1024 * 1024,
	});
	return result.error === undefined;
}
