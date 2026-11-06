import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeIfChanged(path: string, contents: string | Uint8Array): Promise<boolean> {
	const bytes = typeof contents === 'string' ? Buffer.from(contents) : contents;
	let current: Buffer;
	try {
		current = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	if (current !== undefined && current.equals(bytes)) return false;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
	return true;
}
