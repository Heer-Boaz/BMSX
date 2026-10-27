import type { HostClock } from '../../../hosts/common/clock';
import type { StudioSourceContext } from '../../../hosts/common/studio_projects';
import { LogLevel, type LogOutput } from '../../../hosts/common/log';
import { showEditorWarningBanner } from '../../common/feedback_state';
import type { KeyValueStorage } from '../../workspace/key_value_storage';
import type { WorkspaceRecordProvider } from '../../workspace/record_provider';
import { clearWorkspaceSourceCaches } from '../../workspace/cache';
import {
	buildWorkspaceDirtyEntryPath,
	loadWorkspaceSourceFile,
} from '../../workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
	closeWorkspaceRecords,
	deleteLocalWorkspaceRecord,
	openWorkspaceRecords,
	readLocalWorkspaceRecord,
	selectNewestWorkspaceRecord,
	workspaceRecords,
	workspaceRecordsEqual,
	writeLocalWorkspaceRecord,
	type WorkspaceRecord,
} from '../../workspace/records';
import { joinWorkspacePaths } from '../../workspace/path';
import {
	workspaceDirtyRecords,
	workspaceState,
} from './state';
import { applyWorkspaceAutosavePayload } from './restore';
import {
	commitWorkspaceSessionLocally,
	syncWorkspaceSessionRemotely,
} from './autosave';
import type { CartEditor } from '../../cart_editor';
import type { WorkspaceSourceCatalog } from '../../workspace/source_catalog';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import {
	WorkspaceAutosaveChange,
	deserializeWorkspaceAutosavePayload,
	type WorkspaceAutosavePayload,
} from './models';
import { editorTextModelService } from '../../editor/model/model_service';
import { loadWorkspaceDirtySources, workspaceRecoveryRecordPath } from '../../workspace/source_recovery_store';

const WORKSPACE_AUTOSAVE_DELAY_MS = 2500;
let editor: CartEditor = null;
let catalog: WorkspaceSourceCatalog = null;
let debuggerState: RuntimeBreakpointState = null;
let storage: KeyValueStorage = null;
let clock: HostClock = null;
let logOutput: LogOutput = null;
let unsubscribeEditorParts: (() => void) | undefined;
let unsubscribeModelSaved: (() => void) | undefined;

export async function shutdownWorkspaceStorage(): Promise<void> {
	unsubscribeEditorParts?.();
	unsubscribeModelSaved?.();
	unsubscribeEditorParts = undefined;
	unsubscribeModelSaved = undefined;
	cancelWorkspaceAutosave();
	try {
		if (workspaceState.autosaveTask) {
			await workspaceState.autosaveTask;
		}
		cancelWorkspaceAutosave();
		const task = runWorkspaceAutosaveTick();
		if (task) {
			await task;
		}
	} finally {
		cancelWorkspaceAutosave();
		try {
			if (editor && workspaceState.requestedRevision !== workspaceState.localRevision) {
				commitRequestedWorkspaceSessionLocally();
			}
		} finally {
			workspaceState.context = null;
			workspaceState.recoveryIdentity = null;
			workspaceState.requestedRevision = 0;
			workspaceState.localRevision = 0;
			workspaceState.remoteRevision = -1;
			workspaceState.localGeneration = null;
			workspaceState.remotePayload = null;
			workspaceState.remoteDirtyRecords = null;
			workspaceState.pendingChanges = WorkspaceAutosaveChange.None;
			workspaceDirtyRecords.clear();
			editor = null;
			catalog = null;
			debuggerState = null;
			storage = null;
			clock = null;
			logOutput = null;
			clearWorkspaceSourceCaches();
			await closeWorkspaceRecords();
		}
	}
}

/** Recovery records reference immutable dirty versions, never canonical source files. */
async function readWorkspaceRecordVersion(
	storage: KeyValueStorage, projectRootPath: string, path: string,
): Promise<WorkspaceRecord> {
	const local = readLocalWorkspaceRecord(storage, projectRootPath, path);
	if (local !== null) return local;
	const record = await workspaceRecords.read(path);
	if (record === null) {
		throw new Error(`Incomplete editor recovery: missing '${path}'.`);
	}
	writeLocalWorkspaceRecord(storage, projectRootPath, path, record);
	return record;
}

