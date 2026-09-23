import type { HostClock } from '../../hosts/common/clock';
import type { KeyValueStorage } from './key_value_storage';
import { joinWorkspacePaths } from './path';
import type { WorkspaceRecord, WorkspaceRecordProvider } from './record_provider';
export type { WorkspaceRecord } from './record_provider';

export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace.records';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'session.json';
export const WORKSPACE_MARKER_FILE = '~workspace';

export const workspaceRecordState: { connected: boolean; provider: WorkspaceRecordProvider } = {
	connected: false,
	provider: null,
};

let lastWorkspaceRecordTimestamp = 0;
type PendingRemoteWorkspaceRecord = {
	storage: KeyValueStorage;
	projectRootPath: string;
	record: WorkspaceRecord;
};

const pendingRemoteWorkspaceRecords = new Map<string, PendingRemoteWorkspaceRecord>();
const remoteWorkspaceOperationTails = new Map<string, Promise<void>>();

/** Acknowledgement for this write, not the provider's current connection state. */
export type WorkspaceRecordPersistence =
	| { readonly status: 'workspace' }
	| { readonly status: 'local-only'; readonly reason: 'disconnected' }
	| { readonly status: 'local-only'; readonly reason: 'write-failed'; readonly error: unknown };

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	return `${WORKSPACE_STORAGE_PREFIX}:${projectRootPath}:${relativePath}`;
}

export function createWorkspaceRecord(clock: HostClock, contents: string): WorkspaceRecord {
	const clockTimestamp = clock.dateNow();
	lastWorkspaceRecordTimestamp = clockTimestamp > lastWorkspaceRecordTimestamp
		? clockTimestamp
		: lastWorkspaceRecordTimestamp + 1;
	return {
		contents,
		updatedAt: lastWorkspaceRecordTimestamp,
	};
}

function parseWorkspaceRecord(raw: string): WorkspaceRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return null;
	}
	const record = parsed as Partial<WorkspaceRecord>;
	return typeof record.contents === 'string' && typeof record.updatedAt === 'number'
		? record as WorkspaceRecord
		: null;
}

export function readLocalWorkspaceRecord(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
): WorkspaceRecord | null {
	const raw = storage.getItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
	if (raw === null) {
		return null;
	}
	const record = parseWorkspaceRecord(raw);
	if (!record) {
		console.warn(`[WorkspaceStorage] Deleting unreadable workspace record '${relativePath}'.`);
		deleteLocalWorkspaceRecord(storage, projectRootPath, relativePath);
		return null;
	}
	if (record.updatedAt > lastWorkspaceRecordTimestamp) {
		lastWorkspaceRecordTimestamp = record.updatedAt;
	}
	return record;
}

export function writeLocalWorkspaceRecord(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
	record: WorkspaceRecord,
): void {
	storage.setItem(
		buildWorkspaceStorageKey(projectRootPath, relativePath),
		JSON.stringify(record),
	);
}

export function deleteLocalWorkspaceRecord(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
): void {
	storage.removeItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
}

export async function writeWorkspaceRecord(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
	record: WorkspaceRecord,
): Promise<WorkspaceRecordPersistence> {
	writeLocalWorkspaceRecord(storage, projectRootPath, relativePath, record);
	const pendingRecord = { storage, projectRootPath, record };
	pendingRemoteWorkspaceRecords.set(relativePath, pendingRecord);
	if (!workspaceRecordState.connected) {
		return { status: 'local-only', reason: 'disconnected' };
	}
	try {
		await writeRemoteWorkspaceRecord(relativePath, record);
		if (pendingRemoteWorkspaceRecords.get(relativePath) === pendingRecord) {
			pendingRemoteWorkspaceRecords.delete(relativePath);
		}
		return { status: 'workspace' };
	} catch (error) {
		disconnectWorkspaceRecords(error);
		return { status: 'local-only', reason: 'write-failed', error };
	}
}

export function selectNewestWorkspaceRecord(
	localRecord: WorkspaceRecord | null,
	remoteRecord: WorkspaceRecord | null,
): WorkspaceRecord | null {
	if (remoteRecord && (!localRecord || remoteRecord.updatedAt > localRecord.updatedAt)) {
		return remoteRecord;
	}
	return localRecord;
}

export async function readWorkspaceRecord(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
): Promise<WorkspaceRecord | null> {
	if (!workspaceRecordState.connected) {
		return readLocalWorkspaceRecord(storage, projectRootPath, relativePath);
	}
	try {
		const remoteRecord = await readRemoteWorkspaceRecord(relativePath);
		const localRecord = readLocalWorkspaceRecord(storage, projectRootPath, relativePath);
		const record = selectNewestWorkspaceRecord(localRecord, remoteRecord);
		if (record === remoteRecord && remoteRecord !== null) {
			writeLocalWorkspaceRecord(storage, projectRootPath, relativePath, remoteRecord);
		} else if (localRecord && !workspaceRecordsEqual(localRecord, remoteRecord)) {
			const pendingRecord = pendingRemoteWorkspaceRecords.get(relativePath);
			if (pendingRecord && workspaceRecordsEqual(pendingRecord.record, localRecord)) {
				return record;
			}
			const localPendingRecord = { storage, projectRootPath, record: localRecord };
			pendingRemoteWorkspaceRecords.set(relativePath, localPendingRecord);
			await writeRemoteWorkspaceRecord(relativePath, localRecord);
			if (pendingRemoteWorkspaceRecords.get(relativePath) === localPendingRecord) {
				pendingRemoteWorkspaceRecords.delete(relativePath);
			}
		}
		return record;
	} catch (error) {
		disconnectWorkspaceRecords(error);
		return readLocalWorkspaceRecord(storage, projectRootPath, relativePath);
	}
}

