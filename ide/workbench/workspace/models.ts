import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpoints } from '../../runtime/breakpoints';
import type { WorkspaceRecord } from '../../workspace/records';
import type { SerializedEditorParts } from '../services/editor/editor_parts_serialization';

import type { PersistedDirtyEntry } from '../../workspace/source_recovery_store';
export type { PersistedDirtyEntry } from '../../workspace/source_recovery_store';

export type WorkspaceAutosavePayload = {
	version: 3;
	dirtyFiles: PersistedDirtyEntry[];
	editorParts: SerializedEditorParts;
	breakpoints: SerializedBreakpoints;
	fontVariant: FontVariant;
};

/** Persistent layout and source references are admitted as one versioned format. */
export function deserializeWorkspaceAutosavePayload(source: string): WorkspaceAutosavePayload {
	const payload: WorkspaceAutosavePayload = JSON.parse(source);
	if (payload.version !== 3) throw new Error(`Unsupported workspace session version '${payload.version}'.`);
	return payload;
}

export const enum WorkspaceAutosaveChange {
	None = 0,
	DirtyFiles = 1 << 0,
	EditorSession = 1 << 1,
	Breakpoints = 1 << 2,
	Font = 1 << 3,
	All = DirtyFiles | EditorSession | Breakpoints | Font,
}

export type WorkspaceSessionGeneration = {
	payload: WorkspaceAutosavePayload;
	stateRecord: WorkspaceRecord;
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
};
