import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Publish changed bytes by rename, leaving identical user-facing exports untouched. */
export async function publishFileBytes(path: string, bytes: Buffer): Promise<void> {
	try { if (bytes.equals(await readFile(path))) return; }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	await mkdir(dirname(path), { recursive: true });
	const pending = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(pending, bytes);
		await rename(pending, path);
	} finally { await rm(pending, { force: true }); }
}
