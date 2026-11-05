import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { WorkspaceUiScale } from '../common/display_scale';
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
	fontVariant: FontVariant;
	/** Absence denotes 100% in sessions predating adaptive workspace presentation. */
	uiScale?: WorkspaceUiScale;
};

export const enum WorkspaceAutosaveChange {
	None = 0,
	DirtyFiles = 1 << 0,
	EditorSession = 1 << 1,
	Breakpoints = 1 << 2,
	Font = 1 << 3,
	FilesBrowser = 1 << 4,
	UiScale = 1 << 5,
	All = DirtyFiles | EditorSession | Breakpoints | Font | FilesBrowser | UiScale,
}

export type WorkspaceSessionGeneration = {
	payload: WorkspaceAutosavePayload;
	stateRecord: WorkspaceRecord;
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
};
