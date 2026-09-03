import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import {
	getCodeTabContextById,
	getCodeTabContexts,
} from '../ui/code_tab/contexts';
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
	captureContextSnapshotMetadata,
} from './context_snapshot';
import {
	type PersistedCodeEditorView,
	type PersistedDirtyEntry,
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
	type WorkspaceSessionGeneration,
} from './models';
import type { CartEditor } from '../../cart_editor';
import type { HostClock } from '../../../hosts/common/clock';
import type { KeyValueStorage } from '../../workspace/key_value_storage';
import type { CodeEditorInputId } from '../../common/editor_context';

export function commitWorkspaceSessionLocally(
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeBreakpointState,
	changes: WorkspaceAutosaveChange,
	metadataContextIds: ReadonlySet<CodeEditorInputId>,
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
	let codeEditorViews: PersistedCodeEditorView[];
	if (rebuildDirtyFiles) {
		codeEditorViews = captureDirtyCodeEditorViews();
	} else if (changes & WorkspaceAutosaveChange.ActiveEditor) {
		codeEditorViews = updateCodeEditorViews(
			previousGeneration.payload.codeEditorViews,
			metadataContextIds,
		);
	} else {
		codeEditorViews = previousGeneration.payload.codeEditorViews;
	}

	const breakpoints = !previousGeneration || (changes & WorkspaceAutosaveChange.Breakpoints)
		? serializeBreakpoints(debuggerState)
		: previousGeneration.payload.breakpoints;
	const fontVariant = !previousGeneration || (changes & WorkspaceAutosaveChange.Font)
		? editor.fontVariant
		: previousGeneration.payload.fontVariant;
	if (previousGeneration
		&& dirtyFiles === previousGeneration.payload.dirtyFiles
		&& codeEditorViews === previousGeneration.payload.codeEditorViews
		&& breakpoints === previousGeneration.payload.breakpoints
		&& fontVariant === previousGeneration.payload.fontVariant) {
		return previousGeneration;
	}
	const payload: WorkspaceAutosavePayload = {
		dirtyFiles,
		codeEditorViews,
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

function captureDirtyCodeEditorViews(): PersistedCodeEditorView[] {
	const views: PersistedCodeEditorView[] = [];
	for (const context of getCodeTabContexts()) {
		if (!context.model.dirty) {
			continue;
		}
		const metadata = captureContextSnapshotMetadata(context);
		views.push({
			domain: context.model.resource.domain,
			path: context.model.resource.path,
			...metadata,
		});
	}
	return views;
}

function updateCodeEditorViews(
	views: PersistedCodeEditorView[],
	contextIds: ReadonlySet<CodeEditorInputId>,
): PersistedCodeEditorView[] {
	let updatedViews = views;
	for (const contextId of contextIds) {
		const context = getCodeTabContextById(contextId)!;
		const metadata = captureContextSnapshotMetadata(context);
		let matchingIndex = -1;
		for (let index = 0; index < views.length; index += 1) {
			const entry = views[index];
			if (entry.domain !== context.model.resource.domain || entry.path !== context.model.resource.path) {
				continue;
			}
			matchingIndex = index;
			break;
		}
		const entry = views[matchingIndex]!;
		if (codeEditorViewMetadataEquals(entry, metadata)) {
			continue;
		}
		if (updatedViews === views) {
			updatedViews = views.slice();
		}
		updatedViews[matchingIndex] = {
			domain: entry.domain,
			path: entry.path,
			...metadata,
		};
	}
	return updatedViews;
}

function codeEditorViewMetadataEquals(
	entry: PersistedCodeEditorView,
	metadata: ReturnType<typeof captureContextSnapshotMetadata>,
): boolean {
	if (entry.cursorRow !== metadata.cursorRow
		|| entry.cursorColumn !== metadata.cursorColumn
		|| entry.scrollRow !== metadata.scrollRow
		|| entry.scrollColumn !== metadata.scrollColumn) {
		return false;
	}
	if (!entry.selectionAnchor) {
		return !metadata.selectionAnchor;
	}
	if (!metadata.selectionAnchor) {
		return false;
	}
	return entry.selectionAnchor.row === metadata.selectionAnchor.row
		&& entry.selectionAnchor.column === metadata.selectionAnchor.column;
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
