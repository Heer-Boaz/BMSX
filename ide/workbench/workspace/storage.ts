import type { HostClock, TimerHandle } from '../../../hosts/common/clock';
import type { KeyValueStorage } from '../../workspace/key_value_storage';
import { clearWorkspaceSourceCaches } from '../../workspace/cache';
import {
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceDirtyRecordPath,
} from '../../workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
	closeWorkspaceRecords,
	deleteLocalWorkspaceRecord,
	disconnectWorkspaceRecords,
	openWorkspaceRecords,
	readLocalWorkspaceRecord,
	readRemoteWorkspaceRecord,
	readWorkspaceRecordVersion,
	reconnectWorkspaceRecords,
	selectNewestWorkspaceRecord,
	workspaceRecordState,
	workspaceRecordsEqual,
	writeLocalWorkspaceRecord,
	type WorkspaceRecord,
} from '../../workspace/records';
import { joinWorkspacePaths } from '../../workspace/path';
import {
	workspaceDirtyRecords,
	workspacePendingMetadataContextIds,
	workspaceState,
} from './state';
import { applyWorkspaceAutosavePayload } from './restore';
import {
	commitWorkspaceSessionLocally,
	syncWorkspaceSessionRemotely,
} from './autosave';
import type { CartEditor } from '../../cart_editor';
import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import {
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
} from './models';
import { editorDocumentState } from '../../editor/editing/document_state';

const WORKSPACE_AUTOSAVE_DELAY_MS = 2500;
const WORKSPACE_RECONNECT_DELAY_MS = WORKSPACE_AUTOSAVE_DELAY_MS * 4;

let reconnectHandle: TimerHandle = null;
let reconnectTask: Promise<void> = null;
let editor: CartEditor = null;
let sources: RuntimeSourceState = null;
let debuggerState: RuntimeBreakpointState = null;
let storage: KeyValueStorage = null;
let clock: HostClock = null;

function cancelWorkspaceReconnect(): void {
	reconnectHandle?.cancel();
	reconnectHandle = null;
}

export async function shutdownWorkspaceStorage(): Promise<void> {
	cancelWorkspaceAutosave();
	cancelWorkspaceReconnect();
	try {
		if (workspaceState.autosaveTask) {
			await workspaceState.autosaveTask;
		}
		if (reconnectTask) {
			await reconnectTask;
		}
		cancelWorkspaceAutosave();
		cancelWorkspaceReconnect();
		const task = runWorkspaceAutosaveTick();
		if (task) {
			await task;
		}
	} finally {
		cancelWorkspaceAutosave();
		cancelWorkspaceReconnect();
		try {
			if (editor && workspaceState.requestedRevision !== workspaceState.localRevision) {
				commitRequestedWorkspaceSessionLocally();
			}
		} finally {
			workspaceState.projectRootPath = null;
			workspaceState.requestedRevision = 0;
			workspaceState.localRevision = 0;
			workspaceState.remoteRevision = -1;
			workspaceState.localGeneration = null;
			workspaceState.remotePayload = null;
			workspaceState.remoteDirtyRecords = null;
			workspaceState.pendingChanges = WorkspaceAutosaveChange.None;
			workspaceDirtyRecords.clear();
			workspacePendingMetadataContextIds.clear();
			editor = null;
			sources = null;
			debuggerState = null;
			storage = null;
			clock = null;
			clearWorkspaceSourceCaches();
			closeWorkspaceRecords();
		}
	}
}

