import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

/** The root is the directory against which packaged source paths are resolved. */
export class DiskWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public constructor(private readonly root: string) {}

	public async readDirectory(relativePath: string): Promise<WorkspaceDirectoryEntry[] | null> {
		try {
			const entries = await fs.readdir(path.resolve(this.root, relativePath), { withFileTypes: true });
			return entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory'
				: entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symbolic-link' : 'other' }));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		}
	}

	public async read(relativePath: string): Promise<WorkspaceRecord | null> {
		try {
			const file = await fs.open(path.resolve(this.root, relativePath), 'r');
			try {
				const contents = await file.readFile('utf8');
				const stat = await file.stat();
				return { contents, updatedAt: Math.round(stat.mtimeMs) };
			} finally {
				await file.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		}
	}

	public async write(relativePath: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		const filePath = path.resolve(this.root, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		try {
			await fs.writeFile(filePath, record.contents, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`File already exists: ${relativePath}`);
			throw error;
		}
		const modifiedSeconds = record.updatedAt / 1000;
		await fs.utimes(filePath, modifiedSeconds, modifiedSeconds);
	}

	public async delete(relativePath: string): Promise<void> {
		await fs.rm(path.resolve(this.root, relativePath), { force: true });
	}
}