export async function initializeWorkspaceStorage(
	workspaceStorage: KeyValueStorage,
	workspaceClock: HostClock,
	context: StudioSourceContext,
	recoverySessionId: string,
	sourceCatalog: WorkspaceSourceCatalog,
	workspaceFiles: WorkspaceRecordProvider,
	workspaceLogOutput: LogOutput,
): Promise<WorkspaceAutosavePayload | null> {
	await shutdownWorkspaceStorage();
	storage = workspaceStorage;
	clock = workspaceClock;
	logOutput = workspaceLogOutput;
	workspaceState.context = context;
	const recoveryIdentity = joinWorkspacePaths(context.id, recoverySessionId);
	workspaceState.recoveryIdentity = recoveryIdentity;
	const projectRootPath = context.projectRoot;
	await openWorkspaceRecords(workspaceFiles);
	const statePath = joinWorkspacePaths(
		projectRootPath,
		WORKSPACE_METADATA_DIR,
		'studio',
		recoveryIdentity,
		WORKSPACE_STATE_FILE,
	);
	const localRecord = readLocalWorkspaceRecord(storage, projectRootPath, statePath);
	const localPayload: WorkspaceAutosavePayload | null = localRecord === null ? null : deserializeWorkspaceAutosavePayload(localRecord.contents);
	let remoteRecord: WorkspaceRecord | null = null;
	let providerRead = false;
	try {
		remoteRecord = await workspaceRecords.read(statePath);
		providerRead = true;
	} catch (error) {
		const message = `Could not read the workspace editor session: ${String(error)}`;
		logOutput.log(LogLevel.Warn, `[WorkspaceStorage] ${message}`);
		showEditorWarningBanner(message, 5.0);
	}
	const remotePayload: WorkspaceAutosavePayload | null = remoteRecord === null ? null : deserializeWorkspaceAutosavePayload(remoteRecord.contents);
	const record = selectNewestWorkspaceRecord(localRecord, remoteRecord);
	const payload = record === null ? null : record === remoteRecord ? remotePayload : localPayload;
	// An incomplete generation is an error, not permission to discard unsaved edits or rewrite the manifest.
	const generationDirtyRecords = payload ? await loadWorkspaceDirtySources(sourceCatalog, payload.dirtyFiles,
		(root, path) => readWorkspaceRecordVersion(storage, root, path), recoveryIdentity) : new Map<string, WorkspaceRecord>();
	const replacedLocalPayload = record === remoteRecord && localRecord ? localPayload : null;
	const obsoleteLocalDirtyRecords: Array<readonly [string, string]> = [];
	if (replacedLocalPayload) {
		for (const entry of replacedLocalPayload.dirtyFiles) {
			const dirtyProjectRootPath = sourceCatalog.getContext(entry.contextId).projectRootPath;
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				dirtyProjectRootPath,
				entry.contextId,
				entry.path,
			);
			if (generationDirtyRecords.get(dirtyPath)?.updatedAt === entry.updatedAt) {
				continue;
			}
			obsoleteLocalDirtyRecords.push([
				dirtyProjectRootPath,
				workspaceRecoveryRecordPath(sourceCatalog, entry, recoveryIdentity),
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
			: remotePayload
		: null;
	workspaceState.remoteDirtyRecords = remoteRecord
		&& workspaceRecordsEqual(record, remoteRecord)
		? generationDirtyRecords
		: null;
	workspaceState.remoteRevision = providerRead
		&& workspaceRecordsEqual(record, remoteRecord)
		? 0
		: -1;
	return payload;
}

export async function restoreWorkspaceStorageSession(
	workspaceEditor: CartEditor,
	sourceCatalog: WorkspaceSourceCatalog,
	runtimeDebuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload | null,
	rejectedDirtyPaths: ReadonlySet<string>,
): Promise<void> {
	let restorePayload = payload;
	if (payload && payload.dirtyFiles.length !== 0) {
		const dirtyFiles = [];
		for (const entry of payload.dirtyFiles) {
			const root = sourceCatalog.getContext(entry.contextId).projectRootPath;
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				root,
				entry.contextId,
				entry.path,
			);
			if (!rejectedDirtyPaths.has(dirtyPath)) {
				// Lua already chose ROM/file/draft before compilation; reuse that decision.
				if (sourceCatalog.resolveLuaSource(entry) !== null) {
					dirtyFiles.push(entry);
					continue;
				}
				// Save can complete before recovery cleanup. Admit the checkpoint only
				// against the same canonical record used to initialize its working copy.
				const canonical = await loadWorkspaceSourceFile(sourceCatalog.resolveResource(entry)!.sourceFilePath!);
				if (canonical === null || entry.updatedAt >= canonical.updatedAt) dirtyFiles.push(entry);
			}
		}

		if (dirtyFiles.length !== payload.dirtyFiles.length) restorePayload = { ...payload, dirtyFiles };
	}
	if (restorePayload) {
		await applyWorkspaceAutosavePayload(
			workspaceEditor,
			sourceCatalog,
			runtimeDebuggerState,
			restorePayload,
		);
	}
	editor = workspaceEditor;
	catalog = sourceCatalog;
	debuggerState = runtimeDebuggerState;
	unsubscribeEditorParts = editor.editorParts.onDidChange(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession));
	unsubscribeModelSaved = editorTextModelService.onDidSaveModel(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles));
	if (restorePayload !== payload) {
		requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	}
	if (workspaceState.requestedRevision !== workspaceState.localRevision
		|| workspaceState.remoteRevision !== workspaceState.localRevision) {
		scheduleWorkspaceAutosave();
	}
}