export async function initializeWorkspaceStorage(
	workspaceStorage: KeyValueStorage,
	workspaceClock: HostClock,
	projectRootPath: string,
	runtimeSources: RuntimeSourceState,
): Promise<WorkspaceAutosavePayload | null> {
	await shutdownWorkspaceStorage();
	storage = workspaceStorage;
	clock = workspaceClock;
	workspaceState.projectRootPath = projectRootPath;
	await openWorkspaceRecords(
		storage,
		clock,
		projectRootPath,
	);
	const statePath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_STATE_FILE,
	);
	const localRecord = readLocalWorkspaceRecord(
		storage,
		projectRootPath,
		statePath,
	);
	let remoteRecord: WorkspaceRecord = null;
	if (workspaceRecordState.connected) {
		try {
			remoteRecord = await readRemoteWorkspaceRecord(statePath);
		} catch (error) {
			disconnectWorkspaceRecords(error);
		}
	}
	const record = selectNewestWorkspaceRecord(localRecord, remoteRecord);
	const payload = record ? JSON.parse(record.contents) as WorkspaceAutosavePayload : null;
	const replacedLocalPayload = record === remoteRecord && localRecord
		? JSON.parse(localRecord.contents) as WorkspaceAutosavePayload
		: null;
	const generationDirtyRecords = new Map<string, WorkspaceRecord>();
	if (payload) {
		const loads = new Array<Promise<readonly [string, WorkspaceRecord]>>(payload.dirtyFiles.length);
		for (let index = 0; index < payload.dirtyFiles.length; index += 1) {
			const entry = payload.dirtyFiles[index];
			const dirtyProjectRootPath = runtimeSourceProjectRootPath(runtimeSources, entry.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				dirtyProjectRootPath,
				entry.domain,
				entry.path,
			);
			loads[index] = readWorkspaceRecordVersion(
				storage,
				dirtyProjectRootPath,
				buildWorkspaceDirtyRecordPath(dirtyPath, entry.updatedAt),
				entry.updatedAt,
			).then(dirtyRecord => {
				if (!dirtyRecord) {
					throw new Error(`Persisted dirty file '${dirtyPath}' does not match the workspace session.`);
				}
				return [dirtyPath, dirtyRecord] as const;
			});
		}
		const loadedRecords = await Promise.all(loads);
		for (let index = 0; index < loadedRecords.length; index += 1) {
			const [dirtyPath, dirtyRecord] = loadedRecords[index];
			generationDirtyRecords.set(dirtyPath, dirtyRecord);
		}
	}
	const obsoleteLocalDirtyRecords: Array<readonly [string, string]> = [];
	if (replacedLocalPayload) {
		for (const entry of replacedLocalPayload.dirtyFiles) {
			const dirtyProjectRootPath = runtimeSourceProjectRootPath(runtimeSources, entry.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				dirtyProjectRootPath,
				entry.domain,
				entry.path,
			);
			if (generationDirtyRecords.get(dirtyPath)?.updatedAt === entry.updatedAt) {
				continue;
			}
			obsoleteLocalDirtyRecords.push([
				dirtyProjectRootPath,
				buildWorkspaceDirtyRecordPath(dirtyPath, entry.updatedAt),
			]);
		}
	}
	if (remoteRecord && record === remoteRecord) {
		writeLocalWorkspaceRecord(
			storage,
			projectRootPath,
			statePath,
			remoteRecord,
		);
		for (const [dirtyProjectRootPath, dirtyRecordPath] of obsoleteLocalDirtyRecords) {
			deleteLocalWorkspaceRecord(
				storage,
				dirtyProjectRootPath,
				dirtyRecordPath,
			);
		}
	}
	workspaceDirtyRecords.clear();
	for (const [dirtyPath, dirtyRecord] of generationDirtyRecords) {
		workspaceDirtyRecords.set(dirtyPath, dirtyRecord);
	}
	workspaceState.localGeneration = record
		? { payload, stateRecord: record, dirtyRecords: generationDirtyRecords }
		: null;
	workspaceState.remotePayload = remoteRecord
		? workspaceRecordsEqual(record, remoteRecord)
			? payload
			: JSON.parse(remoteRecord.contents) as WorkspaceAutosavePayload
		: null;
	workspaceState.remoteDirtyRecords = remoteRecord
		&& workspaceRecordsEqual(record, remoteRecord)
		? generationDirtyRecords
		: null;
	workspaceState.remoteRevision = workspaceRecordState.connected
		&& workspaceRecordsEqual(record, remoteRecord)
		? 0
		: -1;
	return payload;
}

export async function restoreWorkspaceStorageSession(
	workspaceEditor: CartEditor,
	runtimeSources: RuntimeSourceState,
	runtimeDebuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload | null,
	rejectedDirtyPaths: ReadonlySet<string>,
): Promise<void> {
	let restorePayload = payload;
	if (payload && rejectedDirtyPaths.size !== 0) {
		const dirtyFiles = [];
		for (const entry of payload.dirtyFiles) {
			const root = runtimeSourceProjectRootPath(runtimeSources, entry.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				root,
				entry.domain,
				entry.path,
			);
			if (!rejectedDirtyPaths.has(dirtyPath)) {
				dirtyFiles.push(entry);
			}
		}
		restorePayload = {
			dirtyFiles,
			breakpoints: payload.breakpoints,
			fontVariant: payload.fontVariant,
		};
	}
	if (restorePayload) {
		await applyWorkspaceAutosavePayload(
			storage,
			workspaceEditor,
			runtimeSources,
			runtimeDebuggerState,
			restorePayload,
		);
	}
	editor = workspaceEditor;
	sources = runtimeSources;
	debuggerState = runtimeDebuggerState;
	if (restorePayload !== payload) {
		requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	}
	if (workspaceState.requestedRevision !== workspaceState.localRevision
		|| (workspaceRecordState.connected
			&& workspaceState.remoteRevision !== workspaceState.localRevision)) {
		scheduleWorkspaceAutosave();
	}
	if (!workspaceRecordState.connected) {
		scheduleWorkspaceReconnect();
	}
}

export function requestWorkspaceAutosave(changes: WorkspaceAutosaveChange): void {
	if (!editor) {
		return;
	}
	if (changes & WorkspaceAutosaveChange.ActiveEditor) {
		workspacePendingMetadataContextIds.add(editorDocumentState.contextId);
	}
	workspaceState.pendingChanges |= changes;
	workspaceState.requestedRevision += 1;
	scheduleWorkspaceAutosave();
}

