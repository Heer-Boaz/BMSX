import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../../ide/workspace/record_provider';

/** Canonical file fixture, deliberately independent of recovery key/value storage. */
export class MemoryWorkspaceFiles implements WorkspaceRecordProvider {
	public readonly records = new Map<string, WorkspaceRecord>();
	public constructor(public readonly persistence: 'workspace' | 'browser' = 'browser') {}
	public async read(path: string): Promise<WorkspaceRecord | null> { return this.records.get(path) ?? null; }
	public async readDirectory(path: string): Promise<WorkspaceDirectoryEntry[]> {
		const entries = new Map<string, WorkspaceDirectoryEntry>();
		for (const file of this.records.keys()) {
			if (!file.startsWith(`${path}/`)) continue;
			const relative = file.slice(path.length + 1), separator = relative.indexOf('/');
			const name = separator === -1 ? relative : relative.slice(0, separator);
			entries.set(name, { name, type: separator === -1 ? 'file' : 'directory' });
		}
		return [...entries.values()];
	}
	public async write(path: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		if (!overwrite && this.records.has(path)) throw new Error(`File already exists: ${path}`);
		this.records.set(path, record);
	}
	public async delete(path: string): Promise<void> { this.records.delete(path); }
}
