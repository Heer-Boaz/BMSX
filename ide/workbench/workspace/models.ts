import type { Position } from '../../common/models';
import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpointMap } from '../contrib/debugger/controller';
import type { ResourceIdentity } from '../../common/resource';

export const WORKSPACE_AUTOSAVE_VERSION = 2;

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

export type PersistedDirtyEntry = {
	resource: ResourceIdentity;
	dirtyPath: string;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
};

export type WorkspaceAutosavePayload = {
	version: typeof WORKSPACE_AUTOSAVE_VERSION;
	savedAt: number;
	dirtyFiles: PersistedDirtyEntry[];
	breakpoints?: SerializedBreakpointMap;
	fontVariant?: FontVariant;
	overlayResolutionMode?: 'offscreen' | 'viewport';
};

export type DirtyContextEntry = PersistedDirtyEntry & { text: string };
