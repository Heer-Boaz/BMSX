import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const WORKSPACE_SAVE_DIRECTORY = '.bmsx/saves';
const publications = new Map();

/** Server-backed Studio frontends and workers share this filesystem publication queue. */
function enqueuePublication(destination, operation) {
	const previous = publications.get(destination);
	const result = previous === undefined ? operation() : previous.then(operation);
	const tail = result.then(() => undefined, () => undefined);
	publications.set(destination, tail);
	void tail.then(() => { if (publications.get(destination) === tail) publications.delete(destination); });
	return result;
}

export function publishWorkspaceRecord(destination, stagingDirectory, record, overwrite, expectedSource) {
	return enqueuePublication(destination, () => publishSource(destination, stagingDirectory, record, overwrite, expectedSource));
}

export function deleteWorkspaceRecord(destination) {
	return enqueuePublication(destination, () => rm(destination, { force: true }));
}

export function createWorkspaceDirectory(destination) {
	return enqueuePublication(destination, async () => {
		await mkdir(dirname(destination), { recursive: true });
		await mkdir(destination);
	});
}

/** Publish complete source bytes and their timestamp together, outside the ROM input set until commit. */
async function publishSource(destination, stagingDirectory, record, overwrite, expectedSource) {
	let mode;
	if (overwrite) {
		let previous;
		try { previous = await open(destination, (expectedSource === undefined ? constants.O_WRONLY : constants.O_RDWR) | constants.O_NOFOLLOW); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		if (previous !== undefined) {
			// Replacing an inode must not bypass its write permission or discard executable bits.
			try {
				mode = (await previous.stat()).mode & 0o7777;
				if (expectedSource !== undefined && await previous.readFile('utf8') !== expectedSource) {
					throw Object.assign(new Error(`Source changed outside this Studio: ${destination}`), { code: 'ESTALE' });
				}
			}
			finally { await previous.close(); }
		} else if (expectedSource !== undefined && expectedSource !== null) {
			throw Object.assign(new Error(`Source removed outside this Studio: ${destination}`), { code: 'ESTALE' });
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
