import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const WORKSPACE_SAVE_DIRECTORY = '.bmsx/saves';

/** Publish complete source bytes and their timestamp together, outside the ROM input set until commit. */
export async function publishWorkspaceRecord(destination, stagingDirectory, record, overwrite) {
	let mode;
	if (overwrite) {
		let previous;
		try { previous = await open(destination, constants.O_WRONLY | constants.O_NOFOLLOW); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		if (previous !== undefined) {
			// Replacing an inode must not bypass its write permission or discard executable bits.
			try { mode = (await previous.stat()).mode & 0o7777; }
			finally { await previous.close(); }
		}
	}
	await mkdir(stagingDirectory, { recursive: true });
	const temporary = join(stagingDirectory, randomUUID());
	try {
		const file = await open(temporary, 'wx');
		try {
			await file.writeFile(record.contents, 'utf8');
			const seconds = record.updatedAt / 1000;
			await file.utimes(seconds, seconds);
			if (mode !== undefined) await file.chmod(mode);
		} finally { await file.close(); }
		if (overwrite) await rename(temporary, destination);
		else await link(temporary, destination);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	if (!overwrite) await rm(temporary);
}
