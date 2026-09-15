import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

/** The root is the directory against which packaged source paths are resolved. */
export class DiskWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public constructor(private readonly root: string) {}

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

	public async write(relativePath: string, record: WorkspaceRecord): Promise<void> {
		const filePath = path.resolve(this.root, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, record.contents, 'utf8');
		const modifiedSeconds = record.updatedAt / 1000;
		await fs.utimes(filePath, modifiedSeconds, modifiedSeconds);
	}

	public async delete(relativePath: string): Promise<void> {
		await fs.rm(path.resolve(this.root, relativePath), { force: true });
	}
}
