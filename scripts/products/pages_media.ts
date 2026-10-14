import { execFile } from 'node:child_process';
import { relative } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

async function git(repository: string, ...args: string[]): Promise<string> {
	return (await execute('git', ['-C', repository, ...args])).stdout.trim();
}

/**
 * Commits exactly the given media files in their GitHub Pages checkout and pushes that commit.
 * Unrelated work in the checkout stays out of the commit; unrelated unpushed commits block the push.
 * Content-addressed media that is already committed is not committed again.
 */
export async function pushPagesMedia(directory: string, files: readonly string[], message: string): Promise<'pushed' | 'unchanged'> {
	const repository = await git(directory, 'rev-parse', '--show-toplevel');
	const paths = files.map(file => relative(repository, file));
	if (await git(repository, 'rev-list', '--count', '@{upstream}..HEAD') !== '0') {
		throw new Error(`${repository} has unpushed commits; push or remove them before publishing media.`);
	}
	await git(repository, 'add', '--', ...paths);
	if (await git(repository, 'diff', '--cached', '--name-only', '--', ...paths) === '') return 'unchanged';
	await git(repository, 'commit', '--quiet', '--message', message, '--', ...paths);
	await git(repository, 'push', '--quiet');
	return 'pushed';
}
