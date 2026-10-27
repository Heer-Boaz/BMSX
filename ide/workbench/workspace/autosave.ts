import type { WorkspaceSourceCatalog } from '../../workspace/source_catalog';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import { editorTextModelService } from '../../editor/model/model_service';
import { captureWorkspaceDirtySources } from '../services/working_copy/source_recovery';
import { publishWorkspaceDirtySources, pruneWorkspaceDirtySources, workspaceRecoveryRecordPath } from '../../workspace/source_recovery_store';
import {
	buildWorkspaceDirtyEntryPath,
} from '../../workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
	createWorkspaceRecord,
	deleteLocalWorkspaceRecord,
	writeLocalWorkspaceRecord,
	workspaceRecords,
	type WorkspaceRecord,
} from '../../workspace/records';
import { joinWorkspacePaths } from '../../workspace/path';
import {
	workspaceDirtyRecords,
	workspaceState,
} from './state';
import {
	type PersistedDirtyEntry,
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
	type WorkspaceSessionGeneration,
} from './models';
import type { CartEditor } from '../../cart_editor';
import type { HostClock } from '../../../hosts/common/clock';
import type { KeyValueStorage } from '../../workspace/key_value_storage';

export function commitWorkspaceSessionLocally(
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	catalog: WorkspaceSourceCatalog,
	debuggerState: RuntimeBreakpointState,
	changes: WorkspaceAutosaveChange,
): WorkspaceSessionGeneration {
	const previousGeneration = workspaceState.localGeneration;
	const context = workspaceState.context;
	const recoveryIdentity = workspaceState.recoveryIdentity;
	const rebuildDirtyFiles = !previousGeneration || (changes & WorkspaceAutosaveChange.DirtyFiles);
	let dirtyFiles: PersistedDirtyEntry[];
	let generationDirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
	if (rebuildDirtyFiles) {
		const generation = captureWorkspaceDirtySources(editorTextModelService, catalog, clock, workspaceDirtyRecords,
			(root, entry, record) => writeLocalWorkspaceRecord(storage, root,
				workspaceRecoveryRecordPath(catalog, entry, recoveryIdentity), record));
		dirtyFiles = generation.dirtyFiles;
		generationDirtyRecords = generation.dirtyRecords;
		for (const [path, record] of generation.dirtyRecords) workspaceDirtyRecords.set(path, record);
	} else {
		dirtyFiles = previousGeneration.payload.dirtyFiles;
		generationDirtyRecords = previousGeneration.dirtyRecords;
	}
	const editorParts = !previousGeneration || rebuildDirtyFiles || (changes & WorkspaceAutosaveChange.EditorSession)
		? editor.editorParts.serialize(editor.editorInputSerializers, previousGeneration?.payload.editorParts)
		: previousGeneration.payload.editorParts;

	const breakpoints = !previousGeneration || (changes & WorkspaceAutosaveChange.Breakpoints)
		? debuggerState.breakpoints.serialize()
		: previousGeneration.payload.breakpoints;
	const fontVariant = !previousGeneration || (changes & WorkspaceAutosaveChange.Font)
		? editor.fontVariant
		: previousGeneration.payload.fontVariant;
	if (previousGeneration
		&& dirtyFiles === previousGeneration.payload.dirtyFiles
		&& editorParts === previousGeneration.payload.editorParts
		&& breakpoints === previousGeneration.payload.breakpoints
		&& fontVariant === previousGeneration.payload.fontVariant) {
		return previousGeneration;
	}
	const payload: WorkspaceAutosavePayload = {
		version: 5,
		dirtyFiles,
		editorParts,
		breakpoints,
		fontVariant,
	};
	const statePath = joinWorkspacePaths(
		context.projectRoot,
		WORKSPACE_METADATA_DIR,
		'studio',
		recoveryIdentity,
		WORKSPACE_STATE_FILE,
	);
	const stateRecord = createWorkspaceRecord(
		clock,
		JSON.stringify(payload),
	);
	writeLocalWorkspaceRecord(
		storage,
		context.projectRoot,
		statePath,
		stateRecord,
	);

	if (rebuildDirtyFiles && previousGeneration) {
		for (const entry of previousGeneration.payload.dirtyFiles) {
			const projectRootPath = catalog.getContext(entry.contextId).projectRootPath;
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				projectRootPath,
				entry.contextId,
				entry.path,
			);
			const currentRecord = generationDirtyRecords.get(dirtyPath);
			if (currentRecord?.updatedAt === entry.updatedAt) {
				continue;
			}
			deleteLocalWorkspaceRecord(
				storage,
				projectRootPath,
				workspaceRecoveryRecordPath(catalog, entry, recoveryIdentity),
			);
			if (!currentRecord) {
				workspaceDirtyRecords.delete(dirtyPath);
			}
		}
	}
	return { payload, stateRecord, dirtyRecords: generationDirtyRecords };
}

export async function syncWorkspaceSessionRemotely(
	catalog: WorkspaceSourceCatalog,
	generation: WorkspaceSessionGeneration,
): Promise<void> {
	const context = workspaceState.context;
	const recoveryIdentity = workspaceState.recoveryIdentity;
	const dirtyRecordsChanged = workspaceState.remoteDirtyRecords !== generation.dirtyRecords;
	if (dirtyRecordsChanged) {
		await publishWorkspaceDirtySources(catalog, generation.payload.dirtyFiles, generation.dirtyRecords,
			workspaceState.remotePayload?.dirtyFiles ?? [], recoveryIdentity);
	}

	const statePath = joinWorkspacePaths(
		context.projectRoot,
		WORKSPACE_METADATA_DIR,
		'studio',
		recoveryIdentity,
		WORKSPACE_STATE_FILE,
	);
	await workspaceRecords.write(statePath, generation.stateRecord);

	if (dirtyRecordsChanged) {
		await pruneWorkspaceDirtySources(catalog, workspaceState.remotePayload?.dirtyFiles ?? [], generation.payload.dirtyFiles, recoveryIdentity);
	}
}
