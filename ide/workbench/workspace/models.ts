import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpoints } from '../contrib/debugger/controller';
import type { ResourceDomain } from '../../common/resource';
import type { WorkspaceRecord } from '../../workspace/records';
import type { SerializedEditorGroup } from '../services/editor/editor_serialization';

export type PersistedDirtyEntry = {
	domain: ResourceDomain;
	path: string;
	updatedAt: number;
};

export type WorkspaceAutosavePayload = {
	dirtyFiles: PersistedDirtyEntry[];
	editorGroup: SerializedEditorGroup;
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
