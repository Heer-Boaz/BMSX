import type { Position } from '../../common/models';
import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpointMap } from '../contrib/debugger/controller';
import type { ResourceDomain } from '../../common/resource';
import type { WorkspaceRecord } from '../../workspace/records';

export type SnapshotMetadata = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
	textVersion?: number;
};

export type PersistedDirtyEntry = {
	domain: ResourceDomain;
	path: string;
	updatedAt: number;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
};

export type WorkspaceAutosavePayload = {
	dirtyFiles: PersistedDirtyEntry[];
	breakpoints: SerializedBreakpointMap;
	fontVariant: FontVariant;
};

export const enum WorkspaceAutosaveChange {
	None = 0,
	DirtyFiles = 1 << 0,
	ActiveEditor = 1 << 1,
	Breakpoints = 1 << 2,
	Font = 1 << 3,
	All = DirtyFiles | ActiveEditor | Breakpoints | Font,
}

export type WorkspaceSessionGeneration = {
	payload: WorkspaceAutosavePayload;
	stateRecord: WorkspaceRecord;
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
};
