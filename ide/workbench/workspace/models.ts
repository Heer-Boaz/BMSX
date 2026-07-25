import type { Position } from '../../common/models';
import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpointMap } from '../contrib/debugger/controller';
import type { ResourceDomain } from '../../common/resource';

export const WORKSPACE_AUTOSAVE_VERSION = 1;

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
	domain: ResourceDomain;
	path: string;
	type: string;
	asset_id?: string;
	readOnly?: boolean;
};

export type PersistedDirtyEntry = {
	descriptor: SerializedDescriptor;
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

export type LegacyWorkspaceAutosavePayload = {
	version?: never;
	savedAt: number;
	dirtyFiles: Array<Omit<PersistedDirtyEntry, 'descriptor'> & {
		contextId?: string;
		descriptor: Omit<SerializedDescriptor, 'domain'>;
	}>;
	breakpoints?: SerializedBreakpointMap;
	fontVariant?: FontVariant;
	overlayResolutionMode?: 'offscreen' | 'viewport';
};

export type StoredWorkspaceAutosavePayload = WorkspaceAutosavePayload | LegacyWorkspaceAutosavePayload;