export async function readWorkspaceRecordVersion(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
	updatedAt: number,
): Promise<WorkspaceRecord | null> {
	const localRecord = readLocalWorkspaceRecord(storage, projectRootPath, relativePath);
	if (localRecord?.updatedAt === updatedAt) {
		return localRecord;
	}
	if (!workspaceRecordState.connected) {
		return null;
	}
	try {
		const remoteRecord = await readRemoteWorkspaceRecord(relativePath);
		if (remoteRecord?.updatedAt !== updatedAt) {
			return null;
		}
		writeLocalWorkspaceRecord(storage, projectRootPath, relativePath, remoteRecord);
		return remoteRecord;
	} catch (error) {
		disconnectWorkspaceRecords(error);
		return null;
	}
}

export function readRemoteWorkspaceRecord(relativePath: string): Promise<WorkspaceRecord | null> {
	return enqueueRemoteWorkspaceOperation(relativePath, async () => {
		const record = await workspaceRecordState.provider.read(relativePath);
		if (record && record.updatedAt > lastWorkspaceRecordTimestamp) {
			lastWorkspaceRecordTimestamp = record.updatedAt;
		}
		return record;
	});
}

export function writeRemoteWorkspaceRecord(
	relativePath: string,
	record: WorkspaceRecord,
): Promise<void> {
	return enqueueRemoteWorkspaceOperation(relativePath, () => workspaceRecordState.provider.write(relativePath, record, true));
}

/** Publish a new source only after the filesystem has admitted its name. */
export async function createWorkspaceFile(
	storage: KeyValueStorage,
	projectRootPath: string,
	relativePath: string,
	record: WorkspaceRecord,
): Promise<void> {
	await enqueueRemoteWorkspaceOperation(relativePath, () => workspaceRecordState.provider.write(relativePath, record, false));
	writeLocalWorkspaceRecord(storage, projectRootPath, relativePath, record);
}

export function deleteRemoteWorkspaceRecord(relativePath: string): Promise<void> {
	return enqueueRemoteWorkspaceOperation(relativePath, () => workspaceRecordState.provider.delete(relativePath));
}

export async function openWorkspaceRecords(
	storage: KeyValueStorage,
	clock: HostClock,
	projectRootPath: string,
	provider: WorkspaceRecordProvider,
): Promise<void> {
	workspaceRecordState.provider = provider;
	const markerPath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_MARKER_FILE,
	);
	const marker = createWorkspaceRecord(clock, '');
	writeLocalWorkspaceRecord(storage, projectRootPath, markerPath, marker);
	try {
		await writeRemoteWorkspaceRecord(markerPath, marker);
		await syncPendingRemoteWorkspaceRecords();
		workspaceRecordState.connected = true;
	} catch (error) {
		disconnectWorkspaceRecords(error);
	}
}

export function closeWorkspaceRecords(): void {
	workspaceRecordState.connected = false;
}

export async function reconnectWorkspaceRecords(
	clock: HostClock,
	projectRootPath: string,
): Promise<void> {
	const markerPath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_MARKER_FILE,
	);
	try {
		await writeRemoteWorkspaceRecord(markerPath, createWorkspaceRecord(clock, ''));
		await syncPendingRemoteWorkspaceRecords();
		workspaceRecordState.connected = true;
	} catch (error) {
		disconnectWorkspaceRecords(error);
	}
}

async function syncPendingRemoteWorkspaceRecords(): Promise<void> {
	while (pendingRemoteWorkspaceRecords.size !== 0) {
		for (const [relativePath] of pendingRemoteWorkspaceRecords) {
			const remoteRecord = await readRemoteWorkspaceRecord(relativePath);
			const pendingRecord = pendingRemoteWorkspaceRecords.get(relativePath);
			if (!pendingRecord) {
				continue;
			}
			const record = selectNewestWorkspaceRecord(pendingRecord.record, remoteRecord);
			if (record === remoteRecord && remoteRecord !== null) {
				writeLocalWorkspaceRecord(
					pendingRecord.storage,
					pendingRecord.projectRootPath,
					relativePath,
					remoteRecord,
				);
			} else if (!workspaceRecordsEqual(pendingRecord.record, remoteRecord)) {
				await writeRemoteWorkspaceRecord(relativePath, pendingRecord.record);
			}
			if (pendingRemoteWorkspaceRecords.get(relativePath) === pendingRecord) {
				pendingRemoteWorkspaceRecords.delete(relativePath);
			}
		}
	}
}

function enqueueRemoteWorkspaceOperation<T>(
	relativePath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = remoteWorkspaceOperationTails.get(relativePath);
	const result = previous ? previous.then(operation) : operation();
	const tail = result.then(
		() => undefined,
		() => undefined,
	);
	remoteWorkspaceOperationTails.set(relativePath, tail);
	void tail.then(() => {
		if (remoteWorkspaceOperationTails.get(relativePath) === tail) {
			remoteWorkspaceOperationTails.delete(relativePath);
		}
	});
	return result;
}

export function disconnectWorkspaceRecords(error: unknown): void {
	workspaceRecordState.connected = false;
	console.warn('[WorkspaceStorage] Remote workspace unavailable; local recovery remains active.', error);
}

export function workspaceRecordsEqual(
	left: WorkspaceRecord | null,
	right: WorkspaceRecord | null,
): boolean {
	return left === right
		|| (left !== null
			&& right !== null
			&& left.updatedAt === right.updatedAt
			&& left.contents === right.contents);
}
