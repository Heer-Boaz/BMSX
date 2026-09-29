import type { HostClock } from '../../hosts/common/clock';
import type { KeyValueStorage } from './key_value_storage';
import type { WorkspaceRecord, WorkspaceRecordProvider } from './record_provider';
export type { WorkspaceRecord } from './record_provider';

export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace.records';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'session.json';

let lastWorkspaceRecordTimestamp = 0;

/** Acknowledgement of a completed canonical write, never of a recovery checkpoint. */
export type WorkspaceRecordPersistence = { readonly status: 'workspace' | 'browser' };

/** One workspace's file operations and lifetime. Recovery and network admission are separate owners. */
export class WorkspaceRecords {
	private readonly operations = new Map<string, Promise<void>>();
	private closing = false;

	public constructor(public readonly provider: WorkspaceRecordProvider) {}

	public read(relativePath: string): Promise<WorkspaceRecord | null> {
		return this.enqueue(relativePath, async () => {
			const record = await this.provider.read(relativePath);
			if (record && record.updatedAt > lastWorkspaceRecordTimestamp) lastWorkspaceRecordTimestamp = record.updatedAt;
			return record;
		});
	}

	/** overwrite=false admits a new file atomically in the owning filesystem. */
	public write(relativePath: string, record: WorkspaceRecord, overwrite = true): Promise<WorkspaceRecordPersistence> {
		return this.enqueue(relativePath, async () => {
			await this.provider.write(relativePath, record, overwrite);
			return { status: this.provider.persistence };
		});
	}

	public delete(relativePath: string): Promise<void> {
		return this.enqueue(relativePath, () => this.provider.delete(relativePath));
	}

	/** Stop admission, then join accepted operations before replacing the workspace. */
	public async close(): Promise<void> {
		this.closing = true;
		await Promise.all(this.operations.values());
	}

	private enqueue<T>(relativePath: string, operation: () => Promise<T>): Promise<T> {
		if (this.closing) throw new Error('Cannot access files after workspace shutdown has started.');
		const previous = this.operations.get(relativePath);
		const result = previous ? previous.then(operation) : operation();
		// Failure belongs to the requesting operation, not to subsequent operations on this path.
		const tail = result.then(() => undefined, () => undefined);
		this.operations.set(relativePath, tail);
		void tail.then(() => {
			if (this.operations.get(relativePath) === tail) this.operations.delete(relativePath);
		});
		return result;
	}
}

export let workspaceRecords: WorkspaceRecords | null = null;

export async function openWorkspaceRecords(provider: WorkspaceRecordProvider): Promise<void> {
	await closeWorkspaceRecords();
	workspaceRecords = new WorkspaceRecords(provider);
}

export async function closeWorkspaceRecords(): Promise<void> {
	const records = workspaceRecords;
	workspaceRecords = null;
	await records?.close();
}

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	return `${WORKSPACE_STORAGE_PREFIX}:${projectRootPath}:${relativePath}`;
}

export function createWorkspaceRecord(clock: HostClock, contents: string): WorkspaceRecord {
	const clockTimestamp = clock.dateNow();
	lastWorkspaceRecordTimestamp = clockTimestamp > lastWorkspaceRecordTimestamp
		? clockTimestamp : lastWorkspaceRecordTimestamp + 1;
	return { contents, updatedAt: lastWorkspaceRecordTimestamp };
}

/** Synchronous recovery storage, separate from the canonical file provider. */
export function readLocalWorkspaceRecord(storage: KeyValueStorage, projectRootPath: string, relativePath: string): WorkspaceRecord | null {
	const raw = storage.getItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
	if (raw === null) return null;
	const record: WorkspaceRecord = JSON.parse(raw);
	if (record.updatedAt > lastWorkspaceRecordTimestamp) lastWorkspaceRecordTimestamp = record.updatedAt;
	return record;
}

export function writeLocalWorkspaceRecord(storage: KeyValueStorage, projectRootPath: string, relativePath: string, record: WorkspaceRecord): void {
	storage.setItem(buildWorkspaceStorageKey(projectRootPath, relativePath), JSON.stringify(record));
}

export function deleteLocalWorkspaceRecord(storage: KeyValueStorage, projectRootPath: string, relativePath: string): void {
	storage.removeItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
}

export function selectNewestWorkspaceRecord(localRecord: WorkspaceRecord | null, remoteRecord: WorkspaceRecord | null): WorkspaceRecord | null {
	return remoteRecord && (!localRecord || remoteRecord.updatedAt > localRecord.updatedAt) ? remoteRecord : localRecord;
}

export function workspaceRecordsEqual(left: WorkspaceRecord | null, right: WorkspaceRecord | null): boolean {
	return left === right || (left !== null && right !== null && left.updatedAt === right.updatedAt && left.contents === right.contents);
}