export function requestWorkspaceAutosave(changes: WorkspaceAutosaveChange): void {
	if (!editor) {
		return;
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
		&& workspaceState.remoteRevision === workspaceState.localRevision) return;
	const targetRevision = workspaceState.requestedRevision;
	if (targetRevision !== workspaceState.localRevision) {
		const previousLocalRevision = workspaceState.localRevision;
		const previousGeneration = workspaceState.localGeneration;
		const changes = workspaceState.pendingChanges;
		const generation = commitWorkspaceSessionLocally(
			storage,
			clock,
			editor,
			catalog,
			debuggerState,
			changes,
		);
		workspaceState.localGeneration = generation;
		workspaceState.localRevision = targetRevision;
		workspaceState.pendingChanges &= ~changes;
		if (generation === previousGeneration
			&& workspaceState.remoteRevision === previousLocalRevision) {
			workspaceState.remoteRevision = targetRevision;
		}
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
	let failed = false;
	try {
		const targetRevision = workspaceState.localRevision;
		const generation = workspaceState.localGeneration;
		await syncWorkspaceSessionRemotely(catalog, generation);
		workspaceState.remotePayload = generation.payload;
		workspaceState.remoteDirtyRecords = generation.dirtyRecords;
		workspaceState.remoteRevision = targetRevision;
	} catch (error) {
		failed = true;
		workspaceState.remoteRevision = -1;
		const message = `Could not persist the editor session: ${String(error)}`;
		logOutput.log(LogLevel.Error, `[WorkspaceStorage] ${message}`);
		showEditorWarningBanner(message, 5.0);
	} finally {
		workspaceState.autosaveTask = null;
		if (workspaceState.requestedRevision !== workspaceState.localRevision
			|| (!failed && workspaceState.remoteRevision !== workspaceState.localRevision)) {
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
		catalog,
		debuggerState,
		workspaceState.pendingChanges,
	);
	workspaceState.localRevision = workspaceState.requestedRevision;
	workspaceState.pendingChanges = WorkspaceAutosaveChange.None;
}
