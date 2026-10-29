import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../../ide/workspace/record_provider';

/** Canonical file fixture, deliberately independent of recovery key/value storage. */
export class MemoryWorkspaceFiles implements WorkspaceRecordProvider {
	public readonly records = new Map<string, WorkspaceRecord>();
	public readonly directories = new Set(['']);
	public constructor(public readonly persistence: 'workspace' | 'browser' = 'browser') {}
	public async read(path: string): Promise<WorkspaceRecord | null> {
		if (this.hasDirectory(path)) throw new Error(`Is a directory: ${path}`);
		return this.records.get(path) ?? null;
	}
	public async readDirectory(path: string): Promise<WorkspaceDirectoryEntry[] | null> {
		if (this.records.has(path)) throw new Error(`Not a directory: ${path}`);
		if (!this.hasDirectory(path)) return null;
		const entries = new Map<string, WorkspaceDirectoryEntry>();
		const prefix = path.length === 0 ? '' : `${path}/`;
		for (const [type, paths] of [['directory', this.directories], ['file', this.records.keys()]] as const) {
			for (const entry of paths) {
				if (entry === path || !entry.startsWith(prefix)) continue;
				const relative = entry.slice(prefix.length), separator = relative.indexOf('/');
				const name = separator === -1 ? relative : relative.slice(0, separator);
				entries.set(name, { name, type: separator === -1 ? type : 'directory' });
			}
		}
		return [...entries.values()];
	}
	public async createDirectory(path: string): Promise<void> {
		if (this.records.has(path) || this.hasDirectory(path)) throw new Error(`File already exists: ${path}`);
		this.admitParents(path); this.directories.add(path);
	}
	public async write(path: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		if (this.hasDirectory(path)) throw new Error(`Is a directory: ${path}`);
		if (!overwrite && this.records.has(path)) throw new Error(`File already exists: ${path}`);
		this.admitParents(path);
		this.records.set(path, record);
	}
	public async delete(path: string): Promise<void> {
		if (this.hasDirectory(path)) throw new Error(`Is a directory: ${path}`);
		if (this.records.has(path)) this.admitParents(path);
		this.records.delete(path);
	}

	private hasDirectory(path: string): boolean {
		if (this.directories.has(path)) return true;
		const prefix = `${path}/`;
		for (const entry of this.records.keys()) if (entry.startsWith(prefix)) return true;
		for (const entry of this.directories) if (entry.startsWith(prefix)) return true;
		return false;
	}
	private admitParents(path: string): void {
		for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
			const parent = path.slice(0, slash);
			if (this.records.has(parent)) throw new Error(`Not a directory: ${parent}`);
			this.directories.add(parent);
		}
	}
}
