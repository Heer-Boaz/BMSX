import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import { editorTabGroup } from '../ui/tab/group_model';
import { editorTextModelService } from '../../editor/model/model_service';
import { getTextSnapshot } from '../../editor/text/source_text';
import { serializeBreakpoints } from '../contrib/debugger/controller';
import {
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceDirtyRecordPath,
} from '../../workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
	createWorkspaceRecord,
	deleteLocalWorkspaceRecord,
	deleteRemoteWorkspaceRecord,
	writeLocalWorkspaceRecord,
	writeRemoteWorkspaceRecord,
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
		dirtyFiles = [];
		const records = new Map<string, WorkspaceRecord>();
		generationDirtyRecords = records;
		for (const model of editorTextModelService.models) {
			if (!model.dirty) {
				continue;
			}
			const resource = model.resource;
			const projectRootPath = runtimeSourceProjectRootPath(sources, resource.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				projectRootPath,
				resource.domain,
				resource.path,
			);
			const text = getTextSnapshot(model.buffer);
			let record = workspaceDirtyRecords.get(dirtyPath);
			if (!record || record.contents !== text) {
				record = createWorkspaceRecord(clock, text);
				writeLocalWorkspaceRecord(
					storage,
					projectRootPath,
					buildWorkspaceDirtyRecordPath(dirtyPath, record.updatedAt),
					record,
				);
				workspaceDirtyRecords.set(dirtyPath, record);
			}
			dirtyFiles.push({
				domain: resource.domain,
				path: resource.path,
				updatedAt: record.updatedAt,
			});
			records.set(dirtyPath, record);
		}
	} else {
		dirtyFiles = previousGeneration.payload.dirtyFiles;
		generationDirtyRecords = previousGeneration.dirtyRecords;
	}
	const editorGroup = !previousGeneration || rebuildDirtyFiles || (changes & WorkspaceAutosaveChange.EditorSession)
		? editorTabGroup.serialize(editor.editorInputSerializers, previousGeneration?.payload.editorGroup)
		: previousGeneration.payload.editorGroup;

	const breakpoints = !previousGeneration || (changes & WorkspaceAutosaveChange.Breakpoints)
		? serializeBreakpoints(debuggerState)
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
	let remoteDirtyVersions: Map<string, number>;
	if (dirtyRecordsChanged) {
		remoteDirtyVersions = new Map<string, number>();
		if (workspaceState.remotePayload) {
			for (const entry of workspaceState.remotePayload.dirtyFiles) {
				const projectRootPath = runtimeSourceProjectRootPath(sources, entry.domain);
				const dirtyPath = buildWorkspaceDirtyEntryPath(
					projectRootPath,
					entry.domain,
					entry.path,
				);
				remoteDirtyVersions.set(dirtyPath, entry.updatedAt);
			}
		}
		for (const [dirtyPath, record] of generation.dirtyRecords) {
			if (remoteDirtyVersions.get(dirtyPath) !== record.updatedAt) {
				await writeRemoteWorkspaceRecord(
					buildWorkspaceDirtyRecordPath(dirtyPath, record.updatedAt),
					record,
				);
			}
		}
	}

	const statePath = joinWorkspacePaths(
		workspaceState.projectRootPath,
		WORKSPACE_METADATA_DIR,
		WORKSPACE_STATE_FILE,
	);
	await writeRemoteWorkspaceRecord(statePath, generation.stateRecord);

	if (dirtyRecordsChanged) {
		for (const [dirtyPath, updatedAt] of remoteDirtyVersions!) {
			if (generation.dirtyRecords.get(dirtyPath)?.updatedAt !== updatedAt) {
				await deleteRemoteWorkspaceRecord(
					buildWorkspaceDirtyRecordPath(dirtyPath, updatedAt),
				);
			}
		}
	}
}
