import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpoints } from '../../runtime/breakpoints';
import type { WorkspaceRecord } from '../../workspace/records';
import type { SerializedEditorParts } from '../services/editor/editor_parts_serialization';
import type { SerializedMainWorkspace } from '../common/main_workspace_serialization';

import type { PersistedDirtyEntry } from '../../workspace/source_recovery_store';
export type { PersistedDirtyEntry } from '../../workspace/source_recovery_store';

export type WorkspaceAutosavePayload = {
	dirtyFiles: PersistedDirtyEntry[];
	editorParts: SerializedEditorParts;
	mainWorkspace: SerializedMainWorkspace;
	breakpoints: SerializedBreakpoints;
	fontVariant: FontVariant;
};

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
