import { machineManager } from '../../machine/ts/core/machine_manager';
import type { HttpResponse, StorageService } from '../../machine/ts/platform/platform';
import { joinWorkspacePaths } from './path';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace.records';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'workspace.json';
export const WORKSPACE_MARKER_FILE = '~workspace';

export type WorkspaceRecord = {
	contents: string;
	updatedAt: number;
};

export const workspaceRecordState = {
	connected: false,
};

let lastWorkspaceRecordTimestamp = 0;
type PendingRemoteWorkspaceRecord = {
	storage: StorageService;
	projectRootPath: string;
	record: WorkspaceRecord;
};

const pendingRemoteWorkspaceRecords = new Map<string, PendingRemoteWorkspaceRecord>();
const remoteWorkspaceOperationTails = new Map<string, Promise<void>>();

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	return `${WORKSPACE_STORAGE_PREFIX}:${projectRootPath}:${relativePath}`;
}

export function createWorkspaceRecord(contents: string): WorkspaceRecord {
	const clockTimestamp = machineManager.platform.clock.dateNow();
	lastWorkspaceRecordTimestamp = clockTimestamp > lastWorkspaceRecordTimestamp
		? clockTimestamp
		: lastWorkspaceRecordTimestamp + 1;
	return {
		contents,
		updatedAt: lastWorkspaceRecordTimestamp,
	};
}

export function readLocalWorkspaceRecord(
	storage: StorageService,
	projectRootPath: string,
	relativePath: string,
): WorkspaceRecord | null {
	const raw = storage.getItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
	if (raw === null) {
		return null;
	}
	const record = JSON.parse(raw) as WorkspaceRecord;
	if (record.updatedAt > lastWorkspaceRecordTimestamp) {
		lastWorkspaceRecordTimestamp = record.updatedAt;
	}
	return record;
}

export function writeLocalWorkspaceRecord(
	storage: StorageService,
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
	storage: StorageService,
	projectRootPath: string,
	relativePath: string,
): void {
	storage.removeItem(buildWorkspaceStorageKey(projectRootPath, relativePath));
}

export async function writeWorkspaceRecord(
	storage: StorageService,
	projectRootPath: string,
	relativePath: string,
	record: WorkspaceRecord,
): Promise<void> {
	writeLocalWorkspaceRecord(storage, projectRootPath, relativePath, record);
	const pendingRecord = { storage, projectRootPath, record };
	pendingRemoteWorkspaceRecords.set(relativePath, pendingRecord);
	if (!workspaceRecordState.connected) {
		return;
	}
	try {
		await writeRemoteWorkspaceRecord(relativePath, record);
		if (pendingRemoteWorkspaceRecords.get(relativePath) === pendingRecord) {
			pendingRemoteWorkspaceRecords.delete(relativePath);
		}
	} catch (error) {
		disconnectWorkspaceRecords(error);
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
	storage: StorageService,
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
	storage: StorageService,
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
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'GET',
			cache: 'no-store',
		});
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(await workspaceResponseError('read', relativePath, response));
		}
		const record = await response.json() as WorkspaceRecord;
		if (record.updatedAt > lastWorkspaceRecordTimestamp) {
			lastWorkspaceRecordTimestamp = record.updatedAt;
		}
		return record;
	});
}

export function writeRemoteWorkspaceRecord(
	relativePath: string,
	record: WorkspaceRecord,
): Promise<void> {
	return enqueueRemoteWorkspaceOperation(relativePath, async () => {
		const response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				path: relativePath,
				contents: record.contents,
				updatedAt: record.updatedAt,
			}),
		});
		if (!response.ok) {
			throw new Error(await workspaceResponseError('write', relativePath, response));
		}
	});
}

export function deleteRemoteWorkspaceRecord(relativePath: string): Promise<void> {
	return enqueueRemoteWorkspaceOperation(relativePath, async () => {
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'DELETE',
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(await workspaceResponseError('delete', relativePath, response));
		}
	});
}

export async function openWorkspaceRecords(
	storage: StorageService,
	projectRootPath: string,
): Promise<void> {
	const markerPath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_MARKER_FILE,
	);
	const marker = createWorkspaceRecord('');
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

export async function reconnectWorkspaceRecords(projectRootPath: string): Promise<void> {
	const markerPath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_MARKER_FILE,
	);
	try {
		await writeRemoteWorkspaceRecord(markerPath, createWorkspaceRecord(''));
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

async function workspaceResponseError(
	operation: string,
	relativePath: string,
	response: HttpResponse,
): Promise<string> {
	const detail = await response.text();
	return `[WorkspaceStorage] Failed to ${operation} file '${relativePath}': ${detail}`;
}
