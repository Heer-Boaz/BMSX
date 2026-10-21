import type { ResourceDomain } from '../common/resource';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../runtime/sources';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceDirtyRecordPath } from './files';
import { joinWorkspacePaths, stripProjectRootPrefix } from './path';
import { WORKSPACE_METADATA_DIR, workspaceRecords, type WorkspaceRecord } from './records';

export type PersistedDirtyEntry = { domain: ResourceDomain; path: string; updatedAt: number };

/** The source identity stays independent of a frontend's recovery namespace. */
export function workspaceRecoveryRecordPath(sources: RuntimeSourceState, entry: PersistedDirtyEntry, identity?: string): string {
	const root = runtimeSourceProjectRootPath(sources, entry.domain);
	const dirtyPath = buildWorkspaceDirtyEntryPath(root, entry.domain, entry.path);
	const path = identity === undefined ? dirtyPath : joinWorkspacePaths(root, WORKSPACE_METADATA_DIR,
		'studio', identity, stripProjectRootPrefix(dirtyPath, joinWorkspacePaths(root, WORKSPACE_METADATA_DIR)));
	return buildWorkspaceDirtyRecordPath(path, entry.updatedAt);
}

/** Read every referenced immutable version before admitting a recovery generation. */
export async function loadWorkspaceDirtySources(sources: RuntimeSourceState, entries: readonly PersistedDirtyEntry[],
	read: (projectRoot: string, path: string) => Promise<WorkspaceRecord>, identity?: string): Promise<Map<string, WorkspaceRecord>> {
	return new Map(await Promise.all(entries.map(async entry => [
		buildWorkspaceDirtyEntryPath(runtimeSourceProjectRootPath(sources, entry.domain), entry.domain, entry.path),
		await read(runtimeSourceProjectRootPath(sources, entry.domain), workspaceRecoveryRecordPath(sources, entry, identity)),
	] as const)));
}

/** Publish data before its manifest; the caller publishes that manifest before pruning. */
export async function publishWorkspaceDirtySources(sources: RuntimeSourceState, entries: readonly PersistedDirtyEntry[],
	records: ReadonlyMap<string, WorkspaceRecord>, previous: readonly PersistedDirtyEntry[], identity?: string): Promise<void> {
	const versions = new Set(previous.map(entry => workspaceRecoveryRecordPath(sources, entry, identity)));
	for (const entry of entries) {
		const path = workspaceRecoveryRecordPath(sources, entry, identity);
		if (versions.has(path)) continue;
		const key = buildWorkspaceDirtyEntryPath(runtimeSourceProjectRootPath(sources, entry.domain), entry.domain, entry.path);
		await workspaceRecords.write(path, records.get(key)!);
	}
}

export async function pruneWorkspaceDirtySources(sources: RuntimeSourceState, previous: readonly PersistedDirtyEntry[],
	current: readonly PersistedDirtyEntry[], identity?: string): Promise<void> {
	const retained = new Set(current.map(entry => workspaceRecoveryRecordPath(sources, entry, identity)));
	for (const entry of previous) {
		const path = workspaceRecoveryRecordPath(sources, entry, identity);
		if (!retained.has(path)) await workspaceRecords.delete(path);
	}
}
