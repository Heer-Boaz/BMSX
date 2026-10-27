import type { WorkspaceSourceCatalog } from './source_catalog';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceDirtyRecordPath } from './files';
import { joinWorkspacePaths, stripProjectRootPrefix } from './path';
import { WORKSPACE_METADATA_DIR, workspaceRecords, type WorkspaceRecord } from './records';

export type PersistedDirtyEntry = { contextId: string; path: string; updatedAt: number };

/** The source identity stays independent of a frontend's recovery namespace. */
export function workspaceRecoveryRecordPath(catalog: WorkspaceSourceCatalog, entry: PersistedDirtyEntry, identity?: string): string {
	const root = catalog.getContext(entry.contextId).projectRootPath;
	const dirtyPath = buildWorkspaceDirtyEntryPath(root, entry.contextId, entry.path);
	const path = identity === undefined ? dirtyPath : joinWorkspacePaths(root, WORKSPACE_METADATA_DIR,
		'studio', identity, stripProjectRootPrefix(dirtyPath, joinWorkspacePaths(root, WORKSPACE_METADATA_DIR)));
	return buildWorkspaceDirtyRecordPath(path, entry.updatedAt);
}

/** Read every referenced immutable version before admitting a recovery generation. */
export async function loadWorkspaceDirtySources(catalog: WorkspaceSourceCatalog, entries: readonly PersistedDirtyEntry[],
	read: (projectRoot: string, path: string) => Promise<WorkspaceRecord>, identity?: string): Promise<Map<string, WorkspaceRecord>> {
	return new Map(await Promise.all(entries.map(async entry => [
		buildWorkspaceDirtyEntryPath(catalog.getContext(entry.contextId).projectRootPath, entry.contextId, entry.path),
		await read(catalog.getContext(entry.contextId).projectRootPath, workspaceRecoveryRecordPath(catalog, entry, identity)),
	] as const)));
}

/** Publish data before its manifest; the caller publishes that manifest before pruning. */
export async function publishWorkspaceDirtySources(catalog: WorkspaceSourceCatalog, entries: readonly PersistedDirtyEntry[],
	records: ReadonlyMap<string, WorkspaceRecord>, previous: readonly PersistedDirtyEntry[], identity?: string): Promise<void> {
	const versions = new Set(previous.map(entry => workspaceRecoveryRecordPath(catalog, entry, identity)));
	for (const entry of entries) {
		const path = workspaceRecoveryRecordPath(catalog, entry, identity);
		if (versions.has(path)) continue;
		const key = buildWorkspaceDirtyEntryPath(catalog.getContext(entry.contextId).projectRootPath, entry.contextId, entry.path);
		await workspaceRecords.write(path, records.get(key)!);
	}
}

export async function pruneWorkspaceDirtySources(catalog: WorkspaceSourceCatalog, previous: readonly PersistedDirtyEntry[],
	current: readonly PersistedDirtyEntry[], identity?: string): Promise<void> {
	const retained = new Set(current.map(entry => workspaceRecoveryRecordPath(catalog, entry, identity)));
	for (const entry of previous) {
		const path = workspaceRecoveryRecordPath(catalog, entry, identity);
		if (!retained.has(path)) await workspaceRecords.delete(path);
	}
}
