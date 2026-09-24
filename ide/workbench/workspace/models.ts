import type { FontVariant } from '../../../machine/ts/render/shared/bmsx_font';
import type { SerializedBreakpoints } from '../../runtime/breakpoints';
import type { ResourceDomain } from '../../common/resource';
import type { WorkspaceRecord } from '../../workspace/records';
import type { SerializedEditorGroup, SerializedEditorInput } from '../services/editor/editor_serialization';

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

/**
 * Persisted session records outlive the build that wrote them, so a record may predate
 * a payload shape change, or be truncated by an interrupted write. Validate structurally
 * and let the caller discard whatever does not match instead of failing the workbench start.
 */
export function isWorkspaceAutosavePayload(value: unknown): value is WorkspaceAutosavePayload {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const payload = value as Partial<WorkspaceAutosavePayload>;
	if (!Array.isArray(payload.dirtyFiles) || !payload.dirtyFiles.every(isPersistedDirtyEntry)) {
		return false;
	}
	if (!isSerializedEditorGroup(payload.editorGroup)) {
		return false;
	}
	if (!Array.isArray(payload.breakpoints) || !payload.breakpoints.every(isSerializedBreakpoint)) {
		return false;
	}
	return payload.fontVariant === 'msx' || payload.fontVariant === 'tiny';
}

function isResourceDomain(value: unknown): value is ResourceDomain {
	return value === -1 || value === 0 || value === 1;
}

function isPersistedDirtyEntry(value: unknown): value is PersistedDirtyEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const entry = value as Partial<PersistedDirtyEntry>;
	return isResourceDomain(entry.domain)
		&& typeof entry.path === 'string'
		&& typeof entry.updatedAt === 'number';
}

function isSerializedBreakpoint(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const breakpoint = value as { domain?: unknown; path?: unknown; lines?: unknown };
	return isResourceDomain(breakpoint.domain)
		&& typeof breakpoint.path === 'string'
		&& Array.isArray(breakpoint.lines)
		&& breakpoint.lines.every(line => typeof line === 'number');
}

function isSerializedEditorGroup(value: unknown): value is SerializedEditorGroup {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const group = value as Partial<SerializedEditorGroup>;
	if (!Array.isArray(group.inputs) || !group.inputs.every(isSerializedEditorInput)) {
		return false;
	}
	return (group.active === null || typeof group.active === 'number')
		&& (group.preview === null || typeof group.preview === 'number');
}

function isSerializedEditorInput(value: unknown): value is SerializedEditorInput {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const input = value as Partial<SerializedEditorInput>;
	return typeof input.kind === 'string' && typeof input.value === 'string';
}

export type WorkspaceSessionGeneration = {
	payload: WorkspaceAutosavePayload;
	stateRecord: WorkspaceRecord;
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
};
