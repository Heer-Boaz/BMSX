import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { RuntimeDebuggerState } from '../../runtime/debugger_state';
import {
	getCodeTabContextById,
	getCodeTabContexts,
} from '../ui/code_tab/contexts';
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
	captureContextText,
} from './context_snapshot';
import {
	type PersistedDirtyEntry,
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
	type WorkspaceSessionGeneration,
} from './models';
import type { CartEditor } from '../../cart_editor';
import type { HostClock, StorageService } from '../../../machine/ts/platform/platform';

export function commitWorkspaceSessionLocally(
	storage: StorageService,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	changes: WorkspaceAutosaveChange,
	metadataContextIds: ReadonlySet<string>,
): WorkspaceSessionGeneration {
	const previousGeneration = workspaceState.localGeneration;
	const rebuildDirtyFiles = !previousGeneration || (changes & WorkspaceAutosaveChange.DirtyFiles);
	let dirtyFiles: PersistedDirtyEntry[];
	let generationDirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
	if (rebuildDirtyFiles) {
		dirtyFiles = [];
		const records = new Map<string, WorkspaceRecord>();
		generationDirtyRecords = records;
		for (const context of getCodeTabContexts()) {
			if (!context.dirty) {
				continue;
			}
			const projectRootPath = runtimeSourceProjectRootPath(sources, context.resource.domain);
			const dirtyPath = buildWorkspaceDirtyEntryPath(
				projectRootPath,
				context.resource.domain,
				context.resource.path,
			);
			const metadata = captureContextSnapshotMetadata(context);
			const text = captureContextText(context);
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
				domain: context.resource.domain,
				path: context.resource.path,
				updatedAt: record.updatedAt,
				cursorRow: metadata.cursorRow,
				cursorColumn: metadata.cursorColumn,
				scrollRow: metadata.scrollRow,
				scrollColumn: metadata.scrollColumn,
				selectionAnchor: metadata.selectionAnchor,
			});
			records.set(dirtyPath, record);
		}
	} else {
		dirtyFiles = previousGeneration.payload.dirtyFiles;
		generationDirtyRecords = previousGeneration.dirtyRecords;
		if (changes & WorkspaceAutosaveChange.ActiveEditor) {
			dirtyFiles = captureDirtyEntryMetadata(dirtyFiles, metadataContextIds);
		}
	}

	const breakpoints = !previousGeneration || (changes & WorkspaceAutosaveChange.Breakpoints)
		? serializeBreakpoints(debuggerState)
		: previousGeneration.payload.breakpoints;
	const fontVariant = !previousGeneration || (changes & WorkspaceAutosaveChange.Font)
		? editor.fontVariant
		: previousGeneration.payload.fontVariant;
	if (previousGeneration
		&& dirtyFiles === previousGeneration.payload.dirtyFiles
		&& breakpoints === previousGeneration.payload.breakpoints
		&& fontVariant === previousGeneration.payload.fontVariant) {
		return previousGeneration;
	}
	const payload: WorkspaceAutosavePayload = {
		dirtyFiles,
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

function captureDirtyEntryMetadata(
	dirtyFiles: PersistedDirtyEntry[],
	contextIds: ReadonlySet<string>,
): PersistedDirtyEntry[] {
	let updatedDirtyFiles = dirtyFiles;
	for (const contextId of contextIds) {
		const context = getCodeTabContextById(contextId);
		const metadata = captureContextSnapshotMetadata(context);
		let found = false;
		for (let index = 0; index < dirtyFiles.length; index += 1) {
			const entry = dirtyFiles[index];
			if (entry.domain !== context.resource.domain || entry.path !== context.resource.path) {
				continue;
			}
			found = true;
			if (dirtyEntryMetadataEquals(entry, metadata)) {
				break;
			}
			if (updatedDirtyFiles === dirtyFiles) {
				updatedDirtyFiles = dirtyFiles.slice();
			}
			updatedDirtyFiles[index] = {
				domain: entry.domain,
				path: entry.path,
				updatedAt: entry.updatedAt,
				cursorRow: metadata.cursorRow,
				cursorColumn: metadata.cursorColumn,
				scrollRow: metadata.scrollRow,
				scrollColumn: metadata.scrollColumn,
				selectionAnchor: metadata.selectionAnchor,
			};
			break;
		}
		if (!found) {
			throw new Error(`Dirty editor '${context.resource.path}' is missing from the retained workspace generation.`);
		}
	}
	return updatedDirtyFiles;
}

function dirtyEntryMetadataEquals(
	entry: PersistedDirtyEntry,
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
