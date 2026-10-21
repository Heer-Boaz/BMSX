import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import { editorTabGroup } from '../ui/tab/group_model';
import { editorTextModelService } from '../../editor/model/model_service';
import { captureWorkspaceDirtySources } from '../services/working_copy/source_recovery';
import { publishWorkspaceDirtySources, pruneWorkspaceDirtySources } from '../../workspace/source_recovery_store';
import {
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceDirtyRecordPath,
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
	sources: RuntimeSourceState,
	debuggerState: RuntimeBreakpointState,
	changes: WorkspaceAutosaveChange,
): WorkspaceSessionGeneration {
	const previousGeneration = workspaceState.localGeneration;
	const rebuildDirtyFiles = !previousGeneration || (changes & WorkspaceAutosaveChange.DirtyFiles);
	let dirtyFiles: PersistedDirtyEntry[];
	let generationDirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
	if (rebuildDirtyFiles) {
		const generation = captureWorkspaceDirtySources(editorTextModelService, sources, clock, workspaceDirtyRecords,
			(root, path, record) => writeLocalWorkspaceRecord(storage, root, path, record));
		dirtyFiles = generation.dirtyFiles;
		generationDirtyRecords = generation.dirtyRecords;
		for (const [path, record] of generation.dirtyRecords) workspaceDirtyRecords.set(path, record);
	} else {
		dirtyFiles = previousGeneration.payload.dirtyFiles;
		generationDirtyRecords = previousGeneration.dirtyRecords;
	}
	const editorGroup = !previousGeneration || rebuildDirtyFiles || (changes & WorkspaceAutosaveChange.EditorSession)
		? editorTabGroup.serialize(editor.editorInputSerializers, previousGeneration?.payload.editorGroup)
		: previousGeneration.payload.editorGroup;

	const breakpoints = !previousGeneration || (changes & WorkspaceAutosaveChange.Breakpoints)
		? debuggerState.breakpoints.serialize()
		: previousGeneration.payload.breakpoints;
	const fontVariant = !previousGeneration || (changes & WorkspaceAutosaveChange.Font)
		? editor.fontVariant
		: previousGeneration.payload.fontVariant;
	if (previousGeneration
		&& dirtyFiles === previousGeneration.payload.dirtyFiles
		&& editorGroup === previousGeneration.payload.editorGroup
		&& breakpoints === previousGeneration.payload.breakpoints
		&& fontVariant === previousGeneration.payload.fontVariant) {
		return previousGeneration;
	}
	const payload: WorkspaceAutosavePayload = {
		dirtyFiles,
		editorGroup,
		breakpoints,
		fontVariant,
	};
	const statePath = joinWorkspacePaths(
		workspaceState.projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_STATE_FILE,
	);
	const stateRecord = createWorkspaceRecord(
		clock,
		JSON.stringify(payload),
	);
	writeLocalWorkspaceRecord(
		storage,
		workspaceState.projectRootPath,
		statePath,
		stateRecord,
	);

	if (rebuildDirtyFiles && previousGeneration) {
		for (const entry of previousGeneration.payload.dirtyFiles) {
			const projectRootPath = runtimeSourceProjectRootPath(sources, entry.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				projectRootPath,
				entry.domain,
				entry.path,
			);
			const currentRecord = generationDirtyRecords.get(dirtyPath);
			if (currentRecord?.updatedAt === entry.updatedAt) {
				continue;
			}
			deleteLocalWorkspaceRecord(
				storage,
				projectRootPath,
				buildWorkspaceDirtyRecordPath(dirtyPath, entry.updatedAt),
			);
			if (!currentRecord) {
				workspaceDirtyRecords.delete(dirtyPath);
			}
		}
	}
	return { payload, stateRecord, dirtyRecords: generationDirtyRecords };
}

export async function syncWorkspaceSessionRemotely(
	sources: RuntimeSourceState,
	generation: WorkspaceSessionGeneration,
): Promise<void> {
	const dirtyRecordsChanged = workspaceState.remoteDirtyRecords !== generation.dirtyRecords;
	if (dirtyRecordsChanged) {
		await publishWorkspaceDirtySources(sources, generation.payload.dirtyFiles, generation.dirtyRecords,
			workspaceState.remotePayload?.dirtyFiles ?? []);
	}

	const statePath = joinWorkspacePaths(
		workspaceState.projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_STATE_FILE,
	);
	await workspaceRecords.write(statePath, generation.stateRecord);

	if (dirtyRecordsChanged) {
		await pruneWorkspaceDirtySources(sources, workspaceState.remotePayload?.dirtyFiles ?? [], generation.payload.dirtyFiles);
	}
}
