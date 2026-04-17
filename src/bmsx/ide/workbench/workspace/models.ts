import type { Position } from '../../common/models';
import type { FontVariant } from '../../../render/shared/bmsx_font';
import type { SerializedBreakpointMap } from '../contrib/debugger/controller';

export type WorkspaceStoragePaths = {
	projectRootPath: string;
	metadataDir: string;
	dirtyDir: string;
	stateFile: string;
};

export type SnapshotMetadata = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
	textVersion?: number;
};

export type SerializedDescriptor = {
	path: string;
	type: string;
	asset_id?: string;
	readOnly?: boolean;
};

export type PersistedDirtyEntry = {
	contextId: string;
	descriptor: SerializedDescriptor;
	dirtyPath: string;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
};

export type WorkspaceAutosavePayload = {
	savedAt: number;
	dirtyFiles: PersistedDirtyEntry[];
	breakpoints?: SerializedBreakpointMap;
	fontVariant?: FontVariant;
	overlayResolutionMode?: 'offscreen' | 'viewport';
};

export type DirtyContextEntry = PersistedDirtyEntry & { text: string };