function scheduleWorkspaceAutosave(delayMs: number = WORKSPACE_AUTOSAVE_DELAY_MS): void {
	if (!editor || workspaceState.autosaveHandle || workspaceState.autosaveTask) {
		return;
	}
	workspaceState.autosaveHandle = clock.scheduleOnce(delayMs, () => {
		workspaceState.autosaveHandle = null;
		void runWorkspaceAutosaveTick();
	});
}

export function cancelWorkspaceAutosave(): void {
	workspaceState.autosaveHandle?.cancel();
	workspaceState.autosaveHandle = null;
}

export function runWorkspaceAutosaveTick(): Promise<void> | void {
	if (!editor) {
		return;
	}
	if (workspaceState.autosaveTask) {
		return workspaceState.autosaveTask;
	}
	if (workspaceState.requestedRevision === workspaceState.localRevision
		&& (!workspaceRecordState.connected
			|| workspaceState.remoteRevision === workspaceState.localRevision)) {
		if (!workspaceRecordState.connected) {
			scheduleWorkspaceReconnect();
		}
		return;
	}
	const targetRevision = workspaceState.requestedRevision;
	if (targetRevision !== workspaceState.localRevision) {
		const previousLocalRevision = workspaceState.localRevision;
		const previousGeneration = workspaceState.localGeneration;
		const changes = workspaceState.pendingChanges;
		const generation = commitWorkspaceSessionLocally(
			storage,
			clock,
			editor,
			sources,
			debuggerState,
			changes,
			workspacePendingMetadataContextIds,
		);
		workspaceState.localGeneration = generation;
		workspaceState.localRevision = targetRevision;
		workspaceState.pendingChanges &= ~changes;
		workspacePendingMetadataContextIds.clear();
		if (generation === previousGeneration
			&& workspaceState.remoteRevision === previousLocalRevision) {
			workspaceState.remoteRevision = targetRevision;
		}
	}
	if (!workspaceRecordState.connected) {
		scheduleWorkspaceReconnect();
		return;
	}
	if (workspaceState.remoteRevision === workspaceState.localRevision
		|| !workspaceState.localGeneration) {
		return;
	}
	const task = syncWorkspaceAutosave();
	workspaceState.autosaveTask = task;
	return task;
}

async function syncWorkspaceAutosave(): Promise<void> {
	try {
		const targetRevision = workspaceState.localRevision;
		const generation = workspaceState.localGeneration;
		await syncWorkspaceSessionRemotely(sources, generation);
		workspaceState.remotePayload = generation.payload;
		workspaceState.remoteDirtyRecords = generation.dirtyRecords;
		workspaceState.remoteRevision = targetRevision;
	} catch (error) {
		disconnectWorkspaceRecords(error);
		workspaceState.remoteRevision = -1;
		scheduleWorkspaceReconnect();
	} finally {
		workspaceState.autosaveTask = null;
		if (workspaceState.requestedRevision !== workspaceState.localRevision
			|| (workspaceRecordState.connected
				&& workspaceState.remoteRevision !== workspaceState.localRevision)) {
			scheduleWorkspaceAutosave();
		}
	}
}

export function persistWorkspaceSessionLocally(): void {
	if (!editor) {
		return;
	}
	workspaceState.pendingChanges |= WorkspaceAutosaveChange.All;
	workspaceState.requestedRevision += 1;
	commitRequestedWorkspaceSessionLocally();
}

function commitRequestedWorkspaceSessionLocally(): void {
	workspaceState.localGeneration = commitWorkspaceSessionLocally(
		storage,
		clock,
		editor,
		sources,
		debuggerState,
		workspaceState.pendingChanges,
		workspacePendingMetadataContextIds,
	);
	workspaceState.localRevision = workspaceState.requestedRevision;
	workspaceState.pendingChanges = WorkspaceAutosaveChange.None;
	workspacePendingMetadataContextIds.clear();
}

function scheduleWorkspaceReconnect(): void {
	if (workspaceRecordState.connected
		|| reconnectHandle
		|| reconnectTask
		|| !workspaceState.projectRootPath) {
		return;
	}
	reconnectHandle = clock.scheduleOnce(WORKSPACE_RECONNECT_DELAY_MS, () => {
		reconnectHandle = null;
		reconnectTask = reconnectAndSyncWorkspace();
		void reconnectTask;
	});
}

async function reconnectAndSyncWorkspace(): Promise<void> {
	await reconnectWorkspaceRecords(clock, workspaceState.projectRootPath);
	reconnectTask = null;
	if (workspaceRecordState.connected) {
		workspaceState.remoteRevision = -1;
		scheduleWorkspaceAutosave(0);
	} else {
		scheduleWorkspaceReconnect();
	}
}
