import type { SerializedBreakpoints } from '../../runtime/breakpoints';
import type { WorkspaceRecord } from '../../workspace/records';
import type { SerializedEditorLocation, SerializedEditorParts } from '../services/editor/editor_parts_serialization';
import type { SerializedMainWorkspace } from '../common/main_workspace_serialization';
import type { SerializedResourcePanel } from '../contrib/resources/panel/session';

import type { WorkingCopyRecoveryEntry } from '../services/working_copy/source_recovery';

export type WorkspaceAutosavePayload = {
	dirtyFiles: WorkingCopyRecoveryEntry[];
	editorParts: SerializedEditorParts;
	sceneCompanion: SerializedEditorLocation | undefined;
	mainWorkspace: SerializedMainWorkspace;
	filesBrowser: SerializedResourcePanel;
	breakpoints: SerializedBreakpoints;
};

export const enum WorkspaceAutosaveChange {
	None = 0,
	DirtyFiles = 1 << 0,
	EditorSession = 1 << 1,
	Breakpoints = 1 << 2,
	FilesBrowser = 1 << 4,
	All = DirtyFiles | EditorSession | Breakpoints | FilesBrowser,
}

export type WorkspaceSessionGeneration = {
	payload: WorkspaceAutosavePayload;
	stateRecord: WorkspaceRecord;
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
};
